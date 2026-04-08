/**
 * Parser for program.md — the human-authored experiment definition.
 *
 * Splits markdown by ## headings (case-insensitive), strips HTML comments,
 * extracts structured fields, and validates against the ProgramConfig Zod schema.
 * Throws ParseError with actionable messages on invalid input.
 */
import { readFile } from "fs/promises";
import { join } from "path";
import { ProgramConfig, type ProgramConfig as ProgramConfigType } from "@/lib/schemas.js";
import { PROGRAM_MD } from "@/lib/store.js";

class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

type Sections = Record<string, string>;

/** Split markdown into a map of lowercase heading → body content. */
function extractSections(markdown: string): Sections {
  const sections: Sections = {};
  const lines = markdown.split("\n");
  let currentSection: string | null = null;
  const bodyLines: string[] = [];

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/i);
    if (heading) {
      if (currentSection) {
        sections[currentSection] = bodyLines.join("\n").trim();
      }
      currentSection = heading[1].trim().toLowerCase();
      bodyLines.length = 0;
    } else if (currentSection) {
      bodyLines.push(line);
    }
  }
  if (currentSection) {
    sections[currentSection] = bodyLines.join("\n").trim();
  }

  return sections;
}

function stripComments(text: string): string {
  return text.replace(/<!--.*?-->/gs, "").trim();
}

function parseFirstNonEmptyLine(body: string): string {
  const cleaned = stripComments(body);
  for (const line of cleaned.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function parseBulletList(body: string): string[] {
  const cleaned = stripComments(body);
  return cleaned
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line.length > 0);
}

/** Extract key-value pairs from `**Key**: value` markdown format. */
function parseMetricSection(body: string): {
  name: string;
  direction: string;
  extractCommand: string;
} {
  const cleaned = stripComments(body);
  const fields: Record<string, string> = {};

  for (const line of cleaned.split("\n")) {
    const match = line.match(/^\s*-?\s*\*\*(.+?)\*\*:\s*(.+)$/);
    if (match) {
      fields[match[1].trim().toLowerCase()] = match[2].trim();
    }
  }

  return {
    name: fields["name"] ?? "",
    direction: fields["direction"] ?? "",
    extractCommand: fields["extract command"] ?? "",
  };
}

function requireSection(sections: Sections, name: string): string {
  const body = sections[name.toLowerCase()];
  if (body === undefined) {
    throw new ParseError(`Missing required section: ## ${name}`);
  }
  return body;
}

/** Read and parse program.md from disk. Main entry point for commands. */
export async function parseProgram(cwd?: string): Promise<ProgramConfigType> {
  const programPath = join(cwd ?? process.cwd(), PROGRAM_MD);
  let content: string;
  try {
    content = await readFile(programPath, "utf-8");
  } catch {
    throw new ParseError(`Cannot read ${PROGRAM_MD}. Run 'auto-evolve init' first.`);
  }

  return parseProgramContent(content);
}

/** Parse program.md content string. Exported separately for testing. */
export function parseProgramContent(content: string): ProgramConfigType {
  const sections = extractSections(content);

  const objectiveBody = requireSection(sections, "Objective");
  const metricBody = requireSection(sections, "Metric");
  const evalBody = requireSection(sections, "Eval Command");
  const scopeBody = requireSection(sections, "Scope");

  const objective = parseFirstNonEmptyLine(objectiveBody);
  if (!objective) throw new ParseError("## Objective section is empty");

  const metric = parseMetricSection(metricBody);
  if (!metric.name) throw new ParseError("## Metric is missing **Name**");
  if (!metric.direction) throw new ParseError("## Metric is missing **Direction**");
  if (!metric.extractCommand) throw new ParseError("## Metric is missing **Extract command**");

  const evalCommand = parseFirstNonEmptyLine(evalBody);
  if (!evalCommand) throw new ParseError("## Eval Command section is empty");

  const scope = parseBulletList(scopeBody);
  if (scope.length === 0) throw new ParseError("## Scope must have at least one entry");

  const constraints = sections["constraints"] ? parseBulletList(sections["constraints"]) : [];
  const context = sections["context"] ? stripComments(sections["context"]) : "";

  let timeout = 300;
  if (sections["timeout"]) {
    const parsed = parseInt(parseFirstNonEmptyLine(sections["timeout"]), 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      throw new ParseError("## Timeout must be a positive integer");
    }
    timeout = parsed;
  }

  const result = ProgramConfig.safeParse({
    objective,
    metric: {
      name: metric.name,
      direction: metric.direction,
      extractCommand: metric.extractCommand,
    },
    evalCommand,
    scope,
    constraints,
    context,
    timeout,
  });

  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ParseError(`Validation error: ${issue.message} (at ${issue.path.join(".")})`);
  }

  return result.data;
}

export { ParseError };
