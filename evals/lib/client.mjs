import { randomUUID } from "node:crypto";

// A table or a chart is a part of the answer: the person reads it in the chat.
const SHOWS_A_RESULT = /^present_(?!progress)/u;

const strings = (value) =>
  typeof value === "string"
    ? [value]
    : value && typeof value === "object"
      ? Object.values(value).flatMap(strings)
      : typeof value === "number"
        ? [String(value)]
        : [];

// Without the fallback an empty field of a locale reads as empty, not as the default text.
const localeQuery = (locale, fallback = true) =>
  locale ? `&locale=${locale}${fallback ? "" : "&fallback-locale=none"}` : "";
// Without `draft` a read returns the live version and a write publishes when the data says so.
const draftQuery = (draft) => (draft ? "&draft=true" : "");

export function createClient(base) {
  let token = null;

  async function req(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `JWT ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json;

    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 500) };
    }

    if (!res.ok)
      throw Object.assign(new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`), {
        status: res.status,
      });

    return json;
  }

  return {
    req,
    async login(email, password) {
      token = (await req("POST", "/api/users/login", { email, password })).token;
    },
    getDoc: (collection, id, locale, { fallback = true, draft = true } = {}) =>
      req(
        "GET",
        `/api/${collection}/${id}?depth=0${draftQuery(draft)}${localeQuery(locale, fallback)}`
      ),
    getGlobal: (slug, locale, { fallback = true, draft = true } = {}) =>
      req(
        "GET",
        `/api/globals/${slug}?depth=0${draftQuery(draft)}${localeQuery(locale, fallback)}`
      ),
    patchDoc: (collection, id, data, locale, { draft = true } = {}) =>
      req(
        "PATCH",
        `/api/${collection}/${id}?depth=0${draftQuery(draft)}${localeQuery(locale)}`,
        data
      ),
    patchGlobal: (slug, data, locale, { draft = true } = {}) =>
      req("POST", `/api/globals/${slug}?depth=0${draftQuery(draft)}${localeQuery(locale)}`, data),
    deleteDoc: (collection, id) => req("DELETE", `/api/${collection}/${id}`),
    find: (collection, query = "") => req("GET", `/api/${collection}?depth=0&draft=true&${query}`),
    changes: (conversationId) =>
      req("GET", `/api/content-agent/changes?conversationId=${conversationId}`),
    discard: (conversationId, documents, force = false) =>
      req("POST", "/api/content-agent/discard", { conversationId, documents, force }),

    // The cut-off note and the false-write warning arrive after the finish event: read to the end marker.
    // `approve` is the person's answer to every confirmation card of the turn; `null` leaves it open.
    async send(
      prompt,
      {
        pageContext,
        conversationId = randomUUID(),
        timeoutMs = 600_000,
        history = [],
        onTool,
        approve = true,
      } = {}
    ) {
      const started = Date.now();
      const out = {
        conversationId,
        text: "",
        tools: [],
        instructions: [],
        shown: [],
        toolErrors: [],
        approvals: [],
        error: null,
        finishReason: null,
        seconds: 0,
      };
      // The endpoint takes the whole conversation on every turn.
      const messages = [...history, { role: "user", text: prompt }].map((m) => ({
        id: randomUUID(),
        role: m.role,
        parts: [{ type: "text", text: m.text }],
      }));
      const reply = { id: randomUUID(), role: "assistant", parts: [] };
      const names = new Map();
      const toolPart = (toolCallId) =>
        reply.parts.find((part) => part.toolCallId === toolCallId) ?? {};

      const take = (ev) => {
        if (ev.type === "start-step") reply.parts.push({ type: "step-start" });
        else if (ev.type === "text-delta") {
          const last = reply.parts.at(-1);

          out.text += ev.delta ?? "";
          if (last?.type === "text") last.text += ev.delta ?? "";
          else reply.parts.push({ type: "text", text: ev.delta ?? "" });
        } else if (ev.type === "tool-input-available") {
          names.set(ev.toolCallId, ev.toolName);
          out.tools.push(ev.toolName);
          if (typeof ev.input?.instruction === "string")
            out.instructions.push(ev.input.instruction);
          if (SHOWS_A_RESULT.test(ev.toolName)) out.shown.push(...strings(ev.input));
          reply.parts.push({
            ...(ev.dynamic
              ? { type: "dynamic-tool", toolName: ev.toolName }
              : { type: `tool-${ev.toolName}` }),
            toolCallId: ev.toolCallId,
            state: "input-available",
            input: ev.input,
            ...(ev.providerMetadata ? { callProviderMetadata: ev.providerMetadata } : {}),
          });
          onTool?.(ev.toolName);
        } else if (ev.type === "tool-approval-request") {
          out.approvals.push({ tool: names.get(ev.toolCallId), reason: ev.reason ?? null });
          Object.assign(toolPart(ev.toolCallId), {
            state: "approval-requested",
            approval: {
              id: ev.approvalId,
              ...(ev.reason ? { requestReason: ev.reason } : {}),
              ...(ev.signature ? { signature: ev.signature } : {}),
            },
          });
        } else if (ev.type === "tool-output-denied")
          Object.assign(toolPart(ev.toolCallId), { state: "output-denied" });
        else if (ev.type === "tool-output-error") {
          Object.assign(toolPart(ev.toolCallId), {
            state: "output-error",
            errorText: ev.errorText,
          });
          out.toolErrors.push({
            tool: names.get(ev.toolCallId),
            error: String(ev.errorText).slice(0, 300),
          });
        } else if (ev.type === "tool-output-available") {
          if (!ev.preliminary)
            Object.assign(toolPart(ev.toolCallId), {
              state: "output-available",
              output: ev.output,
            });
          if (typeof ev.output?.error === "string")
            out.toolErrors.push({
              tool: names.get(ev.toolCallId),
              error: ev.output.error.slice(0, 300),
            });
        } else if (ev.type === "error") out.error = String(ev.errorText).slice(0, 500);
        else if (ev.type === "finish") out.finishReason = ev.finishReason ?? null;
      };

      const request = async (sent) => {
        const res = await fetch(`${base}/api/content-agent/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `JWT ${token}` },
          body: JSON.stringify({
            messages: sent,
            conversationId,
            ...(pageContext ? { pageContext } : {}),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) {
          out.error = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;

          return false;
        }

        let buffer = "";
        const decoder = new TextDecoder();

        for await (const chunk of res.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let nl;

          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trimEnd();

            buffer = buffer.slice(nl + 1);
            if (!line.startsWith("data: ") || line === "data: [DONE]") continue;

            try {
              take(JSON.parse(line.slice(6)));
            } catch {
              continue;
            }
          }
        }

        return true;
      };

      const MAX_CONFIRMATIONS = 4;
      let sent = messages;

      for (let round = 0; round <= MAX_CONFIRMATIONS; round++) {
        if (!(await request(sent))) break;
        const asked = reply.parts.filter((part) => part.state === "approval-requested");

        if (!asked.length || approve === null) break;

        for (const part of asked) {
          part.state = "approval-responded";
          part.approval = {
            ...part.approval,
            approved: approve,
            ...(approve ? {} : { reason: "The person declined this in the chat." }),
          };
        }

        sent = [...messages, reply];
      }

      out.seconds = (Date.now() - started) / 1000;

      return out;
    },
  };
}
