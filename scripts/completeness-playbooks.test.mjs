import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCompletenessPrompts,
  collectStaticCompletenessFindings,
  extractCompletenessContent,
  normalizeModelResponse,
} from "./completeness-playbooks.mjs";

test("buildCompletenessPrompts gives feature-specific guidance", () => {
  const prompts = buildCompletenessPrompts("playbooks/platform-feature-01.md", "feature", "12: 1. Step");

  assert.match(prompts.system, /experienced iOS software engineer/i);
  assert.match(prompts.system, /feature flow/i);
  assert.match(prompts.user, /feature-enablement flow/i);
  assert.doesNotMatch(prompts.system, /attacker perspective/i);
});

test("buildCompletenessPrompts gives risk-specific guidance", () => {
  const prompts = buildCompletenessPrompts("playbooks/platform-feature-01-risk-01.md", "risk", "12: 1. Step");

  assert.match(prompts.system, /experienced iOS security engineer/i);
  assert.match(prompts.system, /attacker perspective/i);
  assert.match(prompts.user, /risk-demonstration flow/i);
});

test("buildCompletenessPrompts gives control-specific guidance", () => {
  const prompts = buildCompletenessPrompts("playbooks/platform-feature-01-risk-01-control-01.md", "control", "12: 1. Step");

  assert.match(prompts.system, /defender mindset/i);
  assert.match(prompts.system, /defender perspective/i);
  assert.match(prompts.user, /defensive control flow/i);
  assert.doesNotMatch(prompts.system, /attacker perspective/i);
});

test("normalizeModelResponse accepts a valid incorrect-claim finding", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "One step could be clearer.",
      overallUnderstanding: "The sequence appears to guide the reader through securing sensitive data in the app workflow.",
      findings: [
        {
          line: 6,
          category: "step_review",
          improvement: "Clarify what storage mechanism is used so the reader knows exactly how the secret is protected.",
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
      line: 6,
      severity: "advisory",
      category: "step_review",
      understanding: "The sequence appears to guide the reader through securing sensitive data in the app workflow.",
      improvement: "Clarify what storage mechanism is used so the reader knows exactly how the secret is protected.",
    },
  ]);
});

test("normalizeModelResponse accepts a second valid step review finding", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "One step needs a better explanation.",
      overallUnderstanding: "The sequence appears to configure the environment needed to run the demonstration safely.",
      findings: [
        {
          line: 6,
          category: "step_review",
          improvement: "State the missing prerequisite explicitly so the reader can reproduce the step reliably.",
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
      line: 6,
      severity: "advisory",
      category: "step_review",
      understanding: "The sequence appears to configure the environment needed to run the demonstration safely.",
      improvement: "State the missing prerequisite explicitly so the reader can reproduce the step reliably.",
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
          improvement: "Use an approved category.",
        },
      ],
      overallUnderstanding: "The sequence appears to describe a feature workflow.",
    }),
    "playbooks/platform-feature-01.md",
    12
  );

  assert.equal(result.findings.length, 0);
  assert.match(result.error, /must be one of/i);
});

test("normalizeModelResponse rejects out-of-range line numbers", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "Bad line number.",
      findings: [
        {
          line: 40,
          category: "platform_mismatch",
          improvement: "Replace the iOS-specific mechanism with the correct iOS one.",
        },
      ],
      overallUnderstanding: "The sequence appears to configure a storage mechanism.",
    }),
    "playbooks/platform-feature-01.md",
    12
  );

  assert.equal(result.findings.length, 0);
  assert.match(result.error, /line value 40/i);
});

test("normalizeModelResponse rejects findings without understanding", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "Missing understanding.",
      findings: [
        {
          line: 6,
          category: "step_review",
          improvement: "Explain what the step is meant to accomplish.",
        },
      ],
      overallUnderstanding: "",
    }),
    "playbooks/platform-feature-01.md",
    12
  );

  assert.equal(result.findings.length, 0);
  assert.match(result.error, /overallUnderstanding/i);
});

test("normalizeModelResponse rejects findings without improvement", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "Missing improvement.",
      overallUnderstanding: "The sequence appears to secure the stored secret.",
      findings: [
        {
          line: 6,
          category: "step_review",
          improvement: "",
        },
      ],
    }),
    "playbooks/platform-feature-01.md",
    12
  );

  assert.equal(result.findings.length, 0);
  assert.match(result.error, /improvement/i);
});

test("extractCompletenessContent preserves original line numbers and keeps only numbered steps", () => {
  const content = extractCompletenessContent(`## platform-feature-01
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
1. Update the app to use encrypted storage to protect the secret at rest`);

  assert.doesNotMatch(content, /^## /m);
  assert.doesNotMatch(content, /^### /m);
  assert.doesNotMatch(content, /^\|/m);
  assert.doesNotMatch(content, /^3: The iOS platform provides Secure Storage feature\.$/m);
  assert.doesNotMatch(content, /^7: Set up demo app with the following configuration:$/m);
  assert.doesNotMatch(content, /^11: Perform the following steps to enable Secure Storage:$/m);
  assert.match(content, /^12: 1\. Update the app to use encrypted storage to protect the secret at rest$/m);
});

test("collectStaticCompletenessFindings warns when a control step does not start with Detect or Prevent", () => {
  const findings = collectStaticCompletenessFindings(
    "playbooks/platform-feature-01-risk-01-control-01.md",
    "control",
    [
      "## platform-feature-01-risk-01-control-01",
      "Your app can prevent the risk of an attacker extracting secrets by taking the following steps:",
      "1. Move hardcoded credentials into confidential storage",
      "2. Prevent secret exposure by using device-bound encryption",
    ]
  );

  assert.deepEqual(findings, [
    {
      file: "playbooks/platform-feature-01-risk-01-control-01.md",
      line: 3,
      severity: "advisory",
      category: "demo_inconsistency",
      understanding: "This control step is intended to describe a control action, but it does not currently start with 'Detect' or 'Prevent'.",
      improvement: "Rewrite this step so it starts with 'Detect' or 'Prevent' while preserving the current meaning.",
    },
  ]);
});

test("collectStaticCompletenessFindings ignores non-control files and compliant control steps", () => {
  const controlFindings = collectStaticCompletenessFindings(
    "playbooks/platform-feature-01-risk-01-control-01.md",
    "control",
    [
      "1. Detect hardcoded credentials by scanning the Swift source files",
      "2. Prevent secret exposure by moving credentials into confidential storage",
    ]
  );
  const featureFindings = collectStaticCompletenessFindings(
    "playbooks/platform-feature-01.md",
    "feature",
    ["1. Open the project settings to enable encrypted storage"]
  );

  assert.deepEqual(controlFindings, []);
  assert.deepEqual(featureFindings, []);
});
