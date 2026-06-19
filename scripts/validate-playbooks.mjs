import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const useStdin = args.includes("--stdin");

// Main review flow:
// 1. Gather the list of playbook files to examine.
// 2. Apply both general quality checks and type-specific structure checks.
// 3. Publish GitHub notices for passes and GitHub errors for failures.
//
// This script currently has three review outcomes:
// - Pass: reported as a plain console log line with a "[PASS]" prefix.
// - Warn: reported as a GitHub warning and a console "WARN" line.
// - Fail: reported as a GitHub error and a console "FAIL" line.
async function main() {
  const filePaths = useStdin ? await readPathsFromStdin() : walkMarkdownFiles("playbooks");

  if (filePaths.length === 0) {
    console.log("No playbook Markdown files were provided for review, so there is nothing to validate in this run.");
    return;
  }

  const diagnostics = [];
  const warnings = [];
  const passLogs = [];

  // Each file is reviewed independently so the workflow can report all known
  // issues across the submission, not just the first failing file.
  for (const filePath of filePaths) {
    if (!filePath.endsWith(".md")) {
      continue;
    }

    // Missing files are treated as a failure because the workflow was asked to
    // review a document that is no longer present in the repository snapshot.
    if (!fs.existsSync(filePath)) {
      diagnostics.push(
        makeDiagnostic(
          filePath,
          1,
          "file.exists",
          "This review expected to examine this changed file, but the file is not present in the current repository snapshot.",
          "Restore the file to the repository, or update the pull request so this file is no longer included in the review."
        )
      );
      continue;
    }

    const result = validateFile(filePath);
    diagnostics.push(...result.diagnostics);
    warnings.push(...result.warnings);
    passLogs.push(...result.passLogs);
  }

  // Passing checks are kept as plain logs so the workflow output remains
  // readable without turning successful checks into GitHub annotations.
  for (const passLog of passLogs) {
    console.log(`[PASS] ${passLog.message}`);
  }

  for (const warning of warnings) {
    emitGitHubWarning(warning);
  }

  if (diagnostics.length === 0) {
    console.log(
      `The review completed successfully. ${filePaths.length} playbook file(s) were examined, ${warnings.length} warning(s) were reported, and no blocking issues were found.`
    );
    return;
  }

  for (const diagnostic of diagnostics) {
    emitGitHubError(diagnostic);
  }

  console.error(`The playbook review found ${diagnostics.length} blocking issue(s). Please address the items above before this submission moves forward.`);
  process.exitCode = 1;
}

function validateFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const diagnostics = [];
  const warnings = [];
  const passLogs = [];

  // These are broad hygiene checks that apply to every playbook, regardless of
  // whether the file represents a feature, a risk, or a control.
  //
  // Any issue returned here is a failure because it means the document is not
  // yet ready for a clean, publishable review state.
  diagnostics.push(...checkTrailingWhitespace(filePath, lines, passLogs));
  diagnostics.push(...checkUnreplacedPlaceholders(filePath, lines, passLogs));
  warnings.push(...checkInternalLinks(filePath, lines, passLogs));
  diagnostics.push(...checkTables(filePath, lines, passLogs));
  diagnostics.push(...validateStructure(filePath, lines, passLogs));

  return { diagnostics, warnings, passLogs };
}

function validateStructure(filePath, lines, passLogs) {
  // Structure checks ignore empty lines so that authors may space sections for
  // readability without affecting the required sequence of meaningful content.
  const items = lines
    .map((text, index) => ({ raw: text, text: text.trim(), line: index + 1 }))
    .filter((item) => item.text.length > 0);

  if (items.length === 0) {
    return [
      makeDiagnostic(
        filePath,
        1,
        "file.not_empty",
        "This playbook file is empty, so the review cannot confirm the required public content.",
        "Add the required headings and content for a feature, risk, or control playbook before resubmitting this document for review."
      ),
    ];
  }

  const basename = path.basename(filePath, ".md");
  const type = inferTypeFromFilename(basename);

  // The filename is the gateway to the correct rule set.
  // If the naming pattern is unclear, the validator stops with a failure
  // rather than guessing which public template the author intended to use.
  if (!type) {
    return [
      makeDiagnostic(
        filePath,
        1,
        "filename.scheme",
        `The filename '${basename}.md' does not follow an approved playbook naming pattern, so the validator cannot determine which public template to apply.`,
        "Rename the file to one of the approved patterns: 'platform-feature-01.md', 'platform-feature-01-risk-01.md', or 'platform-feature-01-risk-01-control-01.md'. Each numbered placeholder must use two digits from 01 to 99."
      ),
    ];
  }

  passLogs.push(makePassLog(filePath, 1, `The filename follows the approved '${type}' playbook pattern.`));

  // Once the filename pattern passes, the file is routed into the matching
  // validator. Each validator enforces the exact public template for that
  // document type and returns only pass notices or failures.
  if (type === "feature") {
    return validateFeatureFile(filePath, basename, items, passLogs);
  }

  if (type === "risk") {
    return validateRiskFile(filePath, basename, items, passLogs);
  }

  return validateControlFile(filePath, basename, items, passLogs);
}

