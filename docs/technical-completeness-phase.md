# Technical Completeness Phase

This document defines the proposed Phase 3 review for playbooks: AI-assisted technical completeness.

## Goal

Phase 3 should help reviewers answer:

- Are the technical claims in this playbook likely correct for Android?
- Does the playbook omit technical context that is necessary for those claims to hold up?

This phase should follow the existing review model already used in this repository:

- Phase 1: deterministic, blocking format validation
- Phase 2: AI-based, advisory clarity feedback
- Phase 3: AI-based, advisory technical completeness feedback

The initial rollout should be advisory only.

## Design Principles

- Keep deterministic format rules in `scripts/validate-playbooks.mjs`.
- Keep AI completeness review in its own script so it can evolve independently.
- Require structured model output and reject loose prose responses.
- Prefer high precision over high recall.
- Ask the model to abstain when uncertain.
- Separate incorrect claims from missing context so the output stays actionable.

## Scope

Phase 3 reviews technical completeness.

It should look for:

- platform mismatches
- technically incorrect mechanism descriptions
- unsupported or overstated security claims
- missing prerequisites needed to make a claim valid
- missing threat-model or environment assumptions
- demonstration steps that contradict the described feature, risk, or control

It should not look for:

- formatting problems
- missing required template sections
- general writing quality
- broad policy compliance
- vague stylistic suggestions that are not tied to technical completeness

## Review Outcomes

Phase 3 should emit advisory GitHub warnings, not blocking errors, during the first rollout.

Each finding should belong to one of two groups:

- Incorrect technical claim: something stated is likely wrong
- Technical completeness: something important is missing that makes the claim incomplete

## Proposed Categories

Incorrect technical claim categories:

- `platform_mismatch`
- `incorrect_mechanism`
- `unsupported_claim`
- `security_overclaim`
- `demo_inconsistency`

Technical completeness categories:

- `missing_prerequisite`
- `missing_constraint`
- `missing_security_tradeoff`
- `missing_platform_detail`
- `missing_threat_assumption`

## Proposed Script

Add a new script:

- `scripts/completeness-playbooks.mjs`

Responsibilities:

- read changed playbook paths from stdin or walk `playbooks/`
- call GitHub Models using a dedicated completeness prompt
- parse strict JSON responses only
- validate line numbers, categories, and required fields
- emit GitHub warning annotations for findings
- emit GitHub notice annotations when a file has no findings or the review is skipped

This should mirror the structure of `scripts/clarity-playbooks.mjs` so the repository keeps a consistent review pattern.

## Prompt Strategy

The model should be tightly constrained.

System prompt requirements:

- review Android playbook Markdown files for technical completeness
- do not check format, style, completeness of template sections, or prose clarity
- return no finding when uncertain
- do not speculate about implementation details that are not stated
- every finding must cite exact playbook evidence
- limit findings per file
- return strict JSON only

User prompt inputs should include:

- file path
- inferred playbook type
- filtered playbook content
- rubric for technical completeness checks

## Response Schema

The model response should use strict JSON with this shape:

```json
{
  "summary": "short summary",
  "findings": [
    {
      "line": 12,
      "category": "missing_prerequisite",
      "message": "The playbook claims data is protected at rest but does not explain how encryption keys are created or stored.",
      "evidence": "Feature 01 is a feature that protects sensitive data at rest.",
      "whyItMatters": "Without key-management context, the protection claim is technically incomplete.",
      "suggestedAddition": "Add a sentence explaining whether the key is hardware-backed, app-managed, or derived from user credentials."
    }
  ]
}
```

For incorrect-claim findings, `suggestedAddition` may be replaced with `suggestedRewrite`.

To simplify parsing, the implementation should normalize both variants into a common internal shape:

```json
{
  "file": "playbooks/platform-feature-01.md",
  "line": 12,
  "severity": "advisory",
  "category": "missing_prerequisite",
  "message": "The playbook claims data is protected at rest but does not explain how encryption keys are created or stored.",
  "evidence": "Feature 01 is a feature that protects sensitive data at rest.",
  "whyItMatters": "Without key-management context, the protection claim is technically incomplete.",
  "suggestion": "Add a sentence explaining whether the key is hardware-backed, app-managed, or derived from user credentials."
}
```

## Guardrails

The parser should reject a model response when:

- the response is not valid JSON
- the top-level object is malformed
- `findings` is missing or not an array
- a line number is missing or outside the file range
- a category is not in the approved allowlist
- `message` is empty
- `evidence` is empty
- `whyItMatters` is empty
- neither `suggestedRewrite` nor `suggestedAddition` is present

The review should also cap the number of findings per file to keep annotation noise manageable.

Recommended starting cap:

- maximum 5 findings per file
- maximum 2 technical completeness findings per file

## Workflow Integration

The workflow in `.github/workflows/review-playbooks.yml` should eventually run in this order:

1. Identify changed playbooks
2. Run blocking format validation
3. Run advisory clarity review
4. Run advisory technical completeness review

This keeps deterministic failures ahead of model-based review and preserves the repository's current phase ordering.

## Test Strategy

Add:

- `scripts/completeness-playbooks.test.mjs`

The first test set should focus on parser and normalizer behavior, not live model calls.

Recommended tests:

- accepts a valid incorrect-claim finding
- accepts a valid missing-context finding
- rejects malformed JSON
- rejects unknown categories
- rejects out-of-range line numbers
- rejects findings without evidence
- rejects findings without `whyItMatters`
- rejects findings without a suggestion field

Add example fixtures for manual review:

- `examples/completeness/correct/`
- `examples/completeness/platform-mismatch/`
- `examples/completeness/overclaim/`
- `examples/completeness/missing-prerequisite/`
- `examples/completeness/demo-inconsistency/`

## Rollout Plan

Stage 1:

- implement the script
- add tests
- run as advisory only
- collect feedback on signal quality

Stage 2:

- tune prompt and categories based on real PR findings
- suppress noisy categories if needed
- consider promoting only the highest-confidence categories to blocking

If promotion ever happens, it should be narrow and evidence-based. Good candidates would be:

- `platform_mismatch`
- `incorrect_mechanism`

Completeness categories should remain advisory.

## Non-Goals

Phase 3 should not attempt:

- full internet-backed fact checking
- exhaustive Android security auditing
- judgment about whether a playbook is ideal or complete in every possible way
- replacement for human security review

The purpose is to catch obvious technical errors and missing assumptions early, with useful and structured AI guidance.
