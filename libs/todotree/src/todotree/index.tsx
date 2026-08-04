import { FormOutlined } from "@ant-design/icons";
import { Button, Flex, FloatButton, theme, Tree, Typography, type TreeDataNode } from "antd";
import { useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { statusOptions } from "todo-mcp-node/src/todotree/contract.ts";
import type { TodoTreeNode } from "todo-mcp-node/src/todotree/store.ts";
import store from "../store.ts";
import Title from "./Title.tsx";

export default function App() {
  const { token } = theme.useToken();
  const todotree = store(state => state.todotree);
  const todotreeRecent = store(state => state.todotreeRecent);
  const navigate = useNavigate();
  const [expandedNodeIds, expandedNodeIdsSet] = useState<ReadonlySet<number>>(new Set());
  const [revealedNodeId, revealedNodeIdSet] = useState<number>();
  const [hoveredNodeId, hoveredNodeIdSet] = useState<number>();
  const [statusFilter, statusFilterSet] = useState<"all" | TodoTreeNode["status"]>("all");
  useEffect(() => store.getState().todotreeActions.connect(), []);
  const nodesById = todotree?.treeData.nodesById;
  const statusLabelRead = (status: TodoTreeNode["status"]) => {
    const option = statusOptions.find(value => value.value === status);
    if (!option) throw new Error(`TodoTree status does not exist: ${String(status)}`);
    return option.label;
  };
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
  const filteredNodeIds = useMemo(() => {
    if (statusFilter === "all") return new Set<number>();
    const ids = new Set<number>();
    for (const node of Object.values(nodesById ?? {})) {
      if (node.status !== statusFilter) continue;
      let current: TodoTreeNode | undefined = node;
      while (current) {
        ids.add(current.id);
        current = current.id_parent === null ? undefined : nodesById?.[current.id_parent];
      }
    }
    return ids;
  }, [nodesById, statusFilter]);
  const statusCountByStatus = useMemo(() => {
    const counts = new Map<TodoTreeNode["status"], number>();
    for (const option of statusOptions) counts.set(option.value, 0);
    for (const node of Object.values(nodesById ?? {})) {
      if (node.id !== 1) counts.set(node.status, (counts.get(node.status) ?? 0) + 1);
    }
    return counts;
  }, [nodesById]);
  const nodeChildren = (id: number) => (nodesByParentId.get(id) ?? []).filter(
    nodeValue => statusFilter === "all" || filteredNodeIds.has(nodeValue.id),
  );
  const treeNode = (
    node: TodoTreeNode,
    childrenShow = statusFilter !== "all" || expandedNodeIds.has(node.id),
  ): TreeDataNode => {
    const children = nodeChildren(node.id);
    const drawerAvailable = node.id !== 1;
    const drawerOpen = () => void navigate(`/${String(node.id)}`);
    const attention = node.template === "project"
      ? todotree?.projectAttentionById[node.id]
      : undefined;
    return {
      key: node.id,
      isLeaf: children.length === 0,
      title: (
        <Flex
          align="center"
          data-todotree-node-id={node.id}
          gap="small"
          onDoubleClick={drawerAvailable ? drawerOpen : undefined}
          onMouseEnter={() => hoveredNodeIdSet(node.id)}
          onMouseLeave={() => hoveredNodeIdSet(undefined)}
          style={revealedNodeId === node.id ? {
            background: token.colorPrimaryBg,
            borderRadius: token.borderRadiusSM,
            boxShadow: `0 0 0 1px ${token.colorPrimary}`,
          } : undefined}
        >
          {drawerAvailable && hoveredNodeId !== node.id && node.template !== "project" && (
            <Typography.Text style={{ whiteSpace: "nowrap" }} type="secondary">
              {statusLabelRead(node.status)}
            </Typography.Text>
          )}
          {drawerAvailable && hoveredNodeId === node.id && (
            <Flex align="center" gap="small">
              <Typography.Text type="secondary">#{String(node.id)}</Typography.Text>
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
            </Flex>
          )}
          <Title {...node} />
          {drawerAvailable && hoveredNodeId !== node.id && node.template === "project" && (
            <Typography.Text style={{ whiteSpace: "nowrap" }} type="secondary">
              {statusLabelRead(node.status)}
            </Typography.Text>
          )}
          {attention && attention.decisionCount > 0 && (
            <Typography.Text style={{ color: token.colorSuccess, whiteSpace: "nowrap" }}>
              待决策 {attention.decisionCount}
            </Typography.Text>
          )}
        </Flex>
      ),
      children: childrenShow ? children.map(child => treeNode(child)) : undefined,
    };
  };
  const root = nodesById?.[1];
  const treeData = root ? nodeChildren(root.id).map(nodeValue => treeNode(nodeValue)) : [];
  const nodeReveal = (id: number) => {
    const expanded = new Set(expandedNodeIds);
    expanded.add(id);
    let current = nodesById?.[id];
    while (current?.id_parent !== null && current?.id_parent !== undefined) {
      const parent = nodesById?.[current.id_parent];
      if (!parent) break;
      expanded.add(parent.id);
      current = parent;
    }
    expandedNodeIdsSet(expanded);
    revealedNodeIdSet(id);
    store.getState().todotreeActions.nodeRead(id);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-todotree-node-id="${String(id)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  return (
    <Flex
      onClick={() => revealedNodeIdSet(undefined)}
      style={{
        background: token.colorBgContainer,
        boxSizing: "border-box",
        minHeight: "100vh",
        padding: token.padding,
        paddingRight: 48,
      }}
      vertical
    >
      {root && (
        <Tree
          blockNode
          expandedKeys={[...(statusFilter === "all" ? expandedNodeIds : filteredNodeIds)]}
          onExpand={keys => {
            if (statusFilter !== "all") return;
            expandedNodeIdsSet(new Set(keys.map(Number)));
          }}
          selectable={false}
          treeData={treeData}
        />
      )}
      <Flex
        gap={2}
        style={{ position: "fixed", right: token.marginXS, top: token.marginXS, zIndex: 10 }}
        vertical
      >
        {todotreeRecent.map(recent => (
          <Button
            key={recent.id}
            onClick={event => {
              event.stopPropagation();
              nodeReveal(recent.id);
            }}
            size="small"
            style={{ color: recent.unread ? token.colorPrimary : undefined }}
            title={nodesById?.[recent.id]?.title}
            type="text"
          >
            {recent.id}
          </Button>
        ))}
      </Flex>
      <FloatButton.Group
        closeIcon={false}
        description="筛选"
        icon={false}
        shape="square"
        trigger="click"
      >
        {([{ label: "全部", value: "all" }, ...statusOptions] as const).map(({ label, value }) => (
          <FloatButton
            badge={{
              count: value === "all"
                ? Object.values(nodesById ?? {}).filter(node => node.id !== 1).length
                : statusCountByStatus.get(value) ?? 0,
              overflowCount: Number.MAX_SAFE_INTEGER,
              showZero: true,
            }}
            description={label}
            key={value}
            onClick={() => {
              statusFilterSet(value);
              if (value === "all") {
                expandedNodeIdsSet(new Set());
                revealedNodeIdSet(undefined);
              }
            }}
            style={statusFilter === value ? {
              background: token.colorSuccess,
              borderColor: token.colorSuccess,
              color: token.colorTextLightSolid,
            } : {}}
          />
        ))}
      </FloatButton.Group>
      <Outlet />
    </Flex>
  );
}
