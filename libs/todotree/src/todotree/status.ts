import type { TodoTreeNode } from "todo-mcp-node/src/todotree/store.ts";

export type TodoTreeStatus = NonNullable<TodoTreeNode["status"]>;

export const statusOptions = [
  { label: "待确认", value: 1 },
  { label: "待办", value: 2 },
  { label: "未派工", value: 3 },
  { label: "运行中", value: 4 },
  { label: "已反馈", value: 5 },
  { label: "已中断", value: 6 },
  { label: "已完成", value: 7 },
  { label: "阻塞", value: 8 },
  { label: "已取消", value: 9 },
] satisfies { label: string; value: TodoTreeStatus }[];

export const statusLabelRead = (status: TodoTreeStatus) => {
  const option = statusOptions.find(item => item.value === status);
  if (!option) throw new Error(`Unknown TodoTree status: ${String(status)}`);
  return option.label;
};
