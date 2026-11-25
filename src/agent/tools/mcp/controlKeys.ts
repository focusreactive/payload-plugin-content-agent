/** Parameters of a Payload MCP update call that are not fields of the document. */
export const UPDATE_CONTROL_KEYS = new Set([
  "id",
  "_status",
  "draft",
  "depth",
  "locale",
  "fallbackLocale",
  "overrideLock",
  "autosave",
  "where",
]);
