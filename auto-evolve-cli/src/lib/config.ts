/**
 * Configuration loading with three-level precedence:
 * CLI flags > environment variables > .auto-evolve/config.json
 *
 * All fields have defaults via the Config Zod schema, so a missing
 * config file just returns defaults.
 */
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { Config, type Config as ConfigType } from "@/lib/schemas.js";
import { configFile, setStateDir } from "@/lib/store.js";

/** Environment variable → config key mapping. */
const ENV_MAP: Record<string, keyof ConfigType> = {
  AUTOLOOP_MODEL: "model",
  AUTOLOOP_TIMEOUT: "timeoutSeconds",
};

/** Load config from .auto-evolve/config.json, falling back to defaults. */
export async function loadConfig(cwd?: string): Promise<ConfigType> {
  const configPath = join(cwd ?? process.cwd(), configFile());
  try {
    const content = await readFile(configPath, "utf-8");
    const config = Config.parse(JSON.parse(content));
    // Apply stateDir from config so all path functions use it
    setStateDir(config.stateDir);
    return config;
  } catch {
    return Config.parse({});
  }
}

/** Save config to .auto-evolve/config.json. */
export async function saveConfig(config: ConfigType, cwd?: string): Promise<void> {
  const validated = Config.parse(config);
  const configPath = join(cwd ?? process.cwd(), configFile());
  await writeFile(configPath, JSON.stringify(validated, null, 2) + "\n");
}

/**
 * Resolve config with full precedence chain.
 * Merges: file config ← env vars ← explicit overrides (CLI flags).
 */
export async function resolveConfig(
  overrides: Partial<ConfigType> = {},
  cwd?: string,
): Promise<ConfigType> {
  const fileConfig = await loadConfig(cwd);

  // Apply env vars
  const envApplied = { ...fileConfig };
  for (const [envKey, configKey] of Object.entries(ENV_MAP)) {
    const envValue = process.env[envKey];
    if (envValue !== undefined) {
      if (configKey === "timeoutSeconds") {
        const parsed = parseInt(envValue, 10);
        if (!Number.isNaN(parsed)) envApplied[configKey] = parsed;
      } else {
        (envApplied as Record<string, unknown>)[configKey] = envValue;
      }
    }
  }

  // Apply CLI flag overrides (highest precedence)
  const merged = { ...envApplied, ...stripUndefined(overrides) };
  return Config.parse(merged);
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}
