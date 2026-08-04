export type AiRuntime = {
  id: number;
  projectIds: number[];
  workspacePath: string;
};

export type Store = {
  aiRuntime: {
    idNext: number;
    sessions: Record<string, AiRuntime>;
  };
  aiRuntimeActions: {
    list(): AiRuntime[];
    sessionClose(sessionId: string): void;
    sessionGet(sessionId: string): AiRuntime;
    workspaceSet(options: {
      projectId: number;
      sessionId: string;
      workspacePath: string;
    }): AiRuntime;
  };
  mcpError: {
    entries: Array<{
      at: string;
      detail: string;
      method: string;
      path: string;
    }>;
  };
  mcpErrorActions: {
    errorAdd(error: Store["mcpError"]["entries"][number]): void;
  };
  workcopy: {
    projects: Record<string, {
      baseline: Record<string, {
        sha256: string;
        size: number;
      }>;
      createdAt: string;
      lastError?: {
        at: string;
        detail: string;
      };
      phase: "creating" | "developing" | "syncing" | "synced";
      sourceKey: string;
      sourcePath: string;
      updatedAt: string;
      workcopyPath: string;
    }>;
  };
  workcopyActions: {
    projectSet(project: Store["workcopy"]["projects"][string]): void;
  };
};
