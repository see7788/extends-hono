import { Button, Input, Select, Tree, type TreeDataNode } from "antd";
import { hc } from "hono/client";
import { useState } from "react";
import type { TodoMcpApi } from "todo-mcp-node/src/routers.ts";
import type { TodoTreeStore } from "todo-mcp-node/src/todotree/store.ts";
import store from "../store.ts";
import NodeDrawer from "./Drawer.tsx";

type TodoTreeNode = TodoTreeStore["todotree"]["nodesById"][number];
const client = hc<TodoMcpApi>(location.origin);

export default function App() {
  const todotree = store(state => state.todotree);
  const [drawerNodeId, drawerNodeIdSet] = useState<number>();
  const treeNode = (node: TodoTreeNode): TreeDataNode => {
    const children = Object.values(todotree.nodesById)
      .filter(child => child.id_parent === node.id)
      .sort((left, right) => left.id - right.id)
      .map(treeNode);
    return {
      key: node.id,
      title: (
        <span
          onContextMenu={children.length === 0 ? event => {
            event.preventDefault();
            drawerNodeIdSet(node.id);
          } : undefined}
        >
          #{node.id} {node.title}
        </span>
      ),
      children,
    };
  };
  const treeData = Object.values(todotree.nodesById)
    .filter(node => node.id_parent === null)
    .sort((left, right) => left.id - right.id)
    .map(treeNode);

  return (
    <main>
      <h1>TodoTree</h1>
      <p>从任意节点直接与对应工作区 Codex 沟通</p>
      <form
        className="workspace-add"
        onSubmit={async event => {
          event.preventDefault();
          const form = event.currentTarget;
          const title = String(new FormData(form).get("title") ?? "").trim();
          if (!title) return;
          const response = await client.todotree.add.$post({
            json: { id_parent: null, title },
          });
          if (!response.ok) throw new Error(await response.text());
          form.reset();
        }}
      >
        <Input name="title" aria-label="工作区绝对路径" placeholder="F:\\pro\\项目目录" />
        <Button htmlType="submit" type="primary">添加工作区</Button>
      </form>
      <Tree
        blockNode
        expandedKeys={Object.keys(todotree.nodesById).map(Number)}
        selectable={false}
        treeData={treeData}
      />
      <NodeDrawer nodeId={drawerNodeId} onClose={() => drawerNodeIdSet(undefined)} />
    </main>
  );
}
