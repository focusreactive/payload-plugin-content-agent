interface ExecutableLike {
  execute?: (input: never, options: never) => unknown;
}

export interface UntrustedInput {
  seen: boolean;
}

export function createUntrustedMarker(untrustedInput: UntrustedInput) {
  return <ToolType extends ExecutableLike>(tool: ToolType): ToolType => {
    const execute = tool?.execute;

    return typeof execute !== "function"
      ? tool
      : {
          ...tool,
          execute: async (params: never, callOptions: never) => {
            untrustedInput.seen = true;

            return execute.call(tool, params, callOptions);
          },
        };
  };
}