function validateFeatureFile(filePath, basename, items, passLogs) {
  const levelThreeHeadings = items.filter((item) => item.text.startsWith("### "));
  if (levelThreeHeadings.length > 3) {
    return [
      makeDiagnostic(
        filePath,
        levelThreeHeadings[3].line,
        "feature.heading_count",
        `Feature playbooks must contain exactly 3 level-3 section headings, but this document contains ${levelThreeHeadings.length}. The extra heading found here is '${levelThreeHeadings[3].text}'.`,
        "Remove the extra '###' section heading so the feature playbook contains only '### Description', '### Additional context', and '### Demonstration'."
      ),
    ];
  }

  const state = createParser(filePath, items, passLogs);

  // Feature playbooks describe a platform capability, explain its context,
  // and show how it works.
  // A mismatch in any required section is a failure because the document would
  // no longer follow the agreed public template.
  const heading = state.expect(
    /^## (platform-feature-(0[1-9]|[1-9][0-9]))$/,
    "feature.heading",
    "The feature heading must be written exactly as '## platform-feature-01', where '01' is replaced with a two-digit value from 01 to 99."
  );

  const headingSlug = heading?.match[1] ?? null;
  if (headingSlug && headingSlug !== basename) {
    state.error(
      heading.line,
      "heading.filename_match",
      `The top heading identifies this file as '${headingSlug}', but the filename is '${basename}.md'. These two identifiers must match so the document can be reviewed consistently.`,
      `Rename the file to '${headingSlug}.md', or change the heading to '## ${basename}' so the heading and filename agree.`
    );
  }
  if (headingSlug === basename) {
    state.pass(heading.line, `The top heading matches the filename identifier '${headingSlug}'.`);
  }

  // These paired checks confirm both format and internal consistency:
  // - the wording must match the template
  // - the same feature name must be reused across related sections
  state.expectText("### Description", "feature.description_heading", "The next required section heading is '### Description'.");
  const description = state.expect(
    /^The iOS platform provides (.+) feature\.$/,
    "feature.description_sentence",
    "The description sentence must be written exactly as 'The iOS platform provides <feature_name> feature.'."
  );
  const featureName = description?.match[1] ?? null;
  if (description) {
    state.pass(description.line, "The description sentence follows the approved public wording.");
  }

  state.expectText("### Additional context", "feature.additional_context_heading", "The next required section heading is '### Additional context'.");
  const context = state.expect(
    /^(.+) is a feature that (.+)\.$/,
    "feature.additional_context_sentence",
    "The additional context sentence must be written exactly as '<feature_name> is a feature that <function>.'"
  );
  if (context && featureName && context.match[1] !== featureName) {
    state.error(
      context.line,
      "feature.additional_context_feature_name",
      `The additional context section names the feature as '${context.match[1]}', but the description section names it as '${featureName}'. The same feature name must be used throughout the document.`,
      `Rewrite the additional context line so it begins with '${featureName} is a feature that ...'.`
    );
  }
  if (context && featureName && context.match[1] === featureName) {
    state.pass(context.line, "The additional context section uses the same feature name as the description.");
  }

  // Demonstration checks ensure the feature can be understood in practice.
  // A valid setup line, a valid configuration table, and at least one valid
  // numbered step are all required for a passing outcome.
  state.expectText("### Demonstration", "feature.demonstration_heading", "The next required section heading is '### Demonstration'.");
  state.expect(
    /^Set up .+ with the following configuration:$/,
    "feature.setup_line",
    "The setup line must be written exactly as 'Set up <environment> with the following configuration:'."
  );
  state.expectTable();

  const stepsIntro = state.find(
    /^Perform the following steps to enable (.+):$/,
    "feature.steps_intro",
    "The step introduction must be written exactly as 'Perform the following steps to enable <feature_name>:' and must appear after the demonstration setup."
  );
  if (stepsIntro && featureName && stepsIntro.match[1] !== featureName) {
    state.error(
      stepsIntro.line,
      "feature.steps_feature_name",
      `The demonstration introduction refers to '${stepsIntro.match[1]}', but the description section refers to '${featureName}'. The same feature name must be used throughout the document.`,
      `Rewrite the line as 'Perform the following steps to enable ${featureName}:'.`
    );
  }
  if (stepsIntro && featureName && stepsIntro.match[1] === featureName) {
    state.pass(stepsIntro.line, "The demonstration introduction uses the same feature name as the description.");
  }

  // This numbered-list check is intentionally broad about the action details
  // while still requiring a predictable sentence shape for scalable review.
  state.expectNumberedList(
    /^(\d+)\. .+ to .+$/,
    "feature.demo_steps",
    "Each demonstration step must follow the approved format '1. <action_verb> to <objective>'.",
    { allowImageLines: true }
  );

  const risksIntro = state.find(
    /^Because the iOS platform provides (.+) feature, your app is at risk of:$/,
    "feature.related_risks_intro",
    "The related risks introduction must be written exactly as 'Because the iOS platform provides <feature_name> feature, your app is at risk of:' and must appear after the numbered demonstration steps."
  );
  if (risksIntro && featureName && risksIntro.match[1] !== featureName) {
    state.error(
      risksIntro.line,
      "feature.related_risks_feature_name",
      `The related risks section names the feature as '${risksIntro.match[1]}', but the description section names it as '${featureName}'. The same feature name must be used throughout the document.`,
      `Rewrite the line as 'Because the iOS platform provides ${featureName} feature, your app is at risk of:'.`
    );
  }
  if (risksIntro && featureName && risksIntro.match[1] === featureName) {
    state.pass(risksIntro.line, "The related risks introduction uses the same feature name as the description.");
  }

  state.expectBulletList(
    /^- \[(platform-feature-(0[1-9]|[1-9][0-9])-risk-(0[1-9]|[1-9][0-9]))\]\((platform-feature-(0[1-9]|[1-9][0-9])-risk-(0[1-9]|[1-9][0-9])\.md)\)$/,
    "feature.related_risks_list",
    "Each related risk entry must follow the approved format '- [platform-feature-01-risk-01](platform-feature-01-risk-01.md)'.",
    ({ item, match, parser }) => {
      const riskId = match[1];
      const linkedFile = match[4];
      const expectedFile = `${riskId}.md`;

      if (linkedFile !== expectedFile) {
        parser.error(
          item.line,
          "feature.related_risks_link_match",
          `The related risk entry labels this risk as '${riskId}', but links to '${linkedFile}'. The link target must match the risk identifier exactly.`,
          `Rewrite the link as '- [${riskId}](${expectedFile})'.`
        );
        return false;
      }

      return true;
    }
  );
  return state.diagnostics;
}

