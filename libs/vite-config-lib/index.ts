import { execFile } from "node:child_process";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

export const projectReadValidator = z.object({
  projectPath: z.string().trim().min(1).describe("一个具体 Hono Vite 包的绝对路径"),
}).strict();

export const dependenciesInstallValidator = projectReadValidator;

export const importsEnsureValidator = z.object({
  projectPath: z.string().trim().min(1),
  sourceFilePath: z.string().trim().min(1),
  role: z.enum(["honoReact2", "honoServer", "honoUrl"]),
}).strict();

export const honoReact2Validator = z.object({
  port: z.tuple([
    z.number().int().min(1).max(65_535),
    z.number().int().min(1).max(65_535),
  ]).refine(
    ([businessPort, developmentHonoPort]) => businessPort !== developmentHonoPort,
    "businessPort 与 developmentHonoPort 不能相同",
  ),
  honoPath: z.string().regex(
    /^\.\S*\/index\.(?:ts|tsx)$/,
    "paths 必须是相对的 index.ts 或 index.tsx 文件路径",
  ),
  rendererPaths: z.array(z.string().regex(
    /^\.\S*\/index\.(?:ts|tsx)$/,
    "paths 必须是相对的 index.ts 或 index.tsx 文件路径",
  )).min(1),
  external: z.array(z.string().trim().min(1)).default([]),
  honoDefine: z.record(z.string(), z.json()).optional(),
  rendererDefine: z.record(z.string(), z.json()).optional(),
}).strict();

export const honoServerValidator = z.object({
  routerIdentifier: z.string().regex(
    /^[A-Za-z_$][A-Za-z0-9_$]*$/,
    "identifier 必须是有效的 JavaScript 标识符",
  ),
}).strict();

export const honoUrlValidator = z.object({
  rendererName: z.string().regex(
    /^[A-Za-z0-9._~-]+$/,
    "rendererName 必须是单个 URL 路径段",
  ),
}).strict();

const packageManifestValidator = z.object({
  dependencies: z.record(z.string(), z.unknown()).optional(),
  peerDependencies: z.record(z.string(), z.unknown()).optional(),
  devDependencies: z.record(z.string(), z.unknown()).optional(),
  optionalDependencies: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const packageName = "vite-config-lib";
const dependencyPatch = {
  dependencies: {
    "@hono/node-server": "^1.19.11",
    hono: "4.12.30",
    [packageName]: "workspace:*",
  },
  devDependencies: {
    "@vitejs/plugin-react": "^5.1.1",
    vite: "^8.0.11",
  },
} as const;
const importsByRole = {
  honoReact2: [`import honoReact2 from "${packageName}/plugin2";`],
  honoServer: [`import { honoServer } from "${packageName}/hono";`],
  honoUrl: [`import { honoUrl } from "${packageName}/hono";`],
} as const;
const requiredProjectFiles = [
  "package.json",
  "AGENTS.md",
  "vite.config.ts",
  "hono/index.ts",
  "hono/routers.ts",
  "hono/store.ts",
  "renderer/index.tsx",
  "renderer/routers.tsx",
  "renderer/store.ts",
] as const;
const publicImports = ["vite-config-lib/plugin2", "vite-config-lib/hono"] as const;
const dependencySections = [
  "dependencies",
  "peerDependencies",
  "devDependencies",
  "optionalDependencies",
] as const;
const readmeUrl = new URL("./README.md", import.meta.url);
export const readmeUri = readmeUrl.href;
const readmePath = fileURLToPath(readmeUrl);

type ProjectReadErrorCode =
  | "PROJECT_PATH_NOT_ABSOLUTE"
  | "PROJECT_DIRECTORY_NOT_FOUND"
  | "PROJECT_PATH_NOT_DIRECTORY"
  | "PROJECT_PATH_UNREADABLE"
  | "PNPM_WORKSPACE_ROOT_NOT_ALLOWED"
  | "REQUIRED_FILE_MISSING"
  | "REQUIRED_PATH_NOT_FILE"
  | "REQUIRED_FILE_UNREADABLE"
  | "PACKAGE_JSON_INVALID"
  | "DEPENDENCY_REQUIRED";

class ProjectReadError extends Error {
  constructor(
    readonly code: ProjectReadErrorCode,
    message: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = "ProjectReadError";
  }
}

const isMissingPathError = (error: unknown): boolean =>
  typeof error === "object"
  && error !== null
  && "code" in error
  && (error as { code?: unknown }).code === "ENOENT";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const assertProjectDirectory = async (directoryPath: string): Promise<void> => {
  try {
    const directoryStat = await stat(directoryPath);
    if (!directoryStat.isDirectory()) {
      throw new ProjectReadError(
        "PROJECT_PATH_NOT_DIRECTORY",
        "projectPath must identify a directory: " + directoryPath,
        directoryPath,
      );
    }
  } catch (error) {
    if (error instanceof ProjectReadError) throw error;
    if (isMissingPathError(error)) {
      throw new ProjectReadError(
        "PROJECT_DIRECTORY_NOT_FOUND",
        "Project directory does not exist: " + directoryPath,
        directoryPath,
      );
    }
    throw new ProjectReadError(
      "PROJECT_PATH_UNREADABLE",
      "Project directory cannot be read: " + directoryPath,
      directoryPath,
    );
  }
};

const assertRequiredFile = async (
  filePath: string,
  projectRelativePath: string,
): Promise<void> => {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new ProjectReadError(
        "REQUIRED_PATH_NOT_FILE",
        "Required project path is not a file: " + projectRelativePath,
        filePath,
      );
    }
  } catch (error) {
    if (error instanceof ProjectReadError) throw error;
    if (isMissingPathError(error)) {
      throw new ProjectReadError(
        "REQUIRED_FILE_MISSING",
        "Required project file is missing: " + projectRelativePath,
        filePath,
      );
    }
    throw new ProjectReadError(
      "REQUIRED_FILE_UNREADABLE",
      "Required project file cannot be read: " + projectRelativePath,
      filePath,
    );
  }
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw new ProjectReadError(
      "PROJECT_PATH_UNREADABLE",
      "Project path cannot be inspected: " + path,
      path,
    );
  }
};

