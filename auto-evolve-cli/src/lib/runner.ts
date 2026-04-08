/**
 * Eval command runner with timeout and metric extraction.
 *
 * Executes shell commands, captures output to run.log, and extracts
 * numeric metrics via a user-defined extract command.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { RUN_LOG } from "@/lib/store.js";

export interface RunResult {
  exitCode: number;
  durationSeconds: number;
  timedOut: boolean;
}

/**
 * Run a shell command, redirecting stdout+stderr to run.log.
 * Kills the process at 2x timeout. Returns exit code and duration.
 */
export function runEvalCommand(
  command: string,
  timeoutSeconds: number,
  cwd?: string,
): Promise<RunResult> {
  const resolvedCwd = cwd ?? process.cwd();
  const logPath = join(resolvedCwd, RUN_LOG);
  const logStream = createWriteStream(logPath);

  return new Promise((resolve) => {
    const startTime = Date.now();
    const hardTimeout = timeoutSeconds * 2 * 1000;

    const child = spawn("sh", ["-c", command], {
      cwd: resolvedCwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // Kill the entire process group so child processes are terminated
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, hardTimeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      const durationSeconds = Math.round((Date.now() - startTime) / 1000);
      // Wait for logStream to flush before resolving so run.log is complete
      logStream.end((err: Error | null | undefined) => {
        if (err) console.error(`Warning: failed to flush run.log: ${err.message}`);
        resolve({
          exitCode: code ?? 1,
          durationSeconds,
          timedOut,
        });
      });
    });
  });
}

const EXTRACT_TIMEOUT_MS = 30_000;

/**
 * Run the extract command against run.log and parse the numeric result.
 * Throws if the output is not a valid number. 30s timeout to prevent hangs.
 */
export async function extractMetric(extractCommand: string, cwd?: string): Promise<number> {
  const resolvedCwd = cwd ?? process.cwd();

  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", extractCommand], {
      cwd: resolvedCwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Extract command timed out after 30s"));
    }, EXTRACT_TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Extract command exited with code ${code}`));
        return;
      }
      const trimmed = stdout.trim();
      const value = parseFloat(trimmed);
      if (Number.isNaN(value)) {
        reject(new Error(`Extract command output is not a number: "${trimmed}"`));
        return;
      }
      resolve(value);
    });
  });
}

/** Read the last N lines of run.log for error reporting. */
export async function tailRunLog(n: number, cwd?: string): Promise<string> {
  const logPath = join(cwd ?? process.cwd(), RUN_LOG);
  try {
    const content = await readFile(logPath, "utf-8");
    return content.split("\n").slice(-n).join("\n");
  } catch {
    return "(no run.log found)";
  }
}
