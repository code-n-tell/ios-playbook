import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const useStdin = args.includes("--stdin");

const MODEL_NAME = process.env.GITHUB_MODELS_FACTCHECK_MODEL || "openai/gpt-4o-mini";
const MODELS_API_URL = "https://models.github.ai/inference/chat/completions";
const MAX_FINDINGS_PER_FILE = 5;
const ALLOWED_CATEGORIES = new Set(["incorrect_claim", "unsupported_claim", "missing_assumption"]);
const FACT_CHECK_RUBRIC = [
  "technically questionable iOS or security claims in numbered steps",
  "numbered steps that overclaim outcomes without enough technical support",
  "critical missing assumptions or prerequisites that make a step technically unsound",
];

export async function main() {
  const filePaths = useStdin ? await readPathsFromStdin() : walkMarkdownFiles("playbooks");

  if (filePaths.length === 0) {
    console.log("No playbook Markdown files were provided for fact check review, so there is nothing to examine in this run.");
    return;
  }

  if (!process.env.GITHUB_TOKEN) {
    emitGitHubNotice({
      file: filePaths[0],
      line: 1,
      message: "The advisory fact check review was skipped because no GITHUB_TOKEN was available for GitHub Models.",
    });
    console.log("The advisory fact check review was skipped because no GITHUB_TOKEN was available for GitHub Models.");
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
        message: "The advisory fact check review skipped this file because it is not present in the current repository snapshot.",
      });
      continue;
    }

    const review = await reviewFileWithGitHubModels(filePath);
    reviewedFiles += 1;

    if (review.error) {
      emitGitHubNotice({
        file: filePath,
        line: 1,
        message: `The advisory fact check review could not produce findings for this file. ${review.error}`,
      });
      console.log(`${filePath}:1 NOTICE Advisory fact check review skipped detailed feedback: ${review.error}`);
      continue;
    }

    if (review.findings.length === 0) {
      emitGitHubNotice({
        file: filePath,
        line: 1,
        message: "The advisory fact check review found no suggestions for this playbook.",
      });
      console.log(`${filePath}:1 PASS Advisory fact check review found no suggestions.`);
      continue;
    }

    totalFindings += review.findings.length;
    for (const finding of review.findings) {
      emitGitHubWarning(finding);
    }
  }

  console.log(`The advisory fact check review completed. ${reviewedFiles} playbook file(s) were examined and ${totalFindings} advisory finding(s) were reported.`);
}

async function reviewFileWithGitHubModels(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = splitMarkdownLinesIgnoringCodeBlocks(raw);
  const type = inferTypeFromFilename(path.basename(filePath, ".md")) ?? "unknown";
  const factCheckContent = extractFactCheckContent(raw);
  const prompts = buildFactCheckPrompts(filePath, type, factCheckContent);

  const requestBody = {
    model: MODEL_NAME,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: prompts.system,
      },
      {
        role: "user",
        content: prompts.user,
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
      findings: [],
      error: "GitHub Models returned no assistant content to parse.",
    };
  }

  return normalizeModelResponse(content, filePath, lines);
}

export function buildFactCheckPrompts(filePath, type, raw) {
  return {
    system: buildSystemPrompt(type),
    user: buildUserPrompt(filePath, type, raw),
  };
}

function buildSystemPrompt(type) {
  return [
    "You review iOS playbook Markdown files for factual correctness of numbered steps only.",
    "Do not review wording clarity, formatting, policy compliance, screenshots, references, or missing template sections.",
    "Review the numbered instruction lines using grounded iOS and security knowledge.",
    "Only report a finding when there is a concrete, technically grounded concern.",
    "When uncertain, return an empty findings array.",
    ...buildTypeSpecificSystemGuidance(type),
    `Use only these categories: ${Array.from(ALLOWED_CATEGORIES).join(", ")}.`,
    `Limit findings to at most ${MAX_FINDINGS_PER_FILE}.`,
    "Return strict JSON only with this shape:",
    '{"summary":"short summary","findings":[{"line":12,"category":"incorrect_claim","message":"what seems questionable","suggestedCheck":"what the author should verify, qualify, or correct"}]}',
    "Keep each message focused on the technical concern in that numbered step.",
    "Keep each suggestedCheck focused on the exact correction, qualification, or prerequisite that would make the step more technically sound.",
    "Do not wrap the JSON in Markdown fences.",
  ].join("\n");
}

