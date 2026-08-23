import { execFile } from "node:child_process";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
import { z } from "zod";

const packageManifestValidator = z.object({
  dependencies: z.record(z.string(), z.unknown()).optional(),
  peerDependencies: z.record(z.string(), z.unknown()).optional(),
  devDependencies: z.record(z.string(), z.unknown()).optional(),
  optionalDependencies: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
const projectPathValidator = z.string().trim().min(1);
const projectReadValidator = z.object({ projectPath: projectPathValidator.describe("Absolute path to one concrete Hono Vite package") });
const dependenciesInstallValidator = z.object({ projectPath: projectPathValidator }).strict();
const importRoleValidator = z.enum(["honoReact2", "honoServer", "honoUrl"]);
const importsEnsureValidator = z.object({ projectPath: projectPathValidator, sourceFilePath: z.string().trim().min(1), role: importRoleValidator }).strict();
const identifierValidator = z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, "identifier must be a valid JavaScript identifier");
const rendererNameValidator = z.string().regex(/^[A-Za-z0-9._~-]+$/, "rendererName must be one URL path segment");
const entryPathValidator = z.string().regex(/^\.\S*\/index\.(?:ts|tsx)$/, "paths must be relative index.ts or index.tsx files");
const defineValidator = z.record(z.string(), z.json()).optional();
const honoReact2Validator = z.object({
  port: z.tuple([z.number().int().min(1).max(65_535), z.number().int().min(1).max(65_535)]).refine(([a, b]) => a !== b, "businessPort and developmentHonoPort must be different"),
  honoPath: entryPathValidator,
  rendererPaths: z.array(entryPathValidator).min(1),
  external: z.array(z.string().trim().min(1)).default([]),
  honoDefine: defineValidator,
  rendererDefine: defineValidator,
}).strict();
const honoServerValidator = z.object({ routerIdentifier: identifierValidator }).strict();
const honoUrlValidator = z.object({ rendererName: rendererNameValidator }).strict();
const packageName = "vite-config-lib";
const dependencyPatch = {
  dependencies: { "@hono/node-server": "^1.19.11", hono: "4.12.30", [packageName]: "workspace:*" },
  devDependencies: { "@vitejs/plugin-react": "^5.1.1", vite: "^8.0.11" },
} as const;
const importsByRole = {
  honoReact2: [`import honoReact2 from "${packageName}/plugin2";`],
  honoServer: [`import { honoServer } from "${packageName}/hono";`],
  honoUrl: [`import { honoUrl } from "${packageName}/hono";`],
} as const;
const requiredProjectFiles = ["package.json", "AGENTS.md", "vite.config.ts", "hono/index.ts", "hono/routers.ts", "hono/store.ts", "renderer/index.tsx", "renderer/routers.tsx", "renderer/store.ts"] as const;
const publicImports = ["vite-config-lib/plugin2", "vite-config-lib/hono"] as const;
const dependencySections = ["dependencies", "peerDependencies", "devDependencies", "optionalDependencies"] as const;
const readmePath = await realpath(createRequire(import.meta.url).resolve("vite-config-lib/README.md"));
const readmeUri = pathToFileURL(readmePath).href;

type ProjectReadErrorCode = "PROJECT_PATH_NOT_ABSOLUTE" | "PROJECT_DIRECTORY_NOT_FOUND" | "PROJECT_PATH_NOT_DIRECTORY" | "PROJECT_PATH_UNREADABLE" | "PNPM_WORKSPACE_ROOT_NOT_ALLOWED" | "REQUIRED_FILE_MISSING" | "REQUIRED_PATH_NOT_FILE" | "REQUIRED_FILE_UNREADABLE" | "PACKAGE_JSON_INVALID" | "DEPENDENCY_REQUIRED";
class ProjectReadError extends Error {
  constructor(readonly code: ProjectReadErrorCode, message: string, readonly path?: string) { super(message); this.name = "ProjectReadError"; }
}
type ActionResult<T extends object> = { body: T; status?: 400 };
const isMissingPathError = (error: unknown): boolean => typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
const assertProjectDirectory = async (directoryPath: string): Promise<void> => {
  try {
    const directoryStat = await stat(directoryPath);
    if (!directoryStat.isDirectory()) throw new ProjectReadError("PROJECT_PATH_NOT_DIRECTORY", `projectPath must identify a directory: ${directoryPath}`, directoryPath);
  } catch (error) {
    if (error instanceof ProjectReadError) throw error;
    if (isMissingPathError(error)) throw new ProjectReadError("PROJECT_DIRECTORY_NOT_FOUND", `Project directory does not exist: ${directoryPath}`, directoryPath);
    throw new ProjectReadError("PROJECT_PATH_UNREADABLE", `Project directory cannot be read: ${directoryPath}`, directoryPath);
  }
};
const assertRequiredFile = async (filePath: string, projectRelativePath: string): Promise<void> => {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new ProjectReadError("REQUIRED_PATH_NOT_FILE", `Required project path is not a file: ${projectRelativePath}`, filePath);
  } catch (error) {
    if (error instanceof ProjectReadError) throw error;
    if (isMissingPathError(error)) throw new ProjectReadError("REQUIRED_FILE_MISSING", `Required project file is missing: ${projectRelativePath}`, filePath);
    throw new ProjectReadError("REQUIRED_FILE_UNREADABLE", `Required project file cannot be read: ${projectRelativePath}`, filePath);
  }
};
const pathExists = async (path: string): Promise<boolean> => {
  try { await stat(path); return true; } catch (error) {
    if (isMissingPathError(error)) return false;
    throw new ProjectReadError("PROJECT_PATH_UNREADABLE", `Project path cannot be inspected: ${path}`, path);
  }
};
const projectResolve = async (projectPathInput: string): Promise<string> => {
  if (!isAbsolute(projectPathInput)) throw new Error(`projectPath must be absolute: ${projectPathInput}`);
  const projectPath = await realpath(resolve(projectPathInput));
  await assertProjectDirectory(projectPath);
  if (await pathExists(join(projectPath, "pnpm-workspace.yaml"))) throw new Error(`projectPath must identify a concrete package, not a pnpm workspace root: ${projectPath}`);
  await assertRequiredFile(join(projectPath, "package.json"), "package.json");
  return projectPath;
};
const packageRead = async (packageJsonPath: string) => packageManifestValidator.parse(JSON.parse((await readFile(packageJsonPath, "utf8")).replace(/^\uFEFF/, "")));
const pnpmInstall = async (projectPath: string): Promise<void> => new Promise((resolvePromise, rejectPromise) => {
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "pnpm", "install"] : ["install"];
  execFile(executable, args, { cwd: projectPath, encoding: "utf8", maxBuffer: 5 * 1024 * 1024, timeout: 120_000, windowsHide: true }, error => error ? rejectPromise(new Error(`pnpm install failed: ${error.message}`)) : resolvePromise());
});
const sourceInsideProject = (projectPath: string, sourceFilePath: string): boolean => {
  const value = relative(projectPath, sourceFilePath);
  return value.length > 0 && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
};
const importsEnsure = async (sourceFilePath: string, statements: readonly string[]): Promise<string[]> => {
  const original = await readFile(sourceFilePath, "utf8");
  const missing = statements.filter(statement => !original.includes(statement));
  if (!missing.length) return [];
  const bom = original.startsWith("\uFEFF") ? "\uFEFF" : "";
  const source = bom ? original.slice(1) : original;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const shebangEnd = source.startsWith("#!") ? source.indexOf("\n") + 1 : 0;
  await writeFile(sourceFilePath, `${bom}${source.slice(0, shebangEnd)}${missing.join(newline)}${newline}${source.slice(shebangEnd)}`, "utf8");
  return [...missing];
};

