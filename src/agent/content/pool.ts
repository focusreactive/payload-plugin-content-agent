export async function runPool<Item, Result>(
  items: Item[],
  limit: number,
  worker: (item: Item, index: number) => Promise<Result>
): Promise<Result[]> {
  const results: Result[] = new Array(items.length);
  let next = 0;

  const runner = async (): Promise<void> => {
    while (true) {
      const i = next++;

      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  };

  const workers = Math.max(1, Math.min(limit, items.length));

  await Promise.all(Array.from({ length: workers }, runner));

  return results;
}
