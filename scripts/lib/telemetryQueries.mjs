// Facts the queries rely on:
// - input_tokens already includes the tokens read from the cache. Never add the two.
// - Runs nest: the orchestrator's run contains the sub-agent runs. Seconds are the
//   orchestrator's ("main"); never sum seconds across agents.
// - Rows are written without waiting, so read them a moment after the turn ends.

// - A price file is JSON: { "<model id>": { "input": 2, "cachedInput": 0.2, "output": 8 } },
//   in one currency per million tokens. `cachedInput` and `cacheWrite` default to `input`.
//   The model id is the one in the `model` key of a row's metadata.

const T = "content_agent.ca_agent_telemetry";
const num = (v) => Number(v ?? 0);
const MODEL_ROWS = `event_type IN ('step', 'model_call')`;
const MODEL = `coalesce(metadata->>'model', '(not recorded)')`;

/** The cost of the tokens of one model, or null when the price file has no such model. */
export function tokenCost(tokens, price) {
  if (!price) return null;
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens = 0 } = tokens;
  const fresh = inputTokens - cacheReadTokens - cacheWriteTokens;

  return (
    (fresh * price.input +
      cacheReadTokens * (price.cachedInput ?? price.input) +
      cacheWriteTokens * (price.cacheWrite ?? price.input) +
      outputTokens * price.output) /
    1e6
  );
}

/** The sum over the models, and the models the price file does not have. */
export function costOf(perModel, prices) {
  const unpriced = Object.keys(perModel).filter((model) => !prices?.[model]);
  const cost = Object.entries(perModel).reduce(
    (sum, [model, tokens]) => sum + (tokenCost(tokens, prices?.[model]) ?? 0),
    0
  );

  return { cost: unpriced.length === Object.keys(perModel).length ? null : cost, unpriced };
}

export async function conversationMetrics(db, conversationId, prices = null) {
  const { rows: agents } = await db.query(
    `SELECT agent_id,
       count(*) FILTER (WHERE event_type = 'step') AS steps,
       coalesce(sum(input_tokens), 0) AS input_tokens,
       coalesce(sum(output_tokens), 0) AS output_tokens,
       coalesce(sum(cache_read_tokens), 0) AS cache_read_tokens,
       coalesce(sum(duration_ms) FILTER (WHERE event_type IN ('agent_run', 'model_call')), 0) AS run_ms,
       count(*) FILTER (WHERE event_type IN ('agent_run', 'model_call')) AS runs,
       count(*) FILTER (WHERE event_type IN ('agent_run', 'model_call') AND NOT success) AS failed_runs,
       count(*) FILTER (WHERE event_type = 'tool_call') AS tool_calls,
       count(*) FILTER (WHERE event_type = 'tool_call' AND NOT success) AS failed_tool_calls
     FROM ${T} WHERE conversation_id = $1 GROUP BY agent_id ORDER BY agent_id`,
    [conversationId]
  );
  const { rows: failures } = await db.query(
    `SELECT agent_id, tool_name, left(error, 300) AS error FROM ${T}
     WHERE conversation_id = $1 AND event_type = 'tool_call' AND NOT success ORDER BY created_at, id`,
    [conversationId]
  );
  const { rows: models } = await db.query(
    `SELECT ${MODEL} AS model,
       coalesce(sum(input_tokens), 0) AS input_tokens,
       coalesce(sum(output_tokens), 0) AS output_tokens,
       coalesce(sum(cache_read_tokens), 0) AS cache_read_tokens,
       coalesce(sum(cache_write_tokens), 0) AS cache_write_tokens
     FROM ${T} WHERE conversation_id = $1 AND ${MODEL_ROWS} GROUP BY 1 ORDER BY 1`,
    [conversationId]
  );
  const perModel = Object.fromEntries(
    models.map((m) => [
      m.model,
      {
        inputTokens: num(m.input_tokens),
        outputTokens: num(m.output_tokens),
        cacheReadTokens: num(m.cache_read_tokens),
        cacheWriteTokens: num(m.cache_write_tokens),
      },
    ])
  );
  const perAgent = Object.fromEntries(
    agents.map((a) => [
      a.agent_id,
      {
        steps: num(a.steps),
        inputTokens: num(a.input_tokens),
        outputTokens: num(a.output_tokens),
        cacheReadTokens: num(a.cache_read_tokens),
        seconds: num(a.run_ms) / 1000,
        runs: num(a.runs),
        failedRuns: num(a.failed_runs),
        toolCalls: num(a.tool_calls),
        failedToolCalls: num(a.failed_tool_calls),
      },
    ])
  );
  const sum = (key) => Object.values(perAgent).reduce((n, a) => n + a[key], 0);
  const inputTokens = sum("inputTokens");

  return {
    rows: agents.length > 0,
    steps: sum("steps"),
    inputTokens,
    outputTokens: sum("outputTokens"),
    cacheReadTokens: sum("cacheReadTokens"),
    cachedShare: inputTokens ? sum("cacheReadTokens") / inputTokens : 0,
    seconds: perAgent.main?.seconds ?? 0,
    toolCalls: sum("toolCalls"),
    failedToolCalls: sum("failedToolCalls"),
    failedRuns: sum("failedRuns"),
    failures: failures.map((f) => ({ agent: f.agent_id, tool: f.tool_name, error: f.error })),
    perAgent,
    perModel,
    ...(prices ? costOf(perModel, prices) : {}),
  };
}

