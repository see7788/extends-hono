import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Handler } from "hono";
import browser from "./mcp/browser";
import codegraph from "./mcp/codegraph";
import PublicMcp from "./public";

const mcps = { browser, codegraph };

export default class Mcp {
  private readonly core: PublicMcp;
  honoHandler: Handler

  constructor(...args: ConstructorParameters<typeof McpServer>) {
    this.core = new PublicMcp(new McpServer(...args));
    this.honoHandler= this.core.handler
  }

  mcpRegister(name: keyof typeof mcps) {
    mcps[name](this.core);
    return this;
  }

  requestToolRegister(definition: Parameters<PublicMcp["requestToolRegister"]>[0]) {
    this.core.requestToolRegister(definition);
    return this
  }

}
