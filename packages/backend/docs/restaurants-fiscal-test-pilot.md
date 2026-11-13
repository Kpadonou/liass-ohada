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

The intended candidate is one synthetic, normally published Restaurants FINAL,
group-B FV for 2,360 XOF TTC (2,000 XOF net and 360 XOF VAT), quantity one,
fully paid in CASH, using the existing authorized REM SI e-MECeF TEST identity.
This is a bounded pilot proposal, not a finding that the seller is eligible for
ordinary VAT or an authorization to publish, deploy, open a REAL_TEST gate, or
send CREATE/CONFIRM. D05/GB02 and D15 remain OPEN.

| Remaining disposition | Exact proposed approval wording; not yet approved | Evidence required before approval |
| --- | --- | --- |
| Product Owner — synthetic data and exact operator binding | “I approve one synthetic Restaurants FINAL matching the 2,360 XOF group-B FV cash pilot. I identify my authenticated DEV account in the restricted execution record as its sole operator and approve binding only the exact organization, outlet, session, invoice, source digest and existing REM SI TEST IFU/NIM to this attempt. No real customer or payment credential is entered.” | Restricted account and invoice binding record; synthetic-data checklist; source/settlement digest. Do not put token or personal contact details in this document. |
| Product Owner and security/privacy owners — restricted evidence access and minimization | “I approve retaining only the invoice, source/projection/attempt identifiers, reconciled totals, DGI TEST result and security/QR elements needed for verification and recovery. Access to raw provider captures is limited to my bound operator account and separately named, authorized Fiscal Compliance incident reviewers for the exact case; guest, general staff and broad administrator access are excluded. Every exceptional read/export is purpose-bound, attributable and audited.” | Named reviewer/account register, effective tenant and source permissions, restricted capture location, access/audit review and an approved disclosure route. Security/privacy owners must approve the applicable access policy. |
| Privacy/legal and security owners; Product Owner operational acceptance — retention and deletion | “I accept the reviewed, versioned D15 schedule for diagnostic captures, invoice/provenance proof, audit and backups, including lawful start clocks, holds, deletion exceptions and verified deletion after expiry. A 30-day diagnostic target is applied only where the reviewers confirm it is lawful and compatible with retained fiscal proof; no linked immutable evidence is deleted while required for a retained invoice.” | Current applicable legal sources, data-category schedule, backup/recovery treatment, hold and deletion procedure, attributable privacy/legal and security approvals. No statutory duration or deletion exemption is inferred from this proposal. |
| Product Owner and Fiscal Compliance architect — seller applicability | “Having reviewed the cited seller-regime evidence for the exact REM SI TEST seller and pilot organization, I approve ordinary-VAT group-B treatment for this single synthetic FV candidate. The company declaration alone is not independent proof; any mismatch blocks publication or fiscal submission.” | Seller IFU/NIM and organization binding, ordinary-VAT eligibility evidence with reviewer/reference, frozen profile revision and independent 2,000/360/2,360 reconciliation. |
| Product Owner and security/incident owners — incident procedure | “I will act as primary incident contact. I approve the stop-and-read procedure in this runbook: preserve command IDs, attempt and restricted capture references; stop on ambiguous CREATE/CONFIRM, identity, total or provider discrepancies; notify the authorized Fiscal Compliance and security responders through the approved private channel; require an attributable recovery decision before any further mutation. No blind retry or evidence rewrite is authorized.” | Restricted escalation channel, named authorized responders and backup contact, incident log/case reference, recovery authority and access controls. No personal contact details are recorded here. |
| Fiscal Compliance architect — D05/GB02 | “I approve the bounded Restaurants FINAL source proof, immutable part chain, V1 projection, authoritative ordinary-VAT treatment provenance, mapping and rejection evidence for this one group-B FV pilot only. I do not approve broader scenario coverage or provider execution.” | Exact frozen fixture, independent canonical-byte verification, projection/reconciliation and denial-test references; attributable approval of the versioned contracts. |

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