export async function waitForRun(db, conversationId, timeoutMs = 8000) {
  const until = Date.now() + timeoutMs;

  for (;;) {
    const { rows } = await db.query(
      `SELECT 1 FROM ${T} WHERE conversation_id = $1 AND agent_id = 'main' AND event_type = 'agent_run' LIMIT 1`,
      [conversationId]
    );

    if (rows.length) {
      await new Promise((r) => setTimeout(r, 300)); // let the last tool rows land

      return true;
    }

    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function modelTokens(db, since, prices) {
  const { rows } = await db.query(
    `SELECT ${MODEL} AS model, count(*)::int AS calls,
       coalesce(sum(input_tokens), 0) AS input_tokens,
       coalesce(sum(output_tokens), 0) AS output_tokens,
       coalesce(sum(cache_read_tokens), 0) AS cache_read_tokens,
       coalesce(sum(cache_write_tokens), 0) AS cache_write_tokens
     FROM ${T} WHERE ${MODEL_ROWS} AND ($1::timestamptz IS NULL OR created_at >= $1::timestamptz)
     GROUP BY 1 ORDER BY sum(coalesce(input_tokens, 0)) DESC`,
    [since]
  );

  return rows.map((row) => {
    const tokens = {
      inputTokens: num(row.input_tokens),
      outputTokens: num(row.output_tokens),
      cacheReadTokens: num(row.cache_read_tokens),
      cacheWriteTokens: num(row.cache_write_tokens),
    };
    const cost = prices ? tokenCost(tokens, prices[row.model]) : undefined;

    return {
      model: row.model,
      calls: row.calls,
      input_tokens: tokens.inputTokens,
      cached_input_tokens: tokens.cacheReadTokens,
      output_tokens: tokens.outputTokens,
      ...(prices ? { cost: cost === null ? "no price" : Number(cost.toFixed(4)) } : {}),
    };
  });
}

export async function report(db, since = null, prices = null) {
  const q = async (sql) => (await db.query(sql, [since])).rows;
  const W = `($1::timestamptz IS NULL OR created_at >= $1::timestamptz)`;

  return {
    [prices ? "Tokens and cost per model" : "Tokens per model"]: await modelTokens(
      db,
      since,
      prices
    ),
    "Tool reliability (calls, failed, failed share)": await q(
      `SELECT agent_id AS agent, tool_name AS tool, count(*)::int AS calls,
         count(*) FILTER (WHERE NOT success)::int AS failed,
         round(100.0 * count(*) FILTER (WHERE NOT success) / count(*), 1) || '%' AS failed_share
       FROM ${T} WHERE event_type = 'tool_call' AND ${W}
       GROUP BY 1, 2 ORDER BY count(*) FILTER (WHERE NOT success) DESC, count(*) DESC LIMIT 40`
    ),
    "Most frequent tool errors": await q(
      `SELECT tool_name AS tool, count(*)::int AS times, left(error, 160) AS error
       FROM ${T} WHERE event_type = 'tool_call' AND NOT success AND ${W}
       GROUP BY 1, 3 ORDER BY 2 DESC LIMIT 20`
    ),
    "The same call repeated in one conversation": await q(
      `SELECT tool_name AS tool, count(*)::int AS times, conversation_id AS conversation, left(metadata->>'input', 120) AS input
       FROM ${T} WHERE event_type = 'tool_call' AND metadata ? 'input' AND ${W}
       GROUP BY tool_name, conversation_id, metadata->>'input' HAVING count(*) > 1 ORDER BY 2 DESC LIMIT 20`
    ),
    "Per agent: steps per run, tokens per step, cached share": await q(
      `WITH runs AS (
         SELECT agent_id, count(*) AS runs, avg(duration_ms) AS avg_ms, max(duration_ms) AS max_ms,
           count(*) FILTER (WHERE NOT success) AS failed
         FROM ${T} WHERE event_type IN ('agent_run', 'model_call') AND ${W} GROUP BY 1),
       steps AS (
         SELECT agent_id, count(*) AS steps, avg(input_tokens) AS avg_in, sum(input_tokens) AS sum_in,
           sum(cache_read_tokens) AS sum_cache
         FROM ${T} WHERE event_type IN ('step', 'model_call') AND ${W} GROUP BY 1)
       SELECT r.agent_id AS agent, r.runs::int, r.failed::int AS failed_runs,
         round(s.steps::numeric / r.runs, 1) AS steps_per_run, round(s.avg_in)::int AS input_tokens_per_step,
         CASE WHEN s.sum_in > 0 THEN round(100.0 * coalesce(s.sum_cache, 0) / s.sum_in, 1) || '%' END AS cached_share,
         round(r.avg_ms / 1000, 1) AS avg_seconds, round(r.max_ms / 1000.0, 1) AS max_seconds
       FROM runs r LEFT JOIN steps s USING (agent_id) ORDER BY 1`
    ),
    "Most expensive conversations (input and output tokens)": await q(
      `SELECT conversation_id AS conversation, sum(input_tokens)::int AS input_tokens,
         sum(output_tokens)::int AS output_tokens, count(*) FILTER (WHERE event_type = 'step')::int AS steps,
         min(created_at)::date AS day
       FROM ${T} WHERE ${W} GROUP BY 1 ORDER BY sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)) DESC NULLS LAST LIMIT 10`
    ),
    "Write tools that reported no change": await q(
      `SELECT tool_name AS tool, count(*)::int AS times
       FROM ${T} WHERE event_type = 'tool_call' AND ${W}
         AND (error ILIKE '%nothing changed%' OR error ILIKE '%no change%' OR metadata->>'outputPreview' ILIKE '%nothing changed%')
       GROUP BY 1 ORDER BY 2 DESC LIMIT 20`
    ),
  };
}
