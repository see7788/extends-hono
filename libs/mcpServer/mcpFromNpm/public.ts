import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolResultSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { HonoBase } from "hono/hono-base";
import type { BlankEnv, MergePath, MergeSchemaPath, Schema } from "hono/types";
import { z } from "zod";
import type Register from "../public";

type Definition = {
  namespace: string;
  transport: () => Transport | Promise<Transport>;
};
type Replacement = Partial<Pick<
  Tool,
  "name" | "title" | "description" | "inputSchema" | "outputSchema" | "annotations" | "_meta"
>> & { toolName: string };
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

  register<const NextNamespace extends string>(
    definition: Definition & { namespace: NextNamespace },
  ) {
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
    server: McpServer,
    hono: HonoBase<BlankEnv, ParentSchema, "/", "/">,
  ) {
    if (!this.definition) throw new Error("The npm MCP product has not been registered.");
    const { namespace } = this.definition;
    const client = new Client({ name: `${namespace}-proxy`, version: "0.0.0" });
    await client.connect(await this.definition.transport());
    const toolCall: ToolCall = async (
      toolName: string,
      arguments_: Record<string, unknown>,
    ) => CallToolResultSchema.parse(
      await client.callTool({ name: toolName, arguments: arguments_ }),
    );
    const tools = (await client.listTools()).tools;
    for (const replacement of this.replacements) {
      if (!tools.some(tool => tool.name === replacement.toolName)) {
        throw new Error(`Cannot replace missing tool "${replacement.toolName}" from ${namespace}.`);
      }
    }
    for (const tool of tools) {
      const externalTool: Tool = {
        ...tool,
        ...this.replacements.find(replacement => replacement.toolName === tool.name),
      };
      server.registerTool(`${namespace}.${externalTool.name}`, {
        title: externalTool.title,
        description: externalTool.description,
        inputSchema: z.fromJSONSchema(externalTool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]),
        outputSchema: externalTool.outputSchema ? z.fromJSONSchema(externalTool.outputSchema as Parameters<typeof z.fromJSONSchema>[0]) : undefined,
        annotations: externalTool.annotations,
        _meta: externalTool._meta,
      }, async arguments_ => toolCall(tool.name, arguments_ as Record<string, unknown>));
    }
    for (const addition of this.additions) {
      const mcp = typeof addition === "function" ? addition(toolCall) : addition;
      mcp.mount(namespace, server, hono);
    }
    return hono as HonoBase<
      BlankEnv,
      ParentSchema | MergeSchemaPath<CurrentSchema, MergePath<"/", `/${Namespace}`>>,
      "/",
      "/"
    >;
  }
}
