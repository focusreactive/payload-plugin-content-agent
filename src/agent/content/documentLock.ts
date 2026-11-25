import { quiet } from "../../promises.js";

const locks = new Map<string, Promise<unknown>>();

async function runAfter<Result>(prev: Promise<unknown>, task: () => Promise<Result>) {
  await quiet(prev);

  return task();
}

export async function withDocumentLock<Result>(
  key: string,
  task: () => Promise<Result>
): Promise<Result> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = runAfter(prev, task);
  const settled = quiet(run);

  locks.set(key, settled);

  try {
    return await run;
  } finally {
    if (locks.get(key) === settled) locks.delete(key);
  }
}

export const documentLockKey = (
  target: { collection?: string; global?: string },
  id?: string | number
): string => (target.global ? `global:${target.global}` : `${target.collection}#${id}`);
