import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Hono } from "hono";
import { z } from "zod";
import Register from "../public";
import RegisterFromNpm from "./public";

const scopeMaintenance = {
  purpose: "按真实消费关系维护共享 CodeGraph 索引，使共同分析的项目进入同一图谱；任务按需扩展并保留范围，由使用者定期集中收紧。",
  model: {
    sourceOfTruth: "源码目录",
    workspaceRoot: "需要共同分析的项目所共享的最近公共父目录",
    index: "workspaceRoot 中唯一、可重建并由多个项目共享的 CodeGraph 代码知识缓存",
    scope: "workspaceRoot/.gitignore 精确声明当前共同使用的项目；任务需要的新项目按实际依赖扩展并继续保留，各项目自己的 .gitignore 维护项目内部索引边界。",
    concurrency: "多个 AI 并发读取稳定索引；范围扩展基于最新文件取并集并串行同步，范围收紧由使用者集中维护。",
  },
  workflow: [
    {
      step: "inspect",
      method: [
        "从目标 projectPath 向上确认当前解析到的 workspaceRoot 和统一索引。",
        "读取 codegraph status --json、workspaceRoot/.gitignore、相关项目 .gitignore 及其 SHA-256。",
        "列出当前任务真实读取或修改的项目、直接生产者、直接消费者和为保持调用链完整所需的递归消费者。",
      ],
      result: "得到当前范围基线和本任务 requiredProjects；已有索引中的普通查询只收窄 projectPath 与 query。",
    },
    {
      step: "scope",
      method: [
        "requiredProjects 只包含当前任务需要共同分析的项目，不使用项目类别通配符代替已知的精确目录。",
        "当前有效范围是已有项目规则与本次 requiredProjects 的并集；workspaceRoot 下的共享工具按实际调用关系纳入。",
        "已经进入有效范围的项目直接复用；缺少的项目使用精确顶层目录规则补充。",
      ],
      result: "需要消费多少项目就开放多少项目，保留已经开放的项目供后续任务和其他 AI 共同使用。",
    },
    {
      step: "patch",
      method: [
        "范围维护者记录 workspaceRoot/.gitignore 当前 SHA-256，并以该哈希作为写入基线。",
        "哈希保持一致时使用最小 patch 添加缺少的精确目录；哈希变化时重新 inspect，并基于最新内容重新计算并集。",
        "日常任务只追加 requiredProjects，不移除已有范围；范围收紧留给使用者发起的集中维护。",
        "根级规则只选择项目目录；依赖、构建产物、缓存和本地状态继续由入选项目自己的 .gitignore 管理。",
      ],
      result: "保留已有规则，记录本次范围扩展后的 expectedRevision。",
    },
    {
      step: "sync",
      method: [
        "运行 codegraph sync <workspaceRoot>，使范围变化和源码修改同步到现有索引。",
        "索引状态异常、范围同步结果与预期不一致或 extraction 版本变化时，由范围维护者确认没有活动写入者后运行 codegraph index <workspaceRoot>。",
      ],
      result: "统一索引与 expectedRevision 对应的项目并集保持一致。",
    },
    {
      step: "verify",
      method: [
        "运行 codegraph status --json，确认索引根、complete 状态、pendingChanges 为零。",
        "查询每个新纳入项目的代表性符号，并验证本任务依赖的一条跨项目调用链。",
        "核对 workspaceRoot/.gitignore 当前 SHA-256 等于 expectedRevision。",
      ],
      result: "得到可供所有 AI 只读消费的 verifiedRevision。",
    },
    {
      step: "retain",
      method: [
        "任务完成后保留本次已验证的项目范围，供共享工具、后续任务和其他 AI 继续消费。",
        "记录本次新增目录和 verifiedRevision；日常任务不执行范围删除，也不恢复任务开始前的 .gitignore。",
        "使用者发起集中收紧时，重新 inspect 当前真实消费者，只移除已确认不再需要的目录，并再次 sync 和 verify。",
        "结束当前任务额外启动且已有明确 owner 的 daemon；共享索引服务和已开放范围继续保留。",
      ],
      result: "本次范围扩展稳定保留；集中维护时再按当前真实消费关系统一收紧。",
    },
  ],
  gitignore: {
    exactScopeExample: [
      "/*",
      "!/project-a/",
      "!/shared-libs/",
    ],
    scopeExpansionExample: [
      "/*",
      "!/existing-project/",
      "!/new-required-tool/",
    ],
    rules: [
      "根规则以 workspaceRoot 为基准，/* 建立项目白名单，随后每个 !/project/ 精确开放一个顶层项目。",
      "项目类别通配符只适用于该类别中的每个项目都具有同一项长期消费关系；已知项目集合使用逐项目规则。",
      "项目内部范围由项目自己的 .gitignore 决定；根范围文件只选择进入共享图谱的项目。",
      "日常任务把缺少的真实消费者追加到现有白名单并保留；使用者定期集中检查后统一收紧范围。",
    ],
  },
  coordination: [
    "只读 explore 可以并发执行；.gitignore patch、sync、index、unlock 和 daemon 生命周期操作按 workspaceRoot 串行执行。",
    "每个 AI 修改前读取最新哈希，修改后记录 expectedRevision；基线变化代表已有其他维护结果，需要基于最新范围与本次 requiredProjects 重新计算并集。",
    "日常 AI 只追加自己需要的精确项目目录，不删除已有规则；多个 AI 因而只会扩大并集，不会关闭其他任务正在消费的范围。",
    "范围删除由使用者发起的集中维护统一完成；收紧前核对当前项目关系和真实消费者，收紧后重新 sync 与 verify。",
    "索引文件锁表示已有进程正在消费或维护索引；优先使用支持现有数据库的 sync，完整 index 在确认活动写入状态后执行。",
  ],
  recovery: [
    {
      symptom: "目标 projectPath 未解析到 workspaceRoot 的有效统一索引。",
      repair: "核对最终生效的 MCP 配置和最近公共父目录；索引缺失时准确报告 CodeGraph Index Required，并由维护者在 workspaceRoot 建立索引。",
      verify: "目标 projectPath 解析到 workspaceRoot 索引，并能完成代表性 explore 查询。",
    },
    {
      symptom: "范围 patch 后索引内容与 requiredProjects 不一致。",
      repair: "核对根项目白名单、项目自身 ignore、当前哈希和项目并集，先 sync；结果仍不一致时按单写者流程完整 index。",
      verify: "status、新纳入项目代表性查询和跨项目调用链同时符合预期。",
    },
    {
      symptom: "索引被锁定。",
      repair: "识别当前 MCP、CLI 或 daemon owner；活跃读者存在时使用 sync，陈旧写锁在确认没有活动写入者后由维护者 unlock。",
      verify: "status 为 complete、pendingChanges 为零，代表性查询可用。",
    },
    {
      symptom: "多个 AI 同时扩展范围导致写入基线发生变化。",
      repair: "保留最新文件，把其中已有项目与本次 requiredProjects 重新取并集后最小追加；不回退其他 AI 的范围结果。",
      verify: "最终白名单包含各任务已声明的项目，哈希和索引状态经过验证。",
    },
  ],
};