function validateRiskFile(filePath, basename, items, passLogs) {
  const state = createParser(filePath, items, passLogs);

  // Risk playbooks describe how a platform feature could be misused and what
  // harmful outcome that misuse could create. These checks keep that story
  // complete, consistent, and easy to compare across many playbooks.
  const heading = state.expect(
    /^## (platform-feature-(0[1-9]|[1-9][0-9])-risk-(0[1-9]|[1-9][0-9]))$/,
    "risk.heading",
    "The risk heading must be written exactly as '## platform-feature-01-risk-01', where each numbered placeholder uses a two-digit value from 01 to 99."
  );

  const headingSlug = heading?.match[1] ?? null;
  if (headingSlug && headingSlug !== basename) {
    state.error(
      heading.line,
      "heading.filename_match",
      `The top heading identifies this file as '${headingSlug}', but the filename is '${basename}.md'. These two identifiers must match so the document can be reviewed consistently.`,
      `Rename the file to '${headingSlug}.md', or change the heading to '## ${basename}' so the heading and filename agree.`
    );
  }
  if (headingSlug === basename) {
    state.pass(heading.line, `The top heading matches the filename identifier '${headingSlug}'.`);
  }

  state.expectText("### Description", "risk.description_heading", "The next required section heading is '### Description'.");
  const description = state.expectOneOf(
    [
      /^Because the iOS platform provides (.+) feature, your application is at risk of an attacker (.+)\.$/,
      /^Because the iOS platform provides (.+) feature, your application$/,
    ],
    "risk.description_sentence",
    "The risk description must follow the approved public template exactly."
  );
  const featureName = description?.match[1] ?? null;
  let technique = description?.match[2] ?? null;

  if (description && !technique) {
    const continuation = state.expect(
      /^is at risk of an attacker (.+)\.$/,
      "risk.description_continuation",
      "When the risk description is split over two lines, the second line must be written exactly as 'is at risk of an attacker <technique>.'"
    );
    if (continuation) {
      technique = continuation.match[1];
    }
  }
  if (description) {
    state.pass(description.line, "The risk description follows the approved public wording.");
  }

  // The goal section explains the consequence of the risk.
  // The demonstration section shows the risk in action using a structured,
  // repeatable format. Each missing or malformed part is a failure.
  state.expectText("### Goal", "risk.goal_heading", "The next required section heading is '### Goal'.");
  state.expect(
    /^As a result, this could lead to .+$/,
    "risk.goal_sentence",
    "The goal sentence must begin with 'As a result, this could lead to ' and include a non-empty tactic or outcome description."
  );
  state.expectText("### Demonstration", "risk.demonstration_heading", "The next required section heading is '### Demonstration'.");
  state.expect(
    /^Set up .+ with the following configuration:$/,
    "risk.setup_line",
    "The setup line must be written exactly as 'Set up <environment> with the following configuration:'."
  );
  state.expectTable();

  const stepsIntro = state.find(
    /^Perform the following steps to demonstrate the risk of an attacker (.+):$/,
    "risk.steps_intro",
    "The step introduction must be written exactly as 'Perform the following steps to demonstrate the risk of an attacker <technique>:' and must appear after the demonstration setup."
  );
  if (stepsIntro && technique && stepsIntro.match[1] !== technique) {
    state.error(
      stepsIntro.line,
      "risk.steps_technique",
      `The demonstration introduction names the attacker technique as '${stepsIntro.match[1]}', but the description section names it as '${technique}'. The same technique must be used throughout the document.`,
      `Rewrite the line as 'Perform the following steps to demonstrate the risk of an attacker ${technique}:'.`
    );
  }
  if (stepsIntro && technique && stepsIntro.match[1] === technique) {
    state.pass(stepsIntro.line, "The demonstration introduction uses the same attacker technique as the description.");
  }

  // The technique named in the demonstration must match the technique named in
  // the description. This prevents public-facing documents from drifting into
  // inconsistent attacker narratives.
  state.expectNumberedList(
    /^(\d+)\. .+ to .+$/,
    "risk.demo_steps",
    "Each demonstration step must follow the approved format '1. <action_verb> to <objective>'.",
    { allowImageLines: true }
  );
  return state.diagnostics;
}

