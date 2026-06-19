import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const useStdin = args.includes("--stdin");

const MODEL_NAME = process.env.GITHUB_MODELS_COMPLETENESS_MODEL || "openai/gpt-4o-mini";
const MODELS_API_URL = "https://models.github.ai/inference/chat/completions";
const MAX_FINDINGS_PER_FILE = 5;
const CORRECTNESS_CATEGORIES = new Set(["step_review", "demo_inconsistency"]);
const COMPLETENESS_RUBRIC = [
  "what the reviewer understands the numbered step is trying to do",
  "what could be better in the numbered step so the technical action is clearer, more accurate, or easier to execute",
];

export async function main() {
  const filePaths = useStdin ? await readPathsFromStdin() : walkMarkdownFiles("playbooks");

  if (filePaths.length === 0) {
    console.log("No playbook Markdown files were provided for technical completeness review, so there is nothing to examine in this run.");
    return;
  }

  if (!process.env.GITHUB_TOKEN) {
    emitGitHubNotice({
      file: filePaths[0],
      line: 1,
      message: "The advisory technical completeness review was skipped because no GITHUB_TOKEN was available for GitHub Models.",
    });
    console.log("The advisory technical completeness review was skipped because no GITHUB_TOKEN was available for GitHub Models.");
    return;
  }

  let totalFindings = 0;
  let reviewedFiles = 0;

  for (const filePath of filePaths) {
    if (!filePath.endsWith(".md")) {
      continue;
    }

    if (!fs.existsSync(filePath)) {
      emitGitHubNotice({
        file: filePath,
        line: 1,
        message: "The advisory technical completeness review skipped this file because it is not present in the current repository snapshot.",
      });
      continue;
    }

    const review = await reviewFileWithGitHubModels(filePath);
    reviewedFiles += 1;

    if (review.error) {
      emitGitHubNotice({
        file: filePath,
        line: 1,
        message: `The advisory technical completeness review could not produce findings for this file. ${review.error}`,
      });
      console.log(`${filePath}:1 NOTICE Advisory technical completeness review skipped detailed feedback: ${review.error}`);
      continue;
    }

    if (review.findings.length === 0) {
      emitGitHubNotice({
        file: filePath,
        line: 1,
        message: "The advisory technical completeness review found no suggestions for this playbook.",
      });
      console.log(`${filePath}:1 PASS Advisory technical completeness review found no suggestions.`);
      continue;
    }

    totalFindings += review.findings.length;
    for (const finding of review.findings) {
      emitGitHubWarning(finding);
    }
  }

  console.log(
    `The advisory technical completeness review completed. ${reviewedFiles} playbook file(s) were examined and ${totalFindings} advisory finding(s) were reported.`
  );
}

async function reviewFileWithGitHubModels(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const type = inferTypeFromFilename(path.basename(filePath, ".md")) ?? "unknown";
  const completenessContent = extractCompletenessContent(raw);
  const staticFindings = collectStaticCompletenessFindings(filePath, type, lines);

  const requestBody = {
    model: MODEL_NAME,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(),
      },
      {
        role: "user",
        content: buildUserPrompt(filePath, type, completenessContent),
      },
    ],
  };

  let response;
  try {
    response = await fetch(MODELS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    return {
      findings: [],
      error: `GitHub Models request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!response.ok) {
    const details = await safeReadResponseText(response);
    return {
      findings: [],
      error: `GitHub Models returned HTTP ${response.status}${details ? `: ${details}` : ""}`,
    };
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    return {
      findings: [],
      error: `GitHub Models returned a non-JSON response: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const content = extractAssistantContent(payload);
  if (!content) {
    return {
      findings: staticFindings,
      error: "GitHub Models returned no assistant content to parse.",
    };
  }

  const normalized = normalizeModelResponse(content, filePath, lines.length);
  if (normalized.error) {
    return {
      findings: staticFindings,
      error: normalized.error,
    };
  }

  return {
    findings: [...staticFindings, ...normalized.findings],
    error: null,
  };
}

function buildSystemPrompt() {
  return [
    "You review iOS playbook Markdown files for numbered-step technical completeness only.",
    "Do not review descriptions, goals, references, screenshots, formatting, section completeness, or prose style.",
    "Review the numbered instruction lines as one end-to-end sequence.",
    "When uncertain, return an empty findings array.",
    "Do not speculate about implementation details that are not stated in the numbered steps.",
    `Use only these categories: ${Array.from(CORRECTNESS_CATEGORIES).join(", ")}.`,
    `Limit findings to at most ${MAX_FINDINGS_PER_FILE}.`,
    "Return strict JSON only with this shape:",
    '{"summary":"short summary","overallUnderstanding":"what the full numbered-step sequence appears to do","findings":[{"line":12,"category":"step_review","improvement":"what could be better"}]}',
    "There must be exactly one overallUnderstanding string for the whole sequence.",
    "Each finding should describe one missing or weak part of the overall flow, not repeat the entire understanding.",
    "Do not wrap the JSON in Markdown fences.",
  ].join("\n");
}

function buildUserPrompt(filePath, type, raw) {
  return [
    "Review this playbook's numbered steps using the rubric below.",
    "Ignore all non-numbered lines. Focus only on the numbered instruction lines that remain in the supplied content.",
    "First, form one overall understanding of what the full numbered-step sequence is trying to do.",
    "Then, report one or more specific things that could be better in the technical flow.",
    `Rubric: ${COMPLETENESS_RUBRIC.join("; ")}.`,
    `File: ${filePath}`,
    `Playbook type: ${type}`,
    "",
    "Playbook content with original line numbers:",
    raw,
  ].join("\n");
}

export function extractCompletenessContent(raw) {
  const lines = raw.split(/\r?\n/);
  const filteredLines = [];

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();

    if (trimmed.length === 0 || isIgnoredHeading(trimmed)) {
      continue;
    }

    if (!/^\d+\.\s+/.test(trimmed)) {
      continue;
    }

    filteredLines.push(`${index + 1}: ${trimmed}`);
  }

  return filteredLines.join("\n");
}

export function collectStaticCompletenessFindings(filePath, type, lines) {
  if (type !== "control") {
    return [];
  }

  const findings = [];

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!/^\d+\.\s+/.test(trimmed)) {
      continue;
    }

    if (/^\d+\.\s+(Detect|Prevent)\b/.test(trimmed)) {
      continue;
    }

    findings.push({
      file: filePath,
      line: index + 1,
      severity: "advisory",
      category: "demo_inconsistency",
      understanding: "This control step is intended to describe a control action, but it does not currently start with 'Detect' or 'Prevent'.",
      improvement: "Rewrite this step so it starts with 'Detect' or 'Prevent' while preserving the current meaning.",
    });
  }

  return findings;
}