type ViteConfigSlice = {
  viteConfigActions: {
    dependenciesInstall(input: z.output<typeof dependenciesInstallValidator>): Promise<ActionResult<Record<string, unknown>>>;
    honoReact2(input: z.output<typeof honoReact2Validator>): { packageName: string; import: string; call: string; config: { plugins: string[] }; options: { hono: { path: string; port: [number, number]; external?: string[]; define?: Record<string, unknown> }; renderer: { paths: string[]; define?: Record<string, unknown> } }; next: string };
    honoServer(input: z.output<typeof honoServerValidator>): { packageName: string; import: string; call: string; routerIdentifier: string; next: string };
    honoUrl(input: z.output<typeof honoUrlValidator>): { packageName: string; import: string; call: string; rendererName: string; next: string };
    importsEnsure(input: z.output<typeof importsEnsureValidator>): Promise<ActionResult<Record<string, unknown>>>;
    projectRead(input: z.output<typeof projectReadValidator>): Promise<ActionResult<Record<string, unknown>>>;
    readme(uri?: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }>;
  };
};

const s: ImmerStateCreator<ViteConfigSlice> = () => ({
  viteConfigActions: {
    async dependenciesInstall(input) {
      try {
        const projectPath = await projectResolve(dependenciesInstallValidator.parse(input).projectPath);
        const packageJsonPath = join(projectPath, "package.json");
        const packageJson = await packageRead(packageJsonPath);
        const next = { ...packageJson, dependencies: { ...(packageJson.dependencies ?? {}), ...dependencyPatch.dependencies }, devDependencies: { ...(packageJson.devDependencies ?? {}), ...dependencyPatch.devDependencies } };
        const changed = JSON.stringify(next) !== JSON.stringify(packageJson);
        if (changed) await writeFile(packageJsonPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
        await pnpmInstall(projectPath);
        return { body: { changed, installed: dependencyPatch, packageJsonPath, projectPath } };
      } catch (error) { return { body: { error: errorMessage(error) }, status: 400 }; }
    },
    honoReact2(input) {
      const value = honoReact2Validator.parse(input);
      const options = { hono: { path: value.honoPath, port: value.port, ...(value.external.length ? { external: value.external } : {}), ...(value.honoDefine === undefined ? {} : { define: value.honoDefine }) }, renderer: { paths: value.rendererPaths, ...(value.rendererDefine === undefined ? {} : { define: value.rendererDefine }) } };
      const call = `honoReact2(${JSON.stringify(options, null, 2)})`;
      return { packageName, import: `import honoReact2 from "${packageName}/plugin2";`, call, config: { plugins: [call] }, options, next: "Read the hono.readme resource before changing the generated Vite configuration." };
    },
    honoServer(input) {
      const { routerIdentifier } = honoServerValidator.parse(input);
      return { packageName, import: `import { honoServer } from "${packageName}/hono";`, call: `const server = honoServer(${routerIdentifier});`, routerIdentifier, next: "HONOREACT_HOST and HONOREACT_PORT are supplied by honoReact2; do not create a second listener." };
    },
    honoUrl(input) {
      const { rendererName } = honoUrlValidator.parse(input);
      return { packageName, import: `import { honoUrl } from "${packageName}/hono";`, call: `honoUrl(${JSON.stringify(rendererName)})`, rendererName, next: "Do not manually compose development or production renderer URLs." };
    },
    async importsEnsure(input) {
      try {
        const value = importsEnsureValidator.parse(input);
        const projectPath = await projectResolve(value.projectPath);
        if (!isAbsolute(value.sourceFilePath)) throw new Error(`sourceFilePath must be absolute: ${value.sourceFilePath}`);
        const sourceFilePath = await realpath(resolve(value.sourceFilePath));
        if (!sourceInsideProject(projectPath, sourceFilePath)) throw new Error(`sourceFilePath must resolve inside projectPath: ${sourceFilePath}`);
        if (!(await stat(sourceFilePath)).isFile() || ![".ts", ".tsx"].includes(extname(sourceFilePath).toLowerCase())) throw new Error(`sourceFilePath must be an existing .ts or .tsx file: ${sourceFilePath}`);
        if (sourceFilePath.toLowerCase().endsWith(".d.ts")) throw new Error(`Declaration files are not supported: ${sourceFilePath}`);
        return { body: { added: await importsEnsure(sourceFilePath, importsByRole[value.role]), projectPath, role: value.role, sourceFilePath } };
      } catch (error) { return { body: { error: errorMessage(error) }, status: 400 }; }
    },
    async projectRead(input) {
      const { projectPath } = projectReadValidator.parse(input);
      try {
        if (!isAbsolute(projectPath)) throw new ProjectReadError("PROJECT_PATH_NOT_ABSOLUTE", `projectPath must be absolute: ${projectPath}`, projectPath);
        const resolvedProjectPath = resolve(projectPath);
        await assertProjectDirectory(resolvedProjectPath);
        const realProjectPath = await realpath(resolvedProjectPath);
        const workspaceManifestPath = join(realProjectPath, "pnpm-workspace.yaml");
        if (await pathExists(workspaceManifestPath)) throw new ProjectReadError("PNPM_WORKSPACE_ROOT_NOT_ALLOWED", `projectPath must identify a concrete package, not a pnpm workspace root: ${realProjectPath}`, workspaceManifestPath);
        for (const projectRelativePath of requiredProjectFiles) await assertRequiredFile(join(realProjectPath, projectRelativePath), projectRelativePath);
        const packageJsonPath = join(realProjectPath, "package.json");
        let packageJsonValue: unknown;
        try { packageJsonValue = JSON.parse((await readFile(packageJsonPath, "utf8")).replace(/^\uFEFF/, "")); } catch (error) { throw new ProjectReadError("PACKAGE_JSON_INVALID", error instanceof SyntaxError ? `package.json contains invalid JSON: ${packageJsonPath}` : `package.json cannot be read: ${packageJsonPath}`, packageJsonPath); }
        const packageManifestResult = packageManifestValidator.safeParse(packageJsonValue);
        if (!packageManifestResult.success) throw new ProjectReadError("PACKAGE_JSON_INVALID", `package.json dependency sections must be objects: ${packageJsonPath}`, packageJsonPath);
        const dependencySource = dependencySections.find(sectionName => Object.prototype.hasOwnProperty.call(packageManifestResult.data[sectionName] ?? {}, "vite-config-lib"));
        if (dependencySource === undefined) throw new ProjectReadError("DEPENDENCY_REQUIRED", "The concrete package must declare vite-config-lib in dependencies, peerDependencies, devDependencies, or optionalDependencies.", packageJsonPath);
        const conventionPath = join(realProjectPath, "AGENTS.md");
        const viteConfigPath = join(realProjectPath, "vite.config.ts");
        return { body: { projectPath: realProjectPath, conventionPath, conventionUri: pathToFileURL(conventionPath).href, viteConfigPath, dependencySource, blackboxResourceName: "hono.readme", blackboxReadmePath: readmePath, blackboxReadmeUri: readmeUri, publicImports, instruction: `Read the project convention first: ${conventionPath}. Before changing vite-config-lib integration, read the hono.readme resource at ${readmeUri}. Use only the public imports vite-config-lib/plugin2 and vite-config-lib/hono.` } };
      } catch (error) {
        if (error instanceof ProjectReadError) return { body: { error: { code: error.code, message: error.message, ...(error.path === undefined ? {} : { path: error.path }) } }, status: 400 };
        return { body: { error: { code: "PROJECT_PATH_UNREADABLE", message: `Project context could not be read: ${projectPath}`, path: projectPath } }, status: 400 };
      }
    },
    async readme(uri) { return { contents: [{ uri: uri ?? readmeUri, mimeType: "text/markdown", text: await readFile(readmePath, "utf8") }] }; },
  },
});

export default s;
export { dependenciesInstallValidator, honoReact2Validator, honoServerValidator, honoUrlValidator, importsEnsureValidator, projectReadValidator, readmeUri };
