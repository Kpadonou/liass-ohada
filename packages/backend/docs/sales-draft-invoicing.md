# SALES Draft Invoicing Core

S2A-BE owns editable draft invoices inside SALES. It does not issue invoices and does not claim national fiscal compliance.

## Access patterns

1. Create one draft with a conditional `PutItem` at `PK = ORG#{orgId}`, `SK = SALES_INVOICE#{invoiceId}`.
2. Get one draft with a consistent `GetItem` using the same organization-scoped key.
3. List draft summaries with `Query` on `PK = ORG#{orgId}` and `begins_with(SK, SALES_INVOICE#)`, a header-only projection, and an opaque cursor bound to that organization and prefix.
4. Update header fields or add, update, or remove a line by conditionally replacing the complete bounded aggregate at the caller's `expectedVersion`.

No access pattern uses `Scan` or a GSI. Physical keys remain backend-only.

## Aggregate representation

The invoice header and lines are serialized in one item. This gives every mutation one atomic condition and write: line state, line count, rounded totals, and aggregate version cannot diverge. It also gives detail reads a coherent snapshot without multi-item read retries.

The initial product limit is 100 lines. Existing contract limits cap a description at 2,000 characters and a unit at 80 characters; generated identifiers and bounded decimal strings keep a worst-case 100-line aggregate materially below DynamoDB's 400 KB item limit. This is a product and operational constraint, not a legal rule. List projections omit lines, although DynamoDB read capacity is still based on item size; future list scale or materially larger line payloads would justify revisiting the representation through a reviewed migration.

## Exact calculation policy

All authoritative arithmetic uses integer `BigInt` coefficients and decimal scales. No JavaScript floating-point multiplication determines canonical money.

For each line:

```text
lineSubtotal = ROUND_HALF_UP(quantity * unitPrice, currency minor units)
taxAmount    = ROUND_HALF_UP(lineSubtotal * taxRate / 100, currency minor units)
lineTotal    = lineSubtotal + taxAmount
```

Invoice totals are sums of the already rounded line subtotal, tax, and total values. The currency resolver accepts only runtime-supported ISO 4217 codes and obtains the minor-unit scale from the Node.js `Intl` currency metadata. Derived persistence values are non-negative integer minor-unit strings; shared DTOs expose canonical decimal strings.

The tax rate is a generic percentage only. It is not a VAT regime, DGI category, e-MECeF group, exemption code, or national fiscal rule.

## Deferred behavior

Issuance, immutable `ISSUED` invoices, official numbering, issue dates, PDF/S3 documents, fiscal certification, e-MECeF, discounts, credit notes, payments, receivables, Accounting posting, Treasury integration, and asynchronous events are outside S2A-BE.
