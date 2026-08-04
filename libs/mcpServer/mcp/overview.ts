import type { Tool } from "@modelcontextprotocol/server";
import { Hono } from "hono";
import { z } from "zod";
import Register from "../public";

const inputSchema = z.object({
  name: z.string().trim().min(1).optional().describe(
    "精确工具名；提供后只返回该工具的完整契约。",
  ),
  query: z.string().trim().min(1).optional().describe(
    "在工具名和用途描述中搜索；先用搜索结果取得精确工具名。",
  ),
  offset: z.coerce.number().int().min(0).default(0).describe(
    "名称结果的起始位置。",
  ),
  limit: z.coerce.number().int().min(1).max(50).default(20).describe(
    "本次最多返回的工具名称数量。",
  ),
}).strict();

export class Overview {
  private toolsGet = () => Promise.resolve<Tool[]>([]);

  readonly mcp = new Register({ namespace: "todo-mcp2" }).register(
    "/overview",
    new Hono().get("/", async context => {
      const tools = await this.toolsGet();
      const input = inputSchema.parse(context.req.query());
      if (input.name !== undefined) {
        const tool = tools.find(item => item.name === input.name);
        if (!tool) {
          return context.json({
            error: `Unknown MCP tool: ${input.name}`,
            toolCount: tools.length,
          }, 404);
        }
        return context.json({ toolCount: tools.length, tool });
      }
      const query = input.query?.toLowerCase();
      const matches = query === undefined
        ? tools
        : tools.filter(tool => (
            tool.name.toLowerCase().includes(query)
            || tool.description?.toLowerCase().includes(query)
          ));
      const names = matches
        .slice(input.offset, input.offset + input.limit)
        .map(tool => tool.name);
      return context.json({
        toolCount: tools.length,
        matchCount: matches.length,
        offset: input.offset,
        limit: input.limit,
        nextOffset: input.offset + names.length < matches.length
          ? input.offset + names.length
          : null,
        tools: names,
      });
    }),
    inputSchema,
    "供 AI 发现当前 /todo-mcp 实际注册的工具。默认分页返回轻量工具名称；query 在名称和用途描述中搜索，name 按精确工具名只返回一个完整契约。先发现名称再读取单个契约，禁止为发现工具请求全部 schema。成功返回总数、匹配数、分页位置和下一页位置；只读取当前注册结果，不探测进程健康状态。",
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  );

  toolsSet(toolsGet: () => Promise<Tool[]>) {
    this.toolsGet = toolsGet;
    return this;
  }
}

export default new Overview();
