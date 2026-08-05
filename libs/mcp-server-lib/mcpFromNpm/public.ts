import { Client, type CallToolResult, type Tool, type Transport } from "@modelcontextprotocol/client";
import { CallToolResultSchema } from "@modelcontextprotocol/core";
import { Hono, type Env } from "hono";
import type { HonoBase } from "hono/hono-base";
import type { MergePath, MergeSchemaPath, Schema } from "hono/types";
import { z } from "zod";
import Register, {
  type Definition,
  type HonoDefinition,
  type RegistrationData,
  type ToolContractAnnotations,
  type ToolRegistration,
} from "../public";

type PackageDefinition = {
  instructions?: string;
  transport: () => Transport | Promise<Transport>;
};

type Replacement = Partial<Pick<
  Tool,
  "name" | "description" | "inputSchema" | "outputSchema" | "_meta"
>> & {
  annotations?: ToolContractAnnotations;
  toolName: string;
};

type ToolCall = (
  name: string,
  arguments_: Record<string, unknown>,
) => Promise<CallToolResult>;

type Addition =
  | Definition<any, any, any>
  | ((toolCall: ToolCall) => Definition<any, any, any>);

type Runtime = {
  childPid?: number;
  client: Client;
  closing?: Promise<void>;
  transport: Transport;
  transportClosed: boolean;
};

export type PackageStatus = "closed" | "opening" | "running" | "closing" | "error";

const childPidRead = (transport: Transport) => {
  if (!("pid" in transport)) return;
  const pid = transport.pid;
  return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : undefined;
};

const annotationsGet = (tool: Tool, replacement?: Replacement) => {
  const { title: _title, ...sourceAnnotations } = tool.annotations ?? {};
  const annotations = {
    ...sourceAnnotations,
    ...replacement?.annotations,
  };
  if (
    typeof annotations.readOnlyHint !== "boolean"
    || typeof annotations.destructiveHint !== "boolean"
    || typeof annotations.idempotentHint !== "boolean"
    || typeof annotations.openWorldHint !== "boolean"
  ) {
    throw new Error(`Tool "${tool.name}" has incomplete annotations.`);
  }
  return annotations as ToolContractAnnotations;
};

export default class RegisterFromNpm<
  Namespace extends string,
  AddedSchema extends Schema = {},
