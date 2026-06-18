import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const useStdin = args.includes("--stdin");

const MODEL_NAME = process.env.GITHUB_MODELS_COMPLETENESS_MODEL || "openai/gpt-4o-mini";
const MODELS_API_URL = "https://models.github.ai/inference/chat/completions";
const MAX_FINDINGS_PER_FILE = 5;
const MAX_COMPLETENESS_FINDINGS_PER_FILE = 2;
const CORRECTNESS_CATEGORIES = new Set([
  "platform_mismatch",
  "incorrect_mechanism",
  "unsupported_claim",
  "security_overclaim",
  "demo_inconsistency",
  "missing_prerequisite",
  "missing_constraint",
  "missing_security_tradeoff",
  "missing_platform_detail",
  "missing_threat_assumption",
]);
const COMPLETENESS_CATEGORIES = new Set([
  "missing_prerequisite",
  "missing_constraint",
  "missing_security_tradeoff",
  "missing_platform_detail",
  "missing_threat_assumption",
]);
const COMPLETENESS_RUBRIC = [
  "platform mismatches where iOS content describes non-iOS behavior or APIs",
  "technically incorrect explanations of iOS or security mechanisms",
  "unsupported or overstated security claims",
  "missing prerequisites or assumptions needed to make a claim technically sound",
  "demonstration steps that contradict the described feature, risk, or control",
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
      findings: [],
      error: "GitHub Models returned no assistant content to parse.",
    };
  }

  return normalizeModelResponse(content, filePath, lines.length);
}

function buildSystemPrompt() {
  return [
    "You review iOS playbook Markdown files for technical completeness.",
    "Do not check format compliance, section completeness, prose clarity, or style.",
    "Report only high-confidence findings about technical gaps or likely incorrect technical claims.",
    "When uncertain, return an empty findings array.",
    "Do not speculate about implementation details that are not stated in the playbook.",
    "Every finding must cite exact evidence copied from the playbook content supplied by the user.",
    `Use only these categories: ${Array.from(CORRECTNESS_CATEGORIES).join(", ")}.`,
    `Limit findings to at most ${MAX_FINDINGS_PER_FILE}, and include at most ${MAX_COMPLETENESS_FINDINGS_PER_FILE} findings from completeness categories.`,
    "Return strict JSON only with this shape:",
    '{"summary":"short summary","findings":[{"line":12,"category":"platform_mismatch","message":"short explanation","evidence":"quoted playbook text","whyItMatters":"why the issue matters","suggestedRewrite":"concrete replacement text"}]}',
    "For missing-context findings, use 'suggestedAddition' instead of 'suggestedRewrite'.",
    "Do not wrap the JSON in Markdown fences.",
  ].join("\n");
}

function buildUserPrompt(filePath, type, raw) {
  return [
    "Review this playbook for technical completeness using the rubric below.",
    "Ignore template headings and Markdown tables. Focus on substantive prose and numbered instruction lines.",
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

    if (trimmed.length === 0 || isIgnoredHeading(trimmed)) {
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

  const findings = [];
  let completenessFindings = 0;

  for (const [index, finding] of parsed.findings.entries()) {
    if (findings.length >= MAX_FINDINGS_PER_FILE) {
      break;
    }

    const normalized = normalizeFinding(finding, filePath, lineCount);
    if (normalized.error) {
      return {
        findings: [],
        error: `The advisory technical completeness response contained an invalid finding at position ${index + 1}: ${normalized.error}`,
      };
    }

    if (COMPLETENESS_CATEGORIES.has(normalized.finding.category)) {
      if (completenessFindings >= MAX_COMPLETENESS_FINDINGS_PER_FILE) {
        continue;
      }
      completenessFindings += 1;
    }

    findings.push(normalized.finding);
  }

  return { findings, error: null };
}

function normalizeFinding(finding, filePath, lineCount) {
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

  if (typeof finding.message !== "string" || finding.message.trim().length === 0) {
    return { error: "Each finding must include a non-empty 'message' string." };
  }

  if (typeof finding.evidence !== "string" || finding.evidence.trim().length === 0) {
    return { error: "Each finding must include a non-empty 'evidence' string." };
  }

  if (typeof finding.whyItMatters !== "string" || finding.whyItMatters.trim().length === 0) {
    return { error: "Each finding must include a non-empty 'whyItMatters' string." };
  }

  const suggestionField =
    typeof finding.suggestedRewrite === "string" && finding.suggestedRewrite.trim().length > 0
      ? finding.suggestedRewrite
      : typeof finding.suggestedAddition === "string" && finding.suggestedAddition.trim().length > 0
        ? finding.suggestedAddition
        : null;

  if (!suggestionField) {
    return { error: "Each finding must include a non-empty 'suggestedRewrite' or 'suggestedAddition' string." };
  }

  return {
    finding: {
      file: filePath,
      line: finding.line,
      severity: "advisory",
      category: finding.category,
      message: finding.message.trim(),
      evidence: finding.evidence.trim(),
      whyItMatters: finding.whyItMatters.trim(),
      suggestion: suggestionField.trim(),
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

function emitGitHubWarning({ file, line, severity, category, message, evidence, whyItMatters, suggestion }) {
  const escapedMessage = escapeWorkflowValue(
    `[${severity}/${category}] ${message} Evidence: ${evidence} Why it matters: ${whyItMatters} Suggestion: ${suggestion}`
  );
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
