import { StreamableHTTPTransport } from "@hono/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { CallToolResultSchema, type CallToolResult, type Tool, type ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { Handler } from "hono";
import { z } from "zod";

type ToolDefinition = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: z.ZodRawShape;
  annotations?: ToolAnnotations;
  request?: (arguments_: Record<string, unknown>) => Response | Promise<Response>;
  call?: (toolCall: (name: string, arguments_: Record<string, unknown>) => Promise<CallToolResult>) => CallToolResult | Promise<CallToolResult>;
};
type NpmDefinition = { packageSpec: string; args?: string[]; cache?: string; env?: Record<string, string> };
type ToolOverride = Partial<Pick<Tool, "name" | "title" | "description" | "inputSchema" | "outputSchema" | "annotations" | "_meta">>;

export default class PublicMcp {
  private readonly transport = new StreamableHTTPTransport();
  private readonly npmDefinitions: Array<{
    definition: NpmDefinition;
    overrides: Map<string, ToolOverride>;
    additions: ToolDefinition[];
  }> = [];
  private registration?: Promise<void>;
  private connection?: Promise<void>;

  constructor(private readonly server: McpServer) {}

  readonly handler: Handler = async (ctx) => {
    this.registration ??= (async () => {
      for (const npm of this.npmDefinitions) {
        const { args = [], cache, env, packageSpec } = npm.definition;
        const client = new Client({ name: `${packageSpec}-proxy`, version: "0.0.0" });
        await client.connect(new StdioClientTransport({
          command: "npx",
          args: ["-y", ...(cache ? ["--cache", cache] : []), packageSpec, ...args],
          env,
        }));
        const toolCall = async (name: string, arguments_: Record<string, unknown>) => CallToolResultSchema.parse(
          await client.callTool({ name, arguments: arguments_ }),
        );
        const tools = (await client.listTools()).tools;
        const toolNames = new Set(tools.map(tool => tool.name));
        for (const toolName of npm.overrides.keys()) {
          if (!toolNames.has(toolName)) throw new Error(`Cannot replace missing tool "${toolName}" from ${packageSpec}.`);
        }
        for (const tool of tools) {
          const externalTool = { ...tool, ...npm.overrides.get(tool.name) };
          this.server.registerTool(externalTool.name, {
            title: externalTool.title,
            description: externalTool.description,
            inputSchema: z.fromJSONSchema(externalTool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]),
            outputSchema: externalTool.outputSchema ? z.fromJSONSchema(externalTool.outputSchema as Parameters<typeof z.fromJSONSchema>[0]) : undefined,
            annotations: externalTool.annotations,
            _meta: externalTool._meta,
          }, async arguments_ => toolCall(tool.name, arguments_ as Record<string, unknown>));
        }
        for (const addition of npm.additions) {
          this.server.registerTool(addition.name, {
            title: addition.title,
            description: addition.description,
            inputSchema: addition.inputSchema ? z.object(addition.inputSchema) : undefined,
            annotations: addition.annotations,
          }, async () => addition.call!(toolCall));
        }
      }
    })();
    await this.registration;
    this.connection ??= this.server.connect(this.transport);
    await this.connection;
    return this.transport.handleRequest(ctx);
  };

  npmMcp(definition: NpmDefinition) {
    if (this.registration) throw new Error("MCP configuration cannot change after registration starts.");
    const overrides = new Map<string, ToolOverride>();
    const additions: ToolDefinition[] = [];
    const product = {
      toolReplace: ({ toolName, ...override }: ToolOverride & { toolName: string }) => {
        if (this.registration) throw new Error("MCP configuration cannot change after registration starts.");
        overrides.set(toolName, { ...overrides.get(toolName), ...override });
        return product;
      },
      toolAdd: (tool: ToolDefinition) => {
        if (this.registration) throw new Error("MCP configuration cannot change after registration starts.");
        additions.push(tool);
        return product;
      },
    };
    this.npmDefinitions.push({ definition, overrides, additions });
    return product;
  }

  requestToolRegister<InputArgs extends z.ZodRawShape>(definition: Omit<ToolDefinition, "inputSchema" | "request"> & {
    inputSchema: InputArgs;
    request: (arguments_: z.output<z.ZodObject<InputArgs>>) => Response | Promise<Response>;
  }): void {
    if (this.registration) throw new Error("MCP configuration cannot change after registration starts.");
    this.server.registerTool<AnySchema, z.ZodObject<InputArgs>>(
      definition.name,
      { title: definition.title, description: definition.description, inputSchema: z.object(definition.inputSchema), annotations: definition.annotations },
      async arguments_ => {
        const response = await definition.request(arguments_);
        const text = await response.text();
        if (!response.ok) throw new Error(text || String(response.status));
        const body: unknown = text ? JSON.parse(text) : String(response.status);
        return { content: [{ type: "text" as const, text: typeof body === "string" ? body : JSON.stringify(body) }] };
      },
    );
  }
}
