/**
 * Git state machine utilities.
 *
 * All experiment lifecycle git operations: branch, commit, revert, diff.
 * Uses node:child_process (not Bun.spawn) for vitest compatibility.
 * Throws GitError on any non-zero exit code.
 */
import { spawnSync } from "node:child_process";
import { writeFile } from "fs/promises";

class GitError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "GitError";
  }
}

function exec(args: string[], cwd?: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    throw new GitError(`git ${args[0]} failed: ${stderr}`, stderr);
  }
  return (result.stdout ?? "").trim();
}

export function createBranch(name: string, cwd?: string): void {
  exec(["checkout", "-b", name], cwd);
}

/** Stage all changes and commit. Returns the short SHA of the new commit. */
export function commitAll(message: string, cwd?: string): string {
  exec(["add", "-A"], cwd);
  exec(["commit", "-m", message], cwd);
  return exec(["rev-parse", "--short", "HEAD"], cwd);
}

/** Hard reset to a specific commit. Used to discard failed experiments. */
export function revertToCommit(sha: string, cwd?: string): void {
  exec(["reset", "--hard", sha], cwd);
}

export function getHeadSha(cwd?: string): string {
  return exec(["rev-parse", "--short", "HEAD"], cwd);
}

export function isWorkingTreeClean(cwd?: string): boolean {
  return exec(["status", "--porcelain"], cwd) === "";
}

/** Write `git diff fromSha..HEAD` to a file. Used to capture experiment diffs. */
export async function savePatch(fromSha: string, outPath: string, cwd?: string): Promise<void> {
  const diff = exec(["diff", fromSha, "HEAD"], cwd);
  await writeFile(outPath, diff);
}

export { GitError };
