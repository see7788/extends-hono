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
const windowPath = absolutePath.describe(
  "当前 VS Code 窗口的真实根路径；必须直接使用本次会话 environment_context 中的 cwd，不得填写任务项目路径。",
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
  projectPathExistsById: z.record(z.string(), z.boolean()),
  projectAttentionById: z.record(z.string(), projectAttention),
});
const projectTree = z.object({
  projectId: z.number().int().positive(),
  projectPathExists: z.boolean(),
  nodesById: z.record(z.string(), node),
  attention: projectAttention,
});
const projectMaintenance = z.object({
  projectId: z.number().int().positive(),
  projectPath: absolutePath,
  reason: z.literal("path_missing"),
});
const projectResolve = z.object({
  workspacePath: currentWorkspacePath,
});
const projectMigrate = z.object({
  sourceProjectPath: absolutePath.describe("当前已经登记的项目绝对路径；源目录允许已经迁走。"),
  targetProjectPath: currentWorkspacePath.describe("迁移后的真实项目绝对路径。"),
});
const projectMaintenanceInput = z.object({});
const projectAttentionInput = z.object({
  projectIds: z.array(z.number().int().positive()).min(1).max(100),
});
const conversationInit = projectResolve.extend({
  windowPath,
});
const taskTarget = z.object({
  targetId: z.number().int().positive(),
  title: node.shape.title,
});
const taskOpen = taskTarget.extend({
  status: z.union([z.literal(2), z.literal(4)]).default(2),
});
const taskOpenMany = z.object({
  targets: z.array(taskTarget.extend({
    projectId: z.number().int().positive(),
    status: z.union([z.literal(2), z.literal(4)]).default(2),
  })).min(1).max(100),
});
const taskId = z.object({ taskId: z.number().int().positive() });
const taskComplete = taskId.extend({ result: node.shape.title });
const taskBlock = taskId.extend({
  error: node.shape.title,
  cause: node.shape.title,
  evidence: node.shape.title,
});
const taskCancel = taskId.extend({ reason: node.shape.title });
const taskDecision = taskId.extend({ title: node.shape.title });
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
  projectMaintenance: projectMaintenanceInput,
  projectAttention: projectAttentionInput,
  projectResolve,
  projectNodeRead: del.extend({ workspacePath: currentWorkspacePath }),
  set: setValue,
  taskBlock,
  taskCancel,
  taskComplete,
  taskDecision,
  taskId,
  taskOpen,
  taskOpenMany,
};

