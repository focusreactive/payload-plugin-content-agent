export function withErrorHandling<TArgs, TResult>(
  operation: (args: TArgs) => Promise<TResult>
): (args: TArgs) => Promise<TResult | { error: string }> {
  return async (args: TArgs) => {
    try {
      return await operation(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";

      console.error("[Content Agent] Tool error:", message, err);

      return { error: `Operation failed: ${message}` };
    }
  };
}
