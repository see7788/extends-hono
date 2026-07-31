import { fileURLToPath } from "node:url";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import RegisterFromNpm from "./public";

const mcp = new RegisterFromNpm().register({
  namespace: "io",
  instructions: "在当前母库及其同级项目的公共根目录内执行文件和目录 IO；所有路径必须位于 io.list_allowed_directories 返回的允许范围内。",
  transport: () => new StdioClientTransport({
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: [
      "-y",
      "@modelcontextprotocol/server-filesystem@2026.7.10",
      fileURLToPath(new URL("../../../../", import.meta.url)),
    ],
  }),
});

const toolContracts = {
  read_file: {
    description: "已废弃的文本读取入口，仅在上游调用明确依赖旧名称时使用；必填允许目录内的绝对 path，可选 head 或 tail；成功返回本机文件文本；文件可能包含源码、密钥或个人数据，禁止向外部披露；新调用使用 io.read_text_file。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  read_text_file: {
    description: "需要读取允许目录内的单个本机文本文件时使用；必填绝对 path，可选 head 或 tail；成功返回文件文本；内容可能包含源码、密钥或个人数据，禁止向外部披露；路径、权限或编码失败时修正输入后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  read_media_file: {
    description: "需要读取允许目录内的本机图片、音频或其他二进制文件时使用；必填绝对 path；成功返回媒体或内嵌资源；内容可能包含隐私或敏感数据，未经用户明确授权禁止上传或发送到外部；路径、权限或格式失败时修正输入后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  read_multiple_files: {
    description: "需要同时读取允许目录内多个本机文件时使用；必填非空绝对 paths 数组；成功逐项返回文本并保留单项失败；内容可能包含源码、密钥或个人数据，禁止向外部披露；只修正失败路径后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  write_file: {
    description: "仅在用户明确授权创建文件或完整覆盖既有文件时使用；必填允许目录内的绝对 path 和完整 content；成功写入目标文件；该操作会无提示覆盖原内容，写前必须确认准确目标并保留当前基线；路径、权限或写入失败时重新读取目标状态后处理。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  edit_file: {
    description: "仅在用户授权修改允许目录内文本文件且已读取当前基线时使用；必填绝对 path 和精确 edits，可先用 dryRun 预览；成功执行逐块精确替换并返回 diff；该操作会修改本机文件，匹配数量、编码或内容不符时停止并重新读取，不得猜测覆盖。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  create_directory: {
    description: "仅在用户授权建立允许范围内目录时使用；必填绝对 path；成功确保目录及必要父目录存在；会改变本机文件系统但不删除既有内容；路径或权限失败时修正输入后重试。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  list_directory: {
    description: "需要查看允许目录中直接子项时使用；必填绝对 path；成功返回文件与目录名称；目录结构可能暴露项目或个人信息，禁止向外部披露；路径或权限失败时修正输入后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  list_directory_with_sizes: {
    description: "需要查看允许目录中直接子项及大小时使用；必填绝对 path，可选按名称或大小排序；成功返回目录清单和大小；结果可能暴露项目结构与数据规模，禁止向外部披露；路径或权限失败时修正输入后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  directory_tree: {
    description: "需要递归了解允许目录的完整树结构时使用；必填绝对 path，可选 excludePatterns；成功返回 JSON 目录树；递归结果可能大量暴露项目或个人文件名称，应使用最小路径并排除无关目录，禁止向外部披露。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  move_file: {
    description: "仅在用户明确授权移动或重命名本机文件或目录时使用；必填允许范围内的绝对 source 和 destination，并先确认准确 owner、消费者和目标冲突；成功移动源路径；该操作会使原路径失效，失败时保持现状并重新核对，不得猜测重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  search_files: {
    description: "需要在允许目录内按 glob 递归查找文件或目录时使用；必填绝对 path 和 pattern，可选 excludePatterns；成功返回完整匹配路径；结果可能暴露项目结构或个人文件名称，应限制搜索范围并禁止向外部披露。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  get_file_info: {
    description: "需要读取允许范围内文件或目录的大小、时间、类型和权限时使用；必填绝对 path；成功返回本机元数据；结果可能包含敏感路径和活动时间，禁止向外部披露；路径不存在或无权限时修正输入后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  list_allowed_directories: {
    description: "在首次使用 io、路径边界不明确或访问被拒绝时调用；无输入；成功返回本机 filesystem MCP 当前允许访问的目录；结果属于本机安全边界信息，禁止向外部披露；服务不可用时恢复 io transport 后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
} as const;

for (const [toolName, contract] of Object.entries(toolContracts)) {
  mcp.replace({ toolName, ...contract });
}

export default mcp;
