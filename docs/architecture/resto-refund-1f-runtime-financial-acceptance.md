# RESTO-REFUND-1F — Runtime and Financial Acceptance Validation

Status: **FROZEN CONTRACT** (2026-11-02). Runtime acceptance is not yet executed.
Baseline: `codex/resto-inventory-lite`, commit
`3e76a1fce6e7b88672f33b36b3cc667bb7f3f4aa`; RESTO-REFUND-1E is CLOSED.
Classification: `VERTICAL_SOLUTION`; owner: Restaurants.

## Purpose and execution boundary

1F adds no Refund feature. It proves in DEV that the existing implementation works
financially, atomically and idempotently. Prefer validation before code changes;
classify discrepancies as implementation defects, stale deployment, stale fixtures,
expected domain rejection or environment/configuration issues. Never fix an expected
guard by weakening it. No browser automation, PROD access or Pilot Completeness work.

Use normal application/API commands and exact read-only evidence. Reuse eligible
existing DEV context; create only the minimum normal facts needed for the scenarios.
No direct document/financial writes, Scan, backfill or corruption of immutable facts.
Do not disrupt an operational day/session solely to manufacture a rejection.
Unavailable safe scenarios remain explicit acceptance gaps, not assumed PASS results.
Deploy only a proven stale/fixed DEV dependency if necessary; no broad deployment.
Stash `a9bb2eb7acd970a31ab7d1bca679551c0d7ef78e` remains untouched and unapplied.

## Preconditions and canonical successful command

A **new** Refund requires OWNER/MANAGER authorization in the verified tenant/Outlet,
an active OPEN BusinessDay and that actor's personal OPEN CashSession in the same
Outlet, execution BusinessDay and currency as the CreditNote. The Invoice must be
eligible FINAL commercial truth; the CreditNote must be VALIDATED, consistent and
have sufficient remaining refundable entitlement. Historical commercial documents
may belong to an earlier day: execution-day equality concerns the CashSession and
current BusinessDay, not the original Invoice/CreditNote activity day.

Validate the existing path: eligible Invoice → CreditNote/Avoir → Refund. Reuse
existing eligible documents where possible. For the server-confirmed CONFIRMED
Refund record its identity/reference, exact amount/currency, method, actor, tenant,
Outlet, execution BusinessDay/CashSession and CreditNote/Invoice identities.
Canonical ownership remains Invoice → CreditNote → Refund. Legacy `finalBillId`
maps to the same canonical `invoiceId`; no historical ID/digest is rewritten and no
primary Refund → Payment link is introduced. Payments remain immutable.

## Existing financial effect

The current model already records CASH, CARD and MOBILE_MONEY; no new method model
or provider reversal is authorized. Record the method actually exercised and its
before/after server-confirmed effects; do not claim runtime coverage of untested methods.

- Consume the CreditNote's remaining refundable amount exactly once; verify the
  canonical refund balance and commercial projection refunded/remaining amounts.
- Update existing CashSession `refundedByMethodMinor` and `refundCount` once.
  CASH reduces expected physical cash by exactly the refunded amount; CARD and
  MOBILE_MONEY leave expected physical cash unchanged. Other drawer components
  remain governed by the existing Cash reconciliation formula.
- No duplicate Refund, financial effect or generic CASH_OUT replacement. Client
  display calculations are not financial evidence. No new Refund counter is added.

## Mandatory runtime evidence matrix

| Scenario                        | Required evidence                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Success                         | Valid first command commits one CONFIRMED Refund and the exact existing financial effect above.                                                                               |
| Identical replay                | Same idempotency key and identical payload return/reuse the same committed result, without another fact, entitlement consumption, method total, refundCount or drawer effect. |
| Conflicting replay              | Same key with changed payload is rejected under existing idempotency rules; committed state remains unchanged.                                                                |
| Missing execution context       | Missing active day or personal OPEN CashSession is rejected under existing guards.                                                                                            |
| Unauthorized role               | A role outside OWNER/MANAGER cannot execute; verified tenant/Outlet isolation remains enforced.                                                                               |
| Wrong context/currency          | Foreign Outlet, mismatched execution day/session or currency is rejected where applicable; client-supplied derived context cannot bypass validation.                          |
| Invalid intent                  | Invalid amount (non-positive, non-integer or outside accepted numeric bounds) is rejected. Refund has an amount, not a new quantity model.                                    |
| Ineligible source               | Missing/non-VALIDATED/inconsistent CreditNote or otherwise ineligible source is rejected.                                                                                     |
| Over-refund                     | Amount beyond the existing remaining entitlement is rejected without partial effects.                                                                                         |
| Existing concurrency protection | Competing Refunds cannot overconsume entitlement; losing requests leave no partial Refund, projection, proof or Cash effect.                                                  |

For every case record actual HTTP status/domain outcome, request identity (without
credentials), canonical result identities and before/after persisted/read-model
observations. Expected rejections are successful guard proofs, not implementation
defects. Durable replay follows existing authorization/proof rules: returning an
already committed result after its original CashSession closes is not a new Refund
and must not be confused with bypassing fresh-command preconditions.

Concurrency is required because the existing Refund tests already define competing
write and atomic-failure protection; 1F introduces no new concurrency architecture.
Partial/multiple-Payment scenario expansion is not required. A bounded partial
Refund may be used to exercise existing entitlement/concurrency protection without
changing Payment semantics.

## Post-Refund consistency and closure

Verify coherent existing Invoice, CreditNote, Refund detail/history and Commercial
Documents collection reads, including authoritative refunded/remaining amounts.
Invoice lines, totals, payment snapshots, IDs/digests and technical references stay
unchanged; external payment references stay distinct. Preserve the accepted UI,
with no nested drawers or duplicate workspace, without redesign or browser automation.

Snapshot BusinessDay `invoiceCount` and `creditNoteCount` immediately before Refund:
Refund, replay and rejected commands must not alter either. Any Invoice/CreditNote
created during setup follows the existing COUNTS1 increments separately. Search,
pagination and loaded row counts never define authoritative totals.

1F closes only when DEV evidence covers every mandatory scenario, the financial
effect is exact and once-only, replay/conflict/concurrency proofs pass, read models
and counters remain coherent, and the stash is preserved with no scope expansion.
An uncovered or failed criterion leaves 1F OPEN/INCOMPLETE. No empty code commit;
fixes require focused tests/builds/checks and runtime proof, plus Product Owner review
if visible UI changes. No 1F runtime evidence is claimed by this contract-freeze task.

Explicitly OUT OF SCOPE: new Refund features or method semantics, primary Payment
linkage, new Refund counters, Payment scenario expansion, Stock/SALE_REVERSAL,
Inventory Lite changes, new/redesigned UI, reporting/dashboard, PROD and Pilot
Completeness. Existing Refund does not restore stock; STOCK VALIDATION: OUT OF SCOPE.

## Existing authority

- [Commercial document semantics](../../packages/backend/docs/restaurants-commercial-documents.md).
- [Refund request/fact contracts](../../packages/shared/src/restaurants/refunds.ts).
- [Refund service and Cash integration](../../packages/backend/lambda/domains/restaurants/refund-service.ts).
- [Refund guards, retry and concurrency tests](../../packages/backend/test/unit/restaurants/refund.test.ts).
- [BusinessDay counters and workspace contracts](restaurants-transactional-access-patterns.md).
