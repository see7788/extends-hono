import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import mcp from "extends-hono/createMcpServer/index.ts";
import { z } from "zod";

const codegraphClient = new Client({
  name: "extends-hono-codegraph",
  version: "0.0.0",
});

await codegraphClient.connect(new StdioClientTransport({
  command: "npx",
  args: ["-y", "@colbymchenry/codegraph@1.4.1", "serve", "--mcp"],
}));

const codegraphTools = await codegraphClient.listTools();

for (const codegraphTool of codegraphTools.tools) {
  mcp.registerTool(codegraphTool.name, {
    title: codegraphTool.title,
    description: codegraphTool.description,
    inputSchema: z.fromJSONSchema(codegraphTool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]),
    outputSchema: codegraphTool.outputSchema ? z.fromJSONSchema(codegraphTool.outputSchema as Parameters<typeof z.fromJSONSchema>[0]) : undefined,
    annotations: codegraphTool.annotations,
    _meta: codegraphTool._meta,
  }, async (toolArguments: unknown) => (await codegraphClient.callTool({
    name: codegraphTool.name,
    arguments: toolArguments as Record<string, unknown>,
  })) as unknown as CallToolResult);
}
