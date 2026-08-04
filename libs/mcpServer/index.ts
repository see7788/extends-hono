import { createMcpHandler, McpServer, type Tool } from "@modelcontextprotocol/server";
import { Hono } from "hono";
import type { HonoBase } from "hono/hono-base";
import type { BlankEnv, MergePath, MergeSchemaPath, Schema } from "hono/types";
import { inspect } from "node:util";
import { z } from "zod";
import aiCallAi from "./mcp/ai-call-ai";
import Overview from "./mcp/overview";
// import watcher from "./mcp/watcher";//停用观察者
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

const localRegisters = [aiCallAi,workcopy] as const;
const packageRegisters = [browser, codegraph, docs, io, workspace] as const;
const packageIdleMilliseconds = 20 * 60 * 1000;
type AnyRegistrationData = RegistrationData<any, any>;
type AnyPackageRegister = RegisterFromNpm<any, any>;
type ToolHandle = { remove(): void };
type ActiveServer = {
  mcp: McpServer;
  tools: Map<string, ToolHandle>;
};
type LocalNamespace = {
  kind: "local";
  delivery: AnyRegistrationData;
};
type PackageNamespace = {
  kind: "npm";
  register: AnyPackageRegister;
  delivery?: AnyRegistrationData;
  operation?: Promise<unknown>;
  honoMounted: boolean;
  inFlight: number;
  idleTimer?: ReturnType<typeof setTimeout>;
};
type NamespaceRuntime = LocalNamespace | PackageNamespace;
type NamespaceSummary = {
  namespace: string;
  description: string;
  kind: "local" | "npm";
  status: "closed" | "opening" | "running" | "closing" | "error";
};
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
  private readonly namespaceRuntime = new Map<string, NamespaceRuntime>();
  private readonly activeServers = new Set<ActiveServer>();
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

    for (const register of localRegisters) this.localDeliveryAdd(register.deliver());
    this.localDeliveryAdd(overview.mcp.deliver());
    for (const register of packageRegisters) this.packageRuntimeAdd(register);

    overview.controllerSet({
      list: () => this.namespaceList(),
      listInfo: options => this.namespaceInfo(options),
      open: namespace => this.namespaceOpen(namespace),
      close: namespace => this.namespaceClose(namespace),
    });

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

    const handler = createMcpHandler(() => {
      const mcp = new McpServer({ name: "todo-mcp", version: "0.1.0" });
      const activeServer: ActiveServer = { mcp, tools: new Map() };
      this.activeServers.add(activeServer);
      mcp.server.onclose = () => this.activeServers.delete(activeServer);
      this.serverToolsSync(activeServer);
      return mcp;
    });
    this.hono.all("/todo-mcp", context => handler.fetch(context.req.raw));
  }

  register<Namespace extends string, FragmentSchema extends Schema>(
    register: Register<Namespace, FragmentSchema>,
  ): Mcp<NextSchema<CurrentSchema, Namespace, FragmentSchema>> {
    this.localDeliveryAdd(register.deliver());
    this.serversToolsSync();
    return this as Mcp<NextSchema<CurrentSchema, Namespace, FragmentSchema>>;
  }

  async registerPkg<Namespace extends string, FragmentSchema extends Schema>(
    register: RegisterFromNpm<Namespace, FragmentSchema>,
  ): Promise<Mcp<NextSchema<CurrentSchema, Namespace, FragmentSchema>>> {
    this.packageRuntimeAdd(register as AnyPackageRegister);
    return this as Mcp<NextSchema<CurrentSchema, Namespace, FragmentSchema>>;
  }

  private localDeliveryAdd(delivery: AnyRegistrationData) {
    this.namespaceAvailable(delivery.namespace);
    this.hono.route("/", delivery.hono);
    this.namespaceRuntime.set(delivery.namespace, { kind: "local", delivery });
  }

  private packageRuntimeAdd(register: AnyPackageRegister) {
    this.namespaceAvailable(register.namespace);
    this.namespaceRuntime.set(register.namespace, {
      kind: "npm",
      register,
      honoMounted: false,
      inFlight: 0,
    });
  }

  private async packageDeliver(runtime: PackageNamespace) {
    if (runtime.delivery) return;
    const delivery = await runtime.register.deliver();
    if (!runtime.honoMounted) {
      this.hono.route("/", delivery.hono);
      runtime.honoMounted = true;
    }
    runtime.delivery = delivery;
  }

  private packageOperation<T>(runtime: PackageNamespace, run: () => Promise<T>) {
    const previous = runtime.operation ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(run);
    runtime.operation = operation;
    return operation.finally(() => {
      if (runtime.operation === operation) runtime.operation = undefined;
    });
  }

  private namespaceAvailable(namespace: string) {
    if (this.namespaceRuntime.has(namespace)) throw new Error(`Duplicate MCP namespace: ${namespace}`);
  }

  private namespaceList(): NamespaceSummary[] {
    return [...this.namespaceRuntime.values()].map(runtime => (
      runtime.kind === "local"
        ? {
            namespace: runtime.delivery.namespace,
            description: runtime.delivery.description,
            kind: "local" as const,
            status: "running" as const,
          }
        : {
            namespace: runtime.register.namespace,
            description: runtime.register.description,
            kind: "npm" as const,
            status: runtime.register.status,
          }
    )).sort((left, right) => left.namespace.localeCompare(right.namespace));
  }

  private namespaceInfo(options: {
    namespace: string;
    offset: number;
    limit: number;
  }) {
    const runtime = this.namespaceRuntime.get(options.namespace);
    if (!runtime) throw new Error(`Unknown MCP namespace: ${options.namespace}`);
    if (runtime.kind === "local") {
      return this.namespaceInfoCreate({
        summary: {
          namespace: runtime.delivery.namespace,
          description: runtime.delivery.description,
          kind: "local",
          status: "running",
        },
        tools: runtime.delivery.tools.map(toolOverviewCreate),
        offset: options.offset,
        limit: options.limit,
      });
    }
    return this.namespaceInfoCreate({
      summary: {
        namespace: runtime.register.namespace,
        description: runtime.register.description,
        kind: "npm",
        status: runtime.register.status,
      },
      tools: runtime.delivery?.tools.map(toolOverviewCreate),
      offset: options.offset,
      limit: options.limit,
    });
  }

  private namespaceInfoCreate(options: {
    summary: NamespaceSummary;
    tools?: Tool[];
    offset: number;
    limit: number;
  }) {
    const tools = options.tools;
    if (!tools) {
      return { ...options.summary, toolCount: null, tools: [], nextOffset: null };
    }
    const selected = tools.slice(options.offset, options.offset + options.limit);
    return {
      ...options.summary,
      toolCount: tools.length,
      tools: selected,
      nextOffset: options.offset + selected.length < tools.length
        ? options.offset + selected.length
        : null,
    };
  }

  private packageRequired(namespace: string, action: "open" | "close") {
    const runtime = this.namespaceRuntime.get(namespace);
    if (!runtime) throw new Error(`Unknown MCP namespace: ${namespace}`);
    if (runtime.kind === "local") {
      throw new Error(`Local MCP namespace "${namespace}" is always running and cannot ${action}.`);
    }
    return runtime;
  }

  private async namespaceOpen(namespace: string) {
    const runtime = this.packageRequired(namespace, "open");
    await this.packageOperation(runtime, async () => {
      await this.packageDeliver(runtime);
      this.packageIdleSchedule(runtime);
      this.serversToolsSync();
    });
    return this.namespaceInfo({ namespace, offset: 0, limit: 20 });
  }

  private async namespaceClose(namespace: string) {
    const runtime = this.packageRequired(namespace, "close");
    await this.packageOperation(runtime, () => this.packageClose(runtime));
    return this.namespaceList().find(item => item.namespace === namespace)!;
  }

  private async packageClose(runtime: PackageNamespace) {
    if (runtime.inFlight > 0) {
      throw new Error(
        `External MCP "${runtime.register.namespace}" is executing ${runtime.inFlight} tool call(s) and cannot close.`,
      );
    }
    this.packageIdleCancel(runtime);
    runtime.delivery = undefined;
    this.serversToolsSync();
    await runtime.register.close();
  }

  private packageIdleCancel(runtime: PackageNamespace) {
    if (runtime.idleTimer) clearTimeout(runtime.idleTimer);
    runtime.idleTimer = undefined;
  }

  private packageIdleSchedule(runtime: PackageNamespace) {
    this.packageIdleCancel(runtime);
    const timer = setTimeout(() => {
      if (runtime.idleTimer !== timer) return;
      runtime.idleTimer = undefined;
      void this.packageOperation(runtime, async () => {
        if (runtime.inFlight > 0) {
          this.packageIdleSchedule(runtime);
          return;
        }
        await this.packageClose(runtime);
      }).catch(error => {
        this.healthAuditError = error;
      });
    }, packageIdleMilliseconds);
    timer.unref();
    runtime.idleTimer = timer;
  }

  private serverToolsSync(activeServer: ActiveServer) {
    const tools = new Map(this.toolsGet().map(tool => [tool.name, tool]));
    for (const [name, handle] of activeServer.tools) {
      if (tools.has(name)) continue;
      handle.remove();
      activeServer.tools.delete(name);
    }
    for (const [name, tool] of tools) {
      if (activeServer.tools.has(name)) continue;
      const handle = activeServer.mcp.registerTool(
        name,
        tool.config,
        (arguments_, extra) => this.toolCall(tool, arguments_, extra),
      );
      activeServer.tools.set(name, handle);
    }
  }

  private async toolCall(
    tool: ToolRegistration,
    arguments_: Record<string, unknown>,
    extra: Parameters<ToolRegistration["handler"]>[1],
  ) {
    const namespace = tool.name.split(".", 1)[0]!;
    const runtime = this.namespaceRuntime.get(namespace);
    if (!runtime || runtime.kind === "local") return tool.handler(arguments_, extra);
    if (runtime.register.status === "closing") {
      throw new Error(`External MCP "${runtime.register.namespace}" is closing; open it before use.`);
    }
    if (!runtime.delivery) {
      throw new Error(`External MCP "${runtime.register.namespace}" is closed; open it before use.`);
    }
    this.packageIdleCancel(runtime);
    runtime.inFlight += 1;
    try {
      return await tool.handler(arguments_, extra);
    } finally {
      runtime.inFlight -= 1;
      if (runtime.inFlight === 0) this.packageIdleSchedule(runtime);
    }
  }

  private serversToolsSync() {
    for (const server of this.activeServers) this.serverToolsSync(server);
  }

  private async packagesHealthAudit() {
    const runtimes = [...this.namespaceRuntime.values()]
      .filter((runtime): runtime is PackageNamespace => runtime.kind === "npm" && !!runtime.delivery);
    const results = await Promise.allSettled(runtimes.map(runtime => (
      this.packageOperation(runtime, async () => {
        if (!await runtime.register.healthAudit()) return false;
        this.packageIdleCancel(runtime);
        runtime.delivery = undefined;
        return true;
      })
    )));
    const errors: Error[] = [];
    let toolsChanged = false;
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        errors.push(new Error(
          `External MCP "${runtimes[index]!.register.namespace}" health audit failed.`,
          { cause: result.reason },
        ));
        return;
      }
      toolsChanged ||= result.value;
    });
    if (toolsChanged) this.serversToolsSync();
    if (errors.length) throw new AggregateError(errors, "External MCP health audits failed.");
  }

  private toolsGet() {
    return [...this.namespaceRuntime.values()].flatMap(runtime => (
      runtime.kind === "local"
        ? runtime.delivery.tools
        : runtime.delivery?.tools ?? []
    ));
  }
}
