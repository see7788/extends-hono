import { FormOutlined } from "@ant-design/icons";
import { Tree, type TreeDataNode } from "antd";
import { useMemo, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import type { TodoTreeStore } from "todo-mcp-node/src/todotree/store.ts";
import store from "../store.ts";

type TodoTreeNode = TodoTreeStore["todotree"]["nodesById"][number];

export default function App() {
  const todotree = store(state => state.todotree);
  const navigate = useNavigate();
  const [loadedNodeIds, loadedNodeIdsSet] = useState<ReadonlySet<number>>(new Set());
  const nodesByParentId = useMemo(() => {
    const nodes = new Map<number | null, TodoTreeNode[]>();
    for (const node of Object.values(todotree.nodesById)) {
      const siblings = nodes.get(node.id_parent) ?? [];
      siblings.push(node);
      nodes.set(node.id_parent, siblings);
    }
    for (const siblings of nodes.values()) {
      siblings.sort((left, right) => left.id - right.id);
    }
    return nodes;
  }, [todotree.nodesById]);
  const nodeChildren = (id: number) => nodesByParentId.get(id) ?? [];
  const treeNode = (node: TodoTreeNode, childrenShow = loadedNodeIds.has(node.id)): TreeDataNode => {
    const children = nodeChildren(node.id);
    const drawerAvailable = node.id !== 1 && children.length === 0;
    const drawerOpen = () => void navigate(`/${String(node.id)}`);
    return {
      key: node.id,
      isLeaf: children.length === 0,
      title: (
        <span className="todo-tree-title" onDoubleClick={drawerAvailable ? drawerOpen : undefined}>
          <span>{node.title.slice(0, 60)}</span>
          {drawerAvailable && (
            <span className="todo-tree-node-state">
              {todotree.nodeStatusLabelByStatus[node.status]}
              {" · "}
              {todotree.nodeAgentLabelByAgent[node.agent]}
            </span>
          )}
          {drawerAvailable && (
            <button
              aria-label="打开节点抽屉"
              className="todo-tree-drawer-open"
              onClick={event => {
                event.stopPropagation();
                drawerOpen();
              }}
              type="button"
            >
              <FormOutlined />
            </button>
          )}
        </span>
      ),
      children: childrenShow ? children.map(child => treeNode(child)) : undefined,
    };
  };
  const root = todotree.nodesById[1];
  const treeData = root ? [treeNode(root, true)] : [];

  return (
    <main>
      <Tree
        blockNode
        className="todo-tree"
        defaultExpandedKeys={[1]}
        loadData={async node => {
          loadedNodeIdsSet(current => new Set(current).add(Number(node.key)));
        }}
        selectable={false}
        treeData={treeData}
      />
      <Outlet />
    </main>
  );
}
