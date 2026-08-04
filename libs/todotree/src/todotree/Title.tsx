import { Flex, Typography } from "antd";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TodoTreeNode } from "todo-mcp-node/src/todotree/store.ts";

export default function Title({
  compact = true,
  title,
  template,
}: TodoTreeNode & { compact?: boolean }) {
  if (template === "project") {
    return <Typography.Text strong>{title}</Typography.Text>;
  }
  if (template === "file") {
    return <Typography.Text style={{ fontFamily: "monospace" }}>{title}</Typography.Text>;
  }
  if (template === "typescript") {
    const internal = title.startsWith("[内]");
    return (
      <Flex align="start" gap="small">
        {internal && <Typography.Text type="secondary">[内]</Typography.Text>}
        <Typography.Text style={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
          {internal ? title.slice(3).trimStart() : title}
        </Typography.Text>
      </Flex>
    );
  }
  if (template === "text") {
    return <Typography.Text>{compact ? title.slice(0, 60) : title}</Typography.Text>;
  }
  if (compact) {
    const summary = title
      .replace(/[#*_`~>\-[\]()]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    return <Typography.Text>{summary}</Typography.Text>;
  }

  return (
    <Typography style={{ margin: 0 }}>
      <Markdown remarkPlugins={[remarkGfm]}>{title}</Markdown>
    </Typography>
  );
}
