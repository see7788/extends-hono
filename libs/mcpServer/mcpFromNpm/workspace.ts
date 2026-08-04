import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import RegisterFromNpm from "./public";

const mcp = new RegisterFromNpm({ namespace: "workspace" }).registerPkg({
  transport: () => new StdioClientTransport({
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["-y", "@wonderwhy-er/desktop-commander@0.2.46"],
  }),
});

const toolContracts = {
  get_config: {
    description: "需要查看 Desktop Commander 当前允许目录、命令限制、shell、读写限制、客户端和系统配置时使用；无必填输入；成功返回完整配置 JSON；只读取服务状态；服务不可用时恢复 workspace transport 后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  set_config_value: {
    description: "用户明确要求修改 Desktop Commander 单个配置项时使用；必填 key 和 value，并先确认该配置的权限影响；成功持久化新配置；会改变后续文件与命令访问边界；键、值或权限不合法时停止并恢复原值或改用有效配置后重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  read_file: {
    description: "需要读取允许目录内的单个文件，或明确读取 URL 内容时使用；必填绝对 path，URL 还需 isUrl，可选分页和格式参数；成功返回文本、结构化内容或媒体数据；不修改来源；路径、权限、格式或网络失败时修正输入、开放所需目录或恢复网络后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  read_multiple_files: {
    description: "需要并行读取允许目录内多个文件时使用；必填绝对 paths 数组；成功按路径返回各文件内容并保留单项失败；不修改文件；路径或权限失败时只修正失败项后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  write_file: {
    description: "用户授权创建、重写或追加允许目录内文件时使用；必填绝对 path 和 content，可选 rewrite 或 append；成功写入文件；rewrite 可覆盖原内容且 append 重复调用会重复数据；路径、权限或格式失败时先读取当前文件确认状态，再修正输入后继续。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  write_pdf: {
    description: "用户授权从内容创建新 PDF 或把操作应用到现有 PDF 时使用；必填绝对 path 和 content，修改现有 PDF 时提供新的 outputPath；成功创建目标 PDF；会写入文件且错误目标可能覆盖内容；路径、内容或渲染失败时保留原文件并改用新的有效输出路径重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  create_directory: {
    description: "用户授权在允许范围内建立目录时使用；必填绝对 path；成功确保目录存在；不删除既有内容；路径或权限失败时修正路径或允许目录后重试。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  list_directory: {
    description: "需要查看允许目录中的直接或递归目录项时使用；必填绝对 path，可选深度；成功返回文件和目录清单；不修改文件系统；路径或权限失败时修正路径或允许目录后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  move_file: {
    description: "用户明确授权移动或重命名文件、目录时使用；必填绝对 source 和 destination，并确认目标冲突；成功把源移动到目标；会改变原路径且可能覆盖或造成消费者失效；路径、权限或冲突失败时保持现状，重新核对源、目标和消费者后重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  start_search: {
    description: "需要在允许目录中按名称或内容启动可分页搜索时使用；必填绝对 path 和 pattern，可选搜索类型与过滤条件；成功返回 search session ID 和首批结果；只读取文件但会建立临时会话；路径、正则或权限失败时修正输入后重新启动搜索。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  get_more_search_results: {
    description: "已有 start_search 返回的活动 sessionId 且需要下一批结果时使用；必填 sessionId；成功返回新增结果和搜索状态；只读取搜索会话；会话不存在或已结束时重新启动搜索。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  stop_search: {
    description: "已有活动搜索且不再需要其后台工作时使用；必填 sessionId；成功停止并释放该搜索会话；不修改文件；会话不存在时重新列出活动搜索并只停止有效目标。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  list_searches: {
    description: "需要查看当前 Desktop Commander 活动搜索会话时使用；无输入；成功返回 session ID 和状态；不修改会话或文件；服务不可用时恢复 workspace transport 后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  get_file_info: {
    description: "需要读取允许范围内文件或目录的大小、时间、类型和权限等元数据时使用；必填绝对 path；成功返回当前元数据；不修改文件；路径不存在或无权限时修正路径或允许目录后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  edit_block: {
    description: "用户授权对允许范围内文件执行精确文本或文档块替换时使用；必填 file_path，并按 schema 提供旧内容、新内容及匹配约束；成功只修改匹配块；会覆盖目标文件局部内容；匹配数、编码、路径或权限不符时停止，重新读取当前文件建立基线后再重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  start_process: {
    description: "用户授权在本机启动命令或长运行进程时使用；必填 command 和 timeout_ms，可选 shell；成功返回输出、完成状态或可继续读取的 PID；命令可修改文件、进程和外部系统；命令、权限或超时失败时依据真实输出修正命令，禁止无证据重复。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  read_process_output: {
    description: "已有 start_process 返回的 PID 且需要读取新增或指定范围输出时使用；必填 pid，可选超时、offset 和 length；成功返回输出片段与进程状态；不改变进程业务状态但 offset=0 会推进读取游标；PID 不存在时重新列出会话或确认进程已结束。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  interact_with_process: {
    description: "已有等待输入的活动进程且用户授权继续交互时使用；必填 pid 和 input，可选超时与等待策略；成功把输入发送给进程并返回响应；输入可触发任意本地或外部副作用；PID、进程状态或输入失败时先读取状态，再修正输入或重启明确目标进程。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  force_terminate: {
    description: "用户明确要求结束由 Desktop Commander 管理的终端会话时使用；必填 pid，并先确认 owner；成功强制终止会话；会丢失进程内未保存状态；PID 不存在或无权限时重新列出会话并只处理已确认目标。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  list_sessions: {
    description: "需要查看 Desktop Commander 管理的活动终端会话及等待状态时使用；无输入；成功返回 PID、运行时间和状态；不修改进程；服务不可用时恢复 workspace transport 后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  list_processes: {
    description: "需要查看操作系统当前进程、PID、CPU 和内存概况时使用；无输入；成功返回进程列表；不修改进程；权限或服务失败时恢复所需权限或 workspace transport 后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  kill_process: {
    description: "用户明确要求按 PID 终止操作系统进程时使用；必填 pid，并先确认准确进程和 owner；成功强制结束进程；可能丢失数据或中断服务；PID、权限或目标身份不明时停止并重新列出进程确认。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  get_usage_stats: {
    description: "需要调试 Desktop Commander 的工具使用次数、成功率和耗时时使用；无输入；成功返回本地使用统计；不修改业务文件或进程；服务不可用时恢复 workspace transport 后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  get_recent_tool_calls: {
    description: "需要审计当前服务内存中的近期工具调用、参数和结果时使用；可选数量、工具名和起始时间；成功返回匹配历史，重启后历史可能为空；不修改历史或外部状态；过滤条件无效时修正后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  give_feedback_to_desktop_commander: {
    description: "仅在用户明确同意打开 Desktop Commander 反馈表时使用；无输入；成功在默认浏览器打开外部反馈页面并附带产品使用统计；不会自动提交反馈，但会产生外部导航；浏览器启动失败时向用户报告并由用户决定是否重试。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  get_prompts: {
    description: "用户选择 Desktop Commander 已提供的 onboarding prompt 且需要取得对应内容时使用；必填 action=get_prompt 和有效 promptId；成功返回指定提示内容供当前会话继续执行；本工具本身不修改文件；ID 无效时使用已公开的有效 ID 后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
} as const;

for (const [toolName, contract] of Object.entries(toolContracts)) {
  mcp.mcpReplace({ toolName, ...contract });
}

export default mcp;
