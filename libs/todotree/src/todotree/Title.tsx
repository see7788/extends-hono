import { Flex, Tag, Typography } from "antd";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TodoTreeNode } from "todo-mcp-node/src/todotree/store.ts";

export default function Title({
  compact = true,
  title,
  template,
}: TodoTreeNode & { compact?: boolean }) {
  if (template === "project") {
    return <Typography.Text code strong>{title}</Typography.Text>;
  }
  if (template === "file") {
    return <Typography.Text code>{title}</Typography.Text>;
  }
  if (template === "typescript") {
    const internal = title.startsWith("[内]");
    return (
      <Flex align="start" gap="small">
        {internal && <Tag color="default">内</Tag>}
        <Typography.Text code style={{ whiteSpace: "pre-wrap" }}>
          {internal ? title.slice(3).trimStart() : title}
        </Typography.Text>
      </Flex>
    );
  }
  if (template === "text") {
    return <Typography.Text>{compact ? title.slice(0, 60) : title}</Typography.Text>;
  }

  return (
    <Typography style={{ margin: 0 }}>
      <Markdown remarkPlugins={[remarkGfm]}>{title}</Markdown>
    </Typography>
  );
}
