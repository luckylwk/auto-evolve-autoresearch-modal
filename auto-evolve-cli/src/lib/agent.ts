/**
 * CLI agent executor — shells out to a coding agent (Claude Code, Codex, etc.)
 * with an assembled prompt. The agent modifies files in-place.
 */
import { spawn } from "node:child_process";

export interface AgentResult {
  exitCode: number;
  durationSeconds: number;
  timedOut: boolean;
}

/**
 * Run the coding agent CLI with the given prompt.
 * The agent modifies files in-place in the working directory.
 */
export function runAgent(
  prompt: string,
  agentCommand: string,
  timeoutSeconds: number,
  cwd?: string,
): Promise<AgentResult> {
  const resolvedCwd = cwd ?? process.cwd();

  return new Promise((resolve) => {
    const startTime = Date.now();

    const child = spawn(agentCommand, ["-p", prompt], {
      cwd: resolvedCwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // Kill the entire process group so child processes (e.g. shell scripts) are terminated
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutSeconds * 1000);

    child.on("close", (code) => {
      clearTimeout(timer);
      const durationSeconds = Math.round((Date.now() - startTime) / 1000);
      resolve({
        exitCode: code ?? 1,
        durationSeconds,
        timedOut,
      });
    });
  });
}