function isIgnoredHeading(trimmed) {
  if (
    trimmed === "### Description" ||
    trimmed === "### Additional context" ||
    trimmed === "### Demonstration" ||
    trimmed === "### Goal"
  ) {
    return true;
  }

  return /^## platform-feature-(0[1-9]|[1-9][0-9])(?:-risk-(0[1-9]|[1-9][0-9]))?(?:-control-(0[1-9]|[1-9][0-9]))?$/.test(trimmed);
}

export function normalizeModelResponse(rawContent, filePath, lineCount) {
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    return {
      findings: [],
      error: `The advisory technical completeness response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      findings: [],
      error: "The advisory technical completeness response must be a JSON object with a 'findings' array.",
    };
  }

  if (!Array.isArray(parsed.findings)) {
    return {
      findings: [],
      error: "The advisory technical completeness response did not include a valid 'findings' array.",
    };
  }

  if (typeof parsed.overallUnderstanding !== "string" || parsed.overallUnderstanding.trim().length === 0) {
    return {
      findings: [],
      error: "The advisory technical completeness response must include a non-empty 'overallUnderstanding' string.",
    };
  }

  const findings = [];
  for (const [index, finding] of parsed.findings.entries()) {
    if (findings.length >= MAX_FINDINGS_PER_FILE) {
      break;
    }

    const normalized = normalizeFinding(finding, filePath, lineCount, parsed.overallUnderstanding);
    if (normalized.error) {
      return {
        findings: [],
        error: `The advisory technical completeness response contained an invalid finding at position ${index + 1}: ${normalized.error}`,
      };
    }

    findings.push(normalized.finding);
  }

  return { findings, error: null };
}

function normalizeFinding(finding, filePath, lineCount, overallUnderstanding) {
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
    return { error: "Each finding must be a JSON object." };
  }

  if (!Number.isInteger(finding.line)) {
    return { error: "Each finding must include an integer 'line' value." };
  }

  if (finding.line < 1 || finding.line > lineCount) {
    return { error: `The line value ${finding.line} falls outside the file's line range of 1 to ${lineCount}.` };
  }

  if (typeof finding.category !== "string" || !CORRECTNESS_CATEGORIES.has(finding.category)) {
    return {
      error: `Each finding category must be one of: ${Array.from(CORRECTNESS_CATEGORIES).join(", ")}.`,
    };
  }

  if (typeof finding.improvement !== "string" || finding.improvement.trim().length === 0) {
    return { error: "Each finding must include a non-empty 'improvement' string." };
  }

  return {
    finding: {
      file: filePath,
      line: finding.line,
      severity: "advisory",
      category: finding.category,
      understanding: overallUnderstanding.trim(),
      improvement: finding.improvement.trim(),
    },
  };
}

function extractAssistantContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }

  return "";
}

async function safeReadResponseText(response) {
  try {
    const text = await response.text();
    return text.trim().slice(0, 500);
  } catch {
    return "";
  }
}

function inferTypeFromFilename(basename) {
  if (/^platform-feature-(0[1-9]|[1-9][0-9])-risk-(0[1-9]|[1-9][0-9])-control-(0[1-9]|[1-9][0-9])$/.test(basename)) {
    return "control";
  }

  if (/^platform-feature-(0[1-9]|[1-9][0-9])-risk-(0[1-9]|[1-9][0-9])$/.test(basename)) {
    return "risk";
  }

  if (/^platform-feature-(0[1-9]|[1-9][0-9])$/.test(basename)) {
    return "feature";
  }

  return null;
}

function walkMarkdownFiles(rootDirectory) {
  if (!fs.existsSync(rootDirectory)) {
    return [];
  }

  const results = [];
  const entries = fs.readdirSync(rootDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(rootDirectory, entry.name);

    if (entry.isDirectory()) {
      results.push(...walkMarkdownFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }

  return results;
}

function readPathsFromStdin() {
  return new Promise((resolve) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => {
      resolve(
        buffer
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      );
    });
  });
}

function emitGitHubWarning({ file, line, severity, category, understanding, improvement }) {
  const escapedMessage = escapeWorkflowValue(`[${severity}/${category}] Understanding: ${understanding} What can be better: ${improvement}`);
  console.log(`::warning file=${file},line=${line},title=Playbook technical completeness::${escapedMessage}`);
}

function emitGitHubNotice({ file, line, message }) {
  const escapedMessage = escapeWorkflowValue(message);
  console.log(`::notice file=${file},line=${line},title=Playbook technical completeness::${escapedMessage}`);
}

function escapeWorkflowValue(value) {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  await main();
}
