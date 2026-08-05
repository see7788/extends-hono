import { zValidator } from "@hono/zod-validator";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  opendir,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { inspect } from "node:util";
import { Hono } from "hono";
import { z } from "zod";
import Register from "../../public";
import store from "../../store";

type WorkcopyProject = (typeof store.getState extends () => infer State
  ? State
  : never)["workcopy"]["projects"][string];
type WorkcopyManifest = WorkcopyProject["baseline"];

const workcopyRoot = resolve("D:\\ssdpro");
const excludedDirectoryNames = new Set([
  ".angular",
  ".cache",
  ".codegraph",
  ".git",
  ".hg",
  ".next",
  ".nuxt",
  ".output",
  ".pnpm-store",
  ".svelte-kit",
  ".svn",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "logs",
  "node_modules",
  "out",
  "storybook-static",
  "temp",
  "tmp",
]);
const sourcePathSchema = z.string().trim().min(1).refine(isAbsolute, {
  message: "sourcePath 必须是绝对路径。",
});
const relativePathSchema = z.string().trim().min(1).refine(path => {
  const normalized = path.replaceAll("\\", "/");
  return !isAbsolute(path)
    && normalized.split("/").every(segment => (
      segment !== "" && segment !== "." && segment !== ".."
    ));
}, {
  message: "deletePaths 只能包含工作副本内的相对文件路径。",
});
const createSchema = z.object({
  sourcePath: sourcePathSchema,
}).strict();
const statusSchema = z.object({
  sourcePath: sourcePathSchema.optional(),
}).strict();
const syncSchema = z.object({
  sourcePath: sourcePathSchema,
  deletePaths: z.array(relativePathSchema).default([]),
}).strict();

const pathKeyGet = (path: string) => resolve(path).toLowerCase();
const portablePathGet = (path: string) => path.split(sep).join("/");
const pathWithin = (root: string, candidate: string) => {
  const pathRelative = relative(root, candidate);
  return pathRelative === ""
    || (!pathRelative.startsWith(`..${sep}`) && pathRelative !== ".." && !isAbsolute(pathRelative));
};
const pathExists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};
const errorDetailGet = (error: unknown) => inspect(error, { depth: null });

const fileHashGet = async (path: string) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};

const filePathsGet = async (root: string) => {
  const paths: string[] = [];
  const directoryRead = async (directoryPath: string) => {
    const directory = await opendir(directoryPath);
    for await (const entry of directory) {
      const entryPath = resolve(directoryPath, entry.name);
      if (
        excludedDirectoryNames.has(entry.name)
        && (entry.isDirectory() || entry.isSymbolicLink())
      ) continue;
      if (entry.isDirectory()) {
        await directoryRead(entryPath);
        continue;
      }
      if (entry.isFile()) {
        if (!entry.name.endsWith(".log") && !entry.name.endsWith(".tsbuildinfo")) {
          paths.push(portablePathGet(relative(root, entryPath)));
        }
        continue;
      }
      const entryState = await lstat(entryPath);
      throw new Error(
        `workcopy 不复制非普通文件：${entryPath} (${entryState.isSymbolicLink() ? "symbolic-link" : "special"})`,
      );
    }
  };
  await directoryRead(root);
  return paths.sort();
};

const manifestGet = async (root: string): Promise<WorkcopyManifest> => {
  const manifest: WorkcopyManifest = {};
  for (const path of await filePathsGet(root)) {
    const absolutePath = resolve(root, ...path.split("/"));
    const fileState = await stat(absolutePath);
    manifest[path] = {
      sha256: await fileHashGet(absolutePath),
      size: fileState.size,
    };
  }
  return manifest;
};

const manifestEqual = (
  left: WorkcopyManifest,
  right: WorkcopyManifest,
) => {
  const paths = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...paths].every(path => (
    left[path]?.sha256 === right[path]?.sha256
    && left[path]?.size === right[path]?.size
  ));
};