function validateControlFile(filePath, basename, items, passLogs) {
  const state = createParser(filePath, items, passLogs);

  // Control playbooks are intentionally concise. They must identify the risk,
  // provide a detection step, provide a prevention step, and point to the APK
  // that demonstrates the control. Anything missing becomes a failure.
  const heading = state.expect(
    /^## (platform-feature-(0[1-9]|[1-9][0-9])-risk-(0[1-9]|[1-9][0-9])-control-(0[1-9]|[1-9][0-9]))$/,
    "control.heading",
    "The control heading must be written exactly as '## platform-feature-01-risk-01-control-01', where each numbered placeholder uses a two-digit value from 01 to 99."
  );

  const headingSlug = heading?.match[1] ?? null;
  if (headingSlug && headingSlug !== basename) {
    state.error(
      heading.line,
      "heading.filename_match",
      `The top heading identifies this file as '${headingSlug}', but the filename is '${basename}.md'. These two identifiers must match so the document can be reviewed consistently.`,
      `Rename the file to '${headingSlug}.md', or change the heading to '## ${basename}' so the heading and filename agree.`
    );
  }
  if (headingSlug === basename) {
    state.pass(heading.line, `The top heading matches the filename identifier '${headingSlug}'.`);
  }

  state.expect(
    /^Your app can prevent the risk of an attacker (.+) by taking the following steps:$/,
    "control.intro",
    "The control introduction must be written exactly as 'Your app can prevent the risk of an attacker <technique> by taking the following steps:'."
  );
  state.expectNumberedList(
    /^(\d+)\. .+$/,
    "control.steps",
    "Each control step must be a numbered item written as '1. <instructions>'."
  );
  state.find(
    /^The APK with the implemented control can be found \[here\]\((.+)\)\.$/,
    "control.apk_link",
    "The APK line must be written exactly as 'The APK with the implemented control can be found [here](path).' and must appear after the numbered control steps."
  );
  return state.diagnostics;
}

