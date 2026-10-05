import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PROJECT_ROOT =
  process.env.AWX_PROJECT_ROOT ?? resolve(process.cwd(), "..");

export async function runWebRunner(args: string[]): Promise<string> {
  const tsxBin = join(PROJECT_ROOT, "node_modules", ".bin", "tsx");
  const { stdout } = await execFileAsync(tsxBin, ["src/web-runner.ts", ...args], {
    cwd: PROJECT_ROOT,
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}