const directoryCopy = async (
  sourcePath: string,
  workcopyPath: string,
  manifest: WorkcopyManifest,
) => {
  await mkdir(workcopyPath, { recursive: true });
  for (const path of Object.keys(manifest)) {
    const sourceFile = resolve(sourcePath, ...path.split("/"));
    const workcopyFile = resolve(workcopyPath, ...path.split("/"));
    await mkdir(dirname(workcopyFile), { recursive: true });
    await copyFile(sourceFile, workcopyFile);
  }
  const copiedManifest = await manifestGet(workcopyPath);
  if (!manifestEqual(manifest, copiedManifest)) {
    throw new Error("工作副本与复制前的源文件清单不一致；源项目可能在复制期间发生变化。");
  }
};

const manifestChangesGet = (
  baseline: WorkcopyManifest,
  current: WorkcopyManifest,
) => {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  for (const path of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
    if (!baseline[path] && current[path]) added.push(path);
    else if (baseline[path] && !current[path]) deleted.push(path);
    else if (baseline[path]!.sha256 !== current[path]!.sha256) modified.push(path);
  }
  return { added, modified, deleted };
};

const projectInspect = async (project: WorkcopyProject) => {
  const sourceExists = await pathExists(project.sourcePath);
  const workcopyExists = await pathExists(project.workcopyPath);
  const sourceManifest = sourceExists ? await manifestGet(project.sourcePath) : {};
  const workcopyManifest = workcopyExists ? await manifestGet(project.workcopyPath) : {};
  const sourceChanges = manifestChangesGet(project.baseline, sourceManifest);
  const workcopyChanges = manifestChangesGet(project.baseline, workcopyManifest);
  const sourceChanged = new Set([
    ...sourceChanges.added,
    ...sourceChanges.modified,
    ...sourceChanges.deleted,
  ]);
  const workcopyChanged = new Set([
    ...workcopyChanges.added,
    ...workcopyChanges.modified,
    ...workcopyChanges.deleted,
  ]);
  const conflicts = [...workcopyChanged].filter(path => (
    sourceChanged.has(path)
    && sourceManifest[path]?.sha256 !== workcopyManifest[path]?.sha256
  ));
  const pending = [...workcopyChanged].filter(path => (
    sourceManifest[path]?.sha256 !== workcopyManifest[path]?.sha256
  ));
  const phase = project.phase === "creating"
    || project.phase === "syncing"
    || project.phase === "developing"
    ? project.phase
    : pending.length > 0
      ? "developing"
      : "synced";
  return {
    project: {
      createdAt: project.createdAt,
      lastError: project.lastError,
      phase,
      recordedPhase: project.phase,
      sourceExists,
      sourcePath: project.sourcePath,
      updatedAt: project.updatedAt,
      workcopyExists,
      workcopyPath: project.workcopyPath,
      changes: {
        conflicts,
        pending,
        source: sourceChanges,
        workcopy: workcopyChanges,
      },
    },
    sourceManifest,
    workcopyManifest,
    workcopyChanges,
    conflicts,
    pending,
  };
};

const projectGet = async (sourcePath: string) => {
  const resolvedPath = resolve(sourcePath);
  const canonicalPath = await pathExists(resolvedPath)
    ? await realpath(resolvedPath)
    : resolvedPath;
  const sourceKey = pathKeyGet(canonicalPath);
  return {
    project: store.getState().workcopy.projects[sourceKey],
    sourceKey,
  };
};