function createParser(filePath, items, passLogs) {
  return {
    diagnostics: [],
    index: 0,
    pass(line, message) {
      passLogs.push(makePassLog(filePath, line, message));
    },
    error(line, rule, message, howToFix) {
      this.diagnostics.push(makeDiagnostic(filePath, line, rule, message, howToFix));
    },
    current() {
      return items[this.index];
    },
    // Generic sequential matcher:
    // - Pass: advances to the next meaningful line and records a notice.
    // - Fail: records a blocking diagnostic with a suggested repair.
    //
    // This pattern keeps new rule authoring scalable because most future
    // structure checks can be expressed as "expect this next line to match."
    expect(pattern, rule, message) {
      const item = this.current();
      if (!item) {
        this.error(items.at(-1)?.line ?? 1, rule, `${message} The document ends before that required line appears.`, "Add the missing line in the required position so the document can continue through review.");
        return null;
      }

      const match = item.text.match(pattern);
      if (!match) {
        this.error(item.line, rule, `${message} The review found '${item.text}' on this line instead.`, `Replace line ${item.line} with the required template text so the document matches the approved format.`);
        this.index += 1;
        return null;
      }

      this.index += 1;
      this.pass(item.line, `The required check '${rule}' passed at this line.`);
      return { ...item, match };
    },
    // Look-ahead matcher:
    // - Pass: scans forward until a matching meaningful line is found.
    // - Fail: records a blocking diagnostic if the required line never appears.
    //
    // This is used for cases where supporting content may appear between two
    // required sections, but the required line must still appear later in the
    // document.
    find(pattern, rule, message) {
      for (let offset = this.index; offset < items.length; offset += 1) {
        const item = items[offset];
        const match = item.text.match(pattern);
        if (match) {
          this.index = offset + 1;
          this.pass(item.line, `The required check '${rule}' passed at this line.`);
          return { ...item, match };
        }
      }

      this.error(
        items.at(-1)?.line ?? 1,
        rule,
        `${message} The document ends before that required line appears.`,
        "Add the missing line after the numbered demonstration steps so the document matches the approved feature format."
      );
      return null;
    },
    // Variant matcher for cases where the public template permits one of a
    // small number of exact phrasings, such as a sentence split over two lines.
    expectOneOf(patterns, rule, message) {
      const item = this.current();
      if (!item) {
        this.error(items.at(-1)?.line ?? 1, rule, `${message} The document ends before an approved version of this line appears.`, "Add the missing line in the required position so the document can continue through review.");
        return null;
      }

      for (const pattern of patterns) {
        const match = item.text.match(pattern);
        if (match) {
          this.index += 1;
          this.pass(item.line, `${rule} passed.`);
          return { ...item, match };
        }
      }

      this.index += 1;
      this.error(item.line, rule, `${message} The review found '${item.text}' on this line instead.`, `Replace line ${item.line} with wording that matches one of the approved template options.`);
      return null;
    },
    expectText(text, rule, message) {
      return this.expect(new RegExp(`^${escapeRegex(text)}$`), rule, message);
    },
    // Required configuration-table check:
    // - Pass: header is exact and separator is present.
    // - Fail: missing table, wrong header, or too few rows.
    //
    // General Markdown table quality is also checked elsewhere by checkTables().
    expectTable() {
      const start = this.current();
      if (!start || !start.text.startsWith("|")) {
        this.error(
          start?.line ?? items.at(-1)?.line ?? 1,
          "table.missing",
          "A configuration table is required immediately after the setup line, but no table appears in that position.",
          "Add a table in that position with the exact header '| Configuration | Detail |' and a separator row."
        );
        return null;
      }

      const tableLines = [];
      while (this.current() && this.current().text.startsWith("|")) {
        tableLines.push(this.current());
        this.index += 1;
      }

      if (tableLines.length < 2) {
        this.error(
          start.line,
          "table.row_count",
          `The configuration table must contain at least 2 lines, but only ${tableLines.length} line(s) were found.`,
          "Add the required header row and separator row."
        );
        return null;
      }

      const headerCells = parseTableCells(tableLines[0].text);
      if (headerCells.length !== 2 || headerCells[0] !== "Configuration" || headerCells[1] !== "Detail") {
        this.error(
          tableLines[0].line,
          "table.header",
          `The configuration table header must be '| Configuration | Detail |', but the review found '${tableLines[0].text}' instead.`,
          "Change the first row of the table to '| Configuration | Detail |'."
        );
        return null;
      }

      this.pass(tableLines[0].line, "The configuration table uses the approved header.");
      this.pass(tableLines[1].line, "The configuration table includes a separator row.");
      return tableLines;
    },
    // Numbered-list check:
    // - Pass: at least one numbered item exists and every item matches the rule.
    // - Fail: the list is missing or any item breaks the agreed sentence pattern.
    expectNumberedList(itemPattern, rule, message, options = {}) {
      const { allowImageLines = false } = options;
      const start = this.current();
      if (!start || !/^\d+\.\s+/.test(start.text)) {
        this.error(
          start?.line ?? items.at(-1)?.line ?? 1,
          rule,
          `${message} A numbered list item was required at this point, but none was found.`,
          "Add at least one numbered item that follows the required template."
        );
        return null;
      }

      let count = 0;
      while (this.current()) {
        const item = this.current();
        if (/^\d+\.\s+/.test(item.text)) {
          if (!itemPattern.test(item.text)) {
            this.error(
              item.line,
              rule,
              `${message} The review found '${item.text}' on this line instead.`,
              `Rewrite line ${item.line} so it follows the required numbered-list format.`
            );
            return null;
          }

          count += 1;
          this.pass(item.line, `Numbered list item ${count} passed the '${rule}' review check.`);
          this.index += 1;
          continue;
        }

        if (allowImageLines && /^<img\b.+>$/.test(item.text)) {
          this.pass(item.line, `Supporting image line ${count > 0 ? `after item ${count}` : "within the list block"} is allowed for '${rule}'.`);
          this.index += 1;
          continue;
        }

        break;
      }

      return true;
    },
    expectBulletList(itemPattern, rule, message, validateItem = null) {
      const start = this.current();
      if (!start || !/^- /.test(start.text)) {
        this.error(
          start?.line ?? items.at(-1)?.line ?? 1,
          rule,
          `${message} A bullet list item was required at this point, but none was found.`,
          "Add at least one bullet item that follows the required template."
        );
        return null;
      }

      let count = 0;
      while (this.current() && /^- /.test(this.current().text)) {
        const item = this.current();
        const match = item.text.match(itemPattern);
        if (!match) {
          this.error(
            item.line,
            rule,
            `${message} The review found '${item.text}' on this line instead.`,
            `Rewrite line ${item.line} so it follows the required bullet-list format.`
          );
          return null;
        }

        if (validateItem) {
          const isValid = validateItem({ item, match, parser: this });
          if (!isValid) {
            return null;
          }
        }

        count += 1;
        this.pass(item.line, `Bullet list item ${count} passed the '${rule}' review check.`);
        this.index += 1;
      }

      return true;
    },
    // End-of-document guard:
    // - Pass implicitly when no extra content remains.
    // - Fail when unexpected material appears after the final required section.
    expectEnd(rule, message) {
      if (this.current()) {
        this.error(
          this.current().line,
          rule,
          `${message} The review found additional content here: '${this.current().text}'.`,
          "Remove the extra content that appears after the final required section."
        );
      }
    },
  };
}

