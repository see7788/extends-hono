export type AgentRuntime = {
  id: number;
  projectIds: number[];
  windowPath: string;
};

export type Store = {
  agentRuntime: {
    idNext: number;
    sessions: Record<string, AgentRuntime>;
  };
  agentRuntimeActions: {
    list(): AgentRuntime[];
    sessionClose(sessionId: string): void;
    sessionGet(sessionId: string): AgentRuntime;
    projectBind(options: {
      projectId: number;
      sessionId: string;
      windowPath: string;
    }): AgentRuntime;
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
