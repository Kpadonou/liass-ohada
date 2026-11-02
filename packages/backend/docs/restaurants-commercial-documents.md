# Restaurants commercial document vocabulary

Classification: `VERTICAL_SOLUTION`. Owner: Restaurants.

The canonical business vocabulary is deliberately separate from the retained V1
persistence and wire vocabulary:

| Canonical concept                   | Meaning                                                                  | Retained compatibility names                              |
| ----------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| `RestaurantBill` / Addition         | Operational read model derived from the GuestSession and accepted Orders | no separate persisted Bill aggregate                      |
| `RestaurantInvoice` / Facture       | Immutable FINAL commercial document                                      | `RestaurantReceipt*`, `receiptId`, `finalBillId`, `BILL#` |
| `Payment` / Encaissement            | Immutable settlement fact for a GuestSession                             | existing Payment facts and cash projections               |
| `CreditNote` / Avoir                | Immutable additive correction of a FINAL Invoice                         | `finalBillId`, `sourceReceiptDigest` in stored V1 facts   |
| `Refund` / Remboursement            | Immutable financial settlement of a CreditNote                           | existing Refund facts                                     |
| `PaymentReceipt` / Reçu de paiement | Reserved future proof of a Payment; not implemented in V1                | none                                                      |

`invoiceId` is the canonical domain name for the exact UUID carried by legacy
`finalBillId` or `receiptId`. It does not imply that an Invoice is available: the
publication manifest must be `FINAL` and the immutable result must verify its digest
chain. `sourceInvoiceDigest` is the canonical CreditNote name for the unchanged digest
stored as `sourceReceiptDigest`.

The existing `/receipt` routes, `BILL#` partitions, receipt manifest/part/result
entity discriminants, and legacy wire fields remain compatibility artifacts. Adapters
must validate the legacy proof before mapping names, reject contradictory aliases, and
never rewrite or rehash historical payloads. No Scan, GSI, backfill, dual-write, or
physical key migration is required.

Stable future integration events are conceptual only in this phase:
`RestaurantInvoiceFinalized`, `RestaurantPaymentConfirmed`,
`RestaurantCreditNoteValidated`, and `RestaurantRefundConfirmed`. Accounting posting
and country fiscalization are separate consumers. A future `invoiceReference` may use
`INV-YYYYMMDD-8HEX`; no numbering is generated or backfilled here. A future
`fiscalInvoiceNumber` belongs to the country fiscalization adapter and is distinct from
`invoiceId` and `invoiceReference`.
