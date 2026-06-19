import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const useStdin = args.includes("--stdin");

const MODEL_NAME = process.env.GITHUB_MODELS_CLARITY_MODEL || "openai/gpt-4o-mini";
const MODELS_API_URL = "https://models.github.ai/inference/chat/completions";
const MAX_FINDINGS_PER_FILE = 5;
const ALLOWED_CATEGORIES = new Set([
  "ambiguity",
  "flow",
  "demonstration",
  "feature_name",
  "step_action",
  "terminology",
  "rewrite",
]);
const CLARITY_RUBRIC = [
  "ambiguous or vague wording",
  "weak section-to-section flow",
  "feature names in Description that are too long, awkward, or not concise enough for human readers",
  "hard-to-follow demonstration steps",
  "numbered demonstration steps that should start with a clear action verb and state the objective",
  "control steps that should follow a consistent detect/prevent instruction pattern",
  "inconsistent terminology within a file",
  "concrete rewrite suggestions for unclear sentences",
];

export async function main() {
  const filePaths = useStdin ? await readPathsFromStdin() : walkMarkdownFiles("playbooks");

  if (filePaths.length === 0) {
    console.log("No playbook Markdown files were provided for clarity review, so there is nothing to examine in this run.");
    return;
  }

  if (!process.env.GITHUB_TOKEN) {
    emitGitHubNotice({
      file: filePaths[0],
      line: 1,
      message: "The advisory clarity review was skipped because no GITHUB_TOKEN was available for GitHub Models.",
    });
    console.log("The advisory clarity review was skipped because no GITHUB_TOKEN was available for GitHub Models.");
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
        message: "The advisory clarity review skipped this file because it is not present in the current repository snapshot.",
      });
      continue;
    }

    const review = await reviewFileWithGitHubModels(filePath);
    reviewedFiles += 1;

    if (review.error) {
      emitGitHubNotice({
        file: filePath,
        line: 1,
        message: `The advisory clarity review could not produce findings for this file. ${review.error}`,
      });
      console.log(`${filePath}:1 NOTICE Advisory clarity review skipped detailed feedback: ${review.error}`);
      continue;
    }

    if (review.findings.length === 0) {
      emitGitHubNotice({
        file: filePath,
        line: 1,
        message: "The advisory clarity review found no suggestions for this playbook.",
      });
      console.log(`${filePath}:1 PASS Advisory clarity review found no suggestions.`);
      continue;
    }

    totalFindings += review.findings.length;
    for (const finding of review.findings) {
      emitGitHubWarning(finding);
    }
  }

  console.log(
    `The advisory clarity review completed. ${reviewedFiles} playbook file(s) were examined and ${totalFindings} advisory finding(s) were reported.`
  );
}

async function reviewFileWithGitHubModels(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const type = inferTypeFromFilename(path.basename(filePath, ".md")) ?? "unknown";
  const clarityContent = extractClarityContent(raw);
  const prompts = buildClarityPrompts(filePath, type, clarityContent);

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

export function buildClarityPrompts(filePath, type, raw) {
  return {
    system: buildSystemPrompt(type),
    user: buildUserPrompt(filePath, type, raw),
  };
}

function buildSystemPrompt(type) {
  return [
    "You review iOS playbook Markdown files for clarity only.",
    "Do not check format compliance, policy compliance, security completeness, or missing required template sections.",
    "Report only advisory clarity findings that help an author rewrite the playbook for human readers.",
    ...buildTypeSpecificSystemGuidance(type),
    `Use only these categories: ${Array.from(ALLOWED_CATEGORIES).join(", ")}.`,
    `Limit findings to at most ${MAX_FINDINGS_PER_FILE}.`,
    "If the playbook is already clear, return an empty findings array.",
    "Return strict JSON only with this shape:",
    '{"summary":"short summary","findings":[{"line":12,"category":"ambiguity","message":"short explanation","suggestedRewrite":"concrete replacement text"}]}',
    "Do not wrap the JSON in Markdown fences.",
  ].join("\n");
}

function buildUserPrompt(filePath, type, raw) {
  return [
    "Review this playbook for clarity using the rubric below.",
    "Exclude template headings, section headings, filenames, and Markdown tables from your review.",
    "Focus only on the remaining prose and numbered instruction lines.",
    ...buildTypeSpecificUserGuidance(type),
    `Rubric: ${buildRubricForType(type).join("; ")}.`,
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
      "You are reviewing a feature playbook.",
      "You may suggest a more concise feature name only when the current feature name is vague, awkward, or longer than 3 words.",
      "When you suggest a feature name, evaluate only the '<feature_name>' portion of the Description sentence and ignore the trailing template word 'feature'.",
      "Keep any suggested feature name to 1 to 3 words and make sure it still matches the described capability.",
      "For numbered demonstration steps, prefer rewrites that begin with a clear action verb and explain the objective in plain language.",
    ];
  }

  if (type === "risk") {
    return [
      "You are reviewing a risk playbook.",
      "For numbered demonstration steps, prefer rewrites that begin with a clear action verb and explain the objective in plain language.",
      "Favor consistent patterns such as 'Open X to do Y' when that improves readability.",
    ];
  }

  if (type === "control") {
    return [
      "You are reviewing a control playbook.",
      "For numbered control steps, prefer rewrites that begin with a clear action verb and preserve the original step intent.",
      "Favor consistent patterns such as 'Open X by doing Y' when that improves readability.",
      "Do not suggest feature-name rewrites for control playbooks.",
    ];
  }

  return [
    "The playbook type is unknown, so apply only general clarity guidance and avoid type-specific assumptions.",
  ];
}