const projectResolve = async (projectPathInput: string): Promise<string> => {
  if (!isAbsolute(projectPathInput)) {
    throw new Error("projectPath 必须是绝对路径：" + projectPathInput);
  }
  const projectPath = await realpath(resolve(projectPathInput));
  await assertProjectDirectory(projectPath);
  if (await pathExists(join(projectPath, "pnpm-workspace.yaml"))) {
    throw new Error(
      "projectPath 必须指向具体包，不能指向 pnpm workspace 根：" + projectPath,
    );
  }
  await assertRequiredFile(join(projectPath, "package.json"), "package.json");
  return projectPath;
};

const packageRead = async (packageJsonPath: string) =>
  packageManifestValidator.parse(
    JSON.parse((await readFile(packageJsonPath, "utf8")).replace(/^\uFEFF/, "")),
  );

const pnpmInstall = async (projectPath: string): Promise<void> =>
  new Promise((resolvePromise, rejectPromise) => {
    const executable = process.platform === "win32"
      ? (process.env.ComSpec ?? "cmd.exe")
      : "pnpm";
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", "pnpm", "install"]
      : ["install"];
    execFile(
      executable,
      args,
      {
        cwd: projectPath,
        encoding: "utf8",
        maxBuffer: 5 * 1024 * 1024,
        timeout: 120_000,
        windowsHide: true,
      },
      error => error
        ? rejectPromise(new Error("pnpm install failed: " + error.message))
        : resolvePromise(),
    );
  });

const sourceInsideProject = (
  projectPath: string,
  sourceFilePath: string,
): boolean => {
  const value = relative(projectPath, sourceFilePath);
  return value.length > 0
    && value !== ".."
    && !value.startsWith(".." + sep)
    && !isAbsolute(value);
};

const ensureImports = async (
  sourceFilePath: string,
  statements: readonly string[],
): Promise<string[]> => {
  const original = await readFile(sourceFilePath, "utf8");
  const missing = statements.filter(statement => !original.includes(statement));
  if (!missing.length) return [];

  const bom = original.startsWith("\uFEFF") ? "\uFEFF" : "";
  const source = bom ? original.slice(1) : original;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const shebangEnd = source.startsWith("#!") ? source.indexOf("\n") + 1 : 0;
  await writeFile(
    sourceFilePath,
    bom
      + source.slice(0, shebangEnd)
      + missing.join(newline)
      + newline
      + source.slice(shebangEnd),
    "utf8",
  );
  return [...missing];
};

