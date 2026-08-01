import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { Hono } from "hono";
import type { HonoBase } from "hono/hono-base";
import type { BlankEnv, MergePath, MergeSchemaPath, Schema } from "hono/types";
import { appendFile } from "node:fs/promises";
import { inspect } from "node:util";
import aiCallAi from "./mcp/ai-call-ai";
import { Overview } from "./mcp/overview";
import watcher from "./mcp/watcher";
import browser from "./mcpFromNpm/browser";
import codegraph from "./mcpFromNpm/codegraph";
import docs from "./mcpFromNpm/docs";
import io from "./mcpFromNpm/io";
import RegisterFromNpm from "./mcpFromNpm/public";
import workspace from "./mcpFromNpm/workspace";
import type Register from "./public";

const mcp = {
  "ai-call-ai": aiCallAi,
  watcher,
};
const mcpFromNpm = { browser, codegraph, docs, io, workspace };
const mcpFromNpmCreate = () => ({
  browser: new RegisterFromNpm(browser),
  codegraph: new RegisterFromNpm(codegraph),
  docs: new RegisterFromNpm(docs),
  io: new RegisterFromNpm(io),
  workspace: new RegisterFromNpm(workspace),
});
const frameworkNamespace = "todo-mcp2";
const humanRouteRoot = "todo-mcp2";
const errorLog = new URL("./log.txt", import.meta.url);
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
  private readonly registrations: [string, Register<any>][] = [];
  private readonly mcpFromNpm = mcpFromNpmCreate();
  private readonly productMounts = new Map<
    keyof typeof mcpFromNpm,
    Promise<void>
  >();
  private readonly productsMounted = new Set<keyof typeof mcpFromNpm>();
  private healthAuditError?: unknown;
  private healthAuditRunning?: Promise<void>;
  readonly hono: HonoBase<BlankEnv, CurrentSchema, "/", "/">;

  constructor(...args: ConstructorParameters<typeof McpServer>) {
    const overview = new Overview();
    this.hono = new Hono() as HonoBase<BlankEnv, CurrentSchema, "/", "/">;
    this.hono.use("*", async (context, next) => {
      await next();
      const requestError = context.error;
      if (!requestError) return;
      try {
        await appendFile(errorLog, [
          `[${new Date().toISOString()}] ${context.req.method} ${context.req.path}`,
          inspect(requestError, { depth: null }),
          "",
        ].join("\n"), "utf8");
      } catch (logError) {
        throw new AggregateError(
          [requestError, logError],
          `Request failed and could not be written to ${errorLog.pathname}.`,
        );
      }
    });
    for (const [namespace, integration] of Object.entries(mcp)) {
      integration.honoMount(namespace, this.hono);
    }
    const productNames = Object.keys(mcpFromNpm) as (keyof typeof mcpFromNpm)[];
    const productResults = Promise.allSettled(
      productNames.map(name => this.productMount(name)),
    );
    const productsReady = async () => {
      if (this.healthAuditError) {
        throw new Error("External MCP health audit failed.", { cause: this.healthAuditError });
      }
      const results = await productResults;
      const errors = results.flatMap((result, index) => (
        !this.productsMounted.has(productNames[index])
          ? [new Error(
              `mcpFromNpm.${productNames[index]} is unavailable.`,
              result.status === "rejected" ? { cause: result.reason } : undefined,
            )]
          : []
      ));
      if (errors.length) {
        throw new AggregateError(errors, "External MCP products failed to mount.");
      }
    };
    const healthAuditTimer = setInterval(() => {
      if (this.healthAuditRunning || this.healthAuditError) return;
      const audit = this.productsHealthAudit()
        .catch(error => {
          this.healthAuditError = error;
        })
        .finally(() => {
          if (this.healthAuditRunning === audit) this.healthAuditRunning = undefined;
        });
      this.healthAuditRunning = audit;
    }, 20_000);
    healthAuditTimer.unref();
    overview.mcp.honoMount(humanRouteRoot, this.hono);
    overview.toolsSet(async () => {
      await productsReady();
      return this.overviewToolsGet(overview);
    });
    const handler = createMcpHandler(() => {
      const server = new McpServer(...args);
      for (const [namespace, integration] of Object.entries(mcp)) {
        integration.serverMount(namespace, server);
      }
      for (const [namespace, integration] of this.registrations) {
        integration.serverMount(namespace, server);
      }
      for (const name of this.productsMounted) {
        this.mcpFromNpm[name].serverMount(server);
      }
      overview.mcp.serverMount(frameworkNamespace, server);
      return server;
    });
    this.hono.all("/todo-mcp", async (ctx) => {
      await productsReady();
      return handler.fetch(ctx.req.raw);
    });
  }

  register<
    const Namespace extends string,
    FragmentSchema extends Schema,
  >(
    namespace: Namespace,
    mcp: Register<FragmentSchema>,
  ): Mcp<NextSchema<CurrentSchema, `/${Namespace}`, FragmentSchema>> {
    mcp.honoMount(namespace, this.hono);
    this.registrations.push([namespace, mcp]);
    return this as Mcp<NextSchema<CurrentSchema, `/${Namespace}`, FragmentSchema>>;
  }

  private productMount(name: keyof typeof mcpFromNpm) {
    const mounted = this.productMounts.get(name);
    if (mounted) return mounted;
    const mounting = this.mcpFromNpm[name]
      .mount(this.hono)
      .then(() => {
        this.productsMounted.add(name);
      })
      .catch(error => {
        this.productsMounted.delete(name);
        if (this.productMounts.get(name) === mounting) {
          this.productMounts.delete(name);
        }
        throw error;
      });
    this.productMounts.set(name, mounting);
    return mounting;
  }

  private async productsHealthAudit() {
    const productNames = [...this.productsMounted];
    const results = await Promise.allSettled(
      productNames.map(name => this.mcpFromNpm[name].healthAudit()),
    );
    const errors: Error[] = [];
    results.forEach((result, index) => {
      const name = productNames[index]!;
      if (result.status === "rejected") {
        errors.push(new Error(`mcpFromNpm.${name} health audit failed.`, { cause: result.reason }));
        return;
      }
      if (!result.value) return;
      this.productsMounted.delete(name);
      this.productMounts.delete(name);
    });
    if (errors.length > 0) {
      throw new AggregateError(errors, "External MCP products health audit failed.");
    }
  }

  private overviewToolsGet(overview: Overview) {
    const tools: ReturnType<Register["toolsGet"]> = [];
    for (const [namespace, integration] of Object.entries(mcp)) {
      tools.push(...integration.toolsGet(namespace));
    }
    for (const [namespace, integration] of this.registrations) {
      tools.push(...integration.toolsGet(namespace));
    }
    for (const name of this.productsMounted) {
      tools.push(...this.mcpFromNpm[name].toolsGet());
    }
    tools.push(...overview.mcp.toolsGet(frameworkNamespace));
    return tools;
  }

  async registerFromNpm<const Name extends keyof typeof mcpFromNpm>(
    name: Name,
  ): Promise<Mcp<NextFromNpmSchema<CurrentSchema, (typeof mcpFromNpm)[Name]>>> {
    await this.productMount(name);
    return this as Mcp<
      NextFromNpmSchema<CurrentSchema, (typeof mcpFromNpm)[Name]>
    >;
  }
}
