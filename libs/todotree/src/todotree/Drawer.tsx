import { Button, Flex, Input, Segmented, Splitter } from "antd";
import { Drawer } from "extends-antd/src/Drawer";
import { hc } from "hono/client";
import { useNavigate, useParams } from "react-router-dom";
import type { TodoMcpApi } from "todo-mcp-node/src/routers.ts";
import store from "../store.ts";
import { statusOptions, type TodoTreeStatus } from "./status.ts";
import Title from "./Title.tsx";

const client = hc<TodoMcpApi>(location.origin);

export default function NodeDrawer() {
  const todotree = store(state => state.todotree);
  const navigate = useNavigate();
  const { nodeId: nodeIdValue } = useParams<{ nodeId: string }>();
  const nodeId = nodeIdValue === undefined ? undefined : Number(nodeIdValue);
  const node = nodeId === undefined
    ? undefined
    : todotree?.treeData.nodesById[nodeId];
  let workspace = node;
  while (workspace && workspace.id_parent !== 1) {
    workspace = workspace.id_parent === null
      ? undefined
      : todotree?.treeData.nodesById[workspace.id_parent];
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
        <Splitter orientation="vertical">
          <Splitter.Panel defaultSize="50%" min="20%">
            <Flex style={{ boxSizing: "border-box", height: "100%", padding: 16 }} vertical>
              <Segmented<TodoTreeStatus>
                block
                onChange={async statusValue => {
                  const response = await client["todo-mcp-node"].node.set.$post({
                    json: { id: node.id, status: statusValue },
                  });
                  if (!response.ok) throw new Error(await response.text());
                }}
                options={statusOptions}
                size="small"
                value={node.status}
              />
              <Flex style={{ flex: 1, overflow: "auto", paddingTop: 16 }} vertical>
                <Title {...node} compact={false} />
              </Flex>
            </Flex>
          </Splitter.Panel>
          <Splitter.Panel defaultSize="50%" min="20%">
            <form
              onSubmit={async event => {
                event.preventDefault();
                const form = event.currentTarget;
                const title = String(new FormData(form).get("title") ?? "").trim();
                if (!title) return;
                const response = await client["todo-mcp-node"].node.add.$post({
                  json: {
                    id_parent: node.id,
                    title,
                    template: "markdown",
                    status: 2,
                    agent: 1,
                  },
                });
                if (!response.ok) throw new Error(await response.text());
                form.reset();
                void navigate("/");
              }}
              style={{ boxSizing: "border-box", height: "100%", padding: 16 }}
            >
              <Flex gap="middle" style={{ height: "100%" }} vertical>
                <Input.TextArea name="title" style={{ flex: 1, resize: "none" }} />
                <Flex justify="end">
                  <Button htmlType="submit" type="primary">发送</Button>
                </Flex>
              </Flex>
            </form>
          </Splitter.Panel>
        </Splitter>
      )}
    </Drawer>
  );
}