class ViteConfig {
  async readme(uri?: string): Promise<{
    contents: Array<{ uri: string; mimeType: string; text: string }>;
  }> {
    return {
      contents: [{
        uri: uri ?? readmeUri,
        mimeType: "text/markdown",
        text: await readFile(readmePath, "utf8"),
      }],
    };
  }

  async dependenciesInstall(
    input: z.infer<typeof dependenciesInstallValidator>,
  ) {
    try {
      const value = dependenciesInstallValidator.parse(input);
      const projectPath = await projectResolve(value.projectPath);
      const packageJsonPath = join(projectPath, "package.json");
      const packageJson = await packageRead(packageJsonPath);
      const next = {
        ...packageJson,
        dependencies: {
          ...(packageJson.dependencies ?? {}),
          ...dependencyPatch.dependencies,
        },
        devDependencies: {
          ...(packageJson.devDependencies ?? {}),
          ...dependencyPatch.devDependencies,
        },
      };
      const changed = JSON.stringify(next) !== JSON.stringify(packageJson);
      if (changed) {
        await writeFile(
          packageJsonPath,
          JSON.stringify(next, null, 2) + "\n",
          "utf8",
        );
      }
      await pnpmInstall(projectPath);
      return {
        body: {
          changed,
          installed: dependencyPatch,
          packageJsonPath,
          projectPath,
        },
      };
    } catch (error) {
      return { body: { error: errorMessage(error) }, status: 400 as const };
    }
  }

  async importsEnsure(input: z.infer<typeof importsEnsureValidator>) {
    try {
      const value = importsEnsureValidator.parse(input);
      const projectPath = await projectResolve(value.projectPath);
      if (!isAbsolute(value.sourceFilePath)) {
        throw new Error(
          "sourceFilePath 必须是绝对路径：" + value.sourceFilePath,
        );
      }
      const sourceFilePath = await realpath(resolve(value.sourceFilePath));
      if (!sourceInsideProject(projectPath, sourceFilePath)) {
        throw new Error(
          "sourceFilePath 必须位于 projectPath 内部：" + sourceFilePath,
        );
      }
      if (
        !(await stat(sourceFilePath)).isFile()
        || ![".ts", ".tsx"].includes(extname(sourceFilePath).toLowerCase())
      ) {
        throw new Error(
          "sourceFilePath 必须指向已经存在的 .ts 或 .tsx 文件：" + sourceFilePath,
        );
      }
      if (sourceFilePath.toLowerCase().endsWith(".d.ts")) {
        throw new Error("不支持修改声明文件：" + sourceFilePath);
      }
      return {
        body: {
          added: await ensureImports(sourceFilePath, importsByRole[value.role]),
          projectPath,
          role: value.role,
          sourceFilePath,
        },
      };
    } catch (error) {
      return { body: { error: errorMessage(error) }, status: 400 as const };
    }
  }

