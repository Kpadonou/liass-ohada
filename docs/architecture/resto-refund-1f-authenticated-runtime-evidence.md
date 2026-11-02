# RESTO-REFUND-1F — Authenticated DEV runtime evidence

Status: **CLOSED** following GUARDS1 evidence policy and focused guard validation.
Initial authenticated runtime pass: Executed 2026-11-02T19:04:41.058Z (UTC), DEV only.
Branch: `codex/resto-inventory-lite`; starting HEAD:
`598590fcb51bb72a42313bb0eaf627cd87bbdc56`.
Authority: [frozen contract](resto-refund-1f-runtime-financial-acceptance.md).

## Authentication and preconditions

Committed AUTH0 PKCE/session helper reused by a temporary bounded in-process 1F
caller. Manual Cognito login, existing localhost callback, real API Gateway HTTP
path; first harmless BusinessDay GET returned 200 at 2026-11-02T19:04:39.166Z.
Tokens stayed in process memory and were discarded on exit. No credentials,
headers or token material were recorded. No browser automation or fake authorizer.

- Organization: `org-1d6ccb74-b290-44f7-a151-6a619aa0526f`.
- Outlet: `ea063c3f-baed-8320-83fb-63edca996e3b`.
- Actor: `f119900e-6061-70b6-af1f-679398ea822c`.
- BusinessDay: `63e032ca-1ea4-42f1-9701-bdaf36a4ba98`, OPEN.
- Personal CashSession: `0354cbcb-24e8-4ff5-9b64-bad31a1beb3c`, OPEN, same execution day/Outlet/XOF.
- Role eligibility: manager-only BusinessDay summary returned 200; Refund mutation
  independently passed existing OWNER/MANAGER authorization. Exact role enumeration
  was not returned by these read surfaces.
- Invoice: `2201ef74-c78e-41ad-a765-7027bbb2f79f`, ALTAB, 900 XOF; existing verified FINAL detail
  readable with commercial parts and original digest.
- GuestSession: `f364038a-6830-46f6-b541-e6c0975d531c`.
- CreditNote: `f765606b-c9de-4da3-a53e-da79fd954ae2`, AV-20261102-DFE96600,
  VALIDATED, 900 XOF. Existing CARD Refund: 200 XOF; remaining entitlement: 700 XOF.

## Success, replay and concurrency

Command: POST `/restaurants/outlets/{outletId}/credit-notes/{creditNoteId}/refunds`.

| Scenario                                                   | HTTP/domain outcome                            | Identity/effect                                                            |
| ---------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| Valid CASH 1 XOF                                           | 200 / CONFIRMED                                | REF-20261102-AF93E07E; c9274708-af40-486c-8fc1-61ed6fc309a1                |
| Identical replay                                           | 200; identical complete result                 | Same identity; no additional consumption/effect                            |
| Changed amount, same key                                   | 409 / RESTAURANTS_REFUND_IDEMPOTENCY           | No mutation                                                                |
| Concurrent distinct-key CASH 350 XOF + 350 XOF against 699 | One 200; one 409 / RESTAURANTS_REFUND_EXCEEDED | Only REF-20261102-748C7DA1; cbf7ab3e-8be2-4442-9490-0d9eaab44ef7 committed |

Success clientRequestId: `e1548744-2c82-4836-805d-f59599a3952c`.
Concurrency request IDs: `b22338fb-9f8f-4f5c-a99c-b3707aac076f`, `da797d11-fb4e-48e1-b6d2-575af1efd62f`.
Concurrency winner was re-read through history; exactly one extra fact and one
financial effect appeared. The loser left no observable Refund/history/projection
or Cash effect; internal command/proof keys were not inspected directly.

| Server-confirmed fact            |  Before | After 1 XOF | After concurrency |
| -------------------------------- | ------: | ----------: | ----------------: |
| Expected drawer XOF              | 6344406 |     6344405 |           6344055 |
| Cash refunded total              |  310400 |      310401 |            310751 |
| Existing CashSession refundCount |       9 |          10 |                11 |
| CreditNote refunded              |     200 |         201 |               551 |
| CreditNote remaining             |     700 |         699 |               349 |
| CreditNote history facts         |       1 |           2 |                 3 |
| invoiceCount                     |       2 |           2 |                 2 |
| creditNoteCount                  |       2 |           2 |                 2 |

CARD refunded total stayed 400; MOBILE_MONEY stayed 800. Payment totals/count,
CashIn/CashOut and movement count were unchanged. Only CASH method was executed
in this pass; no runtime claim for new CARD/MOBILE_MONEY effects. No generic
CASH_OUT created. Comparisons used canonical HTTP reads, not UI-derived amounts.

