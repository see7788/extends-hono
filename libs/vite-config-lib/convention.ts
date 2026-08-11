import { readFile } from "node:fs/promises";

const conventionRead = (): Promise<string> => readFile(
  new URL("./README.md", import.meta.url),
  "utf8",
);

export default conventionRead;