function buildTypeSpecificUserGuidance(type) {
  if (type === "feature") {
    return [
      "Pay special attention to whether the Description uses a concise feature name.",
      "Pay special attention to whether each numbered Demonstration step starts with a clear action verb and follows a consistent pattern such as 'Open X to do Y'.",
    ];
  }

  if (type === "risk") {
    return [
      "Pay special attention to whether each numbered Demonstration step starts with a clear action verb and follows a consistent pattern such as '<action verb> <something> by <method>' or 'Open X to do Y'.",
    ];
  }

  if (type === "control") {
    return [
      "Pay special attention to whether numbered control steps start with a clear action verb, preserve the original intent, and follow a consistent pattern such as '<action verb> <something> by <method>'.",
    ];
  }

  return [
    "Apply only general clarity guidance because the playbook type is unknown.",
  ];
}

function buildRubricForType(type) {
  const baseRubric = [
    "ambiguous or vague wording",
    "weak section-to-section flow",
    "inconsistent terminology within a file",
    "concrete rewrite suggestions for unclear sentences",
  ];

  if (type === "feature") {
    return [
      ...baseRubric,
      "feature names in Description that are too long, awkward, or not concise enough for human readers",
      "hard-to-follow demonstration steps",
      "numbered demonstration steps that should start with a clear action verb and state the objective",
    ];
  }

  if (type === "risk") {
    return [
      ...baseRubric,
      "hard-to-follow demonstration steps",
      "numbered demonstration steps that should start with a clear action verb and state the objective",
    ];
  }

  if (type === "control") {
    return [
      ...baseRubric,
      "control steps that should start with a clear action verb and preserve their original intent",
    ];
  }

  return CLARITY_RUBRIC;
}

export function extractClarityContent(raw) {
  const lines = raw.split(/\r?\n/);
  const filteredLines = [];
  let insideTable = false;

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();

    if (trimmed.startsWith("|")) {
      insideTable = true;
      continue;
    }

    if (insideTable && !trimmed.startsWith("|")) {
      insideTable = false;
    }

    if (insideTable) {
      continue;
    }

    if (isIgnoredHeading(trimmed)) {
      continue;
    }

    if (isIgnoredTemplateLine(trimmed)) {
      continue;
    }

    if (trimmed.length === 0) {
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
    trimmed === "### Goal"
  ) {
    return true;
  }

  return /^## platform-feature-(0[1-9]|[1-9][0-9])(?:-risk-(0[1-9]|[1-9][0-9]))?(?:-control-(0[1-9]|[1-9][0-9]))?$/.test(trimmed);
}

function isIgnoredTemplateLine(trimmed) {
  return (
    /^Set up .+ with the following configuration:$/.test(trimmed) ||
    /^Perform the following steps to enable .+:$/.test(trimmed) ||
    /^Perform the following steps to demonstrate the risk of an attacker .+:$/.test(trimmed) ||
    /^Your app can prevent the risk of an attacker .+ by taking the following steps:$/.test(trimmed) ||
    /^Because the iOS platform provides .+ feature, your app is at risk of:$/.test(trimmed) ||
    /^The APK with the implemented control can be found \[here\]\((.+)\)\.$/.test(trimmed)
  );
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
      error: `The advisory clarity response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      findings: [],
      error: "The advisory clarity response must be a JSON object with a 'findings' array.",
    };
  }

  if (!Array.isArray(parsed.findings)) {
    return {
      findings: [],
      error: "The advisory clarity response did not include a valid 'findings' array.",
    };
  }

  const findings = [];

  for (const [index, finding] of parsed.findings.entries()) {
    if (findings.length >= MAX_FINDINGS_PER_FILE) {
      break;
    }

    const normalized = normalizeFinding(finding, filePath, lineCount, lines);
    if (normalized.error) {
      return {
        findings: [],
        error: `The advisory clarity response contained an invalid finding at position ${index + 1}: ${normalized.error}`,
      };
    }

    findings.push(normalized.finding);
  }

  return { findings, error: null };
}

function normalizeFinding(finding, filePath, lineCount, lines) {
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

  if (typeof finding.suggestedRewrite !== "string" || finding.suggestedRewrite.trim().length === 0) {
    return { error: "Each finding must include a non-empty 'suggestedRewrite' string." };
  }

  return {
    finding: {
      file: filePath,
      line: finding.line,
      severity: "advisory",
      category: finding.category,
      message: finding.message.trim(),
      sourceText: lines ? (lines[finding.line - 1] ?? "").trim() : "",
      suggestedRewrite: finding.suggestedRewrite.trim(),
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

function emitGitHubWarning({ file, line, severity, category, message, sourceText, suggestedRewrite }) {
  const sourceSegment = sourceText ? ` Source text: ${sourceText}` : "";
  const escapedMessage = escapeWorkflowValue(`[${severity}/${category}] ${message}${sourceSegment} Suggested rewrite: ${suggestedRewrite}`);
  console.log(`::warning file=${file},line=${line},title=Playbook clarity::${escapedMessage}`);
}

function emitGitHubNotice({ file, line, message }) {
  const escapedMessage = escapeWorkflowValue(message);
  console.log(`::notice file=${file},line=${line},title=Playbook clarity::${escapedMessage}`);
}

function escapeWorkflowValue(value) {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  await main();
}
