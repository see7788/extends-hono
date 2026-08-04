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
  status: node.shape.status,
  agent: node.shape.agent.optional(),
});
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
const projectTree = z.object({
  projectId: z.number().int().positive(),
  nodesById: z.record(z.string(), node),
});
const projectResolve = z.object({
  workspacePath: currentWorkspacePath,
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
  conversationInit,
  del,
  nodeSearch,
  projectRegister: z.object({ projectPath: currentWorkspacePath }),
  projectResolve,
  projectNodeRead: del.extend({ workspacePath: currentWorkspacePath }),
  set: setValue,
};

export type TodoTreeNode = z.infer<typeof node>;
export type TodoTreeState = z.infer<typeof treeState>;
export type TodoTreeProject = z.infer<typeof projectTree>;

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
const unfinishedDescendant = database.prepare(`
  WITH RECURSIVE descendants(id, status) AS (
    SELECT id, status FROM todotree_node WHERE id_parent = ?
    UNION ALL
    SELECT child.id, child.status
    FROM todotree_node AS child
    JOIN descendants AS parent ON child.id_parent = parent.id
  )
  SELECT id FROM descendants WHERE status <> 7 LIMIT 1
`);
const completedAncestor = database.prepare(`
  WITH RECURSIVE ancestors(id, id_parent, status) AS (
    SELECT id, id_parent, status FROM todotree_node WHERE id = ?
    UNION ALL
    SELECT parent.id, parent.id_parent, parent.status
    FROM todotree_node AS parent
    JOIN ancestors AS child ON child.id_parent = parent.id
  )
  SELECT id FROM ancestors WHERE status = 7 LIMIT 1
`);
const completedAncestorsRun = database.prepare(`
  WITH RECURSIVE ancestors(id, id_parent) AS (
    SELECT id, id_parent FROM todotree_node WHERE id = ?
    UNION ALL
    SELECT parent.id, parent.id_parent
    FROM todotree_node AS parent
    JOIN ancestors AS child ON child.id_parent = parent.id
  )
  UPDATE todotree_node
  SET status = 4
  WHERE status = 7 AND id IN (SELECT id FROM ancestors)
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
const projectNodeAssert = (projectId: number, nodeId: number) => {
  if (!projectContainsNode.get(projectId, nodeId)) {
    throw new Error("指定节点不属于当前项目。");
  }
};
const projectTreeRead = (projectId: number, rows = subtreeNodes.all(projectId)): TodoTreeProject => {
  const nodes = rows.map(databaseNodeRead);
  return projectTree.parse({
    projectId,
    nodesById: Object.fromEntries(nodes.map(nodeValue => [nodeValue.id, nodeValue])),
  });
};
const nodePlacementValidate = (parentNode: TodoTreeNode, nodeValue: z.infer<typeof add>) => {
  if (nodeValue.template === "project") {
    throw new Error("project 节点只能由项目初始化接口生产。");
  }
  if (nodeValue.template === "file") {
    if (parentNode.template !== "project") {
      throw new Error("file 节点必须直接属于 project 节点。");
    }
    const path = nodeValue.title.replaceAll("\\", "/");
    if (/^(?:[A-Za-z]:\/|\/)/.test(path) || path.split("/").includes("..")) {
      throw new Error("file 节点必须使用项目内完整相对文件路径。");
    }
  }
  if (nodeValue.template === "typescript") {
    if (parentNode.template !== "file") {
      throw new Error("typescript 节点必须直接属于 file 节点。");
    }
    if (!nodeValue.title.split("\n").some(line => line.trimStart().startsWith("// "))) {
      throw new Error("typescript 节点必须在签名后用 // 表达具体用途与直接消费链。");
    }
  }
  if (parentNode.template === "file" && nodeValue.template !== "typescript") {
    throw new Error("file 节点只能生产 typescript 公开成员节点。");
  }
};

const store = {
  add: database.transaction((options: z.input<typeof validator.add>) => {
    const optionsValue = validator.add.parse(options);
    const parentNode = nodeRead(optionsValue.id_parent);
    nodePlacementValidate(parentNode, optionsValue);
    if (optionsValue.status !== 7 && completedAncestor.get(parentNode.id)) {
      throw new Error("已完成节点的后代必须保持已完成状态。");
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
    if (nextNode.status === 7 && unfinishedDescendant.get(nextNode.id)) {
      throw new Error("存在未完成后代时，节点不能设为已完成。");
    }
    if (
      nextNode.status !== 7
      && currentNode.id_parent !== null
      && completedAncestor.get(currentNode.id_parent)
    ) {
      throw new Error("已完成节点的后代必须保持已完成状态。");
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
      completedAncestorsRun.run(memberNode.id);
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
    });
  },
};

export default store;
