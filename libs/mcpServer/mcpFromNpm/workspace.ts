import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import RegisterFromNpm from "./public";

const mcp = new RegisterFromNpm().register({
  namespace: "workspace",
  transport: () => new StdioClientTransport({
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["-y", "@wonderwhy-er/desktop-commander@0.2.46"],
  }),
});

export default mcp;
