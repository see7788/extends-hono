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
const titleType = z.enum(["text", "markdown"]);
const absolutePath = z.string().trim().min(1).refine(
  value => /^(?:[A-Za-z]:[\\/]|\/)/.test(value),
  "TodoTree project title must be an absolute path.",
);
const node = z.object({
  id: z.number().int().positive(),
  id_parent: z.number().int().positive().nullable(),
  title: z.string().trim().min(1),
  titleType,
  status: status.optional(),
  agent,
});
const add = node.omit({ id: true }).extend({
  id_parent: z.number().int().positive(),
}).superRefine((value, context) => {
  if (value.id_parent === 1 && !absolutePath.safeParse(value.title).success) {
    context.addIssue({
      code: "custom",
      path: ["title"],
      message: "TodoTree project title must be an absolute path.",
    });
  }
});
const setValue = z.object({
  id: z.number().int().positive(),
  title: node.shape.title.optional(),
  titleType: node.shape.titleType.optional(),
  status: node.shape.status,
  agent: node.shape.agent.optional(),
}).refine(
  value => [value.title, value.titleType, value.status, value.agent]
    .some(field => field !== undefined),
  { message: "TodoTree set requires at least one changed field." },
);
const del = z.object({
  id: z.number().int().positive(),
});
const tree = z.object({
  nodesById: z.record(z.string(), node),
});
const treeState = z.object({
  treeData: tree,
  treeDataMaxId: z.number().int().positive(),
}).superRefine((value, context) => {
  const nodeMaxId = Math.max(...Object.values(value.treeData.nodesById).map(item => item.id));
  if (value.treeDataMaxId < nodeMaxId) {
    context.addIssue({
      code: "custom",
      path: ["treeDataMaxId"],
      message: "TodoTree treeDataMaxId cannot be lower than an existing node ID.",
    });
  }
});

export const validator = {
  add,
  del,
  node,
  set: setValue,
  tree,
  treeState,
};

export type TodoTreeNode = z.infer<typeof validator.node>;
export type TodoTreeStore = {
  todotree: z.infer<typeof validator.treeState>;
  todotreeActions: {
    add(options: z.input<typeof validator.add>): TodoTreeNode;
    del(id: number): number[];
    set(options: z.input<typeof validator.set>): TodoTreeNode;
    treeSet(tree: TodoTreeStore["todotree"]): void;
  };
};

const store: ImmerStateCreator<TodoTreeStore> = (set, get) => ({
  todotree: {
    treeData: {
      nodesById: {
        1: {
          id: 1,
          id_parent: null,
          title: "TodoTree",
          titleType: "text",
          agent: 1,
        },
      },
    },
    treeDataMaxId: 1,
  },
  todotreeActions: {
    add: options => {
      const optionsValue = validator.add.parse(options);
      if (!get().todotree.treeData.nodesById[optionsValue.id_parent]) {
        throw new Error(`TodoTree parent does not exist: ${String(optionsValue.id_parent)}`);
      }
      let id = 0;
      set(state => {
        state.todotree.treeDataMaxId += 1;
        id = state.todotree.treeDataMaxId;
        state.todotree.treeData.nodesById[id] = {
          id,
          ...optionsValue,
        };
      });
      const nodeValue = get().todotree.treeData.nodesById[id];
      if (!nodeValue) throw new Error(`TodoTree node was not created: ${String(id)}`);
      return nodeValue;
    },
    del: id => {
      const { id: idValue } = validator.del.parse({ id });
      if (idValue === 1) throw new Error("TodoTree root cannot be deleted.");
      if (!get().todotree.treeData.nodesById[idValue]) {
        throw new Error(`TodoTree node does not exist: ${String(idValue)}`);
      }
      const deletedIds = [idValue];
      for (let index = 0; index < deletedIds.length; index += 1) {
        const parentId = deletedIds[index];
        for (const nodeValue of Object.values(get().todotree.treeData.nodesById)) {
          if (nodeValue.id_parent === parentId) deletedIds.push(nodeValue.id);
        }
      }
      set(state => {
        for (const nodeId of deletedIds) delete state.todotree.treeData.nodesById[nodeId];
      });
      return deletedIds;
    },
    set: options => {
      const optionsValue = validator.set.parse(options);
      const currentNode = get().todotree.treeData.nodesById[optionsValue.id];
      if (!currentNode) {
        throw new Error(`TodoTree node does not exist: ${String(optionsValue.id)}`);
      }
      if (optionsValue.title !== undefined && currentNode.id_parent === 1) {
        absolutePath.parse(optionsValue.title);
      }
      set(state => {
        const nodeValue = state.todotree.treeData.nodesById[optionsValue.id];
        if (!nodeValue) {
          throw new Error(`TodoTree node does not exist: ${String(optionsValue.id)}`);
        }
        if (optionsValue.title !== undefined) nodeValue.title = optionsValue.title;
        if (optionsValue.titleType !== undefined) nodeValue.titleType = optionsValue.titleType;
        if (optionsValue.status !== undefined) nodeValue.status = optionsValue.status;
        if (optionsValue.agent !== undefined) nodeValue.agent = optionsValue.agent;
      });
      const nodeValue = get().todotree.treeData.nodesById[optionsValue.id];
      if (!nodeValue) throw new Error(`TodoTree node does not exist: ${String(optionsValue.id)}`);
      return nodeValue;
    },
    treeSet: treeValue => set(state => {
      state.todotree = treeValue;
    }),
  },
});

export default store;