function inferTypeFromFilename(basename) {
  // Filename classification is strict because the filename determines which
  // public template will be enforced next.
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

function checkTrailingWhitespace(filePath, lines, passLogs) {
  const diagnostics = [];
  let foundIssue = false;

  // Trailing whitespace is a fail-only hygiene check.
  // It does not change the meaning of the content, but it does reduce
  // consistency and creates avoidable noise in reviews and diffs.
  for (const [index, line] of lines.entries()) {
    if (/[ \t]+$/.test(line)) {
      foundIssue = true;
      diagnostics.push(
        makeDiagnostic(
          filePath,
          index + 1,
          "whitespace.trailing",
          `This line ends with trailing whitespace, which is not allowed in the reviewed document. The line appears as '${visualizeWhitespace(line)}'.`,
          "Remove the spaces or tabs at the end of this line."
        )
      );
    }
  }

  if (!foundIssue) {
    passLogs.push(makePassLog(filePath, 1, "No trailing whitespace was found in this document."));
  }

  return diagnostics;
}

function checkUnreplacedPlaceholders(filePath, lines, passLogs) {
  const diagnostics = [];
  let foundIssue = false;

  // Placeholder checks protect against unfinished template content reaching a
  // public review. Any remaining placeholder or stray brace is a failure.
  for (const [index, line] of lines.entries()) {
    const placeholder = line.match(/\{[^}]*\}/);
    if (placeholder) {
      foundIssue = true;
      diagnostics.push(
        makeDiagnostic(
          filePath,
          index + 1,
          "placeholder.unreplaced",
          `This line still contains the placeholder '${placeholder[0]}', which indicates that template text was not replaced with final content. The affected line is '${line.trim()}'.`,
          "Replace the placeholder with the final playbook content intended for public review."
        )
      );
      continue;
    }

    if (/[{}]/.test(line)) {
      foundIssue = true;
      diagnostics.push(
        makeDiagnostic(
          filePath,
          index + 1,
          "placeholder.braces",
          `This line contains an unexpected brace character, which may indicate leftover template content. The affected line is '${line.trim()}'.`,
          "Remove the '{' or '}' character, or replace the remaining template text with final content."
        )
      );
    }
  }

  if (!foundIssue) {
    passLogs.push(makePassLog(filePath, 1, "No unreplaced placeholders or stray template braces were found."));
  }

  return diagnostics;
}

