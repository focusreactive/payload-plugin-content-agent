import { withPayload } from "@payloadcms/next/withPayload";

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@ai-sdk/openai", "@ai-sdk/anthropic", "@ai-sdk/mcp"],
};

export default withPayload(nextConfig);
