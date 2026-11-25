import type { Endpoint, PayloadHandler, PayloadRequest } from "payload";
import type { ContentAgentPluginOptions, ResolvedPluginOptions, SchemaContext } from "../types.js";
import { createChatHandler } from "../api/chatEndpoint.js";
import { createConversationsHandler } from "../api/conversationsEndpoint.js";
import { createMessagesHandler } from "../api/messagesEndpoint.js";
import { createInitHandlers } from "../api/initEndpoint.js";
import { createReviewHandlers } from "../api/reviewEndpoint.js";
import { createRatingHandlers } from "../api/ratingEndpoint.js";
import type { MemoryService } from "../memory/index.js";
import type { ModuleEndpoint } from "../sdk/contract.js";
import { DEFAULTS } from "./runtime.js";
import type { PluginRuntime } from "./runtime.js";

export type EndpointGuard = (handler: PayloadHandler) => PayloadHandler;

export interface RuntimeAccess {
  getOptions: () => Promise<ResolvedPluginOptions>;
  ensureSchema: (req: PayloadRequest) => Promise<SchemaContext>;
  getMemory: () => Promise<MemoryService | null>;
}

export interface NamedModuleEndpoint {
  module: string;
  endpoint: ModuleEndpoint;
}

// Default: users of the admin auth collection only. MCP reads and writes run under the shared
// plugin API key, not the caller's own permissions.
export const createEndpointGuard =
  (pluginOptions: ContentAgentPluginOptions): EndpointGuard =>
  (handler) =>
  async (req) => {
    if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const allowed = pluginOptions.access
        ? await pluginOptions.access({ req })
        : String(req.user.collection ?? "") === String(req.payload.config.admin?.user ?? "users");

      if (!allowed) return Response.json({ error: "Forbidden" }, { status: 403 });
    } catch (err) {
      console.error("[Content Agent] access() option threw - failing closed:", err);

      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    return handler(req);
  };

export function collectModuleEndpoints(runtime: PluginRuntime): NamedModuleEndpoint[] {
  return runtime.modules.flatMap((module) =>
    (module.endpoints?.(runtime.moduleCtx) ?? []).map((endpoint) => ({
      module: module.name,
      endpoint,
    }))
  );
}

export function coreEndpoints(
  pluginOptions: ContentAgentPluginOptions,
  access: RuntimeAccess,
  guardEndpoint: EndpointGuard
): Endpoint[] {
  const { getOptions, ensureSchema, getMemory } = access;
  const init = createInitHandlers(getOptions, ensureSchema, getMemory);
  const review = createReviewHandlers(ensureSchema, getMemory);
  const rating = createRatingHandlers(getMemory);

  return [
    {
      path: pluginOptions.apiRoute ?? DEFAULTS.apiRoute,
      method: "post",
      handler: guardEndpoint(async (req) => {
        const opts = await getOptions();
        const resolvedSchema = await ensureSchema(req);
        const memory = await getMemory();

        return createChatHandler(resolvedSchema, opts, memory)(req);
      }),
    },
    {
      path: "/content-agent/conversations",
      method: "get",
      handler: guardEndpoint(createConversationsHandler(getMemory)),
    },
    {
      path: "/content-agent/messages",
      method: "get",
      handler: guardEndpoint(createMessagesHandler(getMemory)),
    },
    {
      path: "/content-agent/init",
      method: "get",
      handler: guardEndpoint(init.status),
    },
    {
      path: "/content-agent/init",
      method: "post",
      handler: guardEndpoint(init.run),
    },
    {
      path: "/content-agent/diff",
      method: "get",
      handler: guardEndpoint(review.diff),
    },
    {
      path: "/content-agent/publish",
      method: "post",
      handler: guardEndpoint(review.publish),
    },
    {
      path: "/content-agent/changes",
      method: "get",
      handler: guardEndpoint(review.changes),
    },
    {
      path: "/content-agent/discard",
      method: "post",
      handler: guardEndpoint(review.discard),
    },
    ...(pluginOptions.chatRating
      ? [
          {
            path: "/content-agent/rating",
            method: "post" as const,
            handler: guardEndpoint(rating.submit),
          },
          {
            path: "/content-agent/rating",
            method: "get" as const,
            handler: guardEndpoint(rating.get),
          },
        ]
      : []),
  ];
}

const routeOf = (endpoint: { method: string; path: string }) =>
  `${endpoint.method.toUpperCase()} ${endpoint.path}`;

export function assertFreeRoutes(
  endpoints: Endpoint[] | undefined,
  moduleEndpoints: NamedModuleEndpoint[]
): void {
  const taken = new Set(
    (endpoints ?? []).slice(0, (endpoints ?? []).length - moduleEndpoints.length).map(routeOf)
  );

  for (const { module, endpoint } of moduleEndpoints) {
    if (taken.has(routeOf(endpoint))) {
      throw new Error(
        `[Content Agent] module "${module}": endpoint ${routeOf(endpoint)} is already registered.`
      );
    }

    taken.add(routeOf(endpoint));
  }
}