  async projectRead(input: z.infer<typeof projectReadValidator>) {
    const { projectPath } = projectReadValidator.parse(input);
    try {
      if (!isAbsolute(projectPath)) {
        throw new ProjectReadError(
          "PROJECT_PATH_NOT_ABSOLUTE",
          "projectPath must be absolute: " + projectPath,
          projectPath,
        );
      }
      const resolvedProjectPath = resolve(projectPath);
      await assertProjectDirectory(resolvedProjectPath);
      const realProjectPath = await realpath(resolvedProjectPath);
      const workspaceManifestPath = join(
        realProjectPath,
        "pnpm-workspace.yaml",
      );
      if (await pathExists(workspaceManifestPath)) {
        throw new ProjectReadError(
          "PNPM_WORKSPACE_ROOT_NOT_ALLOWED",
          "projectPath must identify a concrete package, not a pnpm workspace root: "
            + realProjectPath,
          workspaceManifestPath,
        );
      }
      for (const projectRelativePath of requiredProjectFiles) {
        await assertRequiredFile(
          join(realProjectPath, projectRelativePath),
          projectRelativePath,
        );
      }

      const packageJsonPath = join(realProjectPath, "package.json");
      let packageJsonValue: unknown;
      try {
        packageJsonValue = JSON.parse(
          (await readFile(packageJsonPath, "utf8")).replace(/^\uFEFF/, ""),
        );
      } catch (error) {
        throw new ProjectReadError(
          "PACKAGE_JSON_INVALID",
          error instanceof SyntaxError
            ? "package.json contains invalid JSON: " + packageJsonPath
            : "package.json cannot be read: " + packageJsonPath,
          packageJsonPath,
        );
      }
      const packageManifestResult =
        packageManifestValidator.safeParse(packageJsonValue);
      if (!packageManifestResult.success) {
        throw new ProjectReadError(
          "PACKAGE_JSON_INVALID",
          "package.json dependency sections must be objects: "
            + packageJsonPath,
          packageJsonPath,
        );
      }
      const dependencySource = dependencySections.find(sectionName =>
        Object.prototype.hasOwnProperty.call(
          packageManifestResult.data[sectionName] ?? {},
          "vite-config-lib",
        )
      );
      if (dependencySource === undefined) {
        throw new ProjectReadError(
          "DEPENDENCY_REQUIRED",
          "The concrete package must declare vite-config-lib in dependencies, peerDependencies, devDependencies, or optionalDependencies.",
          packageJsonPath,
        );
      }

      const conventionPath = join(realProjectPath, "AGENTS.md");
      const viteConfigPath = join(realProjectPath, "vite.config.ts");
      return {
        body: {
          projectPath: realProjectPath,
          conventionPath,
          conventionUri: pathToFileURL(conventionPath).href,
          viteConfigPath,
          dependencySource,
          blackboxResourceName: "hono.readme",
          blackboxReadmePath: readmePath,
          blackboxReadmeUri: readmeUri,
          publicImports,
          instruction: "请先阅读项目约定："
            + conventionPath
            + "。修改 vite-config-lib 集成前，请读取 "
            + readmeUri
            + " 处的 hono.readme 资源。仅使用公开导入 vite-config-lib/plugin2 和 vite-config-lib/hono。",
        },
      };
    } catch (error) {
      if (error instanceof ProjectReadError) {
        return {
          body: {
            error: {
              code: error.code,
              message: error.message,
              ...(error.path === undefined ? {} : { path: error.path }),
            },
          },
          status: 400 as const,
        };
      }
      return {
        body: {
          error: {
            code: "PROJECT_PATH_UNREADABLE" as const,
            message: "无法读取项目上下文：" + projectPath,
            path: projectPath,
          },
        },
        status: 400 as const,
      };
    }
  }

  honoReact2(input: z.infer<typeof honoReact2Validator>) {
    const value = honoReact2Validator.parse(input);
    const options = {
      hono: {
        path: value.honoPath,
        port: value.port,
        ...(value.external.length ? { external: value.external } : {}),
        ...(value.honoDefine === undefined ? {} : { define: value.honoDefine }),
      },
      renderer: {
        paths: value.rendererPaths,
        ...(value.rendererDefine === undefined
          ? {}
          : { define: value.rendererDefine }),
      },
    };
    const call = "honoReact2(" + JSON.stringify(options, null, 2) + ")";
    return {
      packageName,
      import: `import honoReact2 from "${packageName}/plugin2";`,
      call,
      config: { plugins: [call] },
      options,
      next: "修改生成的 Vite 配置前，请先读取 hono.readme 资源。",
    };
  }

  honoServer(input: z.infer<typeof honoServerValidator>) {
    const { routerIdentifier } = honoServerValidator.parse(input);
    return {
      packageName,
      import: `import { honoServer } from "${packageName}/hono";`,
      call: "const server = honoServer(" + routerIdentifier + ");",
      routerIdentifier,
      next: "HONOREACT_HOST 和 HONOREACT_PORT 由 honoReact2 提供；请勿创建第二个监听器。",
    };
  }

  honoUrl(input: z.infer<typeof honoUrlValidator>) {
    const { rendererName } = honoUrlValidator.parse(input);
    return {
      packageName,
      import: `import { honoUrl } from "${packageName}/hono";`,
      call: "honoUrl(" + JSON.stringify(rendererName) + ")",
      rendererName,
      next: "请勿手动拼接开发环境或生产环境的渲染器 URL。",
    };
  }
}

export const viteConfig = new ViteConfig();
