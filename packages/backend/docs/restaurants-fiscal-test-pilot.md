# Restaurants one-sale DGI TEST pilot

Offline qualification scope is one normally published FINAL XOF invoice with one
positive ordinary line, an explicit evidenced tax classification, and full
settlement by one mapped payment method. Exclude credits, voids, free items,
discounts, charges, mixed currencies and split settlements from this pilot.
The offline fixture classification conveys no tax approval.

## Release checklist

1. Obtain the Restaurants owner and Fiscal Compliance architect reviews and
   Product Owner acceptance for D05/GB02. Attach the complete FINAL manifest and
   parts, line coordinates, settlement proof, frozen seller/timezone authority,
   approved calculation and mapping versions, and independent source,
   projection and request size measurements. Check G05 and other applicable
   V1 gates. Obtain the D15 evidence handling and retention dispositions before
   processing real data.
2. Review a DEV-only change set for the Restaurants provenance configuration and
   the Fiscal Compliance executor. Build shared/backend, run the focused tests,
   synthesize, count resources and review the diff. Keep both real fiscal and
   credential-verification gates at zero in the baseline release. Check JWT
   routing, tenant and role checks, conditional attempt writes, restricted
   capture access and rollback without removal of fiscal evidence.
   The recovery route and invoke permission belong to RestaurantsApiStack and
   target the existing FiscalComplianceApiStack executor. The synthesized
   Restaurants stack is in the 375–399 architecture-review range. Use a scoped
   release and preserve unrelated deployed packages and infrastructure.
3. After separate approval to provision authorities and create the candidate,
   complete and publish it through the normal Restaurants workflow with the
   approved DEV-only CDK context `restoPilotProvenanceOrgId` on the receipt
   publisher. Omit that context from the baseline release. Verify authentic provenance and record
   the immutable invoice identity and source digest. Stop for missing evidence.
   Never enrich a historical FINAL to make it eligible.
4. Have the authorized release operator bind the executor configuration to the
   exact organization, outlet, session, invoice, operator and digest, with the
   approved TEST credential, IFU/NIM, mapping and independently checked detailed
   fiscal totals. Require separate authorization to open the executor gate and
   perform CREATE and CONFIRM for this invoice.

## Operator sequence after approval

Use the JWT API for the named operator. The base route is
`/restaurants/outlets/{outletId}/sessions/{sessionId}/invoices/{invoiceId}/fiscal`.
Allocate and record stable distinct command IDs for CREATE and CONFIRM, and one
attempt ID, before sending. Keep credentials and raw provider evidence out of
the operator record.

1. GET the base route and require `NOT_STARTED`, TEST, and the expected invoice.
2. POST the base route with `{"attemptId":"<attempt>","commandId":"<create>"}`.
   Require `CREATED` and a reconciled total before proceeding. The server
   independently checks detailed totals and the provider context before
   permitting confirmation. Stop on any discrepancy.
3. PUT `/confirm` with `{"commandId":"<confirm>","confirm":true}`. Require
   `CONFIRMED`, then GET `/result` and require `resultAvailable: true` and
   `evidenceOrigin: DGI_TEST`. Record the sanitized result and close the
   executor gate under the approved release procedure.

## Lost response or interrupted execution

Stop mutations and read status. Preserve the attempt, command identity,
version, known UID and restricted capture reference. A durable confirmed
result can be read without sending again. If an operation remains in flight, stop operator traffic and establish
that the original Lambda invocation ended. Wait at least the executor's 45-second
timeout from the last invocation if completion cannot be observed. Recheck status.
The bound operator can then POST `/recover` with
`{"commandId":"<interrupted command>","executionStopped":true}`. The endpoint
compares the current version and marks the command UNKNOWN_OUTCOME without provider
I/O. A conflict requires another status read. A repeated recovery for the same
unknown command returns status. Recovery does not authorize retry or grant
access to restricted evidence.

For possible CREATE without a durable UID, use the approved DGI TEST support
procedure to establish whether an invoice exists. For possible CONFIRM with a
known UID, use the authorized read-only provider observation and restricted
capture where available. Observation alone does not update durable status.
Treat missing capture, malformed response and missing provider evidence as
unresolved. Preserve evidence and escalate for an attributable decision. Do
not redispatch, replace the attempt, edit the store directly or claim
certification from an unresolved outcome.


## D05/GB02 evidence for review

The local receipt test publishes and verifies a single FINAL XOF line with
one CASH settlement, a unique order/item/part coordinate and frozen authentic-mode
issuance provenance. The source verifier reconciles the full part chain and
settlements and rejects incomplete, tampered and foreign evidence. The fixture
tax group proves mapping mechanics only.

The commercial receipt stores a zero tax component. The TEST TTC price and
provider tax classification cannot establish the immutable V1 commercial net,
tax and gross decomposition. Review must select either an evidenced zero-tax
case or an approved tax calculation and source capture rule for the taxable
case. The review must also pin the currency scale, calculation and treatment
artifacts, projection fingerprint and independent V1 size measurements before
a V1 producer can be admitted. The fixture's zero commercial tax is not evidence
of exemption. The current pilot mapper does not emit a FiscalizableDocument V1.

## Group B commercial policy candidate

Product direction selects one ordinary XOF sale at 18% VAT, conditional on
verified seller eligibility for group B. The proposed offline vector uses one
unit priced at 2,360 XOF TTC, with 2,000 XOF net, 360 XOF VAT and one CASH
settlement of 2,360 XOF. Exact integer arithmetic makes this vector independent
of rounding choices. A zero, negative or fractional split fails admission.
This is a review vector rather than an applicable regime determination or a
runtime calculation policy.

The Restaurants owner and Fiscal Compliance architect must pin the TTC price
basis and XOF scale, the exact calculation definition and treatment references,
and the commercial admission/capture rule. Platform and qualified compliance
reviewers must identify the verified seller-regime artifact and its applicability
to the seller, date and transaction. An IFU, credential, or provider tax-group
list alone cannot supply this evidence. Exempt, unknown or unsupported regimes,
multiple lines, discounts, charges, credits and partial or mixed settlement are
outside this case. The candidate must fail closed until the required reviews
are recorded. D15 review remains required for the evidence lifecycle and access.

The first implementation after approval must bind the seller regime and pinned
policy to accepted commercial pricing, preserve the payable TTC amount through
settlement, and freeze the net/tax/gross breakdown and evidence at FINAL. V1
must resolve that breakdown from the verified FINAL chain and reject historical
zero-tax snapshots for this case. The operator's provider configuration
must never supply missing commercial tax facts.
