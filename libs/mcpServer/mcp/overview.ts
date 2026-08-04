import type { Tool } from "@modelcontextprotocol/server";
import { Hono, type Context } from "hono";
import { z } from "zod";
import Register from "../public";

export type NamespaceStatus = "closed" | "opening" | "running" | "closing" | "error";

export type NamespaceSummary = {
  namespace: string;
  description: string;
  kind: "local" | "npm";
  status: NamespaceStatus;
};

export type NamespaceInfo = NamespaceSummary & {
  toolCount: number | null;
  tools: Tool[];
  nextOffset: number | null;
};

export type NamespaceInfoOptions = {
  namespace: string;
  offset: number;
  limit: number;
};

type NamespaceController = {
  list(): NamespaceSummary[] | Promise<NamespaceSummary[]>;
  listInfo(options: NamespaceInfoOptions): NamespaceInfo | Promise<NamespaceInfo>;
  open(namespace: string): NamespaceInfo | Promise<NamespaceInfo>;
  close(namespace: string): NamespaceSummary | Promise<NamespaceSummary>;
};

const namespaceSchema = z.string().trim().min(1).regex(/^[A-Za-z0-9_-]+$/);
const listSchema = z.object({}).strict();
const listInfoSchema = z.object({
  namespace: namespaceSchema,
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
const switchSchema = z.object({ namespace: namespaceSchema }).strict();
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const responseCreate = async <T>(context: Context, value: () => T | Promise<T>) => {
  try {
    return context.json(await value());
  } catch (error) {
    return context.json({
      error: error instanceof Error ? error.message : String(error),
    }, 409);
  }
};

export class Overview {
  private controller?: NamespaceController;

  readonly mcp = new Register({
    namespace: "mcp",
    description: "发现母库中的 MCP 命名空间，并按需开启或关闭 npm 成品 MCP。",
  })
    .mcpAdd(
      "/list",
      new Hono().get("/", context => responseCreate(
        context,
        () => this.controllerGet().list(),
      )),
      listSchema,
      "列出当前母库的命名空间、用途、来源类型和运行状态；只读取轻量产品目录，不启动 npm MCP，也不读取具体工具契约。",
      annotations,
    )
    .mcpAdd(
      "/listInfo",
      new Hono().get("/", context => responseCreate(context, () => {
        const options = listInfoSchema.parse(context.req.query());
        return this.controllerGet().listInfo(options);
      })),
      listInfoSchema,
      "分页读取一个命名空间的运行状态和具体工具契约；关闭状态不会被隐式启动，首次开启前工具数量为 null。",
      annotations,
    )
    .mcpAdd(
      "/open",
      new Hono().post("/", context => responseCreate(context, async () => {
        const { namespace } = switchSchema.parse(await context.req.json());
        return this.controllerGet().open(namespace);
      })),
      switchSchema,
      "按命名空间真实启动一个 npm 成品 MCP，连接其 Client 与 Transport，把工具交付给母库，并返回首批具体工具；本地命名空间始终运行，不能开启。",
      {
        ...annotations,
        readOnlyHint: false,
      },
    )
    .mcpAdd(
      "/close",
      new Hono().post("/", context => responseCreate(context, async () => {
        const { namespace } = switchSchema.parse(await context.req.json());
        return this.controllerGet().close(namespace);
      })),
      switchSchema,
      "按命名空间从母库移除工具并真实关闭一个 npm 成品 MCP 的 Client 与 Transport；本地命名空间不可关闭。",
      {
        ...annotations,
        readOnlyHint: false,
        destructiveHint: true,
      },
    );

  controllerSet(controller: NamespaceController) {
    this.controller = controller;
    return this;
  }

  private controllerGet() {
    if (!this.controller) throw new Error("MCP namespace controller is not configured.");
    return this.controller;
  }
}
