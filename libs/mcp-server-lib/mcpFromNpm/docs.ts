import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import RegisterFromNpm from "./public";

const mcp = new RegisterFromNpm({
  namespace: "docs",
  description: "查询软件库和框架的当前技术文档与代码示例。",
}).registerPkg({
  transport: () => new StreamableHTTPClientTransport(
    new URL("https://mcp.context7.com/mcp"),
  ),
});

for (const [toolName, contract] of Object.entries({
  "resolve-library-id": {
    description: "需要查询某个库或产品的 Context7 文档且用户没有直接给出 /org/project 或 /org/project/version 标识时使用；必填 libraryName 和描述真实文档需求的 query；成功返回候选库 ID、版本、覆盖度和质量信息，不修改本地或远端数据；名称模糊、无匹配或外部服务失败时细化名称与 query，最多尝试三次后使用最佳候选或报告缺失。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  "query-docs": {
    description: "已有用户提供或 resolve-library-id 返回的精确 Context7 libraryId，并需读取单一主题的最新库文档和代码示例时使用；必填 libraryId 和具体 query；成功返回匹配的外部文档片段与示例，不修改任何数据；ID 无效、主题过宽或外部服务失败时重新解析 ID、收窄 query，并对同一问题最多调用三次。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
})) {
  mcp.mcpReplace({ toolName, ...contract });
}

export default mcp;
