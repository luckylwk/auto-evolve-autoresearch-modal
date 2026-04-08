/**
 * `auto-evolve config` — manage .auto-evolve/config.json.
 *
 * Subcommands: view, get, set, path.
 */
import { Command } from "commander";
import { join } from "path";
import { Config, type Config as ConfigType } from "@/lib/schemas.js";
import { loadConfig, saveConfig } from "@/lib/config.js";
import { configFile } from "@/lib/store.js";

const CONFIG_KEYS = Object.keys(Config.shape) as (keyof ConfigType)[];

function validateKey(key: string): keyof ConfigType {
  if (CONFIG_KEYS.includes(key as keyof ConfigType)) {
    return key as keyof ConfigType;
  }
  throw new Error(`Unknown config key "${key}". Valid keys: ${CONFIG_KEYS.join(", ")}`);
}

/** Coerce a string value to the correct type for a config key. */
function coerceValue(key: keyof ConfigType, value: string): unknown {
  const asNum = Number(value);
  if (!Number.isNaN(asNum) && typeof Config.parse({ [key]: asNum })[key] === "number") {
    return asNum;
  }
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

export function createConfigCommand(): Command {
  const configCommand = new Command("config")
    .description("Manage auto-evolve configuration")
    .action(() => {
      configCommand.help();
    });

  configCommand
    .command("view")
    .description("Print current resolved config as JSON")
    .action(async () => {
      const config = await loadConfig();
      console.log(JSON.stringify(config, null, 2));
    });

  configCommand
    .command("get")
    .description("Get a config value")
    .argument("<key>", `Config key (${CONFIG_KEYS.join(", ")})`)
    .action(async (key: string) => {
      const normalizedKey = validateKey(key);
      const config = await loadConfig();
      console.log(config[normalizedKey]);
    });

  configCommand
    .command("set")
    .description("Set a config value")
    .argument("<key>", `Config key (${CONFIG_KEYS.join(", ")})`)
    .argument("<value>", "Value to store")
    .action(async (key: string, value: string) => {
      const normalizedKey = validateKey(key);
      const config = await loadConfig();
      (config as Record<string, unknown>)[normalizedKey] = coerceValue(normalizedKey, value);
      await saveConfig(Config.parse(config));
      console.log(`Set ${normalizedKey} = ${value}`);
    });

  configCommand
    .command("path")
    .description("Print config file path")
    .action(() => {
      console.log(join(process.cwd(), configFile()));
    });

  return configCommand;
}
