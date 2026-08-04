import { createMcpHandler, McpServer, type Tool } from "@modelcontextprotocol/server";
import { Hono } from "hono";
import type { HonoBase } from "hono/hono-base";
import type { BlankEnv, MergePath, MergeSchemaPath, Schema } from "hono/types";
import { inspect } from "node:util";
import { z } from "zod";
import aiCallAi from "./mcp/ai-call-ai";
import { Overview } from "./mcp/overview";
import watcher from "./mcp/watcher";
import workcopy from "./mcp/workcopy";
import browser from "./mcpFromNpm/browser";
import codegraph from "./mcpFromNpm/codegraph";
import docs from "./mcpFromNpm/docs";
import io from "./mcpFromNpm/io";
import RegisterFromNpm from "./mcpFromNpm/public";
import workspace from "./mcpFromNpm/workspace";
import type Register from "./public";
import type { RegistrationData, ToolRegistration } from "./public";
import store from "./store";

const localRegisters = [aiCallAi, watcher, workcopy] as const;
const packageRegisters = { browser, codegraph, docs, io, workspace } as const;
type AnyRegistrationData = RegistrationData<any, any>;
type AnyPackageRegister = RegisterFromNpm<any, any>;
type NextSchema<
  CurrentSchema extends Schema,
  Namespace extends string,
  FragmentSchema extends Schema,
> = CurrentSchema | MergeSchemaPath<FragmentSchema, MergePath<"/", `/${Namespace}`>>;

const toolOverviewCreate = (tool: ToolRegistration): Tool => ({
  name: tool.name,
  description: tool.config.description,
  inputSchema: z.toJSONSchema(tool.config.inputSchema, {
    io: "input",
    target: "draft-2020-12",
  }) as Tool["inputSchema"],
  outputSchema: tool.config.outputSchema
    ? z.toJSONSchema(tool.config.outputSchema as unknown as z.ZodType, {
        io: "output",
        target: "draft-2020-12",
      }) as Tool["outputSchema"]
    : undefined,
  annotations: tool.config.annotations,
  icons: tool.config.icons,
  _meta: tool.config._meta,
});

export default class Mcp<CurrentSchema extends Schema = {}> {
  private readonly localDeliveries: AnyRegistrationData[] = [];
  private readonly packageDeliveries = new Map<AnyPackageRegister, AnyRegistrationData>();
  private readonly packageDeliveryPromises = new Map<AnyPackageRegister, Promise<void>>();
  private readonly namespaceOwners = new Map<string, object>();
  private healthAuditError?: unknown;
  private healthAuditRunning?: Promise<void>;
  readonly hono: HonoBase<BlankEnv, CurrentSchema, "/", "/">;

