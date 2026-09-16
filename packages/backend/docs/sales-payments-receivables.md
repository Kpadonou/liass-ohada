# SALES Payments and Receivables

S3A-BE keeps two independent state machines inside the SALES domain:

- `SalesInvoice` is the immutable commercial document after issuance. Its lifecycle remains `DRAFT -> ISSUED`; settlement is not an Invoice status.
- `SalesInvoiceReceivable` is the generic operational settlement state for one issued Invoice. Its derived status is `OPEN`, `PARTIALLY_SETTLED`, or `SETTLED`.
- `SalesPayment` is an immutable recorded commercial settlement fact.

This Receivable is not the Accounting accounts-receivable ledger. Recording a SALES Payment does not create an Accounting entry, perform lettering, create a Treasury transaction, reconcile a bank account, or regenerate the Invoice PDF.

## Lazy materialization and exact amounts

Before the first settlement operation, a read returns a synthetic version-0 Receivable derived from the immutable issued Invoice and performs no write. A zero-total issued Invoice is synthetically `SETTLED`. The canonical equation is `balanceDue = invoiceAmount - amountPaid - creditedAmount`. The first accepted Payment or issued Credit Note atomically creates version 1; each later settlement operation increments the version once.

`SalesPayment` is an immutable cash settlement fact. `SalesCreditNote` is a distinct `DRAFT -> ISSUED` commercial correction document tied to one issued Invoice; it copies the Invoice customer, currency, and source-line facts. Issuance atomically increases `creditedAmount` and leaves `amountPaid` and `paymentCount` unchanged. The receivable vocabulary changed from `UNPAID/PARTIALLY_PAID/PAID` because Credit Notes can settle debt without cash.

S3B V1 does not allow a Credit Note total above the current balance due. Refunds, unapplied customer credits, Payment reversal, Credit Notes after full settlement, Credit Note PDF, Accounting, Treasury, and e-MECeF remain deferred.

## Credit Note persistence and access patterns

Credit Notes reuse the organization partition (`PK = ORG#{orgId}`) and are bounded single-item aggregates of at most 100 lines. Their sort key is `SALES_CREDIT_NOTE#{invoiceId}#{creditNoteId}`. Listing for one Invoice uses a partition `Query` with the corresponding prefix and an opaque cursor scoped to both organization and Invoice; there is no Scan or GSI. The worst-case test measures the marshalled 100-line item proxy below 300 KiB, leaving more than 100 KiB below DynamoDB's 400 KiB item limit.

The internal Receivable item stores `creditedLineQuantities` keyed by original Invoice line id. The map is bounded by the Invoice's 100-line limit. Payment writes preserve it unchanged. Credit Note issuance updates it under the same Receivable-version condition that updates `creditedAmount`, making cumulative line-credit checks concurrency-safe.

Credit Note numbering is a separate organization-scoped BigInt-safe sequence at `SALES_CREDIT_NOTE_SEQUENCE#DEFAULT`; issuance idempotency is stored at `SALES_CREDIT_NOTE_ISSUE_IDEMPOTENCY#{clientRequestId}`. One DynamoDB transaction condition-checks the issued Invoice and conditionally writes the sequence, issued Credit Note, Receivable, and idempotency record. Only a genuine sequence conflict is retried, with a bound of four attempts.

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
