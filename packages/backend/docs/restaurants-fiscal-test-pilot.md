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

The ordinary VAT path uses the commercial snapshot for the V1 net, tax and
gross amounts. The integrated test verifies the snapshot and projection
fingerprints, independent size limits and exact DGI TEST request preparation.
Changing the company declaration after FINAL leaves the projection identical.

## Group B commercial policy candidate

Product direction selects one ordinary XOF sale at 18% VAT using a company
declaration of ordinary VAT. The offline test uses one
unit priced at 2,360 XOF TTC, with 2,000 XOF net, 360 XOF VAT and one CASH
settlement of 2,360 XOF. Exact integer arithmetic makes this vector independent
of rounding choices. A zero, negative or fractional split fails admission.
The regime selection is a company declaration.

The Product Owner selected a declarative profile. Platform owns the country
catalog and the rates. A declaration supplies the regime ID only and must be
resolved against the company's authoritative country. It carries no claim of
independent verification. The Benin catalog distinguishes ordinary VAT from
restaurant VAT on margin. The DGI's published ruling on Arrêté 658-C describes
a deemed margin of 33.1% of period net sales. That period basis is excluded
from the one-invoice ordinary VAT calculation.

A direct company owner selects a regime through
`PUT /me/organization/fiscality/profile` with `{"regime":"ORDINARY_VAT"}`.
The corresponding GET lists the country's governed options and selected
revision. The selection is a declaration. Order submission guards the read
revision in the acceptance transaction, and the commercial receipt chain
preserves the rule, revision, digest and exact net, tax and gross.

The supported projection requires one quantity-one XOF line, one full CASH
settlement, authentic FINAL provenance and a Benin seller using the pinned
Porto-Novo timezone. Legacy zero-tax snapshots and margin declarations cannot
enter the ordinary VAT projection. The DGI TEST preparation derives group B
from the frozen ordinary VAT facts. Configured and returned group B totals
must agree with the commercial net and tax.

The profile routes and their restricted role belong to Identity. Restaurants
uses the existing platform item and condition-check access. Fiscal Compliance
reuses the isolated executor. For a scoped release, preserve unrelated Lambda
packages and require review of the candidate nested templates and provider
applicability before activating any gates.
