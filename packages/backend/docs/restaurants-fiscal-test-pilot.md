# Restaurants one-sale DGI TEST pilot

Offline qualification scope is one normally published FINAL XOF invoice with one
positive ordinary line, an explicit evidenced tax classification, and full
settlement by one mapped payment method. Exclude credits, voids, free items,
discounts, charges, mixed currencies and split settlements from this pilot.
The offline fixture classification conveys no tax approval.

## D15 first-pilot decision record — 2026-11-13

**Recorded Product Owner decision:** The Product Owner personally serves as the
named operator and primary incident contact for the first Liass-Resto DGI TEST
pilot. Evidence: the Product Owner's explicit instruction in this conversation,
“The Product Owner confirms that they will personally serve as the named
operator and primary incident contact for the first Liass-Resto DGI TEST pilot.”
The actual authenticated operator account and incident communication channel
must be bound in the restricted execution record before any pilot data or
provider mutation. This decision supplies neither personal contact details nor
permission to disclose credentials or raw fiscal evidence.

**Approved Product Owner pilot design constraints — 2026-11-13:** one synthetic
Restaurants FV, group B, with one quantity-one line for 2,360 XOF TTC
(2,000 XOF net and 360 XOF VAT), fully paid in CASH; use the existing authorized
REM SI e-MECeF TEST identity; the Product Owner is the authenticated DEV pilot
operator and primary incident contact; use no real customer information or
payment credentials. The Product Owner also endorses least-privilege evidence
access and stop-and-read recovery without blind retries. These are design and
operating-principle decisions only. The exact authenticated account, seller
eligibility, evidence readers, backup contact, channel and legal schedule still
need the dispositions below. Nothing here authorizes deployment, publication,
gate activation or DGI CREATE/CONFIRM. D05/GB02 and D15 remain OPEN.

| Remaining disposition / closing authority | Exact evidence and decision still required |
| --- | --- | --- |
| D05/GB02 — Fiscal Compliance architect | Attributable approve/reject/conditions disposition on the bounded versioned Restaurants FINAL source proof, complete immutable part chain, independent canonical-byte verification, V1 projection, ordinary-VAT treatment provenance, reconciliation, DGI mapping and denial tests. Review the 2,360 XOF fixture and `test/unit/restaurants/{issuance-provenance,issuance-provenance-repository,fiscal-classified-projection,fiscal-pilot-tax-policy,fiscal-preparation,fiscal-application-service}.test.ts` plus `test/unit/fiscal-compliance/real-test-execution.test.ts`; record exact versions and evidence references. No architect disposition is recorded yet. |
| Seller ordinary-VAT group-B applicability — seller tax authority evidence, Fiscal Compliance architect review, Product Owner acceptance | Obtain a current DGI VAT-assujetti listing entry, VAT-assujettissement certificate or attributable DGI confirmation for the exact seller IFU, with effective date and restrictions; corroborate the REM SI TEST IFU/NIM binding and pilot organization's legal seller identity, then review whether this sale uses ordinary VAT rather than the restaurant margin regime. The DGI describes its [national taxpayer/VAT listing](https://www.impots.finances.gouv.bj/fichier-national-contribuables/) and [VAT-assujetti certificate](https://www.impots.finances.gouv.bj/wp-content/uploads/2021/05/CODE-G%C3%89N%C3%89RAL-DES-IMP%C3%94TS-DU-B%C3%89NIN-2021.pdf); these historical references identify evidence types, not the seller's current status or a current legal finding. Reconcile the governed profile revision and frozen 2,000/360/2,360 treatment. DGI TEST connectivity and company self-declaration alone do not establish tax eligibility. |
| D15 evidence readers and exact operator binding — Product Owner, security/privacy owners | Name the Product Owner's authenticated DEV account and each additional case-scoped Fiscal Compliance incident reader in a restricted access register; verify tenant/source permission, capture location, purpose, audit and expiry. Review and approve the least-privilege access policy. Do not place names, contact details, token or raw captures in this public runbook. |
| D15 backup incident contact and escalation — Product Owner, security/incident owners | Name an authorized backup contact and responders, identify an approved private escalation channel and case log, bind their account/role and recovery authority, and approve the stop-and-read procedure. The Product Owner's primary role and no-blind-retry principle are already endorsed. |
| D15 retention/deletion — authorized privacy/legal and security reviewers, then Product Owner operational acceptance | Attach a current-law, data-category schedule for diagnostic captures, invoice/provenance proof, audit and backups: legal basis, applicability, start clocks, durations, holds, exceptions, access, restoration and verified deletion. Review the proposed 30-day diagnostic target rather than treating it as law; preserve linked immutable evidence while legally required. Record attributable approvals of the exact version. No statutory period or deletion exemption is inferred. |

DEV deployment, authentic FINAL publication, REAL_TEST gate activation and DGI
CREATE/CONFIRM each require their separate explicit authorizations after the
applicable dispositions above. The three-Lambda immutable code-release package
is technical preparation only and is not modified by this record.

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
revision. The existing Settings → Fiscality customer page exposes those options,
but sends only the selected regime identifier and never editable tax rules. The
selection is a declaration. Order submission guards the read
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
