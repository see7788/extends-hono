import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import RegisterFromNpm from "./public";

const mcp = new RegisterFromNpm().register({
  namespace: "docs",
  transport: () => new StreamableHTTPClientTransport(
    new URL("https://mcp.context7.com/mcp"),
  ),
});

export default mcp;