## Guard evidence

Each rejected command was followed by unchanged CashSession, Refund history,
CreditNote projection and BusinessDay document-counter reads.

| Guard          | HTTP | Domain code                         |
| -------------- | ---: | ----------------------------------- |
| zero           |  400 | RESTAURANTS_REFUND_AMOUNT           |
| negative       |  400 | RESTAURANTS_REFUND_AMOUNT           |
| fractional     |  400 | RESTAURANTS_REFUND_AMOUNT           |
| unsafe         |  400 | RESTAURANTS_REFUND_AMOUNT           |
| clientCurrency |  400 | RESTAURANTS_REFUND_REQUEST          |
| clientDay      |  400 | RESTAURANTS_REFUND_REQUEST          |
| clientSession  |  400 | RESTAURANTS_REFUND_REQUEST          |
| overRefund     |  409 | RESTAURANTS_REFUND_EXCEEDED         |
| missingCredit  |  404 | RESTAURANTS_REFUND_CREDIT_NOT_FOUND |
| foreignOutlet  |  403 | DOMAIN_PERMISSION_REQUIRED          |

These are expected domain rejections, not implementation defects. Foreign Outlet
was a fresh nonexistent UUID denied by the scope guard; access to a real second
Outlet/tenant was not exercised. Client-supplied currency/day/session fields were
rejected by the strict command contract; this does not prove stored-context mismatch.

## Read consistency and outstanding acceptance gaps

Invoice detail before/after was structurally identical, including lines, total,
payment snapshot, technical identity and digest. CreditNote detail/lines were
identical. Refund exact detail equaled the committed response. Invoice projection
was FINAL under the active BusinessDay filter. CreditNote AV server search returned
900 / 551 / 349 XOF. Repeated reads left financial state unchanged. Relationships
remain Invoice → CreditNote → Refund; no primary Payment linkage or fake invoice
reference, counter or UI change was introduced.

At the initial HTTP-only pass, the following cases prevented closure. They are
resolved by the focused evidence below under the Product Owner GUARDS1 policy:

- No second legitimate identity/session available to execute unauthorized-role and
  missing active day/personal OPEN CashSession rejection scenarios safely.
- No safe stored execution-day/currency mismatch or non-VALIDATED/inconsistent
  immutable source fixture. Missing CreditNote was proven, not every source-state case.
- Real cross-tenant/other existing Outlet isolation was not exercised.

No day/session was closed, no identity/role changed, no immutable fact corrupted,
and no fixture manufactured through direct persistence mutation to fill these gaps.
The initial caller incorrectly asserted the publication envelope on the GET detail
response; it stopped before any mutation. Classification: validation-caller/setup
error, corrected to the existing detail contract. No production defect found.

Deployment consistency was verified against the previously managed get-outlet bundle
before this pass; no stale component identified and no deployment performed. No
production backend/frontend/auth/infrastructure source changed. No broad suites or
builds repeated. STOCK VALIDATION: OUT OF SCOPE. No Scan, backfill, direct DynamoDB
writes or PROD access. Recovery stash `a9bb2eb7acd970a31ab7d1bca679551c0d7ef78e`
remains retained and unapplied. Pilot Completeness not started.

Initial closure commit/push was withheld pending the remaining guard evidence below.

## Remaining guard evidence

GUARDS1 Product Owner decision (2026-11-02): real HTTP is required for safely
reachable states; focused backend/domain/integration evidence is accepted when HTTP
would require corruption, operational disruption, manufactured identity/tenant or
invariant bypass. This supplements evidence sourcing only; every guard remains.
No persisted DEV data was intentionally corrupted to manufacture a rejection scenario.

No alternative legitimate authenticated role/session was available in the known
DEV tooling: AUTH0's actor session had exited and discarded its token. No credentials
were obtained, user/role changed or another tenant created. The existing active
BusinessDay/personal CashSession were left intact. Invalid persisted contexts and
CreditNote states are therefore exercised only in isolated in-memory test fixtures.
These tests are not claimed as HTTP/JWT validation or as a real DEV identity.

All automated evidence is in
`packages/backend/test/unit/restaurants/refund.test.ts`:

