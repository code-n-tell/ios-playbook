import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFactCheckPrompts,
  extractFactCheckContent,
  normalizeModelResponse,
} from "./factcheck-playbooks.mjs";

test("buildFactCheckPrompts gives feature-specific guidance", () => {
  const prompts = buildFactCheckPrompts("playbooks/platform-feature-01.md", "feature", "12: 1. Step");

  assert.match(prompts.system, /experienced iOS software engineer/i);
  assert.match(prompts.system, /feature-enablement steps/i);
  assert.match(prompts.user, /feature-enablement flow/i);
  assert.doesNotMatch(prompts.system, /attacker-perspective steps/i);
});

test("buildFactCheckPrompts gives risk-specific guidance", () => {
  const prompts = buildFactCheckPrompts("playbooks/platform-feature-01-risk-01.md", "risk", "12: 1. Step");

  assert.match(prompts.system, /experienced iOS security engineer/i);
  assert.match(prompts.system, /attacker-perspective steps/i);
  assert.match(prompts.user, /risk-demonstration flow/i);
});

test("buildFactCheckPrompts gives control-specific guidance", () => {
  const prompts = buildFactCheckPrompts("playbooks/platform-feature-01-risk-01-control-01.md", "control", "12: 1. Step");

  assert.match(prompts.system, /defender mindset/i);
  assert.match(prompts.system, /defensive control steps/i);
  assert.match(prompts.user, /defensive control flow/i);
  assert.doesNotMatch(prompts.system, /attacker-perspective steps/i);
});

test("extractFactCheckContent preserves original line numbers and keeps only numbered steps", () => {
  const content = extractFactCheckContent(`## platform-feature-01
### Description
The iOS platform provides Secure Storage feature.
### Demonstration
Perform the following steps to enable Secure Storage:
1. Update the app to use encrypted storage

<img src="../attachments/example.png" width="400" alt="Alt text">

2. Build the app with the new storage layer
### References
The IPA with the implemented control can be found [here](../artifacts/example.ipa).`);

  assert.doesNotMatch(content, /^## /m);
  assert.doesNotMatch(content, /^### /m);
  assert.doesNotMatch(content, /^3: The iOS platform provides Secure Storage feature\.$/m);
  assert.doesNotMatch(content, /^5: Perform the following steps to enable Secure Storage:$/m);
  assert.doesNotMatch(content, /^8: <img /m);
  assert.match(content, /^6: 1\. Update the app to use encrypted storage$/m);
  assert.match(content, /^10: 2\. Build the app with the new storage layer$/m);
});

test("extractFactCheckContent ignores fenced Markdown code blocks", () => {
  const content = extractFactCheckContent(`## platform-feature-01
### Demonstration
\`\`\`md
1. Ignore this code sample step
\`\`\`
1. Keep this real step`);

  assert.doesNotMatch(content, /Ignore this code sample step/);
  assert.match(content, /^6: 1\. Keep this real step$/m);
});

test("normalizeModelResponse accepts a valid fact check finding", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "One step may need verification.",
      findings: [
        {
          line: 6,
          category: "missing_assumption",
          message: "This step assumes the signing environment is already trusted and provisioned.",
          suggestedCheck: "State the required certificate, provisioning profile, or trust prerequisite before this action.",
        },
      ],
    }),
    "playbooks/platform-feature-01.md",
    [
      "## platform-feature-01",
      "### Demonstration",
      "Perform the following steps to enable Secure Storage:",
      "1. Placeholder",
      "2. Placeholder",
      "3. Placeholder",
    ]
  );

  assert.equal(result.error, null);
  assert.deepEqual(result.findings, [
    {
      file: "playbooks/platform-feature-01.md",
      line: 6,
      severity: "advisory",
      category: "missing_assumption",
      role: "iOS software engineer",
      message: "This step assumes the signing environment is already trusted and provisioned",
      sourceText: "3. Placeholder",
      suggestedCheck: "State the required certificate, provisioning profile, or trust prerequisite before this action",
    },
  ]);
});

test("normalizeModelResponse strips duplicated role framing from model output", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "One step may be overclaimed.",
      findings: [
        {
          line: 4,
          category: "unsupported_claim",
          message: "As an iOS security engineer, this step implies the artifact alone proves exploitability.",
          suggestedCheck: "As an iOS security engineer, I suggest qualifying the claim so it distinguishes artifact collection from confirmed exploitation.",
        },
      ],
    }),
    "playbooks/platform-feature-01-risk-01.md",
    10
  );

  assert.equal(result.error, null);
  assert.deepEqual(result.findings, [
    {
      file: "playbooks/platform-feature-01-risk-01.md",
      line: 4,
      severity: "advisory",
      category: "unsupported_claim",
      role: "iOS security engineer",
      message: "this step implies the artifact alone proves exploitability",
      sourceText: "",
      suggestedCheck: "qualifying the claim so it distinguishes artifact collection from confirmed exploitation",
    },
  ]);
});

test("normalizeModelResponse rejects malformed JSON", () => {
  const result = normalizeModelResponse("{not json}", "playbooks/platform-feature-01.md", 12);

  assert.equal(result.findings.length, 0);
  assert.match(result.error, /not valid JSON/i);
});

test("normalizeModelResponse rejects unknown categories", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "Bad category.",
      findings: [
        {
          line: 6,
          category: "terminology",
          message: "Use an approved category.",
          suggestedCheck: "Replace this category with an approved one.",
        },
      ],
    }),
    "playbooks/platform-feature-01.md",
    12
  );

  assert.equal(result.findings.length, 0);
  assert.match(result.error, /must be one of/i);
});

test("normalizeModelResponse rejects findings without suggestedCheck", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "Missing verification guidance.",
      findings: [
        {
          line: 6,
          category: "incorrect_claim",
          message: "This may overstate what the tool can prove.",
          suggestedCheck: "",
        },
      ],
    }),
    "playbooks/platform-feature-01.md",
    12
  );

  assert.equal(result.findings.length, 0);
  assert.match(result.error, /suggestedCheck/i);
});
