// import publicMcp from "extends-hono/createMcpServer/public";
// import "extends-hono/createMcpServer/mcp/public";
// await publicMcp.server.connect(transport);

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import publicMcp from "../../public/index.js";
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

publicMcp.server.registerTool("environment.check", {
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
  publicMcp.server.registerTool(browserTool.name, {
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
  publicMcp.server.registerTool(codegraphTool.name, {
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
