# Liass-OHADA DynamoDB Single-Table Conventions

> Internal reference notes for DynamoDB persistence in Liass-OHADA.

## Purpose

This file defines project-specific DynamoDB conventions for Liass-OHADA.

Use it together with:

- `dynamodb-modeling-principles.md`
- OHADA/SYSCOHADA references when the persistence model stores accounting data.

## Source of truth

The examples in this file are illustrative conventions and design guidance for Liass-OHADA. They are not absolute replacements for existing code.

The concrete source of truth for PK, SK, GSI key names, key formats, prefixes, and helper methods is the existing `KeyFactory` implementation in the codebase.

Before generating or modifying DynamoDB persistence code, Codex must inspect the current `KeyFactory` and reuse its existing methods and naming conventions.

If this document conflicts with `KeyFactory`, `KeyFactory` takes precedence.

Codex must not rename PK/SK/GSI patterns or introduce new key formats unless the task explicitly asks for a key model refactor.

## General table approach

Liass-OHADA uses a single-table oriented DynamoDB model.

The model must support:

- multi-organization tenancy;
- future multi-country support;
- fiscal-year partitioning where useful;
- auditable accounting operations;
- automatic accounting entries;
- separation between persistence shape and API/frontend DTOs.

## Naming conventions

Typical key attributes to align with KeyFactory:

```text
PK
SK
GSI1PK
GSI1SK
GSI2PK
GSI2SK
entityType
```

Typical business identifiers:

```text
organizationId
fiscalYear
accountId
accountNumber
journalCode
entryId
entryLineId
invoiceId
paymentId
thirdPartyId
projectId
```

## Do not expose physical keys

Never expose these in frontend-safe DTOs:

```text
PK
SK
GSI1PK
GSI1SK
GSI2PK
GSI2SK
entityType
```

Map them inside repository, mapper, or persistence adapter layers.

## Illustrative item collections to align with KeyFactory

The following examples are conventions/design guidance only. Verify every concrete PK, SK, GSI shape, prefix, and helper method against the existing `KeyFactory` before using them.

### Organization-level configuration

```text
PK = ORG#{organizationId}
SK = ORG#{organizationId}
SK = FY#{year}
SK = ACC#{accountId}
SK = JNL#{year}#{journalCode}
SK = TP#{type}#{thirdPartyId}
SK = PROJ#{projectId}
```

The following fiscal-year examples are illustrative and must be aligned with the existing `KeyFactory` before implementation.

### Fiscal-year operational data

```text
PK = ORG#{organizationId}#FY#{year}
SK = ENTRY#{entryDate}#{entryId}
SK = LINE#{entryId}#{lineNumber}
SK = INV#{invoiceDate}#{invoiceId}
SK = PAY#{paymentDate}#{paymentId}
SK = MATCH#{matchDate}#{matchingId}
SK = AUDIT#{eventDate}#{eventId}
```

## Typical entity types

```text
ORGANIZATION
FISCAL_YEAR
ACCOUNT
JOURNAL
THIRD_PARTY
PROJECT
ENTRY
ENTRY_LINE
INVOICE
PAYMENT
PAYMENT_INVOICE_LINK
MATCHING
MATCHING_LINE
AUDIT_EVENT
PRODUCT
STOCK_MOVEMENT
STOCK_LOT
FIXED_ASSET
```

## Access pattern documentation format

Every model change must document access patterns like this:

```md
### AP-001 — List accounts by organization

User story:
As an accountant, I need to list accounts for an organization.

Query:

- Table or index: Main table
- PK: illustrative organization partition, aligned with `KeyFactory`
- SK condition: illustrative account prefix, aligned with `KeyFactory`
- Sort order: account number ascending
- Pagination: yes
- Consistency: eventually consistent is acceptable
- Notes: frontend DTO must expose accountNumber, label, class, active status, not PK/SK.
```

## Common access patterns for Liass-OHADA

These examples are illustrative. Align every concrete key expression with the existing `KeyFactory`.

### Accounts

```text
Get account by ID:
PK = ORG#{organizationId}
SK = ACC#{accountId}

List accounts:
PK = ORG#{organizationId}
SK begins_with ACC#
```

### Journals

```text
List journals for fiscal year:
PK = ORG#{organizationId}
SK begins_with JNL#{year}#

Get journal:
PK = ORG#{organizationId}
SK = JNL#{year}#{journalCode}
```

### Entries

```text
List entries for fiscal year by date:
PK = ORG#{organizationId}#FY#{year}
SK begins_with ENTRY#

Entry line by account GSI:
GSI PK = ORG#{organizationId}#ACC#{accountId}
GSI SK = DATE#{entryDate}#ENTRY#{entryId}#LINE#{lineNumber}

Entry by journal GSI:
GSI PK = ORG#{organizationId}#FY#{year}#JNL#{journalCode}
GSI SK = DATE#{entryDate}#ENTRY#{entryId}
```

### Invoices by third party

```text
GSI PK = ORG#{organizationId}#TP#{thirdPartyId}
GSI SK = INV#{invoiceDate}#{invoiceId}
```

### Payments by fiscal year

```text
PK = ORG#{organizationId}#FY#{year}
SK = PAY#{paymentDate}#{paymentId}
```

### Audit trail

```text
PK = ORG#{organizationId}#FY#{year}
SK = AUDIT#{eventDate}#{eventId}
```

For actor-based audit queries, consider a sparse GSI:

```text
GSI PK = ORG#{organizationId}#ACTOR#{actorId}
GSI SK = DATE#{eventDate}#EVENT#{eventId}
```

## Accounting integrity rules

For accounting writes:

- create header and lines atomically when possible;
- enforce balanced debit/credit before persistence;
- write audit events for sensitive operations;
- prevent accidental mutation of posted entries;
- use conditional expressions for status transitions;
- use transactions for multi-item accounting writes.

## Review checklist

Before merging a DynamoDB change:

- access patterns are documented;
- no new Scan-based production workflow was introduced;
- every GSI has a clear reason;
- hot partition risk is considered;
- accounting writes preserve integrity;
- persistence keys remain internal;
- tests prove query shapes and mapping behavior.
