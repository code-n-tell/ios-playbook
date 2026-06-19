import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const scriptPath = path.join(repoRoot, "scripts", "validate-playbooks.mjs");

test("feature playbooks accept a post-demonstration related risks section", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ios-playbook-validator-"));
  const filePath = path.join(tempRoot, "platform-feature-01.md");

  fs.writeFileSync(
    filePath,
    [
      "## platform-feature-01",
      "",
      "### Description",
      "",
      "The iOS platform provides Secure Storage feature.",
      "",
      "### Additional context",
      "",
      "Secure Storage is a feature that protects application secrets stored on the device.",
      "",
      "### Demonstration",
      "",
      "Set up demo app with the following configuration:",
      "",
      "| Configuration | Detail |",
      "| -------- | ------- |",
      "| Build variant | Debug |",
      "",
      "Perform the following steps to enable Secure Storage:",
      "",
      "1. Open the project settings to enable encrypted storage",
      "",
      "Because the iOS platform provides Secure Storage feature, your app is at risk of:",
      "",
      "- [platform-feature-01-risk-01](platform-feature-01-risk-01.md)",
      "",
    ].join("\n"),
    "utf8"
  );

  const result = runValidator([filePath]);

  fs.rmSync(tempRoot, { recursive: true, force: true });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /feature\.related_risks_intro/);
  assert.match(result.stdout, /feature\.related_risks_list/);
});

test("required table structure accepts two rows and proceeds to the next feature check", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ios-playbook-validator-"));
  const filePath = path.join(tempRoot, "platform-feature-01.md");

  fs.writeFileSync(
    filePath,
    [
      "## platform-feature-01",
      "",
      "### Description",
      "",
      "The iOS platform provides Secure Storage feature.",
      "",
      "### Additional context",
      "",
      "Secure Storage is a feature that protects application secrets stored on the device.",
      "",
      "### Demonstration",
      "",
      "Set up demo app with the following configuration:",
      "",
      "| Configuration | Detail |",
      "| -------- | ------- |",
      "",
      "Perform the following steps to enable Secure Storage:",
      "",
      "1. Open the project settings to enable encrypted storage",
      "",
      "Because the iOS platform provides Secure Storage feature, your app is at risk of:",
      "",
      "- [platform-feature-01-risk-01](platform-feature-01-risk-01.md)",
      "",
    ].join("\n"),
    "utf8"
  );

  const result = runValidator([filePath]);

  fs.rmSync(tempRoot, { recursive: true, force: true });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /The configuration table uses the approved header/);
  assert.match(result.stdout, /The configuration table includes a separator row/);
  assert.doesNotMatch(result.stdout, /includes at least one data row/);
  assert.match(result.stdout, /feature\.steps_intro/);
});

test("each numbered demonstration step is validated for a feature playbook", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ios-playbook-validator-"));
  const filePath = path.join(tempRoot, "platform-feature-01.md");

  fs.writeFileSync(
    filePath,
    [
      "## platform-feature-01",
      "",
      "### Description",
      "",
      "The iOS platform provides Secure Storage feature.",
      "",
      "### Additional context",
      "",
      "Secure Storage is a feature that protects application secrets stored on the device.",
      "",
      "### Demonstration",
      "",
      "Set up demo app with the following configuration:",
      "",
      "| Configuration | Detail |",
      "| -------- | ------- |",
      "",
      "Perform the following steps to enable Secure Storage:",
      "",
      "1. Open the project settings to enable encrypted storage",
      "2. Update the app configuration to store secrets in the encrypted container",
      "",
      "Because the iOS platform provides Secure Storage feature, your app is at risk of:",
      "",
      "- [platform-feature-01-risk-01](platform-feature-01-risk-01.md)",
      "",
    ].join("\n"),
    "utf8"
  );

  const result = runValidator([filePath]);

  fs.rmSync(tempRoot, { recursive: true, force: true });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Numbered list item 1 passed the 'feature\.demo_steps'/);
  assert.match(result.stdout, /Numbered list item 2 passed the 'feature\.demo_steps'/);
});

