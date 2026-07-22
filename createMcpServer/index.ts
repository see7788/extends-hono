import { Hono } from "hono";
import publicMcp from "extends-hono/createMcpServer/public.ts";

const mcp = Object.assign(new Hono().all("/", async (ctx) => {
  if (!publicMcp.server.isConnected()) await publicMcp.server.connect(publicMcp.transport);
  return publicMcp.transport.handleRequest(ctx);
}), {
  registerTool: publicMcp.server.registerTool.bind(publicMcp.server),
  responseContentRead: publicMcp.responseContentRead,
});

export default mcp;
