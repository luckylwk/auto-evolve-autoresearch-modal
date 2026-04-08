import { describe, it, expect } from "vitest";
import { parseProgramContent, ParseError } from "@/lib/program-parser.js";

const VALID_PROGRAM = `# Program

## Objective
Minimize validation bits-per-byte for a 5-minute Shakespeare training run.

## Metric
- **Name**: val_bpb
- **Direction**: lower_is_better
- **Extract command**: grep "^val_bpb:" run.log | tail -1 | awk '{print $2}'

## Eval Command
uv run train.py

## Scope
- train.py
- configs/*.yaml

## Constraints
- Do not modify prepare.py
- Do not install new packages

## Context
Model is a small GPT-2 variant (~10M params).

## Timeout
120
`;

describe("parseProgramContent", () => {
  it("parses a valid program.md", () => {
    const config = parseProgramContent(VALID_PROGRAM);
    expect(config.objective).toBe(
      "Minimize validation bits-per-byte for a 5-minute Shakespeare training run.",
    );
    expect(config.metric.name).toBe("val_bpb");
    expect(config.metric.direction).toBe("lower_is_better");
    expect(config.metric.extractCommand).toContain("grep");
    expect(config.evalCommand).toBe("uv run train.py");
    expect(config.scope).toEqual(["train.py", "configs/*.yaml"]);
    expect(config.constraints).toEqual(["Do not modify prepare.py", "Do not install new packages"]);
    expect(config.context).toContain("GPT-2");
    expect(config.timeout).toBe(120);
  });

  it("uses default timeout when section is missing", () => {
    const content = VALID_PROGRAM.replace("## Timeout\n120\n", "");
    const config = parseProgramContent(content);
    expect(config.timeout).toBe(300);
  });

  it("uses empty defaults for optional sections", () => {
    const minimal = `# Program
## Objective
Optimize something.

## Metric
- **Name**: score
- **Direction**: higher_is_better
- **Extract command**: cat score.txt

## Eval Command
./run.sh

## Scope
- src/
`;
    const config = parseProgramContent(minimal);
    expect(config.constraints).toEqual([]);
    expect(config.context).toBe("");
    expect(config.timeout).toBe(300);
  });

  it("strips HTML comments from content", () => {
    const withComments = `# Program
## Objective
<!-- This is a comment -->
Optimize latency.
<!-- Another comment -->

## Metric
- **Name**: p95
- **Direction**: lower_is_better
- **Extract command**: jq '.p95' results.json

## Eval Command
./bench.sh

## Scope
- src/server.ts
`;
    const config = parseProgramContent(withComments);
    expect(config.objective).toBe("Optimize latency.");
  });

  it("throws ParseError for missing Objective", () => {
    const content = `# Program
## Metric
- **Name**: x
- **Direction**: lower_is_better
- **Extract command**: echo 1

## Eval Command
echo ok

## Scope
- file.ts
`;
    expect(() => parseProgramContent(content)).toThrow(ParseError);
    expect(() => parseProgramContent(content)).toThrow("Missing required section: ## Objective");
  });

  it("throws ParseError for missing Metric fields", () => {
    const content = `# Program
## Objective
Optimize.

## Metric
- **Name**: x

## Eval Command
echo ok

## Scope
- file.ts
`;
    expect(() => parseProgramContent(content)).toThrow("missing **Direction**");
  });

  it("throws ParseError for empty Scope", () => {
    const content = `# Program
## Objective
Optimize.

## Metric
- **Name**: x
- **Direction**: lower_is_better
- **Extract command**: echo 1

## Eval Command
echo ok

## Scope
`;
    expect(() => parseProgramContent(content)).toThrow("at least one entry");
  });

  it("throws ParseError for invalid Direction", () => {
    const content = `# Program
## Objective
Optimize.

## Metric
- **Name**: x
- **Direction**: minimize
- **Extract command**: echo 1

## Eval Command
echo ok

## Scope
- file.ts
`;
    expect(() => parseProgramContent(content)).toThrow(ParseError);
  });

  it("throws ParseError for invalid timeout", () => {
    const content = VALID_PROGRAM.replace("## Timeout\n120", "## Timeout\nabc");
    expect(() => parseProgramContent(content)).toThrow("positive integer");
  });

  it("handles case-insensitive section headings", () => {
    const content = VALID_PROGRAM.replace("## Eval Command", "## eval command");
    const config = parseProgramContent(content);
    expect(config.evalCommand).toBe("uv run train.py");
  });
});
