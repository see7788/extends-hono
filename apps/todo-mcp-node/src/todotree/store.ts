import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";
import { z } from "zod";

const agent = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
const status = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
  z.literal(9),
]);
const workspacePath = z.string().trim().min(1).refine(
  value => /^(?:[A-Za-z]:[\\/]|\/)/.test(value),
  "TodoTree workspace path must be absolute.",
);
const node = z.object({
  id: z.number().int().positive(),
  id_parent: z.number().int().positive().nullable(),
  title: z.string().trim().min(1),
  status: status.optional(),
  agent,
});
const add = z.object({
  title: z.string().trim().min(1),
  id_parent: z.number().int().positive(),
  status: status.optional(),
  agent,
}).superRefine((value, context) => {
  if (value.id_parent === 1 && !workspacePath.safeParse(value.title).success) {
    context.addIssue({
      code: "custom",
      path: ["title"],
      message: "TodoTree workspace title must be an absolute path.",
    });
  }
});
const setValue = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(1).optional(),
  status: status.optional(),
  agent: agent.optional(),
}).refine(
  value => [value.title, value.status, value.agent]
    .filter(field => field !== undefined).length === 1,
  { message: "Exactly one TodoTree field must change." },
);

export const validator = {
  node,
  add,
  set: setValue,
  tree: z.object({
    id: z.number().int().nonnegative(),
    nodesById: z.record(z.string(), node),
    nodeStatusLabelByStatus: z.object({
      1: z.string(),
      2: z.string(),
      3: z.string(),
      4: z.string(),
      5: z.string(),
      6: z.string(),
      7: z.string(),
      8: z.string(),
      9: z.string(),
    }),
    nodeAgentLabelByAgent: z.object({
      1: z.string(),
      2: z.string(),
      3: z.string(),
      4: z.string(),
    }),
  }),
  treeQuery: z.object({}),
  workspacePath,
};

export type TodoTreeStore = {
  todotree: z.infer<typeof validator.tree>;
  todotreeActions: {
    add(options: z.input<typeof validator.add>): Promise<number>;
    set(options: z.input<typeof validator.set>): Promise<void>;
  };
};

const store: ImmerStateCreator<TodoTreeStore> = (set, get) => ({
  todotree: {
    id: 1,
    nodesById: {
      1: {
        id: 1,
        id_parent: null,
        title: "TodoTree",
        agent: 1,
      },
    },
    nodeStatusLabelByStatus: {
      1: "待确认",
      2: "待办",
      3: "未派工",
      4: "运行中",
      5: "已反馈",
      6: "已中断",
      7: "已完成",
      8: "阻塞",
      9: "已取消",
    },
    nodeAgentLabelByAgent: {
      1: "parent",
      2: "worker",
      3: "indexer",
      4: "tokener",
    },
  },
  todotreeActions: {
    add: async options => {
      const {
        title,
        id_parent,
        status: statusValue,
        agent,
      } = validator.add.parse(options);
      if (!get().todotree.nodesById[id_parent]) {
        throw new Error(`TodoTree parent does not exist: ${String(id_parent)}`);
      }
      if (id_parent === 1) {
        const workspace = Object.values(get().todotree.nodesById).find(node => (
          node.id_parent === 1 && node.title === title
        ));
        if (workspace) return workspace.id;
      }
      let id = 0;
      set(state => {
        state.todotree.id += 1;
        id = state.todotree.id;
        state.todotree.nodesById[id] = {
          id,
          id_parent,
          title,
          ...(statusValue === undefined ? {} : { status: statusValue }),
          agent,
        };
      });
      return id;
    },
    set: async options => {
      const optionsValue = validator.set.parse(options);
      const nodeValue = get().todotree.nodesById[optionsValue.id];
      if (!nodeValue) {
        throw new Error(`TodoTree node does not exist: ${String(optionsValue.id)}`);
      }
      if (nodeValue.id === 1) {
        throw new Error("TodoTree root node cannot be changed.");
      }
      if (optionsValue.title !== undefined && nodeValue.id_parent === 1) {
        validator.workspacePath.parse(optionsValue.title);
      }
      set(state => {
        const currentNode = state.todotree.nodesById[optionsValue.id];
        if (!currentNode) {
          throw new Error(`TodoTree node does not exist: ${String(optionsValue.id)}`);
        }
        if (optionsValue.title !== undefined) currentNode.title = optionsValue.title;
        if (optionsValue.status !== undefined) currentNode.status = optionsValue.status;
        if (optionsValue.agent !== undefined) currentNode.agent = optionsValue.agent;
      });
    },
  },
});

export default store;
