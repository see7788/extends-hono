import { Client, type CallToolResult, type Tool, type Transport } from "@modelcontextprotocol/client";
import { CallToolResultSchema } from "@modelcontextprotocol/core";
import type { McpServer } from "@modelcontextprotocol/server";
import type { HonoBase } from "hono/hono-base";
import type { BlankEnv, MergePath, MergeSchemaPath, Schema } from "hono/types";
import { z } from "zod";
import type Register from "../public";

type Definition = {
  instructions?: string;
  namespace: string;
  transport: () => Transport | Promise<Transport>;
};
type ToolContractAnnotations = Omit<
  NonNullable<Tool["annotations"]>,
  "title"
> & Required<Pick<
  NonNullable<Tool["annotations"]>,
  "readOnlyHint" | "destructiveHint" | "idempotentHint" | "openWorldHint"
>>;
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
type Addition = Register<any> | ((toolCall: ToolCall) => Register<any>);

export default class RegisterFromNpm<
  Namespace extends string = string,
  CurrentSchema extends Schema = {},
> {
  private definition?: Definition;
  private replacements: Replacement[] = [];
  private additions: Addition[] = [];
  private tools?: [string, Tool][];
  private toolCall?: ToolCall;
  private mcp: Register<any>[] = [];

  constructor(source?: RegisterFromNpm<Namespace, CurrentSchema>) {
    if (!source) return;
    this.definition = source.definition;
    this.replacements = [...source.replacements];
    this.additions = [...source.additions];
  }

  register<const NextNamespace extends string>(
    definition: Definition & { namespace: NextNamespace },
  ) {
    if (definition.instructions !== undefined && !definition.instructions.trim()) {
      throw new Error(`Namespace "${definition.namespace}" has empty instructions.`);
    }
    this.definition = definition;
    return this as unknown as RegisterFromNpm<NextNamespace, CurrentSchema>;
  }

  replace(replacement: Replacement) {
    this.replacements.push(replacement);
    return this;
  }

  add<FragmentSchema extends Schema>(
    addition: Register<FragmentSchema> | ((toolCall: ToolCall) => Register<FragmentSchema>),
  ) {
    this.additions.push(addition);
    return this as unknown as RegisterFromNpm<
      Namespace,
      CurrentSchema | FragmentSchema
    >;
  }

  async mount<ParentSchema extends Schema>(
    hono: HonoBase<BlankEnv, ParentSchema, "/", "/">,
  ) {
    if (!this.definition) throw new Error("The npm MCP product has not been registered.");
    const { namespace } = this.definition;
    const transport = await this.definition.transport();
    const client = new Client({ name: `${namespace}-proxy`, version: "0.0.0" });
    try {
      await client.connect(transport);
      const toolCall: ToolCall = async (
        toolName: string,
        arguments_: Record<string, unknown>,
      ) => CallToolResultSchema.parse(
        await client.callTool({ name: toolName, arguments: arguments_ }),
      );
      const sourceTools = (await client.listTools()).tools;
      for (const replacement of this.replacements) {
        if (!sourceTools.some(tool => tool.name === replacement.toolName)) {
          throw new Error(`Cannot replace missing tool "${replacement.toolName}" from ${namespace}.`);
        }
      }
      const tools: [string, Tool][] = sourceTools.map(tool => {
        const replacement = this.replacements.find(item => item.toolName === tool.name);
        const { title: _annotationTitle, ...toolAnnotations } = tool.annotations ?? {};
        const externalTool: Tool = {
          ...tool,
          ...replacement,
          annotations: {
            ...toolAnnotations,
            ...replacement?.annotations,
          },
        };
        if (!externalTool.description?.trim()) {
          throw new Error(`Tool "${externalTool.name}" from ${namespace} has no consumption description.`);
        }
        const annotations = externalTool.annotations;
        if (
          !annotations
          || typeof annotations.readOnlyHint !== "boolean"
          || typeof annotations.destructiveHint !== "boolean"
          || typeof annotations.idempotentHint !== "boolean"
          || typeof annotations.openWorldHint !== "boolean"
        ) {
          throw new Error(`Tool "${externalTool.name}" from ${namespace} has incomplete annotations.`);
        }
        return [tool.name, externalTool];
      });
      const mcp = this.additions.map(addition => (
        typeof addition === "function" ? addition(toolCall) : addition
      ));
      for (const integration of mcp) {
        integration.honoMount(namespace, hono);
      }
      this.toolCall = toolCall;
      this.tools = tools;
      this.mcp = mcp;
    } catch (mountError) {
      try {
        await transport.close();
      } catch (closeError) {
        throw new AggregateError(
          [mountError, closeError],
          `Failed to mount and close external MCP "${namespace}".`,
        );
      }
      throw mountError;
    }
    return hono as HonoBase<
      BlankEnv,
      ParentSchema | MergeSchemaPath<CurrentSchema, MergePath<"/", `/${Namespace}`>>,
      "/",
      "/"
    >;
  }

  serverMount(server: McpServer) {
    if (!this.definition || !this.tools || !this.toolCall) {
      throw new Error("The npm MCP product has not been mounted.");
    }
    const { namespace } = this.definition;
    const namespaceInstructions = this.definition.instructions?.trim();
    for (const [toolName, externalTool] of this.tools) {
      server.registerTool(`${namespace}.${externalTool.name}`, {
        description: namespaceInstructions
          ? `${namespaceInstructions} ${externalTool.description}`
          : externalTool.description,
        inputSchema: z.fromJSONSchema(externalTool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]),
        outputSchema: externalTool.outputSchema ? z.fromJSONSchema(externalTool.outputSchema as Parameters<typeof z.fromJSONSchema>[0]) : undefined,
        annotations: externalTool.annotations,
        _meta: externalTool._meta,
      }, async arguments_ => this.toolCall!(toolName, arguments_ as Record<string, unknown>));
    }
    for (const mcp of this.mcp) {
      mcp.serverMount(namespace, server, namespaceInstructions);
    }
  }

  toolsGet(): Tool[] {
    if (!this.definition || !this.tools) {
      throw new Error("The npm MCP product has not been mounted.");
    }
    const { namespace } = this.definition;
    const namespaceInstructions = this.definition.instructions?.trim();
    const tools: Tool[] = this.tools.map(([, tool]) => ({
      name: `${namespace}.${tool.name}`,
      description: namespaceInstructions
        ? `${namespaceInstructions} ${tool.description}`
        : tool.description!,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: tool.annotations,
      _meta: tool._meta,
    }));
    for (const mcp of this.mcp) {
      tools.push(...mcp.toolsGet(namespace));
    }
    return tools;
  }

}
