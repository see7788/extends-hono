import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import mcp from "extends-hono/createMcpServer/index.ts";
import { z } from "zod";

const browserClient = new Client({
  name: "extends-hono-browser",
  version: "0.0.0",
});

await browserClient.connect(new StdioClientTransport({
  command: "npx",
  args: [
    "-y",
    "--cache",
    "C:/Users/diyya/.codex/npm-cache",
    "chrome-devtools-mcp@1.6.0",
    "--autoConnect",
    "--experimentalIncludeAllPages",
  ],
}));

mcp.registerTool("environment.check", {
  description: "Checks MCP environment capabilities and reports unresolved external issues.",
}, async () => {
  let environmentBugs: string[];
  try {
    await browserClient.callTool({ name: "list_pages", arguments: {} });
    environmentBugs = [];
  } catch (error) {
    environmentBugs = [error instanceof Error ? error.message : String(error)];
  }
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(environmentBugs),
    }],
  };
});

const browserTools = await browserClient.listTools();

for (const browserTool of browserTools.tools) {
  mcp.registerTool(browserTool.name, {
    title: browserTool.title,
    description: browserTool.description,
    inputSchema: z.fromJSONSchema(browserTool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]),
    outputSchema: browserTool.outputSchema ? z.fromJSONSchema(browserTool.outputSchema as Parameters<typeof z.fromJSONSchema>[0]) : undefined,
    annotations: browserTool.annotations,
    _meta: browserTool._meta,
  }, async (toolArguments: unknown) => (await browserClient.callTool({
    name: browserTool.name,
    arguments: toolArguments as Record<string, unknown>,
  })) as unknown as CallToolResult);
}