function checkInternalLinks(filePath, lines, passLogs) {
  const warnings = [];
  const directory = path.dirname(filePath);
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  let linkCount = 0;

  // Internal link checks confirm that local repository references still point
  // to real files. External links and in-page anchors are excluded because
  // this validator is focused on repository integrity.
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(linkPattern)) {
      const rawTarget = match[1].trim();
      const target = rawTarget.startsWith("<") && rawTarget.endsWith(">") ? rawTarget.slice(1, -1) : rawTarget;

      if (target.startsWith("http://") || target.startsWith("https://") || target.startsWith("mailto:") || target.startsWith("#")) {
        continue;
      }

      const [relativePath] = target.split("#");
      const resolvedPath = path.resolve(directory, relativePath);

      if (!fs.existsSync(resolvedPath)) {
        warnings.push(
          makeWarning(
            filePath,
            index + 1,
            "link.internal_exists",
            `This internal repository link points to '${relativePath}', but that file does not exist from the perspective of this document. The affected line is '${line.trim()}'.`,
            "Correct the relative path, or add the missing file so the link can be reviewed successfully."
          )
        );
        continue;
      }

      linkCount += 1;
      passLogs.push(makePassLog(filePath, index + 1, `The internal repository link target '${relativePath}' exists and can be resolved from this document.`));
    }
  }

  if (linkCount === 0) {
    passLogs.push(makePassLog(filePath, 1, "No internal repository links were found in this document, so no local link validation was required."));
  }

  return warnings;
}

