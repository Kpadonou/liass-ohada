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
- Period detail: additive top-level attributes
  `dailyDebit_YYYY_MM_DD` / `dailyCredit_YYYY_MM_DD` on the same `BAL#` item
- Response: opening debit/credit, movement debit/credit, ending debit/credit
- Unsupported alternative: no `Scan`

The API returns the complete six-column trial balance. The backend follows
`LastEvaluatedKey` until the fiscal-year balance item collection is exhausted.
Account labels are hydrated with chunked `BatchGetItem` calls against existing
`ACC#` account items.

Full-fiscal-year reads continue to use the annual opening and movement totals.
Intermediate periods use the additive daily attributes to derive movements and
the net opening balance before the selected start date. Before serving a
partial period, the backend reconciles the sum of all daily attributes to the
stored annual movement debit and credit. If they differ, the request fails
explicitly with `ERROR_TRIAL_BALANCE_PERIOD_AGGREGATES_INCOMPLETE`; it never
falls back to scanning or loading every journal line. Existing fiscal years
created before daily aggregation therefore require an offline, idempotent
aggregate rebuild before arbitrary-period balances are available.

Posting writes update the annual movement and the matching daily attributes in
the same accounting transaction. Draft entries have neither balance aggregate
updates nor general-ledger index attributes, so they cannot affect the balance
or drill-down.

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
