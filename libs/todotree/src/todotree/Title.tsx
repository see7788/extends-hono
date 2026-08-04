import { Typography } from "antd";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TodoTreeNode } from "todo-mcp-node/src/todotree/store.ts";

export default function Title({
  title,
  titleType,
}: TodoTreeNode) {
  if (titleType === "text") {
    return <Typography.Text>{title.slice(0, 60)}</Typography.Text>;
  }

  return (
    <Typography style={{ margin: 0 }}>
      <Markdown remarkPlugins={[remarkGfm]}>{title}</Markdown>
    </Typography>
  );
}
