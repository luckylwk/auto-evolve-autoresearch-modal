import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig, saveConfig, resolveConfig } from "@/lib/config.js";

describe("config", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "auto-evolve-config-test-"));
    await mkdir(join(cwd, ".auto-evolve"), { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    // Clean up env vars
    delete process.env.AUTOLOOP_MODEL;
    delete process.env.AUTOLOOP_TIMEOUT;
  });

  describe("loadConfig", () => {
    it("returns defaults when no config file exists", async () => {
      const config = await loadConfig(join(cwd, "nonexistent"));
      expect(config.model).toBe("claude-sonnet-4-20250514");
      expect(config.timeoutSeconds).toBe(300);
      expect(config.branchPrefix).toBe("autoloop");
    });

    it("reads and validates existing config", async () => {
      await writeFile(
        join(cwd, ".auto-evolve/config.json"),
        JSON.stringify({ model: "gpt-4o", timeoutSeconds: 120 }),
      );
      const config = await loadConfig(cwd);
      expect(config.model).toBe("gpt-4o");
      expect(config.timeoutSeconds).toBe(120);
      // Defaults still applied for unset fields
      expect(config.branchPrefix).toBe("autoloop");
    });
  });

  describe("saveConfig", () => {
    it("writes config to disk", async () => {
      const config = await loadConfig(cwd);
      config.model = "custom-model";
      await saveConfig(config, cwd);

      const reloaded = await loadConfig(cwd);
      expect(reloaded.model).toBe("custom-model");
    });
  });

  describe("resolveConfig", () => {
    it("applies env var overrides over file config", async () => {
      await writeFile(
        join(cwd, ".auto-evolve/config.json"),
        JSON.stringify({ model: "file-model", timeoutSeconds: 100 }),
      );
      process.env.AUTOLOOP_MODEL = "env-model";

      const config = await resolveConfig({}, cwd);
      expect(config.model).toBe("env-model");
      expect(config.timeoutSeconds).toBe(100);
    });

    it("applies CLI overrides over env vars", async () => {
      process.env.AUTOLOOP_MODEL = "env-model";

      const config = await resolveConfig({ model: "cli-model" }, cwd);
      expect(config.model).toBe("cli-model");
    });

    it("applies timeout from env var", async () => {
      process.env.AUTOLOOP_TIMEOUT = "60";

      const config = await resolveConfig({}, cwd);
      expect(config.timeoutSeconds).toBe(60);
    });

    it("ignores invalid env var values", async () => {
      process.env.AUTOLOOP_TIMEOUT = "not-a-number";

      const config = await resolveConfig({}, cwd);
      expect(config.timeoutSeconds).toBe(300); // default
    });
  });
});
