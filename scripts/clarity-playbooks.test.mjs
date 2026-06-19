import test from "node:test";
import assert from "node:assert/strict";

import { buildClarityPrompts, extractClarityContent, normalizeModelResponse } from "./clarity-playbooks.mjs";

test("buildClarityPrompts gives feature-specific guidance", () => {
  const prompts = buildClarityPrompts("playbooks/platform-feature-01.md", "feature", "3: demo");

  assert.match(prompts.system, /reviewing a feature playbook/i);
  assert.match(prompts.system, /ignore the trailing template word 'feature'/i);
  assert.match(prompts.system, /keep any suggested feature name to 1 to 3 words/i);
  assert.match(prompts.user, /Description uses a concise feature name/i);
  assert.match(prompts.user, /Open X to do Y/i);
  assert.doesNotMatch(prompts.system, /Detect <something> by <method>/i);
});

test("buildClarityPrompts gives risk-specific guidance", () => {
  const prompts = buildClarityPrompts("playbooks/platform-feature-01-risk-01.md", "risk", "12: demo");

  assert.match(prompts.system, /reviewing a risk playbook/i);
  assert.match(prompts.system, /Open X to do Y/i);
  assert.doesNotMatch(prompts.system, /keep it to 1 to 3 words/i);
  assert.doesNotMatch(prompts.user, /Description uses a concise feature name/i);
  assert.doesNotMatch(prompts.system, /Detect <something> by <method>/i);
});

test("buildClarityPrompts gives control-specific guidance", () => {
  const prompts = buildClarityPrompts("playbooks/platform-feature-01-risk-01-control-01.md", "control", "3: demo");

  assert.match(prompts.system, /reviewing a control playbook/i);
  assert.match(prompts.system, /preserve the original step intent/i);
  assert.match(prompts.system, /begin with a clear action verb/i);
  assert.match(prompts.system, /Open X by doing Y/i);
  assert.match(prompts.user, /preserve the original intent/i);
  assert.doesNotMatch(prompts.system, /keep it to 1 to 3 words/i);
  assert.doesNotMatch(prompts.user, /Open X to do Y/i);
});

test("normalizeModelResponse accepts a valid advisory finding", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "One line could be clearer.",
      findings: [
        {
          line: 4,
          category: "ambiguity",
          message: "The feature description uses a generic phrase that does not tell readers what is protected.",
          suggestedRewrite: "The iOS platform provides Secure Storage, a feature for encrypting app secrets stored on the device.",
        },
      ],
    }),
    "playbooks/platform-feature-01.md",
    12
  );

  assert.equal(result.error, null);
  assert.deepEqual(result.findings, [
    {
      file: "playbooks/platform-feature-01.md",
      line: 4,
      severity: "advisory",
      category: "ambiguity",
      message: "The feature description uses a generic phrase that does not tell readers what is protected.",
      sourceText: "",
      suggestedRewrite: "The iOS platform provides Secure Storage, a feature for encrypting app secrets stored on the device.",
    },
  ]);
});

test("normalizeModelResponse accepts a feature-name advisory finding", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "The feature name can be more concise.",
      findings: [
        {
          line: 3,
          category: "feature_name",
          message: "The feature name is longer than needed and would be easier to scan if it were shorter.",
          suggestedRewrite: "The iOS platform provides Secure Storage feature.",
        },
      ],
    }),
    "playbooks/platform-feature-01.md",
    12
  );

  assert.equal(result.error, null);
  assert.deepEqual(result.findings, [
    {
      file: "playbooks/platform-feature-01.md",
      line: 3,
      severity: "advisory",
      category: "feature_name",
      message: "The feature name is longer than needed and would be easier to scan if it were shorter.",
      sourceText: "",
      suggestedRewrite: "The iOS platform provides Secure Storage feature.",
    },
  ]);
});

test("normalizeModelResponse accepts an action-oriented demonstration finding", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "One demonstration step should begin with a clearer verb.",
      findings: [
        {
          line: 12,
          category: "step_action",
          message: "The step does not begin with a strong action verb, which makes the instruction harder to follow.",
          suggestedRewrite: "1. Update the app configuration to enable Secure Storage for secrets saved on the device",
        },
      ],
    }),
    "playbooks/platform-feature-01.md",
    12
  );

  assert.equal(result.error, null);
  assert.deepEqual(result.findings, [
    {
      file: "playbooks/platform-feature-01.md",
      line: 12,
      severity: "advisory",
      category: "step_action",
      message: "The step does not begin with a strong action verb, which makes the instruction harder to follow.",
      sourceText: "",
      suggestedRewrite: "1. Update the app configuration to enable Secure Storage for secrets saved on the device",
    },
  ]);
});

test("normalizeModelResponse accepts an action-oriented risk demonstration finding", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "One risk demonstration step should use a more consistent action pattern.",
      findings: [
        {
          line: 12,
          category: "step_action",
          message: "The risk demonstration step would be easier to follow if it started with a direct action verb and stated the objective.",
          suggestedRewrite: "1. Open the exported backup file to extract the stored secret",
        },
      ],
    }),
    "playbooks/platform-feature-01-risk-01.md",
    14
  );

  assert.equal(result.error, null);
  assert.deepEqual(result.findings, [
    {
      file: "playbooks/platform-feature-01-risk-01.md",
      line: 12,
      severity: "advisory",
      category: "step_action",
      message: "The risk demonstration step would be easier to follow if it started with a direct action verb and stated the objective.",
      sourceText: "",
      suggestedRewrite: "1. Open the exported backup file to extract the stored secret",
    },
  ]);
});

