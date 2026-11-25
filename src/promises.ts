export async function quiet(promise: unknown): Promise<void> {
  try {
    await promise;
  } catch {}
}

export async function caught<Value>(
  promise: PromiseLike<Value>,
  onError: (err: unknown) => void
): Promise<Value | undefined> {
  try {
    return await promise;
  } catch (err) {
    onError(err);

    return undefined;
  }
}
