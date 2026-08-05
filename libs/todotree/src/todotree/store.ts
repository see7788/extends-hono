import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";
import { hc } from "hono/client";
import type { TodoMcpApi } from "todo-mcp-node/src/routers.ts";
import type { AgentRuntime } from "mcp-server/public.ts";
import type {
  TodoTreeNode,
  TodoTreeState,
} from "todo-mcp-node/src/todotree/store.ts";

export type TodoTreeStore = {
  todotree: TodoTreeState | undefined;
  todotreeAi: AgentRuntime[];
  todotreeRecent: { id: number; unread: boolean }[];
  todotreeActions: {
    aiSet(ai: AgentRuntime[]): void;
    connect(): () => void;
    nodeAdd(node: TodoTreeNode): void;
    nodeDel(ids: number[]): void;
    nodeRead(id: number): void;
    nodeRecent(node: TodoTreeNode): void;
    nodeSet(node: TodoTreeNode): void;
    projectAttentionSet(attentionByProjectId: TodoTreeState["projectAttentionById"]): void;
    treeSet(tree: TodoTreeState): void;
  };
};

const store: ImmerStateCreator<TodoTreeStore> = (set, get) => ({
  todotree: undefined,
  todotreeAi: [],
  todotreeRecent: [],
  todotreeActions: {
    aiSet: ai => set(state => {
      state.todotreeAi = ai;
    }),
    connect: () => {
      const client = hc<TodoMcpApi>(window.location.origin);
      const eventSource = new EventSource(client["todo-mcp-node"].events.$url());
      eventSource.addEventListener("tree", event => {
        get().todotreeActions.treeSet(JSON.parse(event.data) as TodoTreeState);
      });
      eventSource.addEventListener("add", event => {
        get().todotreeActions.nodeAdd(JSON.parse(event.data) as TodoTreeNode);
      });
      eventSource.addEventListener("ai", event => {
        get().todotreeActions.aiSet(JSON.parse(event.data) as AgentRuntime[]);
      });
      eventSource.addEventListener("attention", event => {
        get().todotreeActions.projectAttentionSet(
          JSON.parse(event.data) as TodoTreeState["projectAttentionById"],
        );
      });
      eventSource.addEventListener("del", event => {
        get().todotreeActions.nodeDel(JSON.parse(event.data) as number[]);
      });
      eventSource.addEventListener("node", event => {
        get().todotreeActions.nodeRecent(JSON.parse(event.data) as TodoTreeNode);
      });
      eventSource.addEventListener("set", event => {
        get().todotreeActions.nodeSet(JSON.parse(event.data) as TodoTreeNode);
      });
      return () => eventSource.close();
    },
    nodeAdd: node => set(state => {
      if (!state.todotree) throw new Error("TodoTree has not been received.");
      state.todotree.treeData.nodesById[node.id] = node;
      state.todotree.treeDataMaxId = Math.max(state.todotree.treeDataMaxId, node.id);
      state.todotreeRecent = [
        { id: node.id, unread: true },
        ...state.todotreeRecent.filter(recent => recent.id !== node.id),
      ].slice(0, 10);
    }),
    nodeDel: ids => set(state => {
      if (!state.todotree) throw new Error("TodoTree has not been received.");
      for (const id of ids) delete state.todotree.treeData.nodesById[id];
      state.todotreeRecent = state.todotreeRecent.filter(recent => !ids.includes(recent.id));
    }),
    nodeRead: id => set(state => {
      const recent = state.todotreeRecent.find(value => value.id === id);
      if (recent) recent.unread = false;
    }),
    nodeRecent: node => set(state => {
      if (!state.todotree?.treeData.nodesById[node.id]) return;
      state.todotreeRecent = [
        { id: node.id, unread: true },
        ...state.todotreeRecent.filter(recent => recent.id !== node.id),
      ].slice(0, 10);
    }),
    nodeSet: node => set(state => {
      if (!state.todotree) throw new Error("TodoTree has not been received.");
      state.todotree.treeData.nodesById[node.id] = node;
      state.todotreeRecent = [
        { id: node.id, unread: true },
        ...state.todotreeRecent.filter(recent => recent.id !== node.id),
      ].slice(0, 10);
    }),
    projectAttentionSet: attentionByProjectId => set(state => {
      if (!state.todotree) throw new Error("TodoTree has not been received.");
      state.todotree.projectAttentionById = attentionByProjectId;
    }),
    treeSet: tree => set(state => {
      state.todotree = tree;
      state.todotreeRecent = state.todotreeRecent.filter(
        recent => tree.treeData.nodesById[recent.id],
      );
    }),
  },
});

export default store;
