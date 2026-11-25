// A registered symbol, so two loaded copies of the SDK agree on it.
const UNTRUSTED = Symbol.for("payload-content-agent.untrusted");

/**
 * Marks a tool whose output comes from outside the CMS (the web, a third-party API). After it
 * runs, the agent saves no shared memory in that turn. Returns the same tool, or a marked copy
 * of a frozen one.
 * @public
 */
export function markUntrusted<Tool extends object>(tool: Tool): Tool {
  const target = Object.isExtensible(tool)
    ? tool
    : (Object.create(Object.getPrototypeOf(tool), Object.getOwnPropertyDescriptors(tool)) as Tool);

  Object.defineProperty(target, UNTRUSTED, { value: true, enumerable: false, configurable: true });

  return target;
}

/**
 * Whether `markUntrusted` produced this tool. Internal to the plugin.
 * @internal
 */
export function isMarkedUntrusted(tool: unknown): boolean {
  return (
    typeof tool === "object" &&
    tool !== null &&
    (tool as Record<symbol, unknown>)[UNTRUSTED] === true
  );
}
