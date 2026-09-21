import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const directTargets = [
  "frontend/.next",
  "frontend/.turbo",
  "frontend/.cache",
  "backend/.pytest_cache",
  "backend/.ruff_cache",
  "backend/.mypy_cache",
  "backend/.pyright",
];

function remove(path) {
  if (!existsSync(path)) return;

  rmSync(path, {
    recursive: true,
    force: true,
  });

  console.log(`Removed: ${path}`);
}

function removePythonCaches(directory) {
  if (!existsSync(directory)) return;

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (!statSync(path).isDirectory()) continue;

    // Never walk into the virtual environment.
    if (entry === ".venv") continue;

    if (entry === "__pycache__") {
      remove(path);
      continue;
    }

    removePythonCaches(path);
  }
}

console.log("Cleaning development caches...\n");

for (const target of directTargets) {
  remove(join(root, target));
}

removePythonCaches(join(root, "backend"));

console.log("\nDevelopment caches cleaned.");
