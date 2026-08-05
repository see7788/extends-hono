import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Hono } from "hono";
import { z } from "zod";
import RegisterFromNpm from "./public";

const scopeMaintenance = {
  invariant: "每个 AI 只能按自身当前真实分析需求最小化放松 workspaceRoot/.gitignore，逐项追加完成本次分析所需的精确目录；不得主动收紧已有范围。",
  workflow: [
    {
      step: "inspect",
      method: [
        "从目标 projectPath 向上确认 workspaceRoot、索引状态和当前 workspaceRoot/.gitignore。",
        "列出完成当前分析实际需要共同入图的源码项目；只包含目标、相关生产者、消费者及调用链连续性所必需的目录。",
      ],
      result: "得到当前分析的 requiredProjects 精确集合。",
    },
    {
      step: "patch",
      method: [
        "以 /* 维持默认排除，只为 requiredProjects 使用 !/project/ 形式逐项开放精确顶层目录。",
        "保留已有开放目录，只对本次缺少的 requiredProjects 做最小精确追加；使用完成后不主动删除规则。",
        "禁止用项目类别、父目录或整个仓库的通配规则代替已知的精确目录集合。",
      ],
      result: "workspaceRoot/.gitignore 保留其他 AI 已开放范围，并且本次只增加必要的精确目录。",
    },
    {
      step: "apply",
      method: [
        "范围变化后运行 codegraph sync <workspaceRoot>；只有索引缺失或 sync 无法恢复时才由维护者重建。",
        "写入前后核对 workspaceRoot/.gitignore，发现并发变化时保留最新文件中的全部已有规则，再重新计算本次缺少的最小精确追加。",
      ],
      result: "共享索引包含已有范围与本次最小必要增量，不覆盖或删除其他 AI 的规则。",
    },
    {
      step: "verify",
      method: [
        "确认索引 complete、pendingChanges 为零，并查询 requiredProjects 的代表性符号和必要跨项目调用链。",
        "确认本次新增目录都由当前真实分析需求直接要求，且本次没有加入项目类别、父目录或全仓通配范围。",
      ],
      result: "索引可用，本次范围变化严格等于完成当前分析所需的最小增量。",
    },
  ],
};

const mcp = new RegisterFromNpm({
  namespace: "codegraph",
  description: "读取工作区源码索引、符号关系、调用路径和修改影响范围。",
}).registerPkg({
  instructions: "CodeGraph 使用全局唯一共享索引；每个 AI 维护 workspaceRoot/.gitignore 时，只能按自身当前真实分析需求最小化追加完成本次分析所需的精确目录，禁止加入项目类别、父目录或全仓通配范围，并且使用完成后不得主动收紧已有规则。",
  transport: () => new StdioClientTransport({
    command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    args: ["dlx", "@colbymchenry/codegraph@1.5.0", "serve", "--mcp"],
  }),
}).mcpReplace({
  toolName: "codegraph_explore",
  name: "explore",
  description: [
    "用于源码符号定位、读取已知源码文件或符号、查询 callers/callees、追踪入口 A 到目标 B 的调用路径，以及评估修改的 blast radius。",
    "projectPath 可省略；提供时必须是目标项目或其内部目录的绝对路径，工具从该路径向上解析最近的现有 CodeGraph 索引；省略时使用服务当前默认项目。",
    "query 必填，可写自然语言、文件名或符号名；追踪流程时在同一次 query 中同时提供关键入口、目标和必要中间符号。",
    "成功返回与 query 相关的逐行源码锚点、文件路径、符号关系、callers/callees、调用路径、影响范围及可用的索引状态提示；只读取索引和源码，不修改文件、索引或进程。",
    "已返回的 AST 关系和调用路径直接作为结构事实使用，不再用全文搜索重建；全文搜索只补充配置、文档和其他未索引文本，这些内容不属于本工具的主要保证范围。",
    "projectPath 未解析到有效索引时返回准确的 CodeGraph Index Required；随后调用 codegraph.scope_maintenance.GET 取得最小必要索引范围的维护契约，再由具备相应文件或 CodeGraph CLI 能力的维护入口执行恢复。",
  ].join(" "),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}).register([
  "/scope_maintenance",
  new Hono().get("/", context => context.text(
    JSON.stringify(scopeMaintenance, undefined, 2),
  )),
  z.object({}),
  [
    "在准备维护 CodeGraph 的 .gitignore 或索引范围，或 codegraph.explore 返回 CodeGraph Index Required 时调用。",
    "无输入；成功返回计算、应用和验证最小必要索引范围的 JSON 契约；只提供维护规范，不读取实时索引状态，也不修改文件、索引或进程。",
    "调用失败表示本 MCP 服务不可用；恢复服务后重试。需要当前索引事实时使用现有 CodeGraph 状态能力或人工检查，本接口不伪造实时状态。",
  ].join(" "),
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
] as const);

export default mcp;
