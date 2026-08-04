import { Button, Input, Select, Space } from "antd";
import { Drawer } from "extends-antd/src/Drawer";
import { hc } from "hono/client";
import type { TodoMcpApi } from "todo-mcp-node/src/routers.ts";
import store from "../store.ts";

const client = hc<TodoMcpApi>(location.origin);

export default function NodeDrawer({
  nodeId,
  onClose,
}: {
  nodeId?: number;
  onClose(): void;
}) {
  const todotree = store(state => state.todotree);
  const node = nodeId === undefined ? undefined : todotree.nodesById[nodeId];
  const setForm = node ? `todotree-set-${String(node.id)}` : undefined;
  const addForm = node ? `todotree-add-${String(node.id)}` : undefined;

  return (
    <Drawer
      destroyOnHidden
      footer={node ? (
        <Space>
          <Button form={setForm} htmlType="submit">保存</Button>
          <Button form={addForm} htmlType="submit" type="primary">发送</Button>
        </Space>
      ) : undefined}
      onClose={onClose}
      open={node !== undefined}
      size="min(560px, calc(100vw - 48px))"
      title={node ? `#${String(node.id)} ${node.title}` : ""}
    >
      {node && (
        <>
          <form
            className="drawer-form"
            id={setForm}
            onSubmit={async event => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const title = String(data.get("title") ?? "").trim();
              if (title && title !== node.title) {
                const response = await client.todotree.set.$post({ json: { id: node.id, title } });
                if (!response.ok) throw new Error(await response.text());
              }
            }}
          >
            <label>内容</label>
            <Input.TextArea name="title" autoSize={{ minRows: 6 }} defaultValue={node.title} />
            <label>状态</label>
            <Select
              defaultValue={node.status}
              options={Object.entries(todotree.nodeStatusLabelByStatus).map(([value, label]) => ({
                value: Number(value),
                label,
              }))}
              onChange={async status => {
                const response = await client.todotree.set.$post({
                  json: { id: node.id, status: status as typeof node.status },
                });
                if (!response.ok) throw new Error(await response.text());
              }}
            />
            <label>执行者</label>
            <Select
              defaultValue={node.agent}
              options={Object.entries(todotree.nodeAgentLabelByAgent).map(([value, label]) => ({
                value: Number(value),
                label,
              }))}
              onChange={async agent => {
                const response = await client.todotree.set.$post({
                  json: { id: node.id, agent: agent as typeof node.agent },
                });
                if (!response.ok) throw new Error(await response.text());
              }}
            />
          </form>
          <form
            className="drawer-form"
            id={addForm}
            onSubmit={async event => {
              event.preventDefault();
              const form = event.currentTarget;
              const title = String(new FormData(form).get("title") ?? "").trim();
              if (!title) return;
              const response = await client.todotree.add.$post({
                json: { id_parent: node.id, title },
              });
              if (!response.ok) throw new Error(await response.text());
              form.reset();
              onClose();
            }}
          >
            <label>向 Codex 提问</label>
            <Input.TextArea name="title" autoSize={{ minRows: 4 }} />
          </form>
        </>
      )}
    </Drawer>
  );
}