| Requirement                          | Evidence type and exact test name                                                                                                                                                                | Rejection                                                                                                     | Zero-effect proof                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Unauthorized role                    | EXISTING TEST: `CASHIER cannot execute even with a valid spoofed context`, WAITER and KITCHEN variants; `existing handler dispatches all three refund routes and rejects unauthorized execution` | Service `RESTAURANTS_REFUND_ROLE`; handler HTTP-shaped response 403                                           | Entire in-memory rows map unchanged after each denied command; handler assertions strengthened                   |
| No active BusinessDay                | EXISTING TEST: `missing active day or own session rejected`                                                                                                                                      | `RESTAURANTS_REFUND_DAY_REQUIRED`                                                                             | Rows compared after removing test-only pointer, immediately before/after rejection                               |
| No personal OPEN CashSession         | Same EXISTING TEST, manager without own session                                                                                                                                                  | `RESTAURANTS_REFUND_SESSION_REQUIRED`                                                                         | Full rows map unchanged; no Refund/balance/session/projection change                                             |
| Session execution-day mismatch       | NEW TARGETED TEST: `Refund rejects inconsistent resolved session businessDayId before financial mutation`                                                                                        | `RESTAURANTS_REFUND_CONTEXT`                                                                                  | Full rows unchanged and no new TransactWriteItems call                                                           |
| Personal actor / OPEN-state mismatch | NEW TARGETED TEST: same parameterized name with `cashierUserId` and `status`                                                                                                                     | `RESTAURANTS_REFUND_CONTEXT`                                                                                  | Same full-state/no-write assertions                                                                              |
| CashSession currency mismatch        | EXISTING TEST: `currency mismatch rejected`                                                                                                                                                      | `RESTAURANTS_REFUND_CURRENCY`                                                                                 | Added full-state unchanged assertion                                                                             |
| BusinessDay currency mismatch        | NEW TARGETED TEST: `Refund rejects resolved BusinessDay currency mismatch without any write`                                                                                                     | `RESTAURANTS_REFUND_CURRENCY`                                                                                 | Full rows unchanged; no transaction submitted                                                                    |
| Non-VALIDATED / incoherent source    | EXISTING TEST: `missing/nonvalidated/inconsistent CreditNote are rejected`                                                                                                                       | `RESTAURANTS_REFUND_CREDIT_NOT_FOUND`, `RESTAURANTS_REFUND_CREDIT_NOT_VALIDATED`, `RESTAURANTS_REFUND_SOURCE` | Full-state snapshot after each fixture alteration; command leaves it unchanged                                   |
| Tenant isolation                     | NEW TARGETED TEST: `Refund commands and exact reads cannot cross unauthorized tenant scope`                                                                                                      | 403 / `PRODUCT_ACCESS_REQUIRED` for create and detail                                                         | Test owns one normal in-memory Refund; foreign-scope attempts leave all rows unchanged and submit no transaction |
| Outlet isolation                     | NEW TARGETED TEST: `Refund commands and exact reads cannot cross unauthorized outlet scope`                                                                                                      | 403 / `DOMAIN_PERMISSION_REQUIRED` for create and detail                                                      | Same full-state/no-write proof; complements existing real DEV foreign-Outlet HTTP rejection                      |

Resolved session/day tests use mocked domain resolver results, not JWT/authorizer
claims. Isolation tests use the real authorization/access resolver against the
memory Dynamo adapter, not an authorization bypass. The existing handler test uses
its pre-existing synthetic Lambda event fixture exclusively inside Jest. No fake
JWT or authorizer was used in DEV. No extra HTTP/financial runtime scenario was rerun.

Validation command (backend workspace):

```sh
npm test -w @liass-ohada/backend -- --runInBand test/unit/restaurants/refund.test.ts --testNamePattern='cannot execute|missing/nonvalidated|missing active day|currency mismatch|inconsistent resolved|cannot cross unauthorized|existing handler'
```

Result: **13 PASS**, 31 intentionally skipped unrelated tests. All tests also retain
the suite's no-Scan assertion. Six parameterized test cases were added; existing
source/context/currency/handler assertions were strengthened. No production code,
frontend, schema, configuration or infrastructure changed. No deployment/build was
required. Prettier and git diff checks PASS.

## Combined closure review

- Real DEV success, exactly-once Cash effect, replay/conflict, overconsumption
  concurrency, document/projection reads and canonical counters: retained HTTP
  evidence above, not rerun.
- Remaining authorization, context, currency, source and isolation requirements:
  PASS through the accepted safe evidence policy and focused tests above.
- Invoice → CreditNote → Refund preserved; no new Payment relation or counter.
- Stock OUT OF SCOPE; no scope expansion, PROD access, live identity changes or
  persisted-data corruption. Recovery stash remains untouched and unapplied.
- RESTO-REFUND-1F: **CLOSED**. Ready for the separate Pilot Completeness task;
  RESTO-PILOT-COMPLETENESS-1 has **not** started.
