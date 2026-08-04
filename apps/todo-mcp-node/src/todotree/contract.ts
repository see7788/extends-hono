import { z } from "zod";

const agentValue = z.literal(1).describe("parent");
const statusValues = [
  z.literal(1).describe("待确认"),
  z.literal(2).describe("待办"),
  z.literal(4).describe("运行中"),
  z.literal(8).describe("阻塞"),
  z.literal(9).describe("已取消"),
  z.literal(7).describe("已完成"),
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

export const templateOptions = Object.freeze(templateValues.map(value => ({
  label: label.parse(value.description),
  value: value.value,
})) satisfies Option<Template>[]);

export const contractValidator = {
  agent: agent.describe(
    `当前唯一执行者字段：${String(agentOptions[0].value)} ${agentOptions[0].label}；工作队未启用，title 不得重复执行者。`,
  ),
  status: status.describe(
    `唯一状态字段依次为：${statusOptions.map(option => `${String(option.value)} ${option.label}`).join("、")}；已完成是唯一正常收尾，title 不得添加状态符号或文字。`,
  ),
  template: template.describe(
    `渲染模板：${templateOptions.map(option => `${option.value} ${option.label}`).join("、")}。`,
  ),
};
