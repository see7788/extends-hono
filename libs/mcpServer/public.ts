import type { McpServer, Tool, ToolAnnotations } from "@modelcontextprotocol/server";
import { Hono, type Env } from "hono";
import type { HonoBase } from "hono/hono-base";
import { METHODS } from "hono/router";
import type {
  BlankEnv,
  MergePath,
  MergeSchemaPath,
  Schema,
} from "hono/types";
import { z } from "zod";

type ToolContractAnnotations = Omit<ToolAnnotations, "title"> & Required<Pick<
  ToolAnnotations,
  "readOnlyHint" | "destructiveHint" | "idempotentHint" | "openWorldHint"
>>;
type Definition<
  Path extends `/${string}` = `/${string}`,
  HonoType extends HonoBase<any, any, any, any> = Hono,
  InputSchema extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
> = readonly [
  path: Path,
  hono: HonoType,
  inputSchema: InputSchema,
  description: string,
  annotations: ToolContractAnnotations,
];
export default class Register<CurrentSchema extends Schema = {}> {
  private definitionsValue: Definition<any, any, any>[] = [];
  private honoValue = new Hono() as HonoBase<BlankEnv, CurrentSchema, "/", "/">;

  register<
    const Path extends `/${string}`,
    HonoEnv extends Env,
    ChildSchema extends Schema,
    HonoBasePath extends string,
    HonoCurrentPath extends string,
    InputSchema extends z.ZodObject<z.ZodRawShape>,
  >(...definition: Definition<
    Path,
    HonoBase<HonoEnv, ChildSchema, HonoBasePath, HonoCurrentPath>,
    InputSchema
  >) {
    const [path, hono, , description, annotations] = definition;
    if (!description.trim()) {
      throw new Error(`MCP action "${path}" requires a consumption description.`);
    }
    if (
      typeof annotations.readOnlyHint !== "boolean"
      || typeof annotations.destructiveHint !== "boolean"
      || typeof annotations.idempotentHint !== "boolean"
      || typeof annotations.openWorldHint !== "boolean"
    ) {
      throw new Error(`MCP action "${path}" requires complete annotations.`);
    }
    const [route, ...routes] = hono.routes;
    if (
      !route
      || route.path !== "/"
      || routes.some(item => (
        item.method !== route.method
        || item.path !== route.path
      ))
    ) {
      throw new Error("Each MCP action Hono must contain one method and path.");
    }
    const method = route.method.toUpperCase();
    if (!METHODS.some(honoMethod => honoMethod.toUpperCase() === method)) {
      throw new Error(`Unsupported MCP Hono method: ${method} ${path}.`);
    }
    const routeName = path.split("/").filter(Boolean);
    if (
      routeName.length === 0
      || routeName.some(segment => !/^[A-Za-z0-9_-]+$/.test(segment))
    ) {
      throw new Error(`Hono route "${method} ${path}" cannot produce a stable MCP tool name.`);
    }
    const nextHono = this.honoValue.route(path, hono);
    const mcp = new Register<
      CurrentSchema | MergeSchemaPath<ChildSchema, MergePath<"/", Path>>
    >();
    mcp.definitionsValue = [...this.definitionsValue, definition];
    mcp.honoValue = nextHono;
    return mcp;
  }

  serverMount(
    namespace: string,
    server: McpServer,
    namespaceInstructions?: string,
  ) {
    for (const definition of this.definitionsValue) {
      const [path, action, inputSchema, description, annotations] = definition;
      const method = action.routes[0]!.method.toUpperCase();
      const { title: _annotationTitle, ...toolAnnotations } = annotations as ToolAnnotations;
      server.registerTool(
        `${namespace}.${path.split("/").filter(Boolean).join(".")}.${method}`,
        {
          description: namespaceInstructions
            ? `${namespaceInstructions} ${description}`
            : description,
          inputSchema,
          annotations: toolAnnotations,
        },
        async (arguments_: Record<string, unknown>) => {
          let requestPath = "/";
          if (method === "GET" || method === "HEAD") {
            const search = new URLSearchParams();
            for (const [name, value] of Object.entries(arguments_)) {
              if (value === undefined) continue;
              for (const item of Array.isArray(value) ? value : [value]) {
                search.append(name, typeof item === "string" ? item : JSON.stringify(item));
              }
            }
            const query = search.toString();
            if (query) requestPath += `?${query}`;
          }
          const env = { mcpServer: server };
          const response = method === "GET" || method === "HEAD"
            ? await action.request(requestPath, { method }, env)
            : await action.request("/", {
                method,
                headers: { "content-type": "application/json" },
                body: JSON.stringify(arguments_),
              }, env);
          const text = await response.text();
          if (!response.ok) throw new Error(text || String(response.status));
          let output = text || String(response.status);
          if (text && response.headers.get("content-type")?.includes("application/json")) {
            const body: unknown = JSON.parse(text);
            output = typeof body === "string" ? body : JSON.stringify(body);
          }
          return { content: [{ type: "text" as const, text: output }] };
        },
      );
    }
  }

  toolsGet(namespace: string): Tool[] {
    return this.definitionsValue.map(definition => {
      const [path, action, inputSchema, description, annotations] = definition;
      const method = action.routes[0]!.method.toUpperCase();
      const { title: _annotationTitle, ...toolAnnotations } = annotations as ToolAnnotations;
      return {
        name: `${namespace}.${path.split("/").filter(Boolean).join(".")}.${method}`,
        description,
        inputSchema: z.toJSONSchema(inputSchema, {
          io: "input",
          target: "draft-2020-12",
        }) as Tool["inputSchema"],
        annotations: toolAnnotations,
      };
    });
  }

  honoMount<ParentSchema extends Schema>(
    namespace: string,
    hono: HonoBase<BlankEnv, ParentSchema, "/", "/">,
  ) {
    hono.route(`/${namespace}`, this.honoValue);
  }
}
