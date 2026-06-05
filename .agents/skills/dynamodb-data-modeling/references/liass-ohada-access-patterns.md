# Liass-OHADA Access Patterns Template

> Copy this template when designing or reviewing a DynamoDB model change.

## Feature

Name:

Module:

Business context:

## Entities involved

- 
- 
- 

## Access patterns

### AP-001 — [Name]

User story:

Frequency:
- Read:
- Write:

Query shape:
- Operation: Query / GetItem / BatchGetItem / TransactWriteItems / UpdateItem
- Table/index:
- PK:
- SK condition:
- Filter expression:
- Projection:
- Sort order:
- Pagination:
- Consistency:

Expected cardinality:

Hot partition risk:

DTO mapping notes:

Tests required:

## Item shapes

### Item type: [ENTITY_TYPE]

```json
{
  "PK": "",
  "SK": "",
  "entityType": "",
  "businessField": ""
}
```

## Indexes

### GSI name: [Name]

Purpose:

Access pattern:

Keys:

```text
GSIxPK =
GSIxSK =
```

Projection:

Sparse index:
- Yes / No

## Writes and integrity

Does the workflow require a transaction?

Conditional writes needed?

Uniqueness constraints?

Audit event needed?

## Migration

Is this change additive?

Backfill needed?

Dual-read or dual-write needed?

Rollback plan:

## Final decision

Accepted design:

Rejected alternatives:

Reasons:
