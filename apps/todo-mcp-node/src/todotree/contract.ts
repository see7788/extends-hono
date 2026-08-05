import { z } from "zod";

const agentValue = z.literal(1).describe("parent");
const statusValues = [
  z.literal(1).describe("待定"),
  z.literal(2).describe("待办"),
  // 工作队未启用，保留正式状态与数字位置，页面暂不展示。
  z.literal(3).describe("未派工"),
  z.literal(4).describe("工作中"),
  // 工作队未启用，保留正式状态与数字位置，页面暂不展示。
  z.literal(5).describe("已反馈"),
  // 工作队未启用，保留正式状态与数字位置，页面暂不展示。
  z.literal(6).describe("已中断"),
  z.literal(7).describe("完成"),
  z.literal(8).describe("阻塞"),
  z.literal(9).describe("取消"),
] as const;
const templateValues = [
  z.literal("project").describe("项目路径"),
  z.literal("file").describe("项目内相对文件路径"),
  z.literal("typescript").describe("真实 TypeScript 公开成员"),
  z.literal("markdown").describe("Markdown 富文本"),
  z.literal("text").describe("普通短内容"),
] as const;
const label = z.string().min(1);

const agent = agentValue;
const status = z.union(statusValues);
const template = z.union(templateValues);

type Option<TValue extends number | string> = {
  label: z.infer<typeof label>;
  value: TValue;
};
type Agent = z.infer<typeof agent>;
type Status = z.infer<typeof status>;
type Template = z.infer<typeof template>;

export const agentOptions = Object.freeze([
  { label: label.parse(agentValue.description), value: agentValue.value },
] satisfies Option<Agent>[]);

export const statusOptions = Object.freeze(statusValues.map(value => ({
  label: label.parse(value.description),
  value: value.value,
})) satisfies Option<Status>[]);

export const statusOptionsVisible = Object.freeze(
  // 3 未派工、5 已反馈、6 已中断属于同一套正式状态；工作队启用前仅隐藏页面入口。
  statusOptions.filter(option => option.value !== 3 && option.value !== 5 && option.value !== 6),
);

export const templateOptions = Object.freeze(templateValues.map(value => ({
  label: label.parse(value.description),
  value: value.value,
})) satisfies Option<Template>[]);

export const contractValidator = {
  agent: agent.describe(
    `当前唯一执行者字段：${String(agentOptions[0].value)} ${agentOptions[0].label}；工作队未启用，title 不得重复执行者。`,
  ),
  status: status.describe(
    `唯一状态字段依次为：${statusOptions.map(option => `${String(option.value)} ${option.label}`).join("、")}；3、5、6 在工作队启用前不作为页面入口；status > 6 统一表示收口，7 完成是正常收口，8 阻塞与 9 取消是分支收口；title 不得添加状态符号或文字。`,
  ),
  template: template.describe(
    `渲染模板：${templateOptions.map(option => `${option.value} ${option.label}`).join("、")}。`,
  ),
};
