import { immer } from "zustand/middleware/immer";
import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
import { createStore } from "zustand/vanilla";
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

export const packageManifestValidator = z.object({
  dependencies: z.record(z.string(), z.unknown()).optional(),
  peerDependencies: z.record(z.string(), z.unknown()).optional(),
  devDependencies: z.record(z.string(), z.unknown()).optional(),
  optionalDependencies: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export type ProjectReadInput = z.output<typeof projectReadValidator>;
export type DependenciesInstallInput = z.output<typeof dependenciesInstallValidator>;
export type ImportsEnsureInput = z.output<typeof importsEnsureValidator>;
export type HonoReact2Input = z.output<typeof honoReact2Validator>;
export type HonoServerInput = z.output<typeof honoServerValidator>;
export type HonoUrlInput = z.output<typeof honoUrlValidator>;

type ViteConfigActions = {
  readme(uri?: string): Promise<unknown>;
  dependenciesInstall(input: DependenciesInstallInput): Promise<{
    body: unknown;
    status?: 400;
  }>;
  importsEnsure(input: ImportsEnsureInput): Promise<{
    body: unknown;
    status?: 400;
  }>;
  projectRead(input: ProjectReadInput): Promise<{
    body: unknown;
    status?: 400;
  }>;
  honoReact2(input: HonoReact2Input): unknown;
  honoServer(input: HonoServerInput): unknown;
  honoUrl(input: HonoUrlInput): unknown;
};

type Store = {
  viteConfigActions: ViteConfigActions;
};

const storeNotInitialized = (): never => {
  throw new Error("hono-vite-config store is not initialized");
};

const s: ImmerStateCreator<Store> = () => ({
  viteConfigActions: {
    readme: () => storeNotInitialized(),
    dependenciesInstall: () => storeNotInitialized(),
    importsEnsure: () => storeNotInitialized(),
    projectRead: () => storeNotInitialized(),
    honoReact2: () => storeNotInitialized(),
    honoServer: () => storeNotInitialized(),
    honoUrl: () => storeNotInitialized(),
  },
});

const store = createStore<Store>()(immer(s));

export default store;
