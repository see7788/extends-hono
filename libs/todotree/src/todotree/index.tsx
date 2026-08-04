import { FormOutlined } from "@ant-design/icons";
import { Button, Flex, Tree, Typography, type TreeDataNode } from "antd";
import { useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import type { TodoTreeNode } from "todo-mcp-node/src/todotree/store.ts";
import store from "../store.ts";
import Title from "./Title.tsx";
import { statusLabelRead } from "./status.ts";
const agentLabelByAgent: Record<TodoTreeNode["agent"], string> = {
  1: "parent",
  2: "worker",
  3: "indexer",
  4: "tokener",
};

export default function App() {
  const todotree = store(state => state.todotree);
  const navigate = useNavigate();
  const [loadedNodeIds, loadedNodeIdsSet] = useState<ReadonlySet<number>>(new Set());
  const [hoveredNodeId, hoveredNodeIdSet] = useState<number>();
  useEffect(() => store.getState().todotreeActions.connect(), []);
  const nodesById = todotree?.treeData.nodesById;
  const nodesByParentId = useMemo(() => {
    const nodes = new Map<number | null, TodoTreeNode[]>();
    for (const node of Object.values(nodesById ?? {})) {
      const siblings = nodes.get(node.id_parent) ?? [];
      siblings.push(node);
      nodes.set(node.id_parent, siblings);
    }
    for (const siblings of nodes.values()) {
      siblings.sort((left, right) => left.id - right.id);
    }
    return nodes;
  }, [nodesById]);
  const nodeChildren = (id: number) => nodesByParentId.get(id) ?? [];
  const treeNode = (
    node: TodoTreeNode,
    childrenShow = loadedNodeIds.has(node.id),
  ): TreeDataNode => {
    const children = nodeChildren(node.id);
    const drawerAvailable = node.id !== 1 && children.length === 0;
    const drawerOpen = () => void navigate(`/${String(node.id)}`);
    return {
      key: node.id,
      isLeaf: children.length === 0,
      title: (
        <Flex
          align="center"
          gap="small"
          onDoubleClick={drawerAvailable ? drawerOpen : undefined}
          onMouseEnter={() => hoveredNodeIdSet(node.id)}
          onMouseLeave={() => hoveredNodeIdSet(undefined)}
        >
          {drawerAvailable && (
            <Typography.Text type="secondary">
              {`${statusLabelRead(node.status)} · `}
              {agentLabelByAgent[node.agent]}
            </Typography.Text>
          )}
          <Title {...node} />
          {drawerAvailable && hoveredNodeId === node.id && (
            <Button
              aria-label="打开节点抽屉"
              icon={<FormOutlined />}
              onClick={event => {
                event.stopPropagation();
                drawerOpen();
              }}
              size="small"
              type="text"
            />
          )}
        </Flex>
      ),
      children: childrenShow ? children.map(child => treeNode(child)) : undefined,
    };
  };
  const root = nodesById?.[1];
  const treeData = root ? [treeNode(root, true)] : [];

  return (
    <Flex vertical>
      <Typography.Title level={5}>
        TodoTree #{String(todotree?.treeDataMaxId ?? 0)}
      </Typography.Title>
      {root && (
        <Tree
          blockNode
          defaultExpandedKeys={[1]}
          loadData={async node => {
            loadedNodeIdsSet(current => new Set(current).add(Number(node.key)));
          }}
          selectable={false}
          treeData={treeData}
        />
      )}
      <Outlet />
    </Flex>
  );
}
