import type {
  Icon,
  StandardSchemaWithJSON,
  ToolAnnotations,
  ToolCallback,
} from "@modelcontextprotocol/server";
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

export type ToolContractAnnotations = Omit<ToolAnnotations, "title"> & Required<Pick<
  ToolAnnotations,
  "readOnlyHint" | "destructiveHint" | "idempotentHint" | "openWorldHint"
>>;

export type Definition<
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

export type HonoDefinition<
  Path extends `/${string}` = `/${string}`,
  HonoType extends HonoBase<any, any, any, any> = Hono,
> = readonly [path: Path, hono: HonoType];

export type ToolRegistration = {
  name: string;
  config: {
    title?: string;
    description: string;
    inputSchema: z.ZodObject<z.ZodRawShape>;
    outputSchema?: StandardSchemaWithJSON;
    annotations: ToolContractAnnotations;
    icons?: Icon[];
    _meta?: Record<string, unknown>;
  };
  handler: ToolCallback<z.ZodObject<z.ZodRawShape>>;
};

export type RegistrationData<
  Namespace extends string,
  CurrentSchema extends Schema,
> = {
  namespace: Namespace;
  hono: HonoBase<
    BlankEnv,
    MergeSchemaPath<CurrentSchema, MergePath<"/", `/${Namespace}`>>,
    "/",
    "/"
  >;
  tools: readonly ToolRegistration[];
};

const namespaceValidate = (namespace: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(namespace)) {
    throw new Error(`Invalid MCP namespace: ${namespace}`);
  }
};

const pathValidate = (path: string) => {
  const segments = path.split("/").filter(Boolean);
  if (
    path !== `/${segments.join("/")}`
    || segments.length === 0
    || segments.some(segment => !/^[A-Za-z0-9_-]+$/.test(segment))
  ) {
    throw new Error(`Invalid MCP/Hono registration path: ${path}`);
  }
};

const registerMethodGet = (definition: Definition) => {
  const [path, hono, , description, annotations] = definition;
  pathValidate(path);
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
    || routes.some(item => item.method !== route.method || item.path !== route.path)
  ) {
    throw new Error(`MCP action "${path}" Hono must contain one method and path.`);
  }
  const method = route.method.toUpperCase();
  if (!METHODS.some(honoMethod => honoMethod.toUpperCase() === method)) {
    throw new Error(`Unsupported MCP Hono method: ${method} ${path}.`);
  }
  return method;
};

const routePathGet = (path: string, routePath: string) => (
  routePath === "/" ? path : `${path}${routePath.startsWith("/") ? routePath : `/${routePath}`}`
);

export default class Register<
  Namespace extends string,
  CurrentSchema extends Schema = {},
> {
  private readonly namespace: Namespace;
  private definitions: Definition<any, any, any>[] = [];
  private honoDefinitions: HonoDefinition<any, any>[] = [];
  private delivery?: RegistrationData<Namespace, CurrentSchema>;

  constructor(options: { namespace: Namespace }) {
    this.namespace = options.namespace;
  }

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
    const next = new Register<
      Namespace,
      CurrentSchema | MergeSchemaPath<ChildSchema, MergePath<"/", Path>>
    >({ namespace: this.namespace });
    next.definitions = [...this.definitions, definition];
    next.honoDefinitions = [...this.honoDefinitions];
    return next;
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
    const next = new Register<
      Namespace,
      CurrentSchema | MergeSchemaPath<ChildSchema, MergePath<"/", Path>>
    >({ namespace: this.namespace });
    next.definitions = [...this.definitions];
    next.honoDefinitions = [...this.honoDefinitions, [path, hono]];
    return next;
  }

  get hono() {
    return this.deliver().hono;
  }

  deliver(): RegistrationData<Namespace, CurrentSchema> {
    if (this.delivery) return this.delivery;
    namespaceValidate(this.namespace);
    if (this.definitions.length === 0 && this.honoDefinitions.length === 0) {
      throw new Error(`MCP namespace "${this.namespace}" has no registrations.`);
    }

    const routeKeys = new Set<string>();
    const relativeHono = new Hono();
    const tools: ToolRegistration[] = [];

    for (const definition of this.definitions) {
      const [path, hono, inputSchema, description, annotations] = definition;
      const method = registerMethodGet(definition);
      const routeKey = `${method} ${path}`;
      if (routeKeys.has(routeKey)) throw new Error(`Duplicate Hono route: ${routeKey}`);
      routeKeys.add(routeKey);
      relativeHono.route(path, hono);
      const name = `${this.namespace}.${path.split("/").filter(Boolean).join(".")}.${method}`;
      if (tools.some(tool => tool.name === name)) throw new Error(`Duplicate MCP tool: ${name}`);
      tools.push({
        name,
        config: {
          description,
          inputSchema,
          annotations,
        },
        handler: async (arguments_: Record<string, unknown>) => {
          let requestPath = "/";
          if (method === "GET" || method === "HEAD") {
            const search = new URLSearchParams();
            for (const [argumentName, value] of Object.entries(arguments_)) {
              if (value === undefined) continue;
              for (const item of Array.isArray(value) ? value : [value]) {
                search.append(
                  argumentName,
                  typeof item === "string" ? item : JSON.stringify(item),
                );
              }
            }
            const query = search.toString();
            if (query) requestPath += `?${query}`;
          }
          const env = { mcpServer: true };
          const response = method === "GET" || method === "HEAD"
            ? await hono.request(requestPath, { method }, env)
            : await hono.request("/", {
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
      });
    }

    for (const [path, hono] of this.honoDefinitions) {
      pathValidate(path);
      if (hono.routes.length === 0) throw new Error(`Hono registration "${path}" has no routes.`);
      for (const route of hono.routes) {
        const routeKey = `${route.method.toUpperCase()} ${routePathGet(path, route.path)}`;
        if (routeKeys.has(routeKey)) throw new Error(`Duplicate Hono route: ${routeKey}`);
        routeKeys.add(routeKey);
      }
      relativeHono.route(path, hono);
    }

    const hono = new Hono().route(`/${this.namespace}`, relativeHono);
    this.delivery = {
      namespace: this.namespace,
      hono: hono as RegistrationData<Namespace, CurrentSchema>["hono"],
      tools,
    };
    return this.delivery;
  }
}
