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
3. After separate approval to provision authorities and create the candidate,
   complete and publish it through the normal Restaurants workflow with the
   approved provenance configuration. Verify authentic provenance and record
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
result can be read without sending again. If an operation remains in flight,
the current internal recovery transition can fence it as UNKNOWN_OUTCOME
using the authoritative version, without provider I/O. It is not exposed by
the current JWT routes. Before rollout, approve and rehearse a scoped operator
entry point for that transition and a restricted evidence access path. Until
then this is a release blocker.

For possible CREATE without a durable UID, use the approved DGI TEST support
procedure to establish whether an invoice exists. For possible CONFIRM with a
known UID, use the authorized read-only provider observation and restricted
capture where available. Observation alone does not update durable status.
Treat missing capture, malformed response and missing provider evidence as
unresolved. Preserve evidence and escalate for an attributable decision. Do
not redispatch, replace the attempt, edit the store directly or claim
certification from an unresolved outcome.
