import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import RegisterFromNpm from "./public";

const browser = new RegisterFromNpm({ namespace: "browser" }).registerPkg({
  transport: () => new StdioClientTransport({
    command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    args: [
      "dlx",
      "chrome-devtools-mcp@1.6.0",
      "--headless=true",
      "--isolated=true",
      "--no-usage-statistics",
      "--no-performance-crux",
      "--allow-unrestricted-paths",
    ],
  }),
});

const toolContracts = {
  click: {
    description: "在已有最新页面快照且需要单击元素时使用；必填快照中的 uid，可选双击和返回新快照；成功执行点击并返回页面结果；会改变页面且可能触发外部请求；uid 过期或元素不可交互时失败，重新获取快照并确认页面状态后重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  close_page: {
    description: "需要关闭指定浏览器页签时使用；必填 list_pages 返回的 pageId，且不能关闭最后一个页签；成功关闭页签；会丢弃该页未保存的页面状态；页签不存在或为最后一页时失败，重新列出页签并选择有效目标。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  drag: {
    description: "在最新页面快照中需要把一个元素拖到另一个元素时使用；必填 from_uid 和 to_uid；成功完成拖放并可返回新快照；会改变页面且可能触发外部副作用；uid 过期或目标不可拖放时失败，重新获取快照后重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  emulate: {
    description: "需要在当前页临时模拟网络、CPU、位置、UA、配色、视口或请求头时使用；仅提供要设置或清除的字段；成功更新浏览器仿真状态；不修改站点持久数据但会影响后续页面行为和请求；参数无效时失败，按 schema 修正后重试。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  evaluate_script: {
    description: "需要在当前页执行页面内 JavaScript 时使用；必填可执行函数文本，可选元素 uid 参数、输出文件和对话框策略；成功返回可 JSON 序列化结果或保存结果；脚本可修改页面、文件并访问外部网络；语法、序列化、权限或页面错误时失败，修正脚本或页面状态后重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  fill: {
    description: "需要给最新快照中的单个输入、文本域、选择框或开关赋值时使用；必填 uid 和 value；成功更新元素并可返回新快照；会改变页面表单状态；uid 过期或值不适合元素时失败，重新获取快照并修正值后重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  fill_form: {
    description: "需要一次填写多个表单元素时使用；必填 elements，每项含最新快照中的 uid 和 value；成功批量更新表单并可返回快照；会改变页面状态；任一 uid 过期或值无效时失败，重新获取快照并提交修正后的完整元素集合。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  get_console_message: {
    description: "已通过 list_console_messages 得到消息编号并需查看单条详情时使用；必填 msgid；成功返回对应控制台消息；只读取当前页观察结果；编号不存在时失败，重新列出消息后使用有效编号。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  get_network_request: {
    description: "已通过 list_network_requests 得到请求编号或已在 DevTools 选中请求并需查看详情时使用；reqid 可选，保存请求或响应正文时提供文件路径；成功返回请求详情或写入指定文件；写文件可能覆盖内容；编号、路径或正文不可用时失败，重新列出请求或修正路径后重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  handle_dialog: {
    description: "当前页面存在 JavaScript 对话框时使用；必填 accept 或 dismiss，可选 promptText；成功处理当前对话框；会推进页面交互状态；没有对话框或动作无效时失败，确认页面对话框状态后重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  hover: {
    description: "需要在最新快照中的元素上触发悬停状态时使用；必填 uid；成功移动指针并可返回新快照；不直接提交数据但可能触发页面脚本或请求；uid 过期时失败，重新获取快照后重试。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  lighthouse_audit: {
    description: "需要审计当前页的可访问性、SEO、最佳实践或 agentic browsing 时使用；可选 mode、device 和报告目录，navigation 模式会重载页面；成功返回审计结果并可写报告；会改变页面运行状态和文件系统；页面、浏览器或输出路径失败时恢复目标页和路径后重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  list_console_messages: {
    description: "需要查看当前页自最近导航以来的控制台消息时使用；可选分页、类型、保留历史和 service worker 过滤；成功返回消息列表及编号；只读取页面观察结果；页签不可用时重新选择有效页面后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  list_network_requests: {
    description: "需要查看当前页自最近导航以来的网络请求时使用；可选分页、资源类型和保留历史过滤；成功返回请求列表及编号；只读取网络观察结果；页签不可用时重新选择有效页面后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  list_pages: {
    description: "需要取得隔离浏览器中现有页签及当前选中页时使用；无输入；成功返回页签 ID、URL 和选择状态；不修改浏览器；browser transport 不可用时恢复浏览器进程后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  navigate_page: {
    description: "需要让当前页打开 URL、前进、后退或重载时使用；必填 type，URL 导航时提供 url，handleBeforeUnload 使用 accept 或 dismiss，可选缓存、初始化脚本和超时；成功完成导航；可能丢失页面状态并访问外部网络；导航或超时失败时确认 URL、页面和网络后重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  new_page: {
    description: "需要新建页签并加载地址时使用；必填 url，可选后台模式、隔离上下文和超时；成功返回新页签并加载目标；会创建浏览器状态并访问外部网络；URL、网络或超时失败时修正输入后重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  performance_analyze_insight: {
    description: "性能 trace 已产生 insight set 且需要分析其中一个 insight 时使用；必填 trace 返回的 insightSetId 和 insightName；成功返回该洞察的详细分析；只读取已有 trace；标识不存在时重新取得 trace 结果并使用其中的有效标识。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  performance_start_trace: {
    description: "需要记录当前页性能 trace 时使用；可选 reload、autoStop 和输出文件；成功启动或完成 trace 并返回性能洞察；可能重载页面并写文件；已有 trace、页面或路径错误时停止旧 trace、恢复页面和路径后重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  performance_stop_trace: {
    description: "已有活动性能 trace 且需要停止时使用；可选输出文件路径；成功停止 trace 并返回结果或保存文件；会结束记录并可能写文件；没有活动 trace 或路径无效时确认 trace 状态和路径后重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  press_key: {
    description: "需要在当前页发送键或组合键时使用；必填 key，可选返回新快照；成功派发键盘输入；会改变页面且可能触发提交、导航或外部动作；页面未聚焦或键值无效时重新选择页面、聚焦元素并重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  resize_page: {
    description: "需要调整当前页视口尺寸时使用；必填 width 和 height；成功调整窗口尺寸；只改变隔离浏览器视口；尺寸无效或页签不可用时修正尺寸或重新选择页面后重试。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  select_page: {
    description: "需要把现有页签设为后续 browser 调用上下文时使用；必填 list_pages 返回的 pageId，可选置前；成功更新当前选中页；不修改页面内容；页签不存在时重新列出页签后重试。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  take_heapsnapshot: {
    description: "需要分析当前页 JavaScript 内存分布或泄漏时使用；必填输出 .heapsnapshot 文件路径；成功捕获并写入堆快照；会创建或覆盖本地文件且可能短暂暂停页面；路径或浏览器失败时修正路径并恢复页面后重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  take_screenshot: {
    description: "需要取得当前页或快照元素的像素图时使用；可选格式、质量、uid、fullPage 和输出路径；成功返回图片或写入文件；写文件时可能覆盖内容；uid、页面或路径失败时重新获取快照或修正路径后重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  take_snapshot: {
    description: "需要读取当前页可交互结构并取得后续元素 uid 时使用；可选 verbose 和输出路径；成功返回最新可访问性树快照或写入文件；写文件时可能覆盖内容；页面或路径失败时重新选择页面或修正路径后重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  type_text: {
    description: "已有聚焦输入位置且需要模拟键盘输入时使用；必填 text，可选提交键；成功输入文本并可提交；会改变页面并可能触发外部动作；焦点丢失或页面变化时重新定位并聚焦元素后重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  upload_file: {
    description: "需要通过最新快照中的文件输入元素上传本地文件时使用；必填 uid 和 filePath；成功把文件交给页面并可返回快照；会读取本地文件并可能向外部站点上传；元素、路径或权限失败时重新获取快照并确认文件后重试。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  wait_for: {
    description: "需要等待当前页出现一个或多个目标文本时使用；必填非空 text 数组，可选超时；成功在任一文本出现时返回页面状态；只观察页面；超时或页签不可用时检查文本、页面和超时设置后重试。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
} as const;

for (const [toolName, contract] of Object.entries(toolContracts)) {
  browser.mcpReplace({ toolName, ...contract });
}

const mcp = browser.register(toolCall => [
  "/environment/check",
  new Hono().get("/", async context => {
    let result: Awaited<ReturnType<typeof toolCall>>;
    try {
      result = await toolCall("list_pages", {});
    } catch (error) {
      throw new HTTPException(502, {
        message: JSON.stringify([
          error instanceof Error ? error.message : String(error),
        ]),
        cause: error,
      });
    }
    if (result.isError) {
      const errors = result.content.flatMap(content => content.type === "text" ? [content.text] : []);
      throw new HTTPException(502, {
        message: JSON.stringify(errors.length ? errors : ["browser.list_pages failed"]),
      });
    }
    return context.text("[]");
  }),
  z.object({}),
  "在依赖 browser 工具前检查隔离浏览器 MCP 是否可调用；无输入；成功返回空 JSON 字符串数组，上游失败返回 502 和错误数组；只读取浏览器页签且不修改页面；出现错误时按返回消息恢复 browser transport 或浏览器进程后重试。",
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
] as const);

export default mcp;
