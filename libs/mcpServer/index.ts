import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import type { HonoBase } from "hono/hono-base";
import type { BlankEnv, MergePath, MergeSchemaPath, Schema } from "hono/types";
import watcher from "./mcp/watcher";
import browser from "./mcpFromNpm/browser";
import codegraph from "./mcpFromNpm/codegraph";
import docs from "./mcpFromNpm/docs";
import type RegisterFromNpm from "./mcpFromNpm/public";
import workspace from "./mcpFromNpm/workspace";
import type Register from "./public";

const mcpFromNpm = { browser, codegraph, docs, workspace };
type NextSchema<
  CurrentSchema extends Schema,
  Path extends string,
  ChildSchema extends Schema,
> = CurrentSchema | MergeSchemaPath<ChildSchema, MergePath<"/", Path>>;
type NextFromNpmSchema<
  CurrentSchema extends Schema,
  Product,
> = Product extends RegisterFromNpm<
  infer Namespace extends string,
  infer FragmentSchema extends Schema
>
  ? NextSchema<CurrentSchema, `/${Namespace}`, FragmentSchema>
  : CurrentSchema;

export default class Mcp<CurrentSchema extends Schema = {}> {
  private readonly server: McpServer;
  readonly hono: HonoBase<BlankEnv, CurrentSchema, "/", "/">;

  constructor(...args: ConstructorParameters<typeof McpServer>) {
    this.server = new McpServer(...args);
    this.hono = new Hono() as HonoBase<BlankEnv, CurrentSchema, "/", "/">;
    watcher.mount("watcher", this.server, this.hono);
    this.hono.get("/watcher/time", async context => {
      try {
        const answer = await this.server.server.createMessage({
          messages: [{
            role: "user",
            content: { type: "text", text: "现在几点" },
          }],
          maxTokens: 4096,
        });
        console.log("[aiAnswer]", answer.content);
        return context.json(answer.content);
      } catch (error) {
        console.error("[aiAnswer]", error);
        return context.text(error instanceof Error ? error.message : String(error), 503);
      }
    });
    const transport = new StreamableHTTPTransport();
    let connection: Promise<void> | undefined;
    this.hono.all("/mcp", async (ctx) => {
      connection ??= this.server.connect(transport);
      await connection;
      return transport.handleRequest(ctx);
    });
  }

  register<
    const Namespace extends string,
    FragmentSchema extends Schema,
  >(
    namespace: Namespace,
    mcp: Register<FragmentSchema>,
  ): Mcp<NextSchema<CurrentSchema, `/${Namespace}`, FragmentSchema>> {
    mcp.mount(namespace, this.server, this.hono);
    return this as Mcp<NextSchema<CurrentSchema, `/${Namespace}`, FragmentSchema>>;
  }

  async registerFromNpm<const Name extends keyof typeof mcpFromNpm>(
    name: Name,
  ): Promise<Mcp<NextFromNpmSchema<CurrentSchema, (typeof mcpFromNpm)[Name]>>> {
    await mcpFromNpm[name].mount(this.server, this.hono);
    return this as Mcp<
      NextFromNpmSchema<CurrentSchema, (typeof mcpFromNpm)[Name]>
    >;
  }
}