const projectCopy = async (project: WorkcopyProject) => {
  let currentProject = project;
  try {
    const baseline = await manifestGet(project.sourcePath);
    currentProject = {
      ...project,
      baseline,
      lastError: undefined,
      phase: "creating",
      updatedAt: new Date().toISOString(),
    };
    store.getState().workcopyActions.projectSet(currentProject);
    await mkdir(workcopyRoot, { recursive: true });
    await directoryCopy(project.sourcePath, project.workcopyPath, baseline);
    currentProject = {
      ...currentProject,
      phase: "developing",
      updatedAt: new Date().toISOString(),
    };
    store.getState().workcopyActions.projectSet(currentProject);
    return (await projectInspect(currentProject)).project;
  } catch (error) {
    currentProject = {
      ...currentProject,
      lastError: {
        at: new Date().toISOString(),
        detail: errorDetailGet(error),
      },
      updatedAt: new Date().toISOString(),
    };
    store.getState().workcopyActions.projectSet(currentProject);
    throw new Error(`创建工作副本失败：${project.sourcePath}`, { cause: error });
  }
};

const projectCreate = async (input: z.infer<typeof createSchema>) => {
  const sourcePath = await realpath(resolve(input.sourcePath));
  const sourceState = await stat(sourcePath);
  if (!sourceState.isDirectory()) throw new Error(`sourcePath 不是目录：${sourcePath}`);
  if (pathWithin(workcopyRoot, sourcePath)) {
    throw new Error(`源项目已经位于 SSD 工作区：${sourcePath}`);
  }
  const projectName = basename(sourcePath);
  if (!projectName) throw new Error(`无法从 sourcePath 取得项目名称：${sourcePath}`);
  const workcopyPath = resolve(workcopyRoot, projectName);
  if (dirname(workcopyPath).toLowerCase() !== workcopyRoot.toLowerCase()) {
    throw new Error(`工作副本必须是 ${workcopyRoot} 的直接子目录。`);
  }
  const sourceKey = pathKeyGet(sourcePath);
  const existing = store.getState().workcopy.projects[sourceKey];
  if (existing) {
    return existing.phase === "creating"
      ? projectCopy(existing)
      : (await projectInspect(existing)).project;
  }
  if (await pathExists(workcopyPath)) {
    throw new Error(`工作副本目标已经存在且未登记：${workcopyPath}`);
  }
  const now = new Date().toISOString();
  const project: WorkcopyProject = {
    baseline: {},
    createdAt: now,
    phase: "creating",
    sourceKey,
    sourcePath,
    updatedAt: now,
    workcopyPath,
  };
  store.getState().workcopyActions.projectSet(project);
  return projectCopy(project);
};

const projectStatusGet = async (input: z.infer<typeof statusSchema>) => {
  if (input.sourcePath) {
    const { project } = await projectGet(input.sourcePath);
    if (!project) throw new Error(`没有登记该源项目：${resolve(input.sourcePath)}`);
    return (await projectInspect(project)).project;
  }
  const projects = await Promise.all(
    Object.values(store.getState().workcopy.projects).map(async project => (
      (await projectInspect(project)).project
    )),
  );
  return { projects };
};