export type TodoTreeNode = z.infer<typeof node>;
export type TodoTreeState = z.infer<typeof treeState>;
type TodoTreeProject = z.infer<typeof projectTree>;
type ProjectAttention = z.infer<typeof projectAttention>;

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
  DROP TABLE IF EXISTS todotree_project_relation;
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
  const taskRootRead = (nodeValue: TodoTreeNode) => {
    let current = nodeValue;
    while (current.id_parent !== null) {
      const parent = nodesById.get(current.id_parent);
      if (!parent) return undefined;
      if (parent.template === "project" || parent.template === "file" || parent.template === "typescript") {
        return current.template === "markdown" ? current : undefined;
      }
      if (parent.template !== "markdown") return undefined;
      current = parent;
    }
    return undefined;
  };
  for (const nodeValue of nodes) {
    const taskRoot = taskRootRead(nodeValue);
    if (!taskRoot) continue;
    const projectId = projectIdRead(taskRoot);
    if (projectId === undefined) continue;
    const attention = attentionByProjectId[projectId];
    if (nodeValue.id === taskRoot.id) {
      if (nodeValue.status === 8) attention.blockedCount += 1;
      if (nodeValue.status === 4) attention.runningCount += 1;
      if (nodeValue.status === 2) attention.todoCount += 1;
    } else if (nodeValue.status === 1) {
      attention.decisionIds.push(nodeValue.id);
    }
  }
  for (const attention of Object.values(attentionByProjectId)) {
    attention.decisionCount = attention.decisionIds.length;
  }
  return z.record(z.string(), projectAttention).parse(attentionByProjectId);
};
const projectPathExistsRead = (nodeValue: TodoTreeNode) => {
  if (nodeValue.template !== "project") return false;
  try {
    return lstatSync(nodeValue.title).isDirectory();
  } catch {
    return false;
  }
};
const projectTreeRead = (projectId: number, rows = subtreeNodes.all(projectId)): TodoTreeProject => {
  const nodes = rows.map(databaseNodeRead);
  const projectNode = nodes.find(nodeValue => nodeValue.id === projectId) ?? nodeRead(projectId);
  const attention = projectAttentionByIdRead(
    subtreeNodes.all(projectId).map(databaseNodeRead),
  )[projectId];
  if (!attention) throw new Error(`TodoTree project does not exist: ${String(projectId)}`);
  return projectTree.parse({
    projectId,
    projectPathExists: projectPathExistsRead(projectNode),
    nodesById: Object.fromEntries(nodes.map(nodeValue => [nodeValue.id, nodeValue])),
    attention,
  });
};
const taskUnfinishedDescendant = database.prepare(`
  WITH RECURSIVE descendants(id, status) AS (
    SELECT id, status FROM todotree_node WHERE id_parent = ?
    UNION ALL
    SELECT child.id, child.status
    FROM todotree_node AS child
    JOIN descendants AS parent ON child.id_parent = parent.id
  )
  SELECT id FROM descendants WHERE status <= 6 LIMIT 1
`);
const taskTargetRead = (projectId: number, targetId: number) => {
  projectNodeAssert(projectId, targetId);
  const target = nodeRead(targetId);
  if (target.template !== "project" && target.template !== "file" && target.template !== "typescript") {
    throw new HTTPException(409, {
      message: "task.targetId 必须指向 project、file 或 typescript 节点。",
    });
  }
  return target;
};
const projectIdForTargetRead = (projectIds: number[], targetId: number) => {
  const projectId = projectIds.find(projectIdValue => projectContainsNode.get(projectIdValue, targetId));
  if (projectId === undefined) {
    throw new HTTPException(409, { message: "task.targetId 不属于当前 AI 已绑定的项目。" });
  }
  return projectId;
};
const taskRead = (taskId: number) => {
  const task = nodeRead(taskId);
  if (task.template !== "markdown") {
    throw new HTTPException(409, { message: "taskId 必须指向 markdown 任务节点。" });
  }
  const parent = task.id_parent === null ? undefined : nodeRead(task.id_parent);
  if (!parent || (parent.template !== "project" && parent.template !== "file" && parent.template !== "typescript")) {
    throw new HTTPException(409, {
      message: "任务节点必须直接挂在 project、file 或 typescript 节点下。",
    });
  }
  return task;
};
const taskProjectAssert = (taskId: number, projectIds: number[]) => {
  const task = taskRead(taskId);
  if (!projectIds.some(projectId => projectContainsNode.get(projectId, task.id))) {
    throw new HTTPException(409, { message: "taskId 不属于当前 AI 已绑定的项目。" });
  }
  return task;
};
const taskActiveAssert = (task: TodoTreeNode) => {
  if (task.status !== 2 && task.status !== 4) {
    throw new HTTPException(409, {
      message: "task 生命周期动作只接受 status: 2 待办或 status: 4 工作中的任务。",
    });
  }
};
const decisionPlacementValidate = (parentNode: TodoTreeNode) => {
  let current: TodoTreeNode | undefined = parentNode;
  while (current) {
    if (current.template === "typescript" || current.template === "markdown") return;
    current = current.id_parent === null ? undefined : nodeRead(current.id_parent);
  }
  throw new HTTPException(409, {
    message: "status: 1 待定节点必须位于真实任务或 typescript 公开成员下面。",
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

const todotreeActions = {
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
        const inserted = todotreeActions.add({ ...nodeValue, id_parent: idParent });
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
      throw new HTTPException(409, { message: "存在 status <= 6 的未收口后代时，节点不能设为完成。" });
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
  projectAttention: (options: z.input<typeof validator.projectAttention>) => {
    const { projectIds } = validator.projectAttention.parse(options);
    const attentionByProjectId = projectAttentionByIdRead(nodesAll.all().map(databaseNodeRead));
    return Object.fromEntries(projectIds.map(projectId => {
      const projectNode = nodeRead(projectId);
      if (projectNode.id_parent !== 1 || projectNode.template !== "project") {
        throw new HTTPException(409, { message: `TodoTree project does not exist: ${String(projectId)}` });
      }
      const attention = attentionByProjectId[projectId];
      if (!attention) throw new Error(`TodoTree project attention does not exist: ${String(projectId)}`);
      return [projectId, attention];
    }));
  },
  projectList: () => projectsAll.all().map(databaseNodeRead),
  projectMaintenance: () => projectMaintenance.array().parse(
    projectsAll.all()
      .map(databaseNodeRead)
      .filter(project => !projectPathExistsRead(project))
      .map(project => ({
        projectId: project.id,
        projectPath: project.title,
        reason: "path_missing" as const,
      })),
  ),
  projectResolve: (value: string) => {
    const projectNode = projectRead(value);
    return projectTreeRead(projectNode.id);
  },
  conversationInit: (options: z.input<typeof validator.conversationInit>) => {
    const optionsValue = validator.conversationInit.parse(options);
    const verifiedWindowPath = workspacePathRead(optionsValue.windowPath);
    const project = todotreeActions.projectResolve(optionsValue.workspacePath);
    return {
      projectId: project.projectId,
      windowPath: verifiedWindowPath,
      nodesById: project.nodesById,
    };
  },
  taskOpen: database.transaction((options: z.input<typeof validator.taskOpen> & { projectIds: number[] }) => {
    const optionsValue = validator.taskOpen.parse(options);
    const projectId = projectIdForTargetRead(options.projectIds, optionsValue.targetId);
    const target = taskTargetRead(projectId, optionsValue.targetId);
    if (optionsValue.status <= 6 && closedAncestor.get(target.id)) {
      throw new HTTPException(409, { message: "已收口节点的后代必须保持 status > 6 的收口状态。" });
    }
    const result = nodeInsert.run(
      target.id,
      optionsValue.title,
      "markdown",
      optionsValue.status,
      1,
    );
    return nodeRead(Number(result.lastInsertRowid));
  }),
  taskOpenMany: database.transaction((options: z.input<typeof validator.taskOpenMany>) => {
    const optionsValue = validator.taskOpenMany.parse(options);
    const targets = optionsValue.targets.map(target => {
      taskTargetRead(target.projectId, target.targetId);
      return target;
    });
    for (const target of targets) {
      if (target.status <= 6 && closedAncestor.get(target.targetId)) {
        throw new HTTPException(409, { message: "已收口节点的后代必须保持 status > 6 的收口状态。" });
      }
    }
    return targets.map(target => {
      const result = nodeInsert.run(
        target.targetId,
        target.title,
        "markdown",
        target.status,
        1,
      );
      return nodeRead(Number(result.lastInsertRowid));
    });
  }),
  taskStart: database.transaction((options: z.input<typeof validator.taskId> & { projectIds: number[] }) => {
    const { taskId } = validator.taskId.parse(options);
    const task = taskProjectAssert(taskId, options.projectIds);
    if (task.status !== 2) {
      throw new HTTPException(409, { message: "task.start 只能启动 status: 2 待办任务。" });
    }
    nodeUpdate.run(task.title, task.template, 4, task.agent, task.id);
    return nodeRead(task.id);
  }),
  taskComplete: database.transaction((options: z.input<typeof validator.taskComplete> & { projectIds: number[] }) => {
    const optionsValue = validator.taskComplete.parse(options);
    const task = taskProjectAssert(optionsValue.taskId, options.projectIds);
    taskActiveAssert(task);
    if (taskUnfinishedDescendant.get(task.id)) {
      throw new HTTPException(409, { message: "任务仍有未收口后代，不能完成。" });
    }
    nodeInsert.run(task.id, optionsValue.result, "markdown", 7, 1);
    nodeUpdate.run(task.title, task.template, 7, task.agent, task.id);
    return nodeRead(task.id);
  }),
  taskBlock: database.transaction((options: z.input<typeof validator.taskBlock> & { projectIds: number[] }) => {
    const optionsValue = validator.taskBlock.parse(options);
    const task = taskProjectAssert(optionsValue.taskId, options.projectIds);
    taskActiveAssert(task);
    nodeInsert.run(
      task.id,
      `# 阻塞\n\n- error: ${optionsValue.error}\n- cause: ${optionsValue.cause}\n- evidence: ${optionsValue.evidence}`,
      "markdown",
      7,
      1,
    );
    nodeUpdate.run(task.title, task.template, 8, task.agent, task.id);
    return nodeRead(task.id);
  }),
  taskCancel: database.transaction((options: z.input<typeof validator.taskCancel> & { projectIds: number[] }) => {
    const optionsValue = validator.taskCancel.parse(options);
    const task = taskProjectAssert(optionsValue.taskId, options.projectIds);
    taskActiveAssert(task);
    nodeInsert.run(task.id, `# 取消\n\n${optionsValue.reason}`, "markdown", 7, 1);
    nodeUpdate.run(task.title, task.template, 9, task.agent, task.id);
    return nodeRead(task.id);
  }),
  taskDecision: database.transaction((options: z.input<typeof validator.taskDecision> & { projectIds: number[] }) => {
    const optionsValue = validator.taskDecision.parse(options);
    const task = taskProjectAssert(optionsValue.taskId, options.projectIds);
    taskActiveAssert(task);
    const result = nodeInsert.run(task.id, optionsValue.title, "markdown", 1, 1);
    return nodeRead(Number(result.lastInsertRowid));
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
      projectPathExistsById: Object.fromEntries(
        nodes
          .filter(nodeValue => nodeValue.id_parent === 1 && nodeValue.template === "project")
          .map(nodeValue => [nodeValue.id, projectPathExistsRead(nodeValue)]),
      ),
      projectAttentionById: projectAttentionByIdRead(nodes),
    });
  },
};
const store = { todotreeActions };

export default store;