function buildUserPrompt(filePath, type, raw) {
  return [
    "Review this playbook's numbered steps for factual correctness using the rubric below.",
    "Ignore all non-numbered lines. Focus only on the numbered instruction lines that remain in the supplied content.",
    "Flag only concrete technical issues such as questionable claims, unsupported overclaims, or critical missing assumptions.",
    ...buildTypeSpecificUserGuidance(type),
    `Rubric: ${FACT_CHECK_RUBRIC.join("; ")}.`,
    `File: ${filePath}`,
    `Playbook type: ${type}`,
    "",
    "Playbook content with original line numbers:",
    raw,
  ].join("\n");
}

function buildTypeSpecificSystemGuidance(type) {
  if (type === "feature") {
    return [
      "You are acting as an experienced iOS software engineer.",
      "Assess whether the feature-enablement steps are technically sound and accurately described.",
    ];
  }

  if (type === "risk") {
    return [
      "You are acting as an experienced iOS security engineer.",
      "Assess whether the attacker-perspective steps are technically realistic and accurately described.",
    ];
  }

  if (type === "control") {
    return [
      "You are acting as an experienced iOS software engineer with a defender mindset.",
      "Assess whether the defensive control steps are technically sound, implementable, and accurately described.",
    ];
  }

  return [
    "Use a general iOS engineering perspective when the playbook type is unknown.",
  ];
}

function buildTypeSpecificUserGuidance(type) {
  if (type === "feature") {
    return [
      "Treat the sequence as a feature-enablement flow and fact-check it from an iOS software engineer perspective.",
    ];
  }

  if (type === "risk") {
    return [
      "Treat the sequence as a risk-demonstration flow and fact-check it from an attacker perspective using iOS security engineering judgment.",
    ];
  }

  if (type === "control") {
    return [
      "Treat the sequence as a defensive control flow and fact-check it from a defender perspective using iOS software engineering judgment.",
    ];
  }

  return [
    "Use a general iOS engineering perspective because the playbook type is unknown.",
  ];
}

export function extractFactCheckContent(raw) {
  const lines = splitMarkdownLinesIgnoringCodeBlocks(raw);
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

function isIgnoredHeading(trimmed) {
  if (
    trimmed === "### Description" ||
    trimmed === "### Additional context" ||
    trimmed === "### Demonstration" ||
    trimmed === "### Goal" ||
    trimmed === "### References"
  ) {
    return true;
  }

  return /^## platform-feature-(0[1-9]|[1-9][0-9])(?:-risk-(0[1-9]|[1-9][0-9]))?(?:-control-(0[1-9]|[1-9][0-9]))?$/.test(trimmed);
}

function splitMarkdownLinesIgnoringCodeBlocks(raw) {
  const lines = raw.split(/\r?\n/);
  const sanitizedLines = [];
  let insideCodeBlock = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      sanitizedLines.push("");
      insideCodeBlock = !insideCodeBlock;
      continue;
    }

    sanitizedLines.push(insideCodeBlock ? "" : line);
  }

  return sanitizedLines;
}

