---
name: dynamodb-data-modeling
description: Use this skill when designing, reviewing, or modifying DynamoDB persistence, single-table design, access patterns, PK/SK, GSIs, LSIs, item collections, Query vs Scan behavior, conditional writes, transactions, pagination, migrations, uniqueness, denormalization, or Liass-OHADA backend repository/data model code.
---

# DynamoDB Data Modeling Skill

## Purpose

Use this skill to keep Liass-OHADA DynamoDB persistence access-pattern driven, scalable, maintainable, and cleanly separated from API/frontend DTOs.

This skill complements `ohada-legal-reference`:

- `ohada-legal-reference` validates OHADA/SYSCOHADA business meaning.
- `dynamodb-data-modeling` validates persistence design and DynamoDB access patterns.

## Mandatory behavior

When working on DynamoDB-related features, Codex must:

1. Identify access patterns before changing data models.
2. Read the relevant files in `references/`.
3. Inspect and preserve the existing `KeyFactory` before generating or modifying DynamoDB persistence code.
4. Treat the existing `KeyFactory` implementation as the source of truth for concrete PK, SK, GSI key names, key formats, prefixes, and helper methods.
5. Prefer `Query` or direct item operations over `Scan`.
6. Document PK, SK, and GSI key shapes for every new or changed item type.
7. Justify every GSI with a concrete access pattern.
8. Keep DynamoDB physical keys out of frontend-safe DTOs.
9. Separate business attributes from indexing attributes.
10. Use conditional writes or transactions for uniqueness and accounting integrity.
11. Consider pagination, hot partitions, item collection size, and migration impact.
12. Preserve existing architecture, shared DTO boundaries, tests, and i18n conventions.
13. Treat the reference files as intended conventions and design principles, not replacements for `KeyFactory`.
14. Do not rename PK/SK/GSI formats or introduce new key formats unless the task explicitly asks for a key model refactor.
15. Respect domain ownership: physical co-location in the shared table does not authorize a domain to use another domain's internal key helpers, repositories, or persistence operations.
16. Use an explicit API or versioned event for cross-domain collaboration rather than direct cross-domain persistence writes.
17. Before constructing a transaction, verify current DynamoDB operation, item-size, and transaction-size limits; address each physical item at most once per transaction. Combine intended changes to one item into one conditional operation, or redesign the boundary without losing atomicity.
18. Condition uniqueness reservations, versions, and state transitions on their expected prior state. Treat conditional failures and transaction conflicts as explicit concurrency outcomes; never silently overwrite or assume a failed write committed.
19. Specify required read consistency per access pattern. A GSI is eventually consistent and cannot alone prove an immediate uniqueness, lock, or post-commit invariant; use authoritative conditional writes or base-table reads where required.
20. Make retryable commands idempotent with durable intent/result evidence. After an ambiguous timeout or transaction outcome, resolve the authoritative outcome before retrying; never generate a new operation identity for the same intent.
21. Assess hot-item contention, partition throughput, transaction amplification, payload size, and realistic concurrency. Validate material scalability risks with representative measurements rather than assuming fiscal-year partitioning alone removes them.
22. For derived projections, define source-of-truth ownership, lag tolerance, reconciliation, and deterministic, repeatable rebuilding when a failure can leave the projection stale.

## Reference priority

Use the reference files in this order:

1. `references/liass-ohada-access-patterns.md`  
   Use this to document or review feature-specific access patterns.

2. `references/liass-ohada-single-table-conventions.md`  
   Use this for Liass-OHADA-specific key naming, item collections, entity types, and DTO boundaries.

3. `references/dynamodb-modeling-principles.md`  
   Use this for general DynamoDB modeling principles, anti-patterns, and review checklist.

## Implementation workflow

1. Identify the feature and module.
2. List access patterns before touching code.
3. Read the relevant reference files.
4. Decide whether the existing table/index design supports the access patterns.
5. Propose the smallest coherent persistence change.
6. Keep PK/SK/GSI mapping inside repository or persistence adapter layers.
7. Add or update tests for query shape, mapping, conditions, and transactions.
8. Mention any access pattern not supported by the current model.

## Final response requirements

When this skill is used, Codex must summarize:

- access patterns considered;
- DynamoDB references consulted;
- key/index changes made;
- files changed;
- tests added or updated;
- risks, tradeoffs, or unsupported access patterns.
- transaction/consistency assumptions, retry and conflict behavior, and any projection-recovery or scalability risks relevant to the change.
