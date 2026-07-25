import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Handler } from "hono";
import type { ZodObject, ZodRawShape, output } from "zod";
import browser from "./mcp/browser";
import codegraph from "./mcp/codegraph";
import PublicMcp from "./public";

const mcps = { browser, codegraph } as const;

export default class Mcp {
  private readonly core: PublicMcp;
  readonly honoHandler: Handler;

  constructor(...args: ConstructorParameters<typeof McpServer>) {
    this.core = new PublicMcp(new McpServer(...args));
    this.honoHandler = this.core.handler;
  }

  mcpRegister(name: keyof typeof mcps) {
    mcps[name](this.core);
    return this;
  }

  requestToolRegister<InputArgs extends ZodRawShape>(
    definition: Omit<Parameters<PublicMcp["requestToolRegister"]>[0], "inputSchema" | "request"> & {
      inputSchema: ZodObject<InputArgs>;
      request: (arguments_: output<ZodObject<InputArgs>>) => Response | Promise<Response>;
    },
  ) {
    this.core.requestToolRegister(definition);
    return this;
  }

}
