# Accounting Lot 4 Access Patterns

This document records the backend access-pattern decisions for the SYSCOHADA
grand livre, balance generale, and journal-specific livre-journal.

## AP-ACC-GL-001 - Paginated general ledger by account and fiscal year

- Operation: `Query`
- Index: `GSI1`
- Partition key: `GSI1PK = ORG#{orgId}`
- Sort-key condition:
  `begins_with(GSI1SK, ACC#{accountId}#FY#{year})`
- Sort order: account, fiscal year, entry date, line identifier
- Pagination: `Limit`, `ExclusiveStartKey`, opaque continuation cursor
- Consistency: eventually consistent; DynamoDB GSIs do not support
  `ConsistentRead: true`
- Response mapping: business identifiers and integer monetary amounts only
- Unsupported alternative: no `Scan`

The continuation cursor also carries the running balance reached at the end of
the previous page. It is read-only continuation state and never participates
in an accounting write.

## AP-ACC-BAL-001 - Trial balance from fiscal-year aggregates

- Operation: paginated `Query` completed inside the backend
- Table: main accounting table
- Partition key: `PK = ORG#{orgId}#FY#{year}`
- Sort-key condition: `begins_with(SK, BAL#)`
- Item key: `SK = BAL#{eightDigitAccountId}`
- Response: opening debit/credit, movement debit/credit, ending debit/credit
- Unsupported alternative: no `Scan`

The API returns the complete six-column trial balance. The backend follows
`LastEvaluatedKey` until the fiscal-year balance item collection is exhausted.

## AP-ACC-JB-001 - Paginated journal book for one journal

- Canonical route: `GET /journals/{journalCode}/entries`
- Operation: `Query`
- Index: `GSI5`
- Partition key: `GSI5PK = ORG#{orgId}#FY#{year}`
- Sort-key condition:
  `begins_with(GSI5SK, JNL#{journalCode}#DT#{datePrefix})`
- Sort order: date and entry identifier within the selected journal
- Filter: posted entry headers only
- Pagination: `Limit`, `ExclusiveStartKey`, opaque cursor
- Unsupported alternative: no `Scan`

`journalCode` is mandatory. GSI5 is journal-first, so it cannot produce a
global chronological inter-journal book. Supporting that future access pattern
requires an additive date-first index or materialized read model plus a
backfill; it must not be simulated with scans or client-side aggregation.

## Contract boundary

Public schemas expose no `PK`, `SK`, `GSI*`, or `entityType`. Physical keys and
cursor contents remain backend persistence details. Monetary amounts are
integers in the smallest currency unit.