  constructor() {
    const overview = new Overview();
    this.hono = new Hono() as HonoBase<BlankEnv, CurrentSchema, "/", "/">;
    this.hono.use("*", async (context, next) => {
      await next();
      const requestError = context.error;
      if (!requestError) return;
      try {
        store.getState().mcpErrorActions.errorAdd({
          at: new Date().toISOString(),
          detail: inspect(requestError, { depth: null }),
          method: context.req.method,
          path: context.req.path,
        });
      } catch (storeError) {
        throw new AggregateError(
          [requestError, storeError],
          "Request failed and could not be persisted to the todo-mcp store.",
        );
      }
    });
    for (const register of localRegisters) this.localDeliveryAdd(register.deliver(), register);
    this.localDeliveryAdd(overview.mcp.deliver(), overview.mcp);

    const packageEntries = Object.entries(packageRegisters) as [
      keyof typeof packageRegisters,
      AnyPackageRegister,
    ][];
    const packageResults = Promise.allSettled(
      packageEntries.map(([, register]) => this.packageDeliver(register)),
    );
    const packagesReady = async () => {
      if (this.healthAuditError) {
        throw new Error("External MCP health audit failed.", { cause: this.healthAuditError });
      }
      const results = await packageResults;
      const errors = results.flatMap((result, index) => {
        const [name, register] = packageEntries[index]!;
        return this.packageDeliveries.has(register)
          ? []
          : [new Error(
              `mcpFromNpm.${name} is unavailable.`,
              result.status === "rejected" ? { cause: result.reason } : undefined,
            )];
      });
      if (errors.length) throw new AggregateError(errors, "External MCP products failed to deliver.");
    };

    const healthAuditTimer = setInterval(() => {
      if (this.healthAuditRunning || this.healthAuditError) return;
      const audit = this.packagesHealthAudit()
        .catch(error => {
          this.healthAuditError = error;
        })
        .finally(() => {
          if (this.healthAuditRunning === audit) this.healthAuditRunning = undefined;
        });
      this.healthAuditRunning = audit;
    }, 20_000);
    healthAuditTimer.unref();

    overview.toolsSet(async () => {
      await packagesReady();
      return this.toolsGet().map(toolOverviewCreate);
    });
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: "todo-mcp", version: "0.1.0" });
      for (const tool of this.toolsGet()) {
        server.registerTool(tool.name, tool.config, tool.handler);
      }
      return server;
    });
    this.hono.all("/todo-mcp", async context => {
      await packagesReady();
      return handler.fetch(context.req.raw);
    });
  }

  register<Namespace extends string, FragmentSchema extends Schema>(
    register: Register<Namespace, FragmentSchema>,
  ): Mcp<NextSchema<CurrentSchema, Namespace, FragmentSchema>> {
    this.localDeliveryAdd(register.deliver(), register);
    return this as Mcp<NextSchema<CurrentSchema, Namespace, FragmentSchema>>;
  }

  async registerPkg<Namespace extends string, FragmentSchema extends Schema>(
    register: RegisterFromNpm<Namespace, FragmentSchema>,
  ): Promise<Mcp<NextSchema<CurrentSchema, Namespace, FragmentSchema>>> {
    await this.packageDeliver(register as AnyPackageRegister);
    return this as Mcp<NextSchema<CurrentSchema, Namespace, FragmentSchema>>;
  }

  private localDeliveryAdd(delivery: AnyRegistrationData, owner: object) {
    this.namespaceAdd(delivery.namespace, owner);
    this.hono.route("/", delivery.hono);
    this.localDeliveries.push(delivery);
  }

  private packageDeliver(register: AnyPackageRegister) {
    const delivered = this.packageDeliveryPromises.get(register);
    if (delivered) return delivered;
    const delivering = register.deliver()
      .then(delivery => {
        this.namespaceAdd(delivery.namespace, register);
        this.hono.route("/", delivery.hono);
        this.packageDeliveries.set(register, delivery);
      })
      .catch(error => {
        this.packageDeliveries.delete(register);
        if (this.packageDeliveryPromises.get(register) === delivering) {
          this.packageDeliveryPromises.delete(register);
        }
        throw error;
      });
    this.packageDeliveryPromises.set(register, delivering);
    return delivering;
  }

  private namespaceAdd(namespace: string, owner: object) {
    const currentOwner = this.namespaceOwners.get(namespace);
    if (currentOwner && currentOwner !== owner) {
      throw new Error(`Duplicate MCP namespace: ${namespace}`);
    }
    this.namespaceOwners.set(namespace, owner);
  }

  private async packagesHealthAudit() {
    const registers = [...this.packageDeliveries.keys()];
    const results = await Promise.allSettled(registers.map(register => register.healthAudit()));
    const errors: Error[] = [];
    results.forEach((result, index) => {
      const register = registers[index]!;
      if (result.status === "rejected") {
        errors.push(new Error("External MCP health audit failed.", { cause: result.reason }));
        return;
      }
      if (!result.value) return;
      this.packageDeliveries.delete(register);
      this.packageDeliveryPromises.delete(register);
    });
    if (errors.length) throw new AggregateError(errors, "External MCP health audits failed.");
  }

  private toolsGet() {
    return [
      ...this.localDeliveries.flatMap(delivery => delivery.tools),
      ...[...this.packageDeliveries.values()].flatMap(delivery => delivery.tools),
    ];
  }
}