test("the validator reports multiple feature issues from one file", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ios-playbook-validator-"));
  const filePath = path.join(tempRoot, "platform-feature-01.md");

  fs.writeFileSync(
    filePath,
    [
      "## platform-feature-01",
      "",
      "### Description",
      "",
      "The iOS platform provides Secure Storage feature.",
      "",
      "### Additional context",
      "",
      "Wrong Name is a feature that protects application secrets stored on the device.",
      "",
      "### Demonstration",
      "",
      "Set up demo app with the following configuration:",
      "",
      "Perform the following steps to enable Another Name:",
      "",
      "Do the thing now",
      "",
      "Because the iOS platform provides Wrong Name feature, your app is at risk of:",
      "",
      "- [platform-feature-01-risk-01](platform-feature-01-risk-02.md)",
      "",
    ].join("\n"),
    "utf8"
  );

  const result = runValidator([filePath]);

  fs.rmSync(tempRoot, { recursive: true, force: true });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /feature\.additional_context_feature_name/);
  assert.match(result.stdout, /table\.missing/);
  assert.match(result.stdout, /feature\.steps_feature_name/);
  assert.match(result.stdout, /feature\.demo_steps/);
  assert.match(result.stdout, /feature\.related_risks_feature_name/);
  assert.match(result.stdout, /feature\.related_risks_link_match/);
});

test("control playbooks accept numbered steps without requiring 'by' phrasing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ios-playbook-validator-"));
  const filePath = path.join(tempRoot, "platform-feature-01-risk-01-control-01.md");

  fs.writeFileSync(
    filePath,
    [
      "## platform-feature-01-risk-01-control-01",
      "",
      "Your app can prevent the risk of an attacker extracting secrets by taking the following steps:",
      "",
      "1. Detect suspicious access patterns in secure storage calls.",
      "",
      "2. Prevent secret exposure with device-bound encryption checks.",
      "",
      "The APK with the implemented control can be found [here](https://example.com/control.apk).",
      "",
    ].join("\n"),
    "utf8"
  );

  const result = runValidator([filePath]);

  fs.rmSync(tempRoot, { recursive: true, force: true });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /control\.detect_step/);
  assert.match(result.stdout, /control\.prevent_step/);
  assert.doesNotMatch(result.stderr, /Detect by|Prevent by/);
});

test("risk playbooks allow additional content after the numbered demonstration steps", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ios-playbook-validator-"));
  const filePath = path.join(tempRoot, "platform-feature-01-risk-01.md");

  fs.writeFileSync(
    filePath,
    [
      "## platform-feature-01-risk-01",
      "",
      "### Description",
      "",
      "Because the iOS platform provides Secure Storage feature, your application is at risk of an attacker extracting secrets.",
      "",
      "### Goal",
      "",
      "As a result, this could lead to credential disclosure.",
      "",
      "### Demonstration",
      "",
      "Set up demo app with the following configuration:",
      "",
      "| Configuration | Detail |",
      "| -------- | ------- |",
      "| Build variant | Debug |",
      "",
      "Perform the following steps to demonstrate the risk of an attacker extracting secrets:",
      "",
      "1. Open the backup directory to locate the exported application data",
      "",
      "Additional notes about the demonstration can appear here.",
      "A follow-up paragraph is also allowed.",
      "",
    ].join("\n"),
    "utf8"
  );

  const result = runValidator([filePath]);

  fs.rmSync(tempRoot, { recursive: true, force: true });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /risk\.demo_steps/);
  assert.doesNotMatch(result.stdout, /risk\.extra_content/);
});

test("risk goal sentences allow emphasized tactics with a short explanation", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ios-playbook-validator-"));
  const filePath = path.join(tempRoot, "platform-feature-01-risk-01.md");

  fs.writeFileSync(
    filePath,
    [
      "## platform-feature-01-risk-01",
      "",
      "### Description",
      "",
      "Because the iOS platform provides IPA Acquisition feature, your application is at risk of an attacker extracting the IPA file.",
      "",
      "### Goal",
      "",
      "As a result, this could lead to _**discovery** - attackers figuring out the IPA's vulnerabilities._",
      "",
      "### Demonstration",
      "",
      "Set up demo app with the following configuration:",
      "",
      "| Configuration | Detail |",
      "| -------- | ------- |",
      "| Build variant | Debug |",
      "",
      "Perform the following steps to demonstrate the risk of an attacker extracting the IPA file:",
      "",
      "1. Open the device backup directory to locate the generated IPA file",
      "",
    ].join("\n"),
    "utf8"
  );

  const result = runValidator([filePath]);

  fs.rmSync(tempRoot, { recursive: true, force: true });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /risk\.goal_sentence/);
});

function runValidator(filePaths) {
  return spawnSync(process.execPath, [scriptPath, "--stdin"], {
    cwd: repoRoot,
    input: `${filePaths.join("\n")}\n`,
    encoding: "utf8",
  });
}
