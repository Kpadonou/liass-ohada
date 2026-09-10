# SALES Invoice documents (S2C-BE)

S2C-BE adds a private PDF representation for an immutable `ISSUED` SALES Invoice. The `SalesInvoice` aggregate remains the commercial source of truth. PDF metadata is a separate SALES-owned item, and the PDF is a derived artifact: generation never changes Invoice data or version and never invokes the Invoice calculator.

## Architecture and access patterns

Classification: `ERP_DOMAIN`. Owner: SALES / Invoicing. The existing `OrganizationService` is the sole Platform Core read boundary and currently provides only the issuer organization name. There are no Customer or Catalog reads during rendering because the persisted Invoice snapshots and calculated strings are authoritative.

### AP-S2C-001 - Generate the canonical Invoice PDF

- Authorization: effective organization, active `SALES` ProductAccess, `SALES_WRITE`.
- Invoice read: `GetItem`, `PK = KeyFactory.orgKey(orgId)`, `SK = KeyFactory.salesInvoiceSK(invoiceId)`, strongly consistent.
- Document read: `GetItem`, same organization partition, `SK = KeyFactory.salesInvoiceDocumentSK(invoiceId)`, strongly consistent.
- Document write: conditional `PutItem` with key absence. The stored item has `entityType = SALES_INVOICE_DOCUMENT` and no GSI attributes.
- Object write: deterministic private S3 key `sales/{encodedOrgId}/invoices/{encodedInvoiceId}/invoice.pdf`.
- Atomicity: S3 and DynamoDB do not provide a cross-service transaction. Upload happens first; an orphan object after a metadata failure is overwritten deterministically and reconciled on retry. A conditional-write loser reads and validates the winning metadata/object. Metadata is never written before its object.
- Cardinality: one V1 `INVOICE_PDF` item per Invoice. No pagination, Scan, GSI, migration, or backfill.

### AP-S2C-002 - Read document metadata

- Authorization: effective organization, active `SALES` ProductAccess, `SALES_READ`.
- Reads: exact Invoice and document `GetItem` operations plus S3 `HeadObject` integrity validation.
- Output excludes bucket and object key.

### AP-S2C-003 - Create a secure download URL

- Authorization: effective organization, active `SALES` ProductAccess, `SALES_READ`.
- Reads: exact Invoice and document `GetItem` operations plus S3 `HeadObject` integrity validation.
- Output: presigned GET URL with a five-minute lifetime. URLs are neither persisted nor logged.

## Rendering and integrity

PDFKit renders synchronously with built-in fonts and no browser runtime. French is the deterministic V1 document language because Invoice does not store a document language. The renderer consumes the persisted issued Invoice and issuer name, formats decimal strings without `Number`, and does not recalculate commercial values.

The final PDF bytes are hashed with SHA-256 before the same bytes are uploaded. The lowercase hash, content type, byte size, rendering version (`1`), generation timestamp, and internal issuer-name render snapshot are persisted. The issuer snapshot makes deterministic repair independent of a later Organization rename and is not exposed in the public document DTO. The hash is an integrity value, not a digital signature.

The bucket blocks public access, uses S3-managed encryption, requires TLS, retains objects when the stack is deleted, and has no aggressive lifecycle deletion. Only the three SALES document Lambdas receive the bucket name and scoped `sales/*` object permissions.

## Explicit limits

The current Organization contract exposes only the organization name, so S2C does not invent RCCM, tax registration, address, phone, or other issuer data. The PDF makes no fiscal-compliance, e-MECeF, DGI, certification, or signature claim. Draft PDFs, frontend document UX, payments, credit notes, cancellation, Accounting posting, and asynchronous generation remain deferred.
