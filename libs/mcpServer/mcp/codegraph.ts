import PublicMcp from "../public";

export default function codegraphRegister(core: PublicMcp): void {
  core.npmMcp({
    packageSpec: "@colbymchenry/codegraph@1.4.1",
    args: ["serve", "--mcp"],
  });
}
