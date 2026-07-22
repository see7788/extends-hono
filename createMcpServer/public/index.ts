import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const publicMcp = {
  server: new McpServer({
    name: "extends-hono",
    version: "0.0.0",
  }),
  transport: new StreamableHTTPTransport(),
  responseContentRead: async (response: Response) => {
    const text = await response.text();
    if (!response.ok) throw new Error(text || String(response.status));
    const body: unknown = text ? JSON.parse(text) : String(response.status);
    return {
      content: [{
        type: "text" as const,
        text: typeof body === "string" ? body : JSON.stringify(body),
      }],
    };
  },
};

export default publicMcp;
