import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  createBranch,
  commitAll,
  revertToCommit,
  getHeadSha,
  isWorkingTreeClean,
  savePatch,
  GitError,
} from "@/lib/git.js";

function git(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  return (result.stdout ?? "").trim();
}

describe("git utilities", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "auto-evolve-git-test-"));
    git(["init", "-b", "main"], cwd);
    git(["config", "user.email", "test@test.com"], cwd);
    git(["config", "user.name", "Test"], cwd);
    git(["config", "commit.gpgsign", "false"], cwd);
    await writeFile(join(cwd, "file.txt"), "initial");
    git(["add", "."], cwd);
    git(["commit", "-m", "initial commit"], cwd);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("createBranch creates and switches to new branch", async () => {
    createBranch("feature/test", cwd);
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    expect(branch).toBe("feature/test");
  });

  it("getHeadSha returns short commit hash", async () => {
    const sha = await getHeadSha(cwd);
    expect(sha).toMatch(/^[a-f0-9]{7,}$/);
  });

  it("isWorkingTreeClean returns true when clean", async () => {
    expect(await isWorkingTreeClean(cwd)).toBe(true);
  });

  it("isWorkingTreeClean returns false when dirty", async () => {
    await writeFile(join(cwd, "dirty.txt"), "dirty");
    expect(await isWorkingTreeClean(cwd)).toBe(false);
  });

  it("commitAll stages and commits all changes", async () => {
    await writeFile(join(cwd, "new.txt"), "new content");
    const sha = await commitAll("add new file", cwd);
    expect(sha).toMatch(/^[a-f0-9]{7,}$/);
    expect(await isWorkingTreeClean(cwd)).toBe(true);
    const log = git(["log", "--oneline", "-1"], cwd);
    expect(log).toContain("add new file");
  });

  it("revertToCommit resets to given commit", async () => {
    const beforeSha = await getHeadSha(cwd);
    await writeFile(join(cwd, "extra.txt"), "extra");
    await commitAll("extra commit", cwd);
    await revertToCommit(beforeSha, cwd);
    const afterSha = await getHeadSha(cwd);
    expect(afterSha).toBe(beforeSha);
  });

  it("savePatch writes diff to file", async () => {
    const beforeSha = await getHeadSha(cwd);
    await writeFile(join(cwd, "file.txt"), "modified");
    await commitAll("modify file", cwd);
    const patchPath = join(cwd, "test.patch");
    await savePatch(beforeSha, patchPath, cwd);
    const patch = await readFile(patchPath, "utf-8");
    expect(patch).toContain("modified");
  });

  it("throws GitError on invalid operations", () => {
    expect(() => createBranch("main", cwd)).toThrow(GitError);
  });
});
