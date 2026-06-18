import test from "node:test";
import assert from "node:assert/strict";

import { extractCompletenessContent, normalizeModelResponse } from "./completeness-playbooks.mjs";

test("normalizeModelResponse accepts a valid incorrect-claim finding", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "One mechanism is described incorrectly.",
      findings: [
        {
          line: 6,
          category: "incorrect_mechanism",
          message: "The playbook says plaintext local storage protects secrets at rest, which is technically incorrect.",
          evidence: "Feature 01 is a feature that protects sensitive data at rest.",
          whyItMatters: "Readers could implement storage that does not provide the security property being claimed.",
          suggestedRewrite: "Explain the actual Android protection mechanism and how it safeguards stored secrets at rest.",
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
      category: "incorrect_mechanism",
      message: "The playbook says plaintext local storage protects secrets at rest, which is technically incorrect.",
      evidence: "Feature 01 is a feature that protects sensitive data at rest.",
      whyItMatters: "Readers could implement storage that does not provide the security property being claimed.",
      suggestion: "Explain the actual Android protection mechanism and how it safeguards stored secrets at rest.",
    },
  ]);
});

test("normalizeModelResponse accepts a valid missing-context finding", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "One key prerequisite is missing.",
      findings: [
        {
          line: 6,
          category: "missing_prerequisite",
          message: "The playbook does not explain what key-management assumption makes the storage claim valid.",
          evidence: "Feature 01 is a feature that protects sensitive data at rest.",
          whyItMatters: "Without the key-management assumption, the protection claim is technically incomplete.",
          suggestedAddition: "Add a sentence explaining whether keys are hardware-backed, app-managed, or derived from user credentials.",
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
      category: "missing_prerequisite",
      message: "The playbook does not explain what key-management assumption makes the storage claim valid.",
      evidence: "Feature 01 is a feature that protects sensitive data at rest.",
      whyItMatters: "Without the key-management assumption, the protection claim is technically incomplete.",
      suggestion: "Add a sentence explaining whether keys are hardware-backed, app-managed, or derived from user credentials.",
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
          message: "Wrong category for completeness review.",
          evidence: "Feature 01 is a feature that protects sensitive data at rest.",
          whyItMatters: "This category should not be accepted.",
          suggestedRewrite: "Use an approved category.",
        },
      ],
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
          message: "The playbook describes an iOS API in an Android document.",
          evidence: "Use the iOS Keychain to store the secret.",
          whyItMatters: "Readers would be directed to the wrong platform mechanism.",
          suggestedRewrite: "Replace the iOS-specific mechanism with the correct Android one.",
        },
      ],
    }),
    "playbooks/platform-feature-01.md",
    12
  );

  assert.equal(result.findings.length, 0);
  assert.match(result.error, /line value 40/i);
});

test("normalizeModelResponse rejects findings without evidence", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "Missing evidence.",
      findings: [
        {
          line: 6,
          category: "unsupported_claim",
          message: "The playbook makes a broad security claim without support.",
          evidence: "",
          whyItMatters: "Readers may trust a claim that has not been grounded in the described mechanism.",
          suggestedRewrite: "Narrow the claim to what the mechanism actually guarantees.",
        },
      ],
    }),
    "playbooks/platform-feature-01.md",
    12
  );

  assert.equal(result.findings.length, 0);
  assert.match(result.error, /evidence/i);
});

test("normalizeModelResponse rejects findings without whyItMatters", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "Missing rationale.",
      findings: [
        {
          line: 6,
          category: "security_overclaim",
          message: "The playbook overstates what the storage mechanism guarantees.",
          evidence: "Feature 01 is a feature that protects sensitive data at rest.",
          whyItMatters: "",
          suggestedRewrite: "State the narrower security property that is actually guaranteed.",
        },
      ],
    }),
    "playbooks/platform-feature-01.md",
    12
  );

  assert.equal(result.findings.length, 0);
  assert.match(result.error, /whyItMatters/i);
});

test("normalizeModelResponse rejects findings without a suggestion field", () => {
  const result = normalizeModelResponse(
    JSON.stringify({
      summary: "Missing suggestion.",
      findings: [
        {
          line: 6,
          category: "missing_constraint",
          message: "The playbook does not state the environment constraint that makes the demo valid.",
          evidence: "Set up demo app with the following configuration:",
          whyItMatters: "Without the environment constraint, the demo setup may not reproduce the claimed behavior.",
        },
      ],
    }),
    "playbooks/platform-feature-01.md",
    12
  );

  assert.equal(result.findings.length, 0);
  assert.match(result.error, /suggestedRewrite' or 'suggestedAddition/i);
});

test("extractCompletenessContent preserves original line numbers and excludes headings and tables", () => {
  const content = extractCompletenessContent(`## platform-feature-01
### Description
The Android platform provides Secure Storage feature.
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
  assert.match(content, /^3: The Android platform provides Secure Storage feature\.$/m);
  assert.match(content, /^7: Set up demo app with the following configuration:$/m);
  assert.match(content, /^11: Perform the following steps to enable Secure Storage:$/m);
  assert.match(content, /^12: 1\. Update the app to use encrypted storage to protect the secret at rest$/m);
});