export function normalizeModelResponse(rawContent, filePath, linesOrLineCount) {
  const lines = Array.isArray(linesOrLineCount) ? linesOrLineCount : null;
  const lineCount = lines ? lines.length : linesOrLineCount;
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    return {
      findings: [],
      error: `The advisory fact check response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      findings: [],
      error: "The advisory fact check response must be a JSON object with a 'findings' array.",
    };
  }

  if (!Array.isArray(parsed.findings)) {
    return {
      findings: [],
      error: "The advisory fact check response did not include a valid 'findings' array.",
    };
  }

  const findings = [];
  const type = inferTypeFromFilename(path.basename(filePath, ".md")) ?? "unknown";
  const role = getReviewerRole(type);

  for (const [index, finding] of parsed.findings.entries()) {
    if (findings.length >= MAX_FINDINGS_PER_FILE) {
      break;
    }

    const normalized = normalizeFinding(finding, filePath, lineCount, lines, role);
    if (normalized.error) {
      return {
        findings: [],
        error: `The advisory fact check response contained an invalid finding at position ${index + 1}: ${normalized.error}`,
      };
    }

    findings.push(normalized.finding);
  }

  return { findings, error: null };
}

function normalizeFinding(finding, filePath, lineCount, lines, role) {
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
    return { error: "Each finding must be a JSON object." };
  }

  if (!Number.isInteger(finding.line)) {
    return { error: "Each finding must include an integer 'line' value." };
  }

  if (finding.line < 1 || finding.line > lineCount) {
    return { error: `The line value ${finding.line} falls outside the file's line range of 1 to ${lineCount}.` };
  }

  if (typeof finding.category !== "string" || !ALLOWED_CATEGORIES.has(finding.category)) {
    return {
      error: `Each finding category must be one of: ${Array.from(ALLOWED_CATEGORIES).join(", ")}.`,
    };
  }

  if (typeof finding.message !== "string" || finding.message.trim().length === 0) {
    return { error: "Each finding must include a non-empty 'message' string." };
  }

  if (typeof finding.suggestedCheck !== "string" || finding.suggestedCheck.trim().length === 0) {
    return { error: "Each finding must include a non-empty 'suggestedCheck' string." };
  }

  return {
    finding: {
      file: filePath,
      line: finding.line,
      severity: "advisory",
      category: finding.category,
      role,
      message: stripRoleLeadIn(finding.message.trim()),
      sourceText: lines ? (lines[finding.line - 1] ?? "").trim() : "",
      suggestedCheck: stripSuggestedCheckLeadIn(finding.suggestedCheck.trim()),
    },
  };
}

function getReviewerRole(type) {
  if (type === "feature") {
    return "iOS software engineer";
  }

  if (type === "risk") {
    return "iOS security engineer";
  }

  if (type === "control") {
    return "iOS software engineer with a defender perspective";
  }

  return "iOS engineer";
}

function stripRoleLeadIn(value) {
  return value
    .replace(/^As an? [^,]+,\s*/i, "")
    .trim()
    .replace(/\.+$/g, "");
}

function stripSuggestedCheckLeadIn(value) {
  return value
    .replace(/^As an? [^,]+,\s*(I suggest\s*)?/i, "")
    .replace(/^I suggest\s*/i, "")
    .trim()
    .replace(/\.+$/g, "");
}

function roleArticle(role) {
  return /^[aeiou]/i.test(role) ? "an" : "a";
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

function emitGitHubWarning({ file, line, severity, category, role, message, sourceText, suggestedCheck }) {
  const sourceSegment = sourceText ? ` Source text: ${sourceText}` : "";
  const escapedMessage = escapeWorkflowValue(
    `[${severity}/${category}] As ${roleArticle(role)} ${role}, I think this step may need a fact check. Concern: ${message}.${sourceSegment} Check: ${suggestedCheck}.`
  );
  console.log(`::warning file=${file},line=${line},title=Playbook fact check::${escapedMessage}`);
}

function emitGitHubNotice({ file, line, message }) {
  const escapedMessage = escapeWorkflowValue(message);
  console.log(`::notice file=${file},line=${line},title=Playbook fact check::${escapedMessage}`);
}

function escapeWorkflowValue(value) {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  await main();
}