test("normalizeModelResponse accepts a control-step rewrite finding", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "The control steps can use a more consistent detect/prevent pattern.",
      findings: [
        {
          line: 3,
          category: "step_action",
          message: "The first control step would be easier to scan if it used a direct detect-by pattern.",
          suggestedRewrite: "1. Detect exported backup files by scanning the app data directory before processing secrets",
        },
        {
          line: 4,
          category: "step_action",
          message: "The second control step would be easier to scan if it used a direct prevent-by pattern.",
          suggestedRewrite: "2. Prevent secret extraction by encrypting backup data with a device-bound key",
        },
      ],
    }),
    "playbooks/platform-feature-01-risk-01-control-01.md",
    6
  );

  assert.equal(result.error, null);
  assert.deepEqual(result.findings, [
    {
      file: "playbooks/platform-feature-01-risk-01-control-01.md",
      line: 3,
      severity: "advisory",
      category: "step_action",
      message: "The first control step would be easier to scan if it used a direct detect-by pattern.",
      sourceText: "",
      suggestedRewrite: "1. Detect exported backup files by scanning the app data directory before processing secrets",
    },
    {
      file: "playbooks/platform-feature-01-risk-01-control-01.md",
      line: 4,
      severity: "advisory",
      category: "step_action",
      message: "The second control step would be easier to scan if it used a direct prevent-by pattern.",
      sourceText: "",
      suggestedRewrite: "2. Prevent secret extraction by encrypting backup data with a device-bound key",
    },
  ]);
});

test("normalizeModelResponse includes source text when original lines are available", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "One step should be clearer.",
      findings: [
        {
          line: 12,
          category: "step_action",
          message: "The step should start with a stronger action verb.",
          suggestedRewrite: "1. Sign in to the same Apple ID on both devices to enable deployment",
        },
      ],
    }),
    "playbooks/platform-feature-01.md",
    [
      "## platform-feature-01",
      "",
      "### Description",
      "",
      "The iOS platform provides IPA Acquisition feature.",
      "",
      "### Demonstration",
      "",
      "Set up demo app with the following configuration:",
      "",
      "Perform the following steps to enable IPA Acquisition:",
      "1. Use the same Apple ID on both devices for deployment",
    ]
  );

  assert.equal(result.error, null);
  assert.equal(result.findings[0].sourceText, "1. Use the same Apple ID on both devices for deployment");
});

test("normalizeModelResponse rejects malformed JSON", () => {
  const result = normalizeModelResponse("{not json}", "playbooks/platform-feature-01.md", 12);

  assert.equal(result.findings.length, 0);
  assert.match(result.error, /not valid JSON/i);
});

test("normalizeModelResponse rejects a response without findings", () => {
  const result = normalizeModelResponse(
    JSON.stringify({ summary: "Missing findings array." }),
    "playbooks/platform-feature-01.md",
    12
  );

  assert.equal(result.findings.length, 0);
  assert.match(result.error, /findings/i);
});

test("normalizeModelResponse rejects out-of-range line numbers", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "Bad line number.",
      findings: [
        {
          line: 40,
          category: "flow",
          message: "The transition into the risk section feels abrupt.",
          suggestedRewrite: "Add a sentence that explains how enabling the feature changes the threat model before listing risks.",
        },
      ],
    }),
    "playbooks/platform-feature-01.md",
    12
  );

  assert.equal(result.findings.length, 0);
  assert.match(result.error, /line value 40/i);
});

test("extractClarityContent excludes template headings, fixed template lines, and Markdown tables", () => {
  const content = extractClarityContent(`## platform-feature-01
### Description
The iOS platform provides Secure Storage feature.
### Additional context
Secure Storage is a feature that protects application secrets stored on the device by encrypting them at rest.
### Demonstration
Set up demo app with the following configuration:
| Configuration | Detail |
| -------- | ------- |
| Build variant | Debug |
Perform the following steps to enable Secure Storage:
1. Update the app to do the needed thing for security`);

  assert.doesNotMatch(content, /^## /m);
  assert.doesNotMatch(content, /^### /m);
  assert.doesNotMatch(content, /^\|/m);
  assert.match(content, /^3: The iOS platform provides Secure Storage feature\.$/m);
  assert.doesNotMatch(content, /^7: Set up demo app with the following configuration:$/m);
  assert.doesNotMatch(content, /^11: Perform the following steps to enable Secure Storage:$/m);
  assert.match(content, /^12: 1\. Update the app to do the needed thing for security$/m);
});

test("extractClarityContent ignores fenced Markdown code blocks", () => {
  const content = extractClarityContent(`## platform-feature-01
### Description
The iOS platform provides Secure Storage feature.

\`\`\`md
This prose should be ignored.
1. This numbered item should be ignored.
\`\`\`

### Demonstration
1. Update the app to do the needed thing for security`);

  assert.doesNotMatch(content, /This prose should be ignored/);
  assert.doesNotMatch(content, /This numbered item should be ignored/);
  assert.match(content, /^11: 1\. Update the app to do the needed thing for security$/m);
});
