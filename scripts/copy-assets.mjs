import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const sourceRoot = new URL("../src/", import.meta.url);
const destinationRoot = new URL("../dist/", import.meta.url);

for (const directory of ["prompts", "policies"]) {
  const source = new URL(`${directory}/`, sourceRoot);
  const destination = new URL(`${directory}/`, destinationRoot);
  await cp(fileURLToPath(source), fileURLToPath(destination), {
    recursive: true,
    filter: (entry) =>
      !entry.includes("node_modules") && !entry.endsWith(".ts"),
  });
}
