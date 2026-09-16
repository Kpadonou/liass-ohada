# SALES Credit Note documents (S3C-BE)

S3C-BE adds the canonical private PDF representation of an immutable `ISSUED` `SalesCreditNote`. The Credit Note aggregate remains the commercial source of truth. PDF metadata is stored as a separate SALES-owned technical item, and generation never mutates or recalculates the Credit Note, source Invoice, or Receivable.

## Architecture and access patterns

Classification: `ERP_DOMAIN`. Owner: SALES / Invoicing. The existing `OrganizationService` is the Platform Core read boundary used for the issuer organization name. The renderer reads only the persisted issued Credit Note snapshots and totals; it never reads Customer, Catalog, Receivable, Payment, or the current source Invoice.

### AP-S3C-001 - Generate the canonical Credit Note PDF

- Authorization: effective organization, active `SALES` ProductAccess, `SALES_WRITE`.
- Credit Note read: strongly consistent `GetItem`, `PK = KeyFactory.orgKey(orgId)`, `SK = KeyFactory.salesCreditNoteSK(invoiceId, creditNoteId)`. This key proves both tenant and Invoice-parent context.
- Document read: strongly consistent `GetItem`, same organization partition, `SK = KeyFactory.salesCreditNoteDocumentSK(invoiceId, creditNoteId)`.
- Document write: conditional `PutItem` with key absence. The item has `entityType = SALES_CREDIT_NOTE_DOCUMENT` and no GSI attributes.
- Object write: deterministic private S3 key `sales/{encodedOrgId}/invoices/{encodedInvoiceId}/credit-notes/{encodedCreditNoteId}/credit-note.pdf`.
- Atomicity: S3 upload precedes metadata creation. If metadata persistence fails, retry overwrites the same deterministic object and recreates metadata. Concurrent writers converge through the conditional metadata write and validate the winner. Metadata is never marked available before the object exists.
- Cardinality: one V1 `CREDIT_NOTE_PDF` item per Credit Note. No pagination, Scan, GSI, migration, or backfill.

### AP-S3C-002 - Read Credit Note document metadata

- Authorization: effective organization, active `SALES` ProductAccess, `SALES_READ`.
- Reads: exact Credit Note and document `GetItem` operations plus S3 `HeadObject` integrity validation.
- Public output excludes bucket, object key, actor, and issuer render snapshot.

### AP-S3C-003 - Create a secure download URL

- Authorization: effective organization, active `SALES` ProductAccess, `SALES_READ`.
- Reads: exact Credit Note and document `GetItem` operations plus S3 `HeadObject` integrity validation.
- Output: an ephemeral presigned GET URL with the existing five-minute SALES document lifetime and safe `avoir-{number}.pdf` filename. URLs are neither persisted nor logged.

## Rendering and integrity

PDFKit renders synchronously in deterministic French because no document language is persisted. It displays `AVOIR`, the Credit Note number and issue date, stored original Invoice number, stored reason, stored customer snapshot when available, line snapshots, tax amounts, positive totals, and currency. Decimal strings are formatted without `Number`, and no calculator runs during generation.

The SHA-256 lowercase hexadecimal hash is computed over the final PDF bytes before upload. It is an integrity fingerprint only, not a digital signature. Rendering version `1`, byte size, content type, generation timestamp, and the internal issuer-name render snapshot are stored separately from the Credit Note. The issuer snapshot supports deterministic missing-object repair even after an Organization rename.

The existing retained private document bucket is reused with its encryption, public-access block, TLS-only policy, and scoped `sales/*` IAM permissions. S3 metadata includes only Credit Note ID, Invoice ID, rendering version, and content hash.

## Explicit limits

Only issued Credit Notes can produce a final PDF. There is no Draft preview, fiscal certification, e-MECeF/DGI content, digital signature, refund/customer-credit workflow, Accounting posting, Treasury operation, asynchronous queue, new bucket/table/index, or S3C frontend UX. Current Receivable and Payment facts are intentionally excluded because they are mutable and are not part of the immutable commercial Credit Note representation.
