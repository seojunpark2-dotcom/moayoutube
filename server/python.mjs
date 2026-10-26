import { readFileSync, statSync } from "node:fs";
import path from "node:path";
export function pythonExecutable() {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  try {
    const configured = readFileSync(
      path.resolve(".tools/python-bin.txt"),
      "utf8",
    ).trim();
    if (path.isAbsolute(configured) && statSync(configured).isFile())
      return configured;
  } catch {}
  return "python";
}