> {
  readonly namespace: Namespace;
  readonly description: string;
  private packageDefinition?: PackageDefinition;
  private replacements: Replacement[] = [];
  private deletions: string[] = [];
  private additions: Addition[] = [];
  private honoDefinitions: HonoDefinition<any, any>[] = [];
  private mcpAdditions: Addition[] = [];
  private delivery?: Promise<RegistrationData<Namespace, AddedSchema>>;
  private runtime?: Runtime;
  private toolCall?: ToolCall;
  private deliveryError?: unknown;

  constructor(options: { namespace: Namespace; description: string }) {
    this.namespace = options.namespace;
    this.description = options.description;
    if (!this.description.trim()) {
      throw new Error(`External MCP "${this.namespace}" requires a namespace description.`);
    }
  }

  get status(): PackageStatus {
    if (this.deliveryError || this.runtime?.transportClosed) return "error";
    if (this.runtime?.closing) return "closing";
    if (this.runtime) return "running";
    if (this.delivery) return "opening";
    return "closed";
  }

  registerPkg(options: PackageDefinition) {
    if (this.packageDefinition) {
      throw new Error(`External MCP "${this.namespace}" already has a package source.`);
    }
    if (options.instructions !== undefined && !options.instructions.trim()) {
      throw new Error(`Namespace "${this.namespace}" has empty instructions.`);
    }
    this.packageDefinition = options;
    return this;
  }

  mcpDel(toolName: string) {
    if (!toolName.trim()) throw new Error("Deleted MCP tool name cannot be empty.");
    this.deletions.push(toolName);
    return this;
  }

  mcpReplace(replacement: Replacement) {
    if (!replacement.toolName.trim()) throw new Error("Replaced MCP tool name cannot be empty.");
    this.replacements.push(replacement);
    return this;
  }

  register<
    const Path extends `/${string}`,
    HonoEnv extends Env,
    ChildSchema extends Schema,
    HonoBasePath extends string,
    HonoCurrentPath extends string,
    InputSchema extends z.ZodObject<z.ZodRawShape>,
  >(
    definition: Definition<
      Path,
      HonoBase<HonoEnv, ChildSchema, HonoBasePath, HonoCurrentPath>,
      InputSchema
    > | ((toolCall: ToolCall) => Definition<
      Path,
      HonoBase<HonoEnv, ChildSchema, HonoBasePath, HonoCurrentPath>,
      InputSchema
    >),
  ) {
    this.additions.push(definition);
    return this as unknown as RegisterFromNpm<
      Namespace,
      AddedSchema | MergeSchemaPath<ChildSchema, MergePath<"/", Path>>
    >;
  }

  honoAdd<
    const Path extends `/${string}`,
    HonoEnv extends Env,
    ChildSchema extends Schema,
    HonoBasePath extends string,
    HonoCurrentPath extends string,
  >(
    path: Path,
    hono: HonoBase<HonoEnv, ChildSchema, HonoBasePath, HonoCurrentPath>,
  ) {
    this.honoDefinitions.push([path, hono]);
    return this as unknown as RegisterFromNpm<
      Namespace,
      AddedSchema | MergeSchemaPath<ChildSchema, MergePath<"/", Path>>
    >;
  }

  mcpAdd<
    const Path extends `/${string}`,
    HonoEnv extends Env,
    ChildSchema extends Schema,
    HonoBasePath extends string,
    HonoCurrentPath extends string,
    InputSchema extends z.ZodObject<z.ZodRawShape>,
  >(
    definition: Definition<
      Path,
      HonoBase<HonoEnv, ChildSchema, HonoBasePath, HonoCurrentPath>,
      InputSchema
    > | ((toolCall: ToolCall) => Definition<
      Path,
      HonoBase<HonoEnv, ChildSchema, HonoBasePath, HonoCurrentPath>,
      InputSchema
    >),
  ) {
    this.mcpAdditions.push(definition);
    return this;
  }

  get hono() {
    return this.deliver().then(delivery => delivery.hono);
  }

  deliver(): Promise<RegistrationData<Namespace, AddedSchema>> {
    if (this.delivery) return this.delivery;
    this.deliveryError = undefined;
    const delivery = this.deliveryCreate().catch(error => {
      if (this.delivery === delivery) this.delivery = undefined;
      this.deliveryError = error;
      throw error;
    });
    this.delivery = delivery;
    return delivery;
  }

  async healthAudit() {
    const runtime = this.runtime;
    if (!runtime) return false;
    if (
      !runtime.transportClosed
      && (!runtime.childPid || childPidRead(runtime.transport))
    ) return false;
    await this.close();
    return true;
  }

  async close() {
    const runtime = this.runtime;
    if (!runtime) {
      this.delivery = undefined;
      this.toolCall = undefined;
      this.deliveryError = undefined;
      return;
    }
    try {
      runtime.closing ??= runtime.client.close();
      await runtime.closing;
    } catch (error) {
      this.deliveryError = error;
      throw error;
    }
    if (this.runtime !== runtime) return;
    this.runtime = undefined;
    this.delivery = undefined;
    this.toolCall = undefined;
    this.deliveryError = undefined;
  }

  private async deliveryCreate(): Promise<RegistrationData<Namespace, AddedSchema>> {
    const packageDefinition = this.packageDefinition;
    if (!packageDefinition) {
      throw new Error(`External MCP "${this.namespace}" has no package source.`);
    }
    if (this.runtime) throw new Error(`External MCP "${this.namespace}" is already delivered.`);
    const transport = await packageDefinition.transport();
    const client = new Client({ name: `${this.namespace}-proxy`, version: "0.0.0" });
    try {
      await client.connect(transport);
      const currentToolCall: ToolCall = async (name, arguments_) => CallToolResultSchema.parse(
        await client.callTool({ name, arguments: arguments_ }),
      );
      const toolCall: ToolCall = (name, arguments_) => {
        if (!this.toolCall) {
          throw new Error(`External MCP "${this.namespace}" is not connected.`);
        }
        return this.toolCall(name, arguments_);
      };
      const sourceTools = (await client.listTools()).tools;
      this.contractChangesValidate(sourceTools);
      const instructions = packageDefinition.instructions?.trim();
      const tools = sourceTools
        .filter(tool => !this.deletions.includes(tool.name))
        .map(tool => this.toolRegistrationCreate({
          instructions,
          tool,
          toolCall: currentToolCall,
        }));

      let local = new Register({
        namespace: this.namespace,
        description: this.description,
      }) as Register<Namespace, any>;
      for (const addition of this.additions) {
        const definition = typeof addition === "function" ? addition(toolCall) : addition;
        local = local.register(...definition) as Register<Namespace, any>;
      }
      for (const [path, hono] of this.honoDefinitions) {
        local = local.honoAdd(path, hono) as Register<Namespace, any>;
      }
      for (const addition of this.mcpAdditions) {
        const definition = typeof addition === "function" ? addition(toolCall) : addition;
        local = local.mcpAdd(...definition) as Register<Namespace, any>;
      }
      let delivery: RegistrationData<Namespace, AddedSchema>;
      if (this.additions.length || this.honoDefinitions.length || this.mcpAdditions.length) {
        const localDelivery = local.deliver();
        delivery = {
          namespace: this.namespace,
          description: this.description,
          hono: localDelivery.hono as RegistrationData<Namespace, AddedSchema>["hono"],
          tools: [...tools, ...localDelivery.tools],
        };
      } else {
        const emptyHono = new Hono().route(`/${this.namespace}`, new Hono());
        delivery = {
          namespace: this.namespace,
          description: this.description,
          hono: emptyHono as RegistrationData<Namespace, AddedSchema>["hono"],
          tools,
        };
      }
      const names = new Set<string>();
      for (const tool of delivery.tools) {
        if (names.has(tool.name)) throw new Error(`Duplicate MCP tool: ${tool.name}`);
        names.add(tool.name);
      }
      const runtime: Runtime = {
        childPid: childPidRead(transport),
        client,
        transport,
        transportClosed: false,
      };
      client.onclose = () => {
        runtime.transportClosed = true;
      };
      this.toolCall = currentToolCall;
      this.runtime = runtime;
      return delivery;
    } catch (deliveryError) {
      try {
        await transport.close();
      } catch (closeError) {
        throw new AggregateError(
          [deliveryError, closeError],
          `Failed to deliver and close external MCP "${this.namespace}".`,
        );
      }
      throw deliveryError;
    }
  }

  private contractChangesValidate(sourceTools: readonly Tool[]) {
    const sourceNames = new Set(sourceTools.map(tool => tool.name));
    const changes = [...this.deletions, ...this.replacements.map(item => item.toolName)];
    for (const toolName of changes) {
      if (!sourceNames.has(toolName)) {
        throw new Error(`Cannot change missing tool "${toolName}" from ${this.namespace}.`);
      }
    }
    const duplicateDeletion = this.deletions.find((name, index) => this.deletions.indexOf(name) !== index);
    if (duplicateDeletion) throw new Error(`Duplicate MCP deletion: ${duplicateDeletion}`);
    const duplicateReplacement = this.replacements.find((item, index) => (
      this.replacements.findIndex(candidate => candidate.toolName === item.toolName) !== index
    ));
    if (duplicateReplacement) {
      throw new Error(`Duplicate MCP replacement: ${duplicateReplacement.toolName}`);
    }
    const conflict = this.deletions.find(name => this.replacements.some(item => item.toolName === name));
    if (conflict) throw new Error(`MCP tool cannot be deleted and replaced: ${conflict}`);
  }

  private toolRegistrationCreate(options: {
    instructions?: string;
    tool: Tool;
    toolCall: ToolCall;
  }): ToolRegistration {
    const replacement = this.replacements.find(item => item.toolName === options.tool.name);
    const externalTool: Tool = { ...options.tool, ...replacement };
    const description = externalTool.description?.trim();
    if (!description) {
      throw new Error(`Tool "${externalTool.name}" from ${this.namespace} has no consumption description.`);
    }
    const annotations = annotationsGet(options.tool, replacement);
    return {
      name: `${this.namespace}.${externalTool.name}`,
      config: {
        description: options.instructions ? `${options.instructions} ${description}` : description,
        inputSchema: z.fromJSONSchema(
          externalTool.inputSchema as Parameters<typeof z.fromJSONSchema>[0],
        ) as z.ZodObject<z.ZodRawShape>,
        outputSchema: externalTool.outputSchema
          ? z.fromJSONSchema(
              externalTool.outputSchema as Parameters<typeof z.fromJSONSchema>[0],
            )
          : undefined,
        annotations,
        _meta: externalTool._meta,
      },
      handler: async arguments_ => options.toolCall(
        options.tool.name,
        arguments_ as Record<string, unknown>,
      ),
    };
  }
}
