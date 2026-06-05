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
