import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { contractValidator } from "./contract.ts";

const { agent, status, template } = contractValidator;
const absolutePath = z.string().trim().min(1).refine(
  value => /^(?:[A-Za-z]:[\\/]|\/)/.test(value),
  "TodoTree project title must be an absolute path.",
);
const currentWorkspacePath = absolutePath.describe(
  "当前 AI 已知的绝对工作路径；服务端只解析到最近的已登记祖先项目，不依据语言文件或 workspace 容器猜测项目。",
);
const node = z.object({
  id: z.number().int().positive().describe("TodoTree 节点 ID。"),
  id_parent: z.number().int().positive().nullable().describe("父节点 ID。"),
  title: z.string().trim().min(1).refine(
    value => !/^\[(?:\s|x|~|!|\?|✓|…|-)\]/i.test(value),
    "title 不得使用自造状态标记；请使用 status。",
  ).describe(
    "节点完整内容；可保存 todo.md 风格的 Markdown；不得重复 status 或 agent，不得添加 [ ]、[~] 等自造状态标记。",
  ),
  template,
  status,
  agent,
});
const nodeCreate = node.omit({ id: true, id_parent: true });
const add = nodeCreate.extend({
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
type BatchNode = z.infer<typeof nodeCreate> & { children?: BatchNode[] };
const batchNode: z.ZodType<BatchNode> = nodeCreate.extend({
  children: z.lazy(() => z.array(batchNode)).optional(),
});
const batch = z.object({
  id_parent: z.number().int().positive(),
  nodes: z.array(batchNode).min(1).max(500),
}).superRefine((value, context) => {
  let count = 0;
  const nodesCount = (nodes: BatchNode[], depth: number) => {
    if (depth > 100) {
      context.addIssue({ code: "custom", message: "TodoTree batch depth cannot exceed 100." });
      return;
    }
    count += nodes.length;
    if (count > 500) {
      context.addIssue({ code: "custom", message: "TodoTree batch cannot exceed 500 nodes." });
      return;
    }
    for (const nodeValue of nodes) nodesCount(nodeValue.children ?? [], depth + 1);
  };
  nodesCount(value.nodes, 1);
});
const setValue = z.object({
  id: z.number().int().positive(),
  title: node.shape.title.optional(),
  status: node.shape.status,
  agent: node.shape.agent.optional(),
});
const del = z.object({
  id: z.number().int().positive(),
});
const move = z.object({
  id: z.number().int().positive(),
  id_parent: z.number().int().positive(),
}).refine(value => value.id !== value.id_parent, {
  message: "TodoTree node cannot be moved below itself.",
});
const tree = z.object({
  nodesById: z.record(z.string(), node),
});
const projectAttention = z.object({
  project: node,
  decisionCount: z.number().int().nonnegative(),
  decisionIds: z.array(z.number().int().positive()),
  blockedCount: z.number().int().nonnegative(),
  runningCount: z.number().int().nonnegative(),
  todoCount: z.number().int().nonnegative(),
});
const treeState = z.object({
  treeData: tree,
  treeDataMaxId: z.number().int().positive(),
  projectAttentionById: z.record(z.string(), projectAttention),
});
const projectTree = z.object({
  projectId: z.number().int().positive(),
  nodesById: z.record(z.string(), node),
  attention: projectAttention,
});
const projectRelation = z.object({
  sourceProjectId: z.number().int().positive(),
  sourceProjectPath: absolutePath,
  targetProjectId: z.number().int().positive(),
  targetProjectPath: absolutePath,
});
const projectRelationInput = z.object({
  sourceProjectPath: absolutePath,
  targetProjectPath: absolutePath,
});
const workspaceTree = z.object({
  workspacePath: absolutePath,
  projectsById: z.record(z.string(), projectTree),
  relations: z.array(projectRelation),
});
const projectResolve = z.object({
  workspacePath: currentWorkspacePath,
});
const projectMigrate = z.object({
  sourceProjectPath: absolutePath.describe("当前已经登记的项目绝对路径；源目录允许已经迁走。"),
  targetProjectPath: currentWorkspacePath.describe("迁移后的真实项目绝对路径。"),
});
const conversationInit = projectResolve.extend({
  title: node.shape.title,
  agent,
  memberId: z.number().int().positive().optional().describe(
    "本次交流对应的 typescript 成员节点 ID；空项目首次建立蓝图时省略，已有成员后必须提供。",
  ),
});
const nodeSearch = projectResolve.extend({
  title: z.string().trim().min(1).optional().describe("按 title 包含关系查询。"),
  template: template.optional(),
  status: status.optional(),
  agent: agent.optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export const validator = {
  add,
  batch,
  conversationInit,
  del,
  move,
  nodeSearch,
  projectRegister: z.object({ projectPath: currentWorkspacePath }),
  projectMigrate,
  projectRelation: projectRelationInput,
  projectResolve,
  projectNodeRead: del.extend({ workspacePath: currentWorkspacePath }),
  set: setValue,
  workspaceTree: projectResolve,
};

export type TodoTreeNode = z.infer<typeof node>;
export type TodoTreeState = z.infer<typeof treeState>;
export type TodoTreeProject = z.infer<typeof projectTree>;
export type ProjectAttention = z.infer<typeof projectAttention>;

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
    template TEXT NOT NULL CHECK (template IN ('project', 'file', 'typescript', 'markdown', 'text')),
    status INTEGER NOT NULL CHECK (status BETWEEN 1 AND 9),
    agent INTEGER NOT NULL CHECK (agent BETWEEN 1 AND 4)
  );
  CREATE INDEX IF NOT EXISTS todotree_node_id_parent
    ON todotree_node(id_parent);
  CREATE TABLE IF NOT EXISTS todotree_project_relation (
    source_project_id INTEGER NOT NULL REFERENCES todotree_node(id) ON DELETE CASCADE,
    target_project_id INTEGER NOT NULL REFERENCES todotree_node(id) ON DELETE CASCADE,
    PRIMARY KEY (source_project_id, target_project_id),
    CHECK (source_project_id <> target_project_id)
  );
  INSERT INTO todotree_node (id, id_parent, title, template, status, agent)
    SELECT 1, NULL, 'TodoTree', 'project', 4, 1
    WHERE NOT EXISTS (SELECT 1 FROM todotree_node);
`);

const nodeById = database.prepare(`
  SELECT id, id_parent, title, template, status, agent
  FROM todotree_node
  WHERE id = ?
`);
const projectByPath = database.prepare(`
  SELECT id, id_parent, title, template, status, agent
  FROM todotree_node
  WHERE id_parent = 1 AND template = 'project' AND title = ? COLLATE NOCASE
  LIMIT 1
`);
const projectsAll = database.prepare(`
  SELECT id, id_parent, title, template, status, agent
  FROM todotree_node
  WHERE id_parent = 1 AND template = 'project'
  ORDER BY length(title) DESC, id
`);
const projectRelationByProjects = database.prepare(`
  SELECT
    relation.source_project_id AS sourceProjectId,
    source.title AS sourceProjectPath,
    relation.target_project_id AS targetProjectId,
    target.title AS targetProjectPath
  FROM todotree_project_relation AS relation
  JOIN todotree_node AS source ON source.id = relation.source_project_id
  JOIN todotree_node AS target ON target.id = relation.target_project_id
  WHERE relation.source_project_id = ? AND relation.target_project_id = ?
`);
const projectRelationsAll = database.prepare(`
  SELECT
    relation.source_project_id AS sourceProjectId,
    source.title AS sourceProjectPath,
    relation.target_project_id AS targetProjectId,
    target.title AS targetProjectPath
  FROM todotree_project_relation AS relation
  JOIN todotree_node AS source ON source.id = relation.source_project_id
  JOIN todotree_node AS target ON target.id = relation.target_project_id
  ORDER BY relation.source_project_id, relation.target_project_id
`);
const projectRelationInsert = database.prepare(`
  INSERT INTO todotree_project_relation (source_project_id, target_project_id)
  VALUES (?, ?)
  ON CONFLICT (source_project_id, target_project_id) DO NOTHING
`);
const projectRelationDelete = database.prepare(`
  DELETE FROM todotree_project_relation
  WHERE source_project_id = ? AND target_project_id = ?
`);
const nodesAll = database.prepare(`
  SELECT id, id_parent, title, template, status, agent
  FROM todotree_node
  ORDER BY id
`);
const nodeSequence = database.prepare(`
  SELECT seq AS id FROM sqlite_sequence WHERE name = 'todotree_node'
`);
const nodeInsert = database.prepare(`
  INSERT INTO todotree_node (id_parent, title, template, status, agent)
  VALUES (?, ?, ?, ?, ?)
`);
const nodeUpdate = database.prepare(`
  UPDATE todotree_node
  SET title = ?, template = ?, status = ?, agent = ?
  WHERE id = ?
`);
const nodeMove = database.prepare(`
  UPDATE todotree_node
  SET id_parent = ?
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
// status <= 6 为未收口；status > 6 的 7/8/9 都是收口分支。
const unfinishedDescendant = database.prepare(`
  WITH RECURSIVE descendants(id, status) AS (
    SELECT id, status FROM todotree_node WHERE id_parent = ?
    UNION ALL
    SELECT child.id, child.status
    FROM todotree_node AS child
    JOIN descendants AS parent ON child.id_parent = parent.id
  )
  SELECT id FROM descendants WHERE status <= 6 LIMIT 1
`);
// 任何 status > 6 的祖先都已收口，后代只能继续保持收口。
const closedAncestor = database.prepare(`
  WITH RECURSIVE ancestors(id, id_parent, status) AS (
    SELECT id, id_parent, status FROM todotree_node WHERE id = ?
    UNION ALL
    SELECT parent.id, parent.id_parent, parent.status
    FROM todotree_node AS parent
    JOIN ancestors AS child ON child.id_parent = parent.id
  )
  SELECT id FROM ancestors WHERE status > 6 LIMIT 1
`);
const closedAncestorsRun = database.prepare(`
  WITH RECURSIVE ancestors(id, id_parent) AS (
    SELECT id, id_parent FROM todotree_node WHERE id = ?
    UNION ALL
    SELECT parent.id, parent.id_parent
    FROM todotree_node AS parent
    JOIN ancestors AS child ON child.id_parent = parent.id
  )
  UPDATE todotree_node
  SET status = 4
  WHERE status > 6 AND id IN (SELECT id FROM ancestors)
`);
const childNodes = database.prepare(`
  SELECT id, id_parent, title, template, status, agent
  FROM todotree_node
  WHERE id_parent = ?
  ORDER BY id
`);
const subtreeNodes = database.prepare(`
  WITH RECURSIVE descendants(
    id, id_parent, title, template, status, agent
  ) AS (
    SELECT id, id_parent, title, template, status, agent
    FROM todotree_node
    WHERE id = ?
    UNION ALL
    SELECT child.id, child.id_parent, child.title, child.template, child.status, child.agent
    FROM todotree_node AS child
    JOIN descendants AS parent ON child.id_parent = parent.id
  )
  SELECT id, id_parent, title, template, status, agent
  FROM descendants
  ORDER BY id
`);
const projectContainsNode = database.prepare(`
  WITH RECURSIVE descendants(id) AS (
    SELECT id FROM todotree_node WHERE id = ?
    UNION ALL
    SELECT child.id
    FROM todotree_node AS child
    JOIN descendants AS parent ON child.id_parent = parent.id
  )
  SELECT id FROM descendants WHERE id = ?
`);
const contextNodes = database.prepare(`
  WITH RECURSIVE
  ancestors(id, id_parent, title, template, status, agent) AS (
    SELECT id, id_parent, title, template, status, agent
    FROM todotree_node
    WHERE id = @nodeId
    UNION ALL
    SELECT parent.id, parent.id_parent, parent.title, parent.template, parent.status, parent.agent
    FROM todotree_node AS parent
    JOIN ancestors AS child ON child.id_parent = parent.id
    WHERE child.id <> @projectId
  ),
  descendants(id, id_parent, title, template, status, agent) AS (
    SELECT id, id_parent, title, template, status, agent
    FROM todotree_node
    WHERE id = @nodeId
    UNION ALL
    SELECT child.id, child.id_parent, child.title, child.template, child.status, child.agent
    FROM todotree_node AS child
    JOIN descendants AS parent ON child.id_parent = parent.id
  )
  SELECT id, id_parent, title, template, status, agent FROM ancestors
  UNION
  SELECT id, id_parent, title, template, status, agent FROM descendants
  ORDER BY id
`);
const searchNodes = database.prepare(`
  WITH RECURSIVE descendants(id, id_parent, title, template, status, agent) AS (
    SELECT id, id_parent, title, template, status, agent
    FROM todotree_node
    WHERE id = @projectId
    UNION ALL
    SELECT child.id, child.id_parent, child.title, child.template, child.status, child.agent
    FROM todotree_node AS child
    JOIN descendants AS parent ON child.id_parent = parent.id
  )
  SELECT id, id_parent, title, template, status, agent
  FROM descendants
  WHERE (@title IS NULL OR instr(lower(title), lower(@title)) > 0)
    AND (@template IS NULL OR template = @template)
    AND (@status IS NULL OR status = @status)
    AND (@agent IS NULL OR agent = @agent)
  ORDER BY id
  LIMIT @limit
`);
const nodeDelete = database.prepare("DELETE FROM todotree_node WHERE id = ?");
const databaseNodeRead = (value: unknown): TodoTreeNode => {
  return node.parse(value);
};
const nodeRead = (id: number) => {
  const row = nodeById.get(id);
  if (!row) throw new Error(`TodoTree node does not exist: ${String(id)}`);
  return databaseNodeRead(row);
};
const privateProjectRoot = realpathSync(resolve(projectPath, "../../.."));
const privateProjectRootCompare = process.platform === "win32"
  ? privateProjectRoot.toLowerCase()
  : privateProjectRoot;
const projectPathAllowed = (value: string) => {
  const pathCompare = process.platform === "win32" ? value.toLowerCase() : value;
  const relativePath = relative(privateProjectRootCompare, pathCompare);
  return Boolean(
    relativePath
    && relativePath !== ".."
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath)
  );
};
const workspacePathRead = (value: string) => {
  const inputPath = currentWorkspacePath.parse(value);
  const stats = lstatSync(inputPath);
  if (!stats.isDirectory()) throw new Error("当前工作路径不是项目目录。");
  const realPath = realpathSync(inputPath);
  if (!projectPathAllowed(realPath)) {
    throw new Error("当前工作路径不属于允许的项目目录。");
  }
  return resolve(realPath);
};
const projectContainsPath = (projectPathValue: string, workspacePathValue: string) => {
  const projectCompare = process.platform === "win32" ? projectPathValue.toLowerCase() : projectPathValue;
  const workspaceCompare = process.platform === "win32" ? workspacePathValue.toLowerCase() : workspacePathValue;
  const relativePath = relative(projectCompare, workspaceCompare);
  return relativePath === "" || Boolean(
    relativePath !== ".."
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath)
  );
};
const projectRead = (value: string) => {
  const workspacePathValue = workspacePathRead(value);
  const project = projectsAll.all()
    .map(databaseNodeRead)
    .find(nodeValue => projectContainsPath(nodeValue.title, workspacePathValue));
  if (!project) {
    if (existsSync(join(workspacePathValue, "pnpm-workspace.yaml"))) {
      throw new HTTPException(409, {
        message: "当前工作路径是 pnpm workspace 容器，不是具体项目；请传入当前任务对应的具体项目绝对路径。",
      });
    }
    throw new HTTPException(404, {
      message: "当前工作路径尚未登记为具体项目或其子目录。",
    });
  }
  return project;
};
const projectExactRead = (value: string) => {
  const path = workspacePathRead(value);
  const row = projectByPath.get(path);
  if (!row) {
    throw new HTTPException(404, {
      message: `TodoTree project is not registered: ${path}`,
    });
  }
  return databaseNodeRead(row);
};
const registeredProjectRead = (value: string) => {
  const inputPath = resolve(absolutePath.parse(value));
  const path = existsSync(inputPath) ? resolve(realpathSync(inputPath)) : inputPath;
  if (!projectPathAllowed(path)) {
    throw new Error("待迁移项目路径不属于允许的项目目录。");
  }
  const row = projectByPath.get(path);
  if (!row) {
    throw new HTTPException(404, {
      message: `TodoTree project is not registered: ${path}`,
    });
  }
  return databaseNodeRead(row);
};
const projectNodeAssert = (projectId: number, nodeId: number) => {
  if (!projectContainsNode.get(projectId, nodeId)) {
    throw new Error("指定节点不属于当前项目。");
  }
};
const projectAttentionByIdRead = (nodes: TodoTreeNode[]) => {
  const nodesById = new Map(nodes.map(nodeValue => [nodeValue.id, nodeValue]));
  const projectIdByNodeId = new Map<number, number>();
  const attentionByProjectId: Record<number, ProjectAttention> = {};
  for (const nodeValue of nodes) {
    if (nodeValue.id_parent !== 1 || nodeValue.template !== "project") continue;
    projectIdByNodeId.set(nodeValue.id, nodeValue.id);
    attentionByProjectId[nodeValue.id] = {
      project: nodeValue,
      decisionCount: 0,
      decisionIds: [],
      blockedCount: 0,
      runningCount: 0,
      todoCount: 0,
    };
  }
  const projectIdRead = (nodeValue: TodoTreeNode) => {
    const path: number[] = [];
    let current: TodoTreeNode | undefined = nodeValue;
    while (current && !projectIdByNodeId.has(current.id)) {
      path.push(current.id);
      current = current.id_parent === null ? undefined : nodesById.get(current.id_parent);
    }
    const projectId = current === undefined ? undefined : projectIdByNodeId.get(current.id);
    if (projectId !== undefined) {
      for (const id of path) projectIdByNodeId.set(id, projectId);
    }
    return projectId;
  };
  for (const nodeValue of nodes) {
    const projectId = projectIdRead(nodeValue);
    if (projectId === undefined || nodeValue.id === projectId) continue;
    const attention = attentionByProjectId[projectId];
    if (nodeValue.status === 1) attention.decisionIds.push(nodeValue.id);
    if (nodeValue.status === 8) attention.blockedCount += 1;
    if (nodeValue.status === 4) attention.runningCount += 1;
    if (nodeValue.status === 2) attention.todoCount += 1;
  }
  for (const attention of Object.values(attentionByProjectId)) {
    attention.decisionCount = attention.decisionIds.length;
  }
  return z.record(z.string(), projectAttention).parse(attentionByProjectId);
};
const projectTreeRead = (projectId: number, rows = subtreeNodes.all(projectId)): TodoTreeProject => {
  const nodes = rows.map(databaseNodeRead);
  const attention = projectAttentionByIdRead(
    subtreeNodes.all(projectId).map(databaseNodeRead),
  )[projectId];
  if (!attention) throw new Error(`TodoTree project does not exist: ${String(projectId)}`);
  return projectTree.parse({
    projectId,
    nodesById: Object.fromEntries(nodes.map(nodeValue => [nodeValue.id, nodeValue])),
    attention,
  });
};
const decisionPlacementValidate = (parentNode: TodoTreeNode) => {
  let current: TodoTreeNode | undefined = parentNode;
  while (current) {
    if (current.template === "typescript") return;
    current = current.id_parent === null ? undefined : nodeRead(current.id_parent);
  }
  throw new HTTPException(409, {
    message: "status: 1 决策必须挂在受影响的 typescript 公开成员下面。",
  });
};
const nodePlacementValidate = (
  parentNode: TodoTreeNode,
  nodeValue: z.infer<typeof add>,
) => {
  if (nodeValue.template === "project") {
    throw new HTTPException(409, { message: "project 节点只能由项目初始化接口生产。" });
  }
  if (nodeValue.template === "file") {
    if (parentNode.template !== "project") {
      throw new HTTPException(409, { message: "file 节点必须直接属于 project 节点。" });
    }
    const path = nodeValue.title.replaceAll("\\", "/");
    if (/^(?:[A-Za-z]:\/|\/)/.test(path) || path.split("/").includes("..")) {
      throw new HTTPException(409, { message: "file 节点必须使用项目内完整相对文件路径。" });
    }
  }
  if (nodeValue.template === "typescript") {
    if (parentNode.template !== "file") {
      throw new HTTPException(409, { message: "typescript 节点必须直接属于 file 节点。" });
    }
    if (!nodeValue.title.split("\n").some(line => line.trimStart().startsWith("// "))) {
      throw new HTTPException(409, {
        message: "typescript 节点必须在签名后用 // 表达具体用途与直接消费链。",
      });
    }
  }
  if (parentNode.template === "file" && nodeValue.template !== "typescript") {
    throw new HTTPException(409, { message: "file 节点只能生产 typescript 公开成员节点。" });
  }
  if (nodeValue.status === 1) {
    decisionPlacementValidate(parentNode);
  }
};

const store = {
  add: database.transaction((options: z.input<typeof validator.add>) => {
    const optionsValue = validator.add.parse(options);
    const parentNode = nodeRead(optionsValue.id_parent);
    nodePlacementValidate(parentNode, optionsValue);
    if (optionsValue.status <= 6 && closedAncestor.get(parentNode.id)) {
      throw new HTTPException(409, { message: "已收口节点的后代必须保持 status > 6 的收口状态。" });
    }
    const result = nodeInsert.run(
      optionsValue.id_parent,
      optionsValue.title,
      optionsValue.template,
      optionsValue.status,
      optionsValue.agent,
    );
    return nodeRead(Number(result.lastInsertRowid));
  }),
  batch: database.transaction((options: z.input<typeof validator.batch>) => {
    const optionsValue = validator.batch.parse(options);
    const result: TodoTreeNode[] = [];
    const nodesAdd = (idParent: number, nodes: BatchNode[]) => {
      for (const { children = [], ...nodeValue } of nodes) {
        const inserted = store.add({ ...nodeValue, id_parent: idParent });
        result.push(inserted);
        nodesAdd(inserted.id, children);
      }
    };
    nodesAdd(optionsValue.id_parent, optionsValue.nodes);
    return result;
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
  move: database.transaction((options: z.input<typeof validator.move>) => {
    const optionsValue = validator.move.parse(options);
    const currentNode = nodeRead(optionsValue.id);
    const parentNode = nodeRead(optionsValue.id_parent);
    if (currentNode.id === 1 || currentNode.template === "project") {
      throw new HTTPException(409, { message: "TodoTree root and project nodes cannot be moved." });
    }
    if (projectContainsNode.get(currentNode.id, parentNode.id)) {
      throw new HTTPException(409, {
        message: "TodoTree node cannot be moved below itself or its descendants.",
      });
    }
    const projects = projectsAll.all().map(databaseNodeRead);
    const currentProject = projects.find(nodeValue => (
      projectContainsNode.get(nodeValue.id, currentNode.id)
    ));
    const parentProject = projects.find(nodeValue => (
      projectContainsNode.get(nodeValue.id, parentNode.id)
    ));
    if (!currentProject || currentProject.id !== parentProject?.id) {
      throw new HTTPException(409, { message: "TodoTree node cannot be moved across projects." });
    }
    nodePlacementValidate(parentNode, { ...currentNode, id_parent: parentNode.id });
    if (currentNode.status <= 6 && closedAncestor.get(parentNode.id)) {
      throw new HTTPException(409, { message: "已收口节点的后代必须保持 status > 6 的收口状态。" });
    }
    nodeMove.run(parentNode.id, currentNode.id);
    return nodeRead(currentNode.id);
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
    if (nextNode.status === 1) {
      if (nextNode.id_parent === null) {
        throw new HTTPException(409, { message: "TodoTree root cannot be a decision." });
      }
      decisionPlacementValidate(nodeRead(nextNode.id_parent));
    }
    if (nextNode.status === 7 && unfinishedDescendant.get(nextNode.id)) {
      throw new HTTPException(409, { message: "存在 status <= 6 的未收口后代时，节点不能设为已完成。" });
    }
    if (
      nextNode.status <= 6
      && currentNode.id_parent !== null
      && closedAncestor.get(currentNode.id_parent)
    ) {
      throw new HTTPException(409, { message: "已收口节点的后代必须保持 status > 6 的收口状态。" });
    }
    nodeUpdate.run(
      nextNode.title,
      nextNode.template,
      nextNode.status,
      nextNode.agent,
      nextNode.id,
    );
    return nodeRead(nextNode.id);
  }),
  projectRegister: database.transaction((value: string) => {
    const path = workspacePathRead(value);
    if (existsSync(join(path, "pnpm-workspace.yaml"))) {
      throw new Error("pnpm workspace 容器不能登记为具体项目。");
    }
    const current = projectByPath.get(path);
    const projectNode = current
      ? databaseNodeRead(current)
      : nodeRead(Number(nodeInsert.run(1, path, "project", 4, 1).lastInsertRowid));
    return projectTreeRead(projectNode.id);
  }),
  projectMigrate: database.transaction((options: z.input<typeof validator.projectMigrate>) => {
    const optionsValue = validator.projectMigrate.parse(options);
    const sourceProject = registeredProjectRead(optionsValue.sourceProjectPath);
    const targetPath = workspacePathRead(optionsValue.targetProjectPath);
    if (existsSync(join(targetPath, "pnpm-workspace.yaml"))) {
      throw new HTTPException(409, {
        message: "pnpm workspace 容器不能作为迁移后的具体项目。",
      });
    }
    const targetProjectValue = projectByPath.get(targetPath);
    if (targetProjectValue) {
      const targetProject = databaseNodeRead(targetProjectValue);
      if (targetProject.id !== sourceProject.id) {
        throw new HTTPException(409, {
          message: `TodoTree target project is already registered: ${targetPath}`,
        });
      }
    }
    nodeUpdate.run(
      targetPath,
      sourceProject.template,
      sourceProject.status,
      sourceProject.agent,
      sourceProject.id,
    );
    return projectTreeRead(sourceProject.id);
  }),
  workspaceRelationAdd: database.transaction((options: z.input<typeof validator.projectRelation>) => {
    const optionsValue = validator.projectRelation.parse(options);
    const sourceProject = projectExactRead(optionsValue.sourceProjectPath);
    const targetProject = projectExactRead(optionsValue.targetProjectPath);
    if (sourceProject.id === targetProject.id) {
      throw new HTTPException(409, { message: "TodoTree project relation requires two projects." });
    }
    projectRelationInsert.run(sourceProject.id, targetProject.id);
    return projectRelation.parse(projectRelationByProjects.get(sourceProject.id, targetProject.id));
  }),
  workspaceRelationDel: database.transaction((options: z.input<typeof validator.projectRelation>) => {
    const optionsValue = validator.projectRelation.parse(options);
    const sourceProject = projectExactRead(optionsValue.sourceProjectPath);
    const targetProject = projectExactRead(optionsValue.targetProjectPath);
    const relation = projectRelationByProjects.get(sourceProject.id, targetProject.id);
    if (!relation) throw new HTTPException(404, { message: "TodoTree project relation does not exist." });
    projectRelationDelete.run(sourceProject.id, targetProject.id);
    return projectRelation.parse(relation);
  }),
  workspaceTree: (value: string) => {
    const workspacePath = workspacePathRead(value);
    const projects = projectsAll.all()
      .map(databaseNodeRead)
      .filter(project => projectContainsPath(workspacePath, project.title));
    if (projects.length === 0) {
      throw new HTTPException(404, {
        message: "当前 Workspace 内没有已登记的具体项目。",
      });
    }
    const projectIds = new Set(projects.map(project => project.id));
    return workspaceTree.parse({
      workspacePath,
      projectsById: Object.fromEntries(projects.map(project => [
        project.id,
        projectTreeRead(project.id),
      ])),
      relations: projectRelationsAll.all()
        .map(value => projectRelation.parse(value))
        .filter(relation => (
          projectIds.has(relation.sourceProjectId) || projectIds.has(relation.targetProjectId)
        )),
    });
  },
  projectAttention: (value: string) => {
    const projectNode = projectRead(value);
    return projectTreeRead(projectNode.id).attention;
  },
  projectAttentionList: () => projectAttentionByIdRead(nodesAll.all().map(databaseNodeRead)),
  projectList: () => projectsAll.all().map(databaseNodeRead),
  projectResolve: (value: string) => {
    const projectNode = projectRead(value);
    return projectTreeRead(projectNode.id);
  },
  conversationInit: database.transaction((options: z.input<typeof validator.conversationInit>) => {
    const optionsValue = validator.conversationInit.parse(options);
    const project = store.projectResolve(optionsValue.workspacePath);
    let idParent = project.projectId;
    if (optionsValue.memberId === undefined) {
      if (Object.values(project.nodesById).some(nodeValue => nodeValue.template === "typescript")) {
        throw new Error("当前项目已有源码成员；conversation.init 必须提供 memberId。");
      }
    } else {
      projectNodeAssert(project.projectId, optionsValue.memberId);
      const memberNode = nodeRead(optionsValue.memberId);
      if (memberNode.template !== "typescript") {
        throw new Error("conversation.init 的 memberId 必须指向 typescript 成员节点。");
      }
      idParent = memberNode.id;
      closedAncestorsRun.run(memberNode.id);
    }
    const conversation = store.add({
      id_parent: idParent,
      title: optionsValue.title,
      template: "markdown",
      status: 4,
      agent: optionsValue.agent,
    });
    return {
      projectId: project.projectId,
      conversationId: conversation.id,
      nodesById: {
        ...project.nodesById,
        [conversation.id]: conversation,
      },
    };
  }),
  projectTree: (value: string) => {
    const projectNode = projectRead(value);
    return projectTreeRead(projectNode.id);
  },
  projectNodeGet: (options: z.input<typeof validator.projectNodeRead>) => {
    const { workspacePath: path, id } = validator.projectNodeRead.parse(options);
    const projectNode = projectRead(path);
    projectNodeAssert(projectNode.id, id);
    return nodeRead(id);
  },
  projectNodeChildren: (options: z.input<typeof validator.projectNodeRead>) => {
    const { workspacePath: path, id } = validator.projectNodeRead.parse(options);
    const projectNode = projectRead(path);
    projectNodeAssert(projectNode.id, id);
    return childNodes.all(id).map(databaseNodeRead);
  },
  projectNodeContext: (options: z.input<typeof validator.projectNodeRead>) => {
    const { workspacePath: path, id } = validator.projectNodeRead.parse(options);
    const projectNode = projectRead(path);
    projectNodeAssert(projectNode.id, id);
    return projectTreeRead(projectNode.id, contextNodes.all({
      nodeId: id,
      projectId: projectNode.id,
    }));
  },
  projectNodeSearch: (options: z.input<typeof validator.nodeSearch>) => {
    const optionsValue = validator.nodeSearch.parse(options);
    const projectNode = projectRead(optionsValue.workspacePath);
    return searchNodes.all({
      projectId: projectNode.id,
      title: optionsValue.title ?? null,
      template: optionsValue.template ?? null,
      status: optionsValue.status ?? null,
      agent: optionsValue.agent ?? null,
      limit: optionsValue.limit,
    }).map(databaseNodeRead);
  },
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
      projectAttentionById: projectAttentionByIdRead(nodes),
    });
  },
};

export default store;
