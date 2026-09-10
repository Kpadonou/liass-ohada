# SALES Payments and Receivables

S3A-BE keeps two independent state machines inside the SALES domain:

- `SalesInvoice` is the immutable commercial document after issuance. Its lifecycle remains `DRAFT -> ISSUED`; `PAID` is not an Invoice status.
- `SalesInvoiceReceivable` is the operational settlement state for one issued Invoice. Its derived status is `UNPAID`, `PARTIALLY_PAID`, or `PAID`.
- `SalesPayment` is an immutable recorded commercial settlement fact.

This Receivable is not the Accounting accounts-receivable ledger. Recording a SALES Payment does not create an Accounting entry, perform lettering, create a Treasury transaction, reconcile a bank account, or regenerate the Invoice PDF.

## Lazy materialization and exact amounts

Before the first Payment, a read returns a synthetic version-0 Receivable derived from the immutable issued Invoice and performs no write. A zero-total issued Invoice is synthetically `PAID`. The first accepted Payment atomically creates version 1; each later Payment increments the version once.

Payment amounts are strict positive decimal strings. Currency comes from the Invoice, currency minor-unit precision is enforced without rounding, and all authoritative arithmetic uses integer minor units backed by `BigInt`. FX and overpayment are unsupported.

## Persistence access patterns

All items use the existing table and organization partition:

```text
PK = ORG#{orgId}
Receivable SK = SALES_RECEIVABLE#{invoiceId}
Payment SK = SALES_PAYMENT#{invoiceId}#{serverSortablePaymentId}
Idempotency SK = SALES_PAYMENT_IDEMPOTENCY#{clientRequestId}
```

Receivable, Payment, and idempotency writes occur in one `TransactWriteItems` operation with an issued-Invoice condition and an optimistic Receivable-version condition. Payment history uses a paginated base-table `Query` on the Invoice-specific Payment prefix. There is no Scan or GSI.

An exact idempotent retry returns the original Payment and the current authoritative Receivable. Reusing the request identifier with different semantics is rejected.

## Deferred scope

Payment reversal/refund, Credit Notes, due dates and aging, Accounting posting, Treasury reconciliation, receipts, and fiscal certification/e-MECeF are intentionally deferred. S3A frontend UX is separately owned by S3A-FE.
