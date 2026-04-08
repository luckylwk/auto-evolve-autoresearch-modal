/**
 * Zod schemas for all auto-evolve state files.
 *
 * These schemas serve as both runtime validators and TypeScript type sources.
 * Every file read/written by auto-evolve is validated through one of these schemas.
 */
import { z } from "zod";

// --- Experiment History ---
// One JSON object per line. Append-only — never modify existing lines.

export const ExperimentStatus = z.enum(["baseline", "kept", "reverted", "crash", "timeout"]);
export type ExperimentStatus = z.infer<typeof ExperimentStatus>;

export const ExperimentEntry = z.object({
  id: z.string(),
  timestamp: z.string().datetime(),
  hypothesis: z.string(),
  title: z.string(),
  baselineMetric: z.number(),
  resultMetric: z.number().nullable(),
  delta: z.number().nullable(),
  status: ExperimentStatus,
  commitSha: z.string().nullable(),
  durationSeconds: z.number(),
  description: z.string(),
});
export type ExperimentEntry = z.infer<typeof ExperimentEntry>;

// --- Hypotheses ---
// Overwritten each batch. Individual hypothesis status updated in-place.

export const HypothesisStatus = z.enum(["pending", "in_progress", "success", "failed", "crash"]);
export type HypothesisStatus = z.infer<typeof HypothesisStatus>;

export const RiskLevel = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const ImpactLevel = z.enum(["small", "medium", "large"]);
export type ImpactLevel = z.infer<typeof ImpactLevel>;

export const Hypothesis = z.object({
  id: z.string(),
  title: z.string(),
  rationale: z.string(),
  risk: RiskLevel,
  expectedImpact: ImpactLevel,
  changes: z.string(),
  priority: z.number().int().min(1).max(10),
  status: HypothesisStatus,
});
export type Hypothesis = z.infer<typeof Hypothesis>;

export const HypothesesFile = z.object({
  batch: z.number().int(),
  generatedAt: z.string().datetime(),
  hypotheses: z.array(Hypothesis),
});
export type HypothesesFile = z.infer<typeof HypothesesFile>;

// --- Metric Snapshot ---
// baseline.json: written once by `auto-evolve baseline`, never modified.
// best.json: updated only when an experiment improves the metric.

export const MetricSnapshot = z.object({
  metric: z.number(),
  commit: z.string(),
  timestamp: z.string().datetime(),
});
export type MetricSnapshot = z.infer<typeof MetricSnapshot>;

// --- Program Config (parsed from program.md) ---
// The human-authored experiment definition. See program-parser.ts for parsing logic.

export const MetricDirection = z.enum(["lower_is_better", "higher_is_better"]);
export type MetricDirection = z.infer<typeof MetricDirection>;

export const ProgramConfig = z.object({
  objective: z.string().min(1),
  metric: z.object({
    name: z.string().min(1),
    direction: MetricDirection,
    extractCommand: z.string().min(1),
  }),
  evalCommand: z.string().min(1),
  scope: z.array(z.string()).min(1),
  constraints: z.array(z.string()).default([]),
  context: z.string().default(""),
  timeout: z.number().int().positive().default(300),
});
export type ProgramConfig = z.infer<typeof ProgramConfig>;

// --- Config (.auto-evolve/config.json) ---
// CLI configuration. All fields have defaults — Config.parse({}) gives a valid config.

export const Config = z.object({
  stateDir: z.string().default(".auto-evolve"),
  agentCommand: z.string().default("claude"),
  model: z.string().default("claude-sonnet-4-20250514"),
  maxHypothesesPerBatch: z.number().int().default(8),
  timeoutSeconds: z.number().int().default(300),
  branchPrefix: z.string().default("autoloop"),
  autoRehypothesizeEvery: z.number().int().default(5),
  maxConsecutiveFailures: z.number().int().default(10),
  simplicityBias: z.boolean().default(true),
  logLlmCalls: z.boolean().default(true),
});
export type Config = z.infer<typeof Config>;