function checkTables(filePath, lines, passLogs) {
  const diagnostics = [];
  let index = 0;
  let tableCount = 0;

  // This is the broad Markdown table quality check.
  // It runs independently from the required-structure table check so that:
  // - required configuration tables must appear in the right place, and
  // - any table anywhere in the file must still be well-formed Markdown.
  while (index < lines.length) {
    if (!lines[index].trim().startsWith("|")) {
      index += 1;
      continue;
    }

    const block = [];
    const lineNumber = index + 1;

    while (index < lines.length && lines[index].trim().startsWith("|")) {
      block.push(lines[index].trim());
      index += 1;
    }

    tableCount += 1;

    if (block.length < 2) {
      diagnostics.push(
        makeDiagnostic(
          filePath,
          lineNumber,
          "table.markdown_row_count",
          `The Markdown table starting at line ${lineNumber} must include a header row and a separator row, but only ${block.length} row(s) were found.`,
          "Add the missing header row or separator row so the table is complete."
        )
      );
      continue;
    }

    const widths = block.map(parseTableCells);
    const expectedColumnCount = widths[0].length;

    if (expectedColumnCount < 2) {
      diagnostics.push(
        makeDiagnostic(
          filePath,
          lineNumber,
          "table.markdown_column_count",
          `The Markdown table starting at line ${lineNumber} has only ${expectedColumnCount} column(s), but at least 2 columns are required for review.`,
          "Add enough pipe-separated columns for the table to contain at least two columns."
        )
      );
      continue;
    }

    const separatorCells = widths[1];
    if (separatorCells.length !== expectedColumnCount || separatorCells.some((cell) => !/^:?-{3,}:?$/.test(cell))) {
      diagnostics.push(
        makeDiagnostic(
          filePath,
          lineNumber + 1,
          "table.separator",
          `The table separator row at line ${lineNumber + 1} is not valid Markdown table syntax. The review found '${block[1]}' instead.`,
          "Use a separator row such as '| -------- | ------- |' so the table is recognized correctly."
        )
      );
    } else {
      passLogs.push(makePassLog(filePath, lineNumber + 1, `Markdown table ${tableCount} includes a valid separator row.`));
    }

    for (let offset = 0; offset < widths.length; offset += 1) {
      if (widths[offset].length !== expectedColumnCount) {
        diagnostics.push(
          makeDiagnostic(
            filePath,
            lineNumber + offset,
            "table.column_alignment",
            `The table row at line ${lineNumber + offset} has ${widths[offset].length} column(s), but the header row establishes ${expectedColumnCount} column(s). The review found '${block[offset]}' on this line.`,
            "Adjust this row so it uses the same number of columns as the table header."
          )
        );
      }
    }
  }

  if (tableCount === 0) {
    passLogs.push(makePassLog(filePath, 1, "No additional Markdown tables were found outside the required structure checks."));
  }

  return diagnostics;
}

function parseTableCells(line) {
  // Table parsing is intentionally simple because the supported playbook tables
  // are expected to be plain Markdown tables without advanced escaping rules.
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function walkMarkdownFiles(rootDirectory) {
  // When stdin is not provided, the validator reviews every Markdown file under
  // the playbooks directory so local full-repository checks remain simple.
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
  // Stdin mode supports pull-request workflows that want to validate only the
  // files changed in a proposal rather than rechecking the entire directory.
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

function makeDiagnostic(file, line, rule, message, howToFix = "") {
  // Diagnostics represent blocking failures.
  return { file, line, rule, message, howToFix };
}

function makeWarning(file, line, rule, message, howToFix = "") {
  // Warnings represent advisory issues that should not fail the review.
  return { file, line, rule, message, howToFix };
}

function makePassLog(file, line, message) {
  // Pass logs represent successful checks and are emitted as plain logs.
  return { file, line, message };
}

function emitGitHubError({ file, line, rule, message }) {
  // GitHub error annotations are used for failures because they make the
  // workflow fail and point reviewers directly to the affected line.
  const escapedMessage = escapeWorkflowValue(`[${rule}] ${message}`);
  console.log(`::error file=${file},line=${line},title=Playbook validation::${escapedMessage}`);
}

function emitGitHubWarning({ file, line, rule, message }) {
  // GitHub warnings are used for advisory issues that deserve attention
  // without blocking the document from moving forward.
  const escapedMessage = escapeWorkflowValue(`[${rule}] ${message}`);
  console.log(`::warning file=${file},line=${line},title=Playbook validation::${escapedMessage}`);
}

function escapeWorkflowValue(value) {
  // Workflow annotation values must be escaped so special characters do not
  // corrupt the log output shown in GitHub Actions.
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeRegex(value) {
  // User-facing literal text is escaped before building regex patterns so the
  // validator treats template text as text, not as regex syntax.
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function visualizeWhitespace(line) {
  // Whitespace is visualized to make invisible formatting problems readable in
  // failure messages.
  return line.replace(/\t/g, "\\t").replace(/ /g, "·");
}

await main();
