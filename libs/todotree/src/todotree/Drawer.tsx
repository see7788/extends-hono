import { Button, Input, Splitter } from "antd";
import { Drawer } from "extends-antd/src/Drawer";
import { hc } from "hono/client";
import Markdown from "react-markdown";
import { useNavigate, useParams } from "react-router-dom";
import remarkGfm from "remark-gfm";
import type { TodoMcpApi } from "todo-mcp-node/src/routers.ts";
import store from "../store.ts";

const client = hc<TodoMcpApi>(location.origin);

export default function NodeDrawer() {
  const todotree = store(state => state.todotree);
  const navigate = useNavigate();
  const { nodeId: nodeIdValue } = useParams<{ nodeId: string }>();
  const nodeId = nodeIdValue === undefined ? undefined : Number(nodeIdValue);
  const node = nodeId === undefined ? undefined : todotree.nodesById[nodeId];
  let workspace = node;
  while (workspace && workspace.id_parent !== 1) {
    workspace = workspace.id_parent === null
      ? undefined
      : todotree.nodesById[workspace.id_parent];
  }

  return (
    <Drawer
      destroyOnHidden
      onClose={() => void navigate("/")}
      open={node !== undefined}
      size="min(560px, calc(100vw - 48px))"
      styles={{ body: { padding: 0 } }}
      title={node ? `#${String(node.id)} ${workspace?.title ?? ""}` : ""}
    >
      {node && (
        <Splitter className="drawer-splitter" orientation="vertical">
          <Splitter.Panel defaultSize="50%" min="20%">
            <article className="drawer-content">
              <Markdown remarkPlugins={[remarkGfm]}>{node.title}</Markdown>
            </article>
          </Splitter.Panel>
          <Splitter.Panel defaultSize="50%" min="20%">
          <form
            className="drawer-panel"
            onSubmit={async event => {
              event.preventDefault();
              const form = event.currentTarget;
              const title = String(new FormData(form).get("title") ?? "").trim();
              if (!title) return;
              const response = await client["todo-mcp-node"].add.$post({
                json: { id_parent: node.id, title },
              });
              if (!response.ok) throw new Error(await response.text());
              form.reset();
              void navigate("/");
            }}
          >
            <Input.TextArea name="title" />
            <Button htmlType="submit" type="primary">发送</Button>
          </form>
          </Splitter.Panel>
        </Splitter>
      )}
    </Drawer>
  );
}