const projectSync = async (input: z.infer<typeof syncSchema>) => {
  const { project } = await projectGet(input.sourcePath);
  if (!project) throw new Error(`没有登记该源项目：${resolve(input.sourcePath)}`);
  const before = await projectInspect(project);
  if (!before.project.sourceExists) throw new Error(`原项目不存在：${project.sourcePath}`);
  if (!before.project.workcopyExists) throw new Error(`工作副本不存在：${project.workcopyPath}`);
  if (before.conflicts.length > 0) {
    throw new Error(`原项目和工作副本同时修改了这些文件：${before.conflicts.join(", ")}`);
  }
  const deletePaths = new Set(input.deletePaths.map(path => path.replaceAll("\\", "/")));
  const invalidDeletePaths = [...deletePaths].filter(path => !before.workcopyChanges.deleted.includes(path));
  if (invalidDeletePaths.length > 0) {
    throw new Error(`deletePaths 不是工作副本中已经删除的文件：${invalidDeletePaths.join(", ")}`);
  }
  let currentProject: WorkcopyProject = {
    ...project,
    lastError: undefined,
    phase: "syncing",
    updatedAt: new Date().toISOString(),
  };
  store.getState().workcopyActions.projectSet(currentProject);
  try {
    const changedFiles = [
      ...before.workcopyChanges.added,
      ...before.workcopyChanges.modified,
    ].filter(path => (
      before.sourceManifest[path]?.sha256 !== before.workcopyManifest[path]?.sha256
    ));
    for (const path of changedFiles) {
      const sourceFile = resolve(project.sourcePath, ...path.split("/"));
      const workcopyFile = resolve(project.workcopyPath, ...path.split("/"));
      await mkdir(dirname(sourceFile), { recursive: true });
      await copyFile(workcopyFile, sourceFile);
      if (await fileHashGet(sourceFile) !== before.workcopyManifest[path]!.sha256) {
        throw new Error(`回迁后文件校验失败：${sourceFile}`);
      }
    }
    for (const path of deletePaths) {
      const sourceFile = resolve(project.sourcePath, ...path.split("/"));
      await rm(sourceFile, { force: true });
      if (await pathExists(sourceFile)) throw new Error(`删除验证失败：${sourceFile}`);
    }
    const pendingDeletes = before.workcopyChanges.deleted.filter(path => (
      !deletePaths.has(path) && before.sourceManifest[path]
    ));
    currentProject = {
      ...currentProject,
      baseline: pendingDeletes.length === 0
        ? before.workcopyManifest
        : currentProject.baseline,
      phase: pendingDeletes.length === 0 ? "synced" : "developing",
      updatedAt: new Date().toISOString(),
    };
    store.getState().workcopyActions.projectSet(currentProject);
    return (await projectInspect(currentProject)).project;
  } catch (error) {
    currentProject = {
      ...currentProject,
      lastError: {
        at: new Date().toISOString(),
        detail: errorDetailGet(error),
      },
      updatedAt: new Date().toISOString(),
    };
    store.getState().workcopyActions.projectSet(currentProject);
    throw new Error(`工作副本回迁失败：${project.workcopyPath}`, { cause: error });
  }
};

const workcopy = new Register({
  namespace: "workcopy",
  description: "管理机械盘项目与 SSD 工作副本之间的创建、状态和归还。",
})
  .register(
    "/create",
    new Hono().post("/", zValidator("json", createSchema), async context => (
      context.json(await projectCreate(context.req.valid("json")))
    )),
    createSchema,
    "仅在方先生明确授权把一个大量读写项目复制到 SSD 工作区后调用；必填原项目绝对 sourcePath。成功在 D:\\ssdpro\\<项目名> 创建已校验工作副本，排除依赖、构建物、缓存和日志，并把原路径、工作副本、阶段、基线和错误持久化到唯一主仓库。目标已存在但没有账本时停止，不覆盖、不移动或删除原项目。",
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  )
  .register(
    "/status",
    new Hono().get("/", zValidator("query", statusSchema), async context => (
      context.json(await projectStatusGet(context.req.valid("query")))
    )),
    statusSchema,
    "检查 SSD 工作副本账本和实时文件差异。sourcePath 可选；提供时返回该项目的原路径、工作副本、记录阶段、实时阶段、存在状态、待回迁文件、双方独立变化和冲突；省略时检查并返回全部登记项目。只读取主仓库和文件，不修改项目或账本。",
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  )
  .register(
    "/sync",
    new Hono().post("/", zValidator("json", syncSchema), async context => (
      context.json(await projectSync(context.req.valid("json")))
    )),
    syncSchema,
    "仅在工作副本已经完成真实验收且方先生授权回迁后调用；必填原项目绝对 sourcePath。把工作副本新增和修改的源码写回原路径，逐文件校验，并持久化同步阶段；双方同时修改同一文件时停止。默认不删除原项目文件，只有方先生明确授权的工作副本删除项才逐项写入 deletePaths。不会删除 SSD 工作副本。",
    {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  );

export default workcopy;
