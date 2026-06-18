# ios-playbook

Playbook submissions live under `playbooks/` and are reviewed automatically on every pull request.

Phase 1 is implemented:
- strict format validation based on filename-inferred playbook type
- internal repo link checks
- Markdown table checks
- trailing whitespace checks
- placeholder detection for unreplaced `{...}` content

Phase 2 is implemented as an advisory AI review:
- GitHub Models-based clarity feedback in CI
- PR annotations for ambiguous wording, weak flow, vague steps, and inconsistent terminology
- non-blocking guidance that runs after the format validator passes

Phase 3 is planned:
- AI-assisted technical completeness review
- advisory findings for likely incorrect claims, overclaims, and missing technical context
- implementation design in `docs/technical-completeness-phase.md`

Expected filename patterns:
- `platform-feature-<slug>.md`
- `platform-feature-<slug>-risk-<slug>.md`
- `platform-feature-<slug>-risk-<slug>-control-<slug>.md`

Run the validator locally with:

```bash
node scripts/validate-playbooks.mjs
```

Run the advisory clarity reviewer locally with:

```bash
GITHUB_TOKEN=your_token_here node scripts/clarity-playbooks.mjs
```

Run the advisory technical completeness reviewer locally with:

```bash
GITHUB_TOKEN=your_token_here node scripts/completeness-playbooks.mjs
```

Run the clarity parser tests with:

```bash
node --test scripts/clarity-playbooks.test.mjs
```

Run the technical completeness parser tests with:

```bash
node --test scripts/completeness-playbooks.test.mjs
```

Smoke-test checklist after pushing:

1. Open a pull request that changes at least one Markdown file under `playbooks/`.
2. Confirm the `Review Playbooks` workflow starts automatically for that pull request.
3. Confirm the format review step passes or fails as expected for the changed playbook.
4. If the format review passes, confirm the advisory clarity review step runs afterward.
5. Confirm the advisory technical completeness review step runs after the clarity review step.
6. Confirm the pull request shows `Playbook clarity` and `Playbook technical completeness` annotations, or notices saying no suggestions were found.
7. If an AI review step reports a GitHub Models access error, verify that GitHub Models is available for the repository or organization and rerun the workflow.