const mcp = new RegisterFromNpm().register({
  namespace: "codegraph",
  transport: () => new StdioClientTransport({
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["-y", "@colbymchenry/codegraph@1.4.1", "serve", "--mcp"],
  }),
}).replace({
  toolName: "codegraph_explore",
  name: "explore",
  title: "检索统一 CodeGraph 代码知识",
  description: [
    "从 projectPath 向上解析最近公共工作区中长期共享的 CodeGraph 索引，返回相关源码、调用路径和影响范围。",
    "跨项目调用、package 依赖和影响分析使用同一共享索引保持完整关系；当前问题通过 projectPath 和 query 收窄。",
    "源码目录是唯一事实来源，CodeGraph 是可重建的代码知识缓存。",
    "索引范围按真实消费关系精确开放项目；任务需要时追加并保留共享工具和项目，范围收紧由使用者集中维护。",
    "准备调整 .gitignore、索引、锁或 daemon 生命周期时，先调用 codegraph.scope_maintenance 取得维护协议。",
    "目标路径缺少有效共享索引时准确报告 CodeGraph Index Required，并说明加载 MCP、重启会话或在公共工作区建立索引的恢复条件。",
  ].join(" "),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}).add(new Register().register(
  "/scope_maintenance",
  new Hono().get("/", context => context.text(
    JSON.stringify(scopeMaintenance, undefined, 2),
  )),
  z.object({}),
  [
    "在 AI 准备维护 CodeGraph 的 .gitignore、索引范围、写锁或 daemon 生命周期前调用。",
    "返回按真实消费者精确开放项目、多 AI 只追加并集、基线串行 patch、同步验证、任务后保留和集中收紧的完整只读规范。",
    "本工具只提供维护协议，不修改文件、索引或进程。",
  ].join(" "),
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
));

export default mcp;
