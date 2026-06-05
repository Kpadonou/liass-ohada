# DynamoDB Modeling Principles

> Internal reference notes for the Liass-OHADA project.
> This file is a project-oriented synthesis of DynamoDB data modeling practices. It is not a copy of the book.

## Purpose

Use this reference when designing, reviewing, or modifying DynamoDB persistence for Liass-OHADA.

The objective is to keep the DynamoDB model access-pattern driven, scalable, maintainable, and compatible with the project's backend/frontend boundaries.

## Core principles

### 1. Start with access patterns

Do not start DynamoDB modeling from entities alone.

Before creating or changing a table, item type, key, or index, identify:

- who reads the data;
- who writes the data;
- the exact query shape;
- required filters;
- required sort order;
- expected cardinality;
- expected pagination;
- consistency requirements;
- write frequency;
- read frequency.

A DynamoDB model is correct only if it efficiently supports the required access patterns.

### 2. Prefer Query over Scan

A production access pattern should normally use `Query`, not `Scan`.

`Scan` may be acceptable only for admin maintenance, migrations, debugging scripts, rare back-office jobs, or offline export/analytics workflows.

If a feature requires regular scanning, reconsider the key design or add an appropriate index.

### 3. Single-table design is access-pattern driven

Single-table design should group related items into item collections so that one query can retrieve the data needed by a use case.

Use item collections intentionally. Do not place items under the same partition key merely because they are related conceptually.

### 4. Separate application attributes from index attributes

Keep business attributes separate from physical/indexing attributes.

Business attributes may include `organizationId`, `fiscalYear`, `accountNumber`, `journalCode`, and `entryDate`.

Index attributes may include `PK`, `SK`, `GSI1PK`, `GSI1SK`, and `entityType`.

Frontend-safe DTOs must not expose `PK`, `SK`, `GSI*`, or internal persistence structure.

### 5. Use explicit item types

Every item should have an explicit type attribute.

Recommended value examples:

```text
ACCOUNT
JOURNAL
ENTRY
ENTRY_LINE
INVOICE
PAYMENT
THIRD_PARTY
AUDIT_EVENT
```

### 6. Design composite keys intentionally

Composite keys should be readable and predictable.

Examples:

```text
PK = ORG#{organizationId}
SK = ACC#{accountId}

PK = ORG#{organizationId}#FY#{year}
SK = ENTRY#{entryDate}#{entryId}
```

Use prefixes to group item types and support `begins_with` queries.

### 7. Use sort keys for hierarchy and sorting

Sort keys can support hierarchy, chronology, filtering by prefix, range queries, and stable pagination.

Examples:

```text
SK = JOURNAL#{journalCode}
SK = ENTRY#{entryDate}#{entryId}
SK = LINE#{entryId}#{lineNumber}
SK = INV#{createdAt}#{invoiceId}
```

For numeric sorting, use zero-padding where appropriate.

### 8. Justify every GSI

Each GSI must be tied to a documented access pattern.

For every GSI, document:

- access pattern name;
- GSI partition key;
- GSI sort key;
- projected attributes;
- expected cardinality;
- whether the index is sparse;
- pagination behavior;
- consistency implications.

### 9. Use sparse indexes when useful

A sparse index is useful when only some item types need to appear in the index.

Examples: unpaid invoices, pending approvals, open fiscal years, active projects, audit events by actor.

Only populate the GSI attributes on items that should be indexed.

### 10. Duplicate data intentionally

DynamoDB often favors controlled denormalization.

Duplicate data only when it avoids expensive reads, the duplicated values are stable or easy to update, update consistency is understood, and tests cover the update path.

### 11. Model many-to-many relationships explicitly

Use one of these strategies:

- shallow duplication;
- adjacency list;
- materialized graph;
- normalized items plus multiple queries.

For accounting relationships, link entities should usually be explicit and auditable.

Examples:

```text
PaymentInvoiceLink
LettrageLine
ProjectAllocation
```

### 12. Enforce uniqueness with conditional writes

When an attribute must be unique, use conditional writes or a dedicated uniqueness item.

Examples:

```text
UNIQUE#ORG#{organizationId}#ACCOUNT#{accountNumber}
UNIQUE#ORG#{organizationId}#JOURNAL#{journalCode}
UNIQUE#ORG#{organizationId}#INVOICE#{invoiceNumber}
```

Use transactions where multiple items must be created atomically.

### 13. Use transactions for accounting integrity

For accounting workflows, use DynamoDB transactions when several writes must succeed or fail together.

Examples:

- create entry header + entry lines;
- create invoice + automatic accounting entry;
- create payment + payment allocation + accounting entry;
- create account + uniqueness guard;
- post journal entry + audit event.

### 14. Plan migrations

Prefer additive changes when possible.

For migrations:

- define old and new item shapes;
- write backfill scripts;
- use parallel scans only for controlled migration jobs;
- support dual-read or dual-write if necessary;
- add metrics and logs;
- make migration idempotent.

### 15. Keep analytics separate from OLTP

DynamoDB is optimized for operational access patterns, not ad hoc analytics.

For complex reporting, exports, BI, or large financial analytics, consider DynamoDB Streams, S3 export, Athena, OpenSearch, materialized read models, or dedicated reporting tables.

## Anti-patterns

Avoid:

- relational modeling first, DynamoDB keys later;
- using `Scan` as a normal access pattern;
- creating indexes without access-pattern justification;
- exposing keys in frontend DTOs;
- generic repository methods that hide access patterns;
- using a heavy ORM that obscures DynamoDB behavior;
- assuming "schemaless" means no application schema;
- storing everything under one hot partition;
- using filters to compensate for weak key design;
- adding random denormalization without update strategy.

## Final checklist

Before accepting a DynamoDB design, confirm:

- access patterns are listed;
- PK/SK design supports the queries;
- GSIs are justified;
- hot partitions are considered;
- DTOs do not expose persistence keys;
- writes requiring integrity use transactions;
- uniqueness is enforced where needed;
- pagination is planned;
- migrations are considered;
- tests cover critical access patterns.
