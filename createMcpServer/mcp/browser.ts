import PublicMcp from "../public";

export default function browserRegister(core: PublicMcp): void {
  core.npmMcp({
    packageSpec: "chrome-devtools-mcp@1.6.0",
    args: ["--autoConnect", "--experimentalIncludeAllPages"],
    cache: "C:/Users/diyya/.codex/npm-cache",
  }).toolAdd({
    name: "environment.check",
    description: "Checks MCP environment capabilities and reports unresolved external issues.",
    call: async toolCall => {
      try {
        await toolCall("list_pages", {});
        return { content: [{ type: "text" as const, text: "[]" }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify([error instanceof Error ? error.message : String(error)]) }] };
      }
    },
  });
}
