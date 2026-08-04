import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
const databaseNode = node.extend({
  status: status.nullable(),
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
});

export const validator = {
  add,
  del,
  set: setValue,
};

export type TodoTreeNode = z.infer<typeof node>;
export type TodoTreeState = z.infer<typeof treeState>;

const projectPath = fileURLToPath(new URL("../../", import.meta.url));
const projectPathValue = process.platform === "win32"
  ? projectPath.toLowerCase().replaceAll("\\", "/")
  : projectPath;
const databaseDirectory = join(
  homedir(),
  ".store",
  createHash("md5").update(projectPathValue).digest("hex"),
);
mkdirSync(databaseDirectory, { recursive: true });

const database = new Database(join(databaseDirectory, "store.sqlite"));
database.pragma("foreign_keys = ON");
database.pragma("journal_mode = WAL");
database.exec(`
  CREATE TABLE IF NOT EXISTS todotree_node (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    id_parent INTEGER REFERENCES todotree_node(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    title_type TEXT NOT NULL CHECK (title_type IN ('text', 'markdown')),
    status INTEGER CHECK (status BETWEEN 1 AND 9),
    agent INTEGER NOT NULL CHECK (agent BETWEEN 1 AND 4)
  );
  CREATE INDEX IF NOT EXISTS todotree_node_id_parent
    ON todotree_node(id_parent);
  INSERT INTO todotree_node (id, id_parent, title, title_type, status, agent)
    SELECT 1, NULL, 'TodoTree', 'text', NULL, 1
    WHERE NOT EXISTS (SELECT 1 FROM todotree_node);
`);

const nodeById = database.prepare(`
  SELECT id, id_parent, title, title_type AS titleType, status, agent
  FROM todotree_node
  WHERE id = ?
`);
const nodesAll = database.prepare(`
  SELECT id, id_parent, title, title_type AS titleType, status, agent
  FROM todotree_node
  ORDER BY id
`);
const nodeSequence = database.prepare(`
  SELECT seq AS id FROM sqlite_sequence WHERE name = 'todotree_node'
`);
const nodeInsert = database.prepare(`
  INSERT INTO todotree_node (id_parent, title, title_type, status, agent)
  VALUES (?, ?, ?, ?, ?)
`);
const nodeUpdate = database.prepare(`
  UPDATE todotree_node
  SET title = ?, title_type = ?, status = ?, agent = ?
  WHERE id = ?
`);
const descendantIds = database.prepare(`
  WITH RECURSIVE descendants(id) AS (
    SELECT id FROM todotree_node WHERE id = ?
    UNION ALL
    SELECT child.id
    FROM todotree_node AS child
    JOIN descendants AS parent ON child.id_parent = parent.id
  )
  SELECT id FROM descendants ORDER BY id
`);
const nodeDelete = database.prepare("DELETE FROM todotree_node WHERE id = ?");
const databaseNodeRead = (value: unknown): TodoTreeNode => {
  const row = databaseNode.parse(value);
  return node.parse({
    ...row,
    status: row.status ?? undefined,
  });
};
const nodeRead = (id: number) => {
  const row = nodeById.get(id);
  if (!row) throw new Error(`TodoTree node does not exist: ${String(id)}`);
  return databaseNodeRead(row);
};

const store = {
  add: database.transaction((options: z.input<typeof validator.add>) => {
    const optionsValue = validator.add.parse(options);
    nodeRead(optionsValue.id_parent);
    const result = nodeInsert.run(
      optionsValue.id_parent,
      optionsValue.title,
      optionsValue.titleType,
      optionsValue.status ?? null,
      optionsValue.agent,
    );
    return nodeRead(Number(result.lastInsertRowid));
  }),
  del: database.transaction((id: number) => {
    const { id: idValue } = validator.del.parse({ id });
    if (idValue === 1) throw new Error("TodoTree root cannot be deleted.");
    nodeRead(idValue);
    const ids = descendantIds.all(idValue).map(value => (
      z.object({ id: z.number().int().positive() }).parse(value).id
    ));
    nodeDelete.run(idValue);
    return ids;
  }),
  set: database.transaction((options: z.input<typeof validator.set>) => {
    const optionsValue = validator.set.parse(options);
    const currentNode = nodeRead(optionsValue.id);
    if (optionsValue.title !== undefined && currentNode.id_parent === 1) {
      absolutePath.parse(optionsValue.title);
    }
    const nextNode = node.parse({
      ...currentNode,
      ...optionsValue,
    });
    nodeUpdate.run(
      nextNode.title,
      nextNode.titleType,
      nextNode.status ?? null,
      nextNode.agent,
      nextNode.id,
    );
    return nodeRead(nextNode.id);
  }),
  tree: (): TodoTreeState => {
    const nodes = nodesAll.all().map(databaseNodeRead);
    if (nodes.length === 0) throw new Error("TodoTree root does not exist.");
    const { id: treeDataMaxId } = z.object({
      id: z.number().int().positive(),
    }).parse(nodeSequence.get());
    return treeState.parse({
      treeData: {
        nodesById: Object.fromEntries(nodes.map(nodeValue => [nodeValue.id, nodeValue])),
      },
      treeDataMaxId,
    });
  },
};

export default store;
