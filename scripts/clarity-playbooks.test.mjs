import test from "node:test";
import assert from "node:assert/strict";

import { extractClarityContent, normalizeModelResponse } from "./clarity-playbooks.mjs";

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
      suggestedRewrite: "The iOS platform provides Secure Storage, a feature for encrypting app secrets stored on the device.",
    },
  ]);
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

test("extractClarityContent excludes template headings and Markdown tables", () => {
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
  assert.match(content, /The iOS platform provides Secure Storage feature\./);
  assert.match(content, /Set up demo app with the following configuration:/);
  assert.match(content, /Perform the following steps to enable Secure Storage:/);
});
