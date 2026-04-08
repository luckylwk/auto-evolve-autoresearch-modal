/**
 * Unified persistence layer for all auto-evolve state files.
 *
 * Merges baseline/best snapshots, experiment history (JSONL), and hypothesis batch management
 * into a single module. All paths are relative to the project root (cwd).
 */
import { readFile, writeFile, appendFile } from "fs/promises";
import { join } from "path";
import {
  MetricSnapshot,
  type MetricSnapshot as MetricSnapshotType,
  ExperimentEntry,
  type ExperimentEntry as ExperimentEntryType,
  HypothesesFile,
  type HypothesesFile as HypothesesFileType,
  type Hypothesis as HypothesisType,
  type HypothesisStatus,
} from "@/lib/schemas.js";

// --- Path constants ---

export const DEFAULT_STATE_DIR = ".auto-evolve";
export let STATE_DIR = DEFAULT_STATE_DIR;
export const EXPERIMENTS_DIR = "experiments";
export const RESULTS_TSV = "results.tsv";
export const RESULTS_MD = "results.md";
export const PROGRAM_MD = "program.md";
export const RUN_LOG = "run.log";

/** Derived paths — always use these instead of hardcoding the state dir. */
export function configFile(): string {
  return `${STATE_DIR}/config.json`;
}
export function historyFile(): string {
  return `${STATE_DIR}/history.jsonl`;
}
export function hypothesesFile(): string {
  return `${STATE_DIR}/hypotheses.json`;
}
export function baselineFile(): string {
  return `${STATE_DIR}/baseline.json`;
}
export function bestFile(): string {
  return `${STATE_DIR}/best.json`;
}
export function llmCallsDir(): string {
  return `${STATE_DIR}/llm-calls`;
}

/** Override the state directory (e.g. from config or CLI flag). */
export function setStateDir(dir: string): void {
  STATE_DIR = dir;
}

/** Lines appended to .gitignore by `auto-evolve init`. */
export function gitignoreEntries(): string[] {
  return ["# auto-evolve", `${STATE_DIR}/`, "experiments/", "results.md", "results.tsv", "run.log"];
}

// --- Metric Snapshots (baseline.json, best.json) ---

async function readSnapshot(
  relativePath: string,
  cwd?: string,
): Promise<MetricSnapshotType | null> {
  try {
    const content = await readFile(join(cwd ?? process.cwd(), relativePath), "utf-8");
    return MetricSnapshot.parse(JSON.parse(content));
  } catch {
    return null;
  }
}

async function writeSnapshot(
  relativePath: string,
  snapshot: MetricSnapshotType,
  cwd?: string,
): Promise<void> {
  const validated = MetricSnapshot.parse(snapshot);
  await writeFile(
    join(cwd ?? process.cwd(), relativePath),
    JSON.stringify(validated, null, 2) + "\n",
  );
}

export async function readBaseline(cwd?: string): Promise<MetricSnapshotType | null> {
  return readSnapshot(baselineFile(), cwd);
}

export async function writeBaseline(snapshot: MetricSnapshotType, cwd?: string): Promise<void> {
  return writeSnapshot(baselineFile(), snapshot, cwd);
}

export async function readBest(cwd?: string): Promise<MetricSnapshotType | null> {
  return readSnapshot(bestFile(), cwd);
}

export async function writeBest(snapshot: MetricSnapshotType, cwd?: string): Promise<void> {
  return writeSnapshot(bestFile(), snapshot, cwd);
}

// --- Experiment History ---

function historyPath(cwd?: string): string {
  return join(cwd ?? process.cwd(), historyFile());
}

export async function appendExperiment(entry: ExperimentEntryType, cwd?: string): Promise<void> {
  const validated = ExperimentEntry.parse(entry);
  await appendFile(historyPath(cwd), JSON.stringify(validated) + "\n");
}

export async function readHistory(cwd?: string): Promise<ExperimentEntryType[]> {
  let content: string;
  try {
    content = await readFile(historyPath(cwd), "utf-8");
  } catch {
    return [];
  }

  const entries: ExperimentEntryType[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(ExperimentEntry.parse(JSON.parse(trimmed)));
    } catch {
      // Skip malformed lines — append-only file may have partial writes
    }
  }
  return entries;
}

export async function getLastN(n: number, cwd?: string): Promise<ExperimentEntryType[]> {
  const history = await readHistory(cwd);
  return history.slice(-n);
}

// --- Hypotheses ---

function hypothesesPath(cwd?: string): string {
  return join(cwd ?? process.cwd(), hypothesesFile());
}

export async function readHypotheses(cwd?: string): Promise<HypothesesFileType | null> {
  let content: string;
  try {
    content = await readFile(hypothesesPath(cwd), "utf-8");
  } catch {
    return null;
  }

  try {
    return HypothesesFile.parse(JSON.parse(content));
  } catch (err) {
    console.warn(`Warning: invalid hypotheses.json: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export async function writeHypotheses(file: HypothesesFileType, cwd?: string): Promise<void> {
  const validated = HypothesesFile.parse(file);
  await writeFile(hypothesesPath(cwd), JSON.stringify(validated, null, 2) + "\n");
}

export async function updateHypothesisStatus(
  id: string,
  status: HypothesisStatus,
  cwd?: string,
): Promise<void> {
  const file = await readHypotheses(cwd);
  if (!file) throw new Error("No hypotheses.json found");

  const hypothesis = file.hypotheses.find((h) => h.id === id);
  if (!hypothesis) throw new Error(`Hypothesis '${id}' not found`);

  hypothesis.status = status;
  await writeHypotheses(file, cwd);
}

/** Return the highest-priority pending hypothesis, or null if none remain. */
export async function getNextPending(cwd?: string): Promise<HypothesisType | null> {
  const file = await readHypotheses(cwd);
  if (!file) return null;

  const pending = file.hypotheses
    .filter((h) => h.status === "pending")
    .sort((a, b) => b.priority - a.priority);

  return pending[0] ?? null;
}
