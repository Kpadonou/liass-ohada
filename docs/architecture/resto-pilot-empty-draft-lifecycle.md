# RESTO-PILOT-ABANDONMENT-1 — Empty technical draft lifecycle

Status: **PRODUCT OWNER ACCEPTED — final acceptance evidence frozen for commit and push.**
Baseline: `codex/resto-inventory-lite`, parent HEAD `7d8978a85b237a99f3781aac82a7a03a1b6d1f5b`.
RESTO-PILOT-CANCELLATION-1 is CLOSED. RESTO-PILOT-ABANDONMENT-1 has technical,
DEV runtime and Product Owner acceptance; repository closeout requires the final commit and
successful push. The closeout chat records that Git result, avoiding a self-referential commit SHA.

## Final acceptance record (authoritative)

This record supersedes the audit/implementation-stage status statements retained below as
historical rationale. UX1/UX2 are superseded by the final accepted hybrid lifecycle and UX3B.
Acceptance is recorded from the Product Owner's authoritative closeout instruction; no earlier
acceptance date or new runtime execution is inferred.

- Technical validation: **PASS**. Hybrid draft lifecycle, canonical `resolutionKind` read model,
  Checkout compatibility and UX3B are accepted. Focused regression reports remain available locally.
- DEV runtime validation: **PASS**. Targeted DEV release completed with **34/34 Lambdas synchronized**
  (23 transaction routes plus 11 strict-schema compatibility consumers). The Preparation
  compatibility regression is resolved.
- Product Owner functional and visual acceptance: **PASS**, explicitly supplied by the Product Owner.
  Codex technical validation is recorded separately and is not the basis for manual acceptance.
- No phantom technical Order blocks normal closure. Normal Service closure and table release were
  verified through the accepted DEV lifecycle. Draft removal itself neither closes the Service nor
  releases its table.
- Both pilot P0 gaps are resolved; this record authorizes no P1 or Pilot Acceptance work.

### Accepted contract and bounded final review

- First Order and first DRAFT item commit atomically; legacy no-item creation stays compatible.
- Removing the final draft item resolves only a fully qualified PURE EMPTY DRAFT. Normal Order
  closure also recovers eligible legacy orphans. Conditional terminal writes and durable replay
  preserve exactly-once `openOrderCount` adjustment, physical `orderCount` and complete history.
- Technical cleanup writes `TECHNICAL_EMPTY_DRAFT`; explicit business cancellation writes `BUSINESS`.
  Technical Orders are hidden only in business presentation, without filtering canonical raw pages
  or weakening Checkout completeness. Business cancellation history remains visible.
- DRAFT composition belongs in “À valider”; DRAFT has no Order-level Cancel Order action.
  OWNER/MANAGER may cancel eligible SUBMITTED Orders; WAITER permissions are unchanged.
- Backend authority, tenant/principal/Outlet isolation, KeyFactory keys and existing indexes remain
  unchanged. TanStack owns canonical server data; local state retains only workflow/command intents.

### Evidence retained and limits

The authoritative runtime and Product Owner acceptance is the closeout instruction in this chat.
Existing local reports were checked for availability, not rerun or committed as runtime dumps:

| Existing report                             | Recorded result                                   |
| ------------------------------------------- | ------------------------------------------------- |
| `/tmp/resto-lifecycle-back-finaltests.log`  | 4 suites / 199 tests passed                       |
| `/tmp/resto-lifecycle-front-finaltests.log` | 6 files / 151 tests passed                        |
| `/tmp/resto-readmodel-back-tests.log`       | 3 suites / 113 tests passed                       |
| `/tmp/resto-readmodel-front-tests.log`      | 3 files / 35 tests passed                         |
| `/tmp/resto-ux3b-back-regression.log`       | 1 suite / 44 tests passed                         |
| `/tmp/resto-ux3b-final-tests.log`           | 10 files / 237 tests passed                       |
| `/tmp/resto-2c-execute.txt`                 | Final release verification reports `verified: 34` |

These are separate historical runs, not additive unique-test totals. `/tmp` reports are local,
non-durable supporting artifacts; the sanitized acceptance summary and committed focused tests
retain the repository evidence. No credentials, downloaded deployed code or sensitive runtime
records are included in this freeze.

The legacy orphan runtime branch was **not independently exercised**. Not every Inventory,
Cash or document side effect was independently inspected in persisted DEV data. Focused regression
tests remain the evidence for those specific invariants; runtime PASS does not imply exhaustive
persisted-data inspection.

### Infrastructure follow-up (record only)

Targeted Lambda code updates may cause temporary CloudFormation/CDK code drift. The broad
CloudFormation changeset was not executed. Restaurants' recorded 379-resource warning remains a
separate infrastructure follow-up under the existing thresholds. Reconciliation needs a separately
authorized normal CDK review/deployment; none is executed by this closeout. No resources are added,
replaced or moved here, and no stateful-resource migration is introduced. No CDK deploy,
infrastructure mutation, browser automation, new visual tests or PROD access occurs during closeout.

## Historical audit and implementation rationale

The sections below describe the original audit and staged implementation. Their references to
future implementation, unaccepted UX or an OPEN parent are historical and superseded by the final
acceptance record above; they do not reopen the accepted chantier.

## Decision and ownership

**D. HYBRID:** atomic staff Order creation with its first draft item; atomic server terminal resolution on removal of the last purely technical draft item; server resolution of eligible legacy empty drafts through normal Order/service closure. None of these steps is frontend-orchestrated CANCEL_ORDER cleanup.

Classification: `VERTICAL_SOLUTION`, owner Restaurants. Preserve verified tenant/principal/ProductAccess/Outlet scope, current Service and Checkout authorizations, domain-owned persistence, KeyFactory and TanStack ownership. No new database status, table, GSI, scheduler, cross-domain write or force-release is required by this contract. Exact adapter/schema design is a small prerequisite in the implementation chantier, including backward-compatible legacy CREATE_ORDER support and close-result parsing.

## Evidence and current lifecycle

Inspection only in this task; no suites/builds/runtime calls were run. Source and tests below are evidence of current behavior; target guarantees require the future test matrix.

| Path                                                                                                                                    | Relevant evidence                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [transaction-service.ts](../../packages/backend/lambda/domains/restaurants/transaction-service.ts)                                      | CREATE_ORDER, draft ADD/EDIT/CANCEL_ITEM, SUBMIT_ORDER, terminal writes, CLOSE_SESSION          |
| [transaction-queries.ts](../../packages/backend/lambda/domains/restaurants/transaction-queries.ts)                                      | SESSION_ORDERS includes historical session links; TABLE_ORDERS uses open links                  |
| [transaction-repository.ts](../../packages/backend/lambda/domains/restaurants/transaction-repository.ts)                                | Conditional transactions and paginated submission reads                                         |
| [key-builder.ts](../../packages/backend/lambda/shared/key-builder.ts)                                                                   | Canonical Order/session, OI, SUB, ORD and OPENORD helpers                                       |
| [transactions.ts](../../packages/shared/src/restaurants/transactions.ts)                                                                | Order counters, statuses, immutable accepted snapshots and request contracts                    |
| [restaurant-order-composer.ts](../../packages/frontend/src/app/domains/restaurants/ui/order-composer/restaurant-order-composer.ts)      | Local intents, serialized CREATE then ADD, retained ambiguous requests                          |
| [restaurant-service-orders.component.ts](../../packages/frontend/src/app/domains/restaurants/ui/restaurant-service-orders.component.ts) | Current unaccepted draft visibility/masking and explicit cancellation                           |
| [restaurant-orders.api.ts](../../packages/frontend/src/app/domains/restaurants/data-access/restaurant-orders.api.ts)                    | Separate existing create/add/cancel HTTP calls and owned canonical reads                        |
| [restaurant-orders.queries.ts](../../packages/frontend/src/app/domains/restaurants/data-access/restaurant-orders.queries.ts)            | Principal/session-scoped canonical cache and mutation reconciliation                            |
| [restaurant-checkout.ts](../../packages/frontend/src/app/domains/restaurants/utils/restaurant-checkout.ts)                              | DRAFT/nonaccepted closure blocker, distinct from monetary debt                                  |
| [restaurant-checkout-flow.ts](../../packages/frontend/src/app/domains/restaurants/data-access/restaurant-checkout-flow.ts)              | Sequential Order close before GuestSession close                                                |
| [restaurant-checkout.api.ts](../../packages/frontend/src/app/domains/restaurants/data-access/restaurant-checkout.api.ts)                | Current Order close adapter requires CLOSED, not CANCELLED                                      |
| [inventory-sales.ts](../../packages/backend/lambda/domains/restaurants/inventory-sales.ts)                                              | Reversal selection requires ACCEPTED plus snapshot; resume processes durable submissions        |
| [payment-service.ts](../../packages/backend/lambda/domains/restaurants/payment-service.ts)                                              | Payment allocation requires SUBMITTED Order                                                     |
| [receipt-service.ts](../../packages/backend/lambda/domains/restaurants/receipt-service.ts)                                              | Closed-service publication; cancelled draft rows without snapshots produce no commercial item   |
| [transactions.test.ts](../../packages/backend/test/unit/restaurants/transactions.test.ts)                                               | Session increments, close blocker, explicit cancel, version races/replay                        |
| [inventory-sales.test.ts](../../packages/backend/test/unit/restaurants/inventory-sales.test.ts)                                         | Empty cancellation without synthetic movement; accepted free-item reversal; mixed/replay proofs |
| [preparation.test.ts](../../packages/backend/test/unit/restaurants/preparation.test.ts)                                                 | Existing cancellation/preparation prerequisite proofs                                           |
| [pilot audit](resto-pilot-completeness-1.md)                                                                                            | Empty Orders obstruct normal closure; original P0 finding                                       |

Current staff sequence:

1. First Add immediately creates a local draft intention. The composer calls CREATE_ORDER if no editable Order is available.
2. CREATE_ORDER commits an empty DRAFT, version 1, all line/financial/work counters zero. It creates active/history/optional waiter projections and both session Order links. For DINE_IN it increments `orderCount` and `openOrderCount` and session version immediately.
3. Only after that response and reconciliation does ADD_ITEM execute independently. It validates configuration, persists a DRAFT line and increments `lineCount`, `draftLineCount` and Order version. EDIT_ITEM updates a draft/version without acceptance or a payable delta.
4. CREATE success followed by ADD failure/crash leaves a committed empty active Order. Local retry intent can recover a live browser; it is not server lifecycle recovery.
5. Draft removal is CANCEL_ITEM. The line becomes CANCELLED with actor/reason/time; `draftLineCount` decreases. `lineCount` is historical and does not decrease. The Order does not terminalize; neither active links nor `openOrderCount` are removed/decremented.
6. SUBMIT_ORDER commits accepted snapshots, increments the historical `acceptedLineCount` and financial revision, creates submission/Preparation/Inventory facts as applicable and changes the Order to SUBMITTED. Accepted-item cancellation does not decrement the historical accepted count or revert status to DRAFT.
7. No automatic empty-draft cleanup exists in these inspected command/read paths. Without a later explicit command, the empty Order remains active; it has no empty-draft expiry path here.
8. CANCEL_ORDER can terminalize an eligible DRAFT. CLOSE_ORDER requires SUBMITTED with accepted history. No other inspected command normally terminalizes a never-accepted DRAFT. CANCEL_ORDER retains identity/history, removes active/waiter/open-session links and decrements the session open count exactly once.

### Exact closure failure

An empty DRAFT has no debt, but Checkout marks it `UNACCEPTED`. Bypassing that presentation check does not help: CLOSE_ORDER rejects a DRAFT, and CLOSE_SESSION rejects any nonzero `openOrderCount` with `RESTAURANTS_UNPAID_CLOSE`. SESSION_ORDERS includes it via the historical session link; TABLE_ORDERS includes it via OPENORD. The active projection is a discoverability mechanism; the authoritative session counter and Order guards are the final barriers. Only normal GuestSession close removes occupancy.

## Canonical distinction

**Technical composer Order:** never accepted; draft intent may exist, but no accepted commercial commitment. This is derived classification, not a new status. A nonempty technical draft is not eligible for cleanup.

**Pure empty technical draft:** under valid current domain invariants:

- Persisted status DRAFT; `draftLineCount === 0` and historical `acceptedLineCount === 0`.
- `financialRevision === 0`; `dueMinor`, `paidMinor`, `reservedMinor`, `pendingPaymentCount` all zero.
- `outstandingWorkCount` zero (absence is compatible with older optional field only when the remaining facts verify that no preparation exists).
- No recorded payment attempts/successes when those optional counters are present.
- Every retained line is a cancelled **draft** with no accepted snapshot or preparation/fire reference, or there are no line records at all. **`lineCount === 0` is not required.**
- No submission/accepted snapshot, Preparation, SALE/effect, payment allocation or commercial fact attributable to this Order. A session-level document for another Order is not by itself an Order-level fact.

The header counters are a cheap candidate predicate, not authority to erase inconsistent history. The domain verifies canonical bounded Order facts before recovery; missing/inconsistent legacy evidence fails closed. The normal final-draft-removal path can use proven prior counters and the conditional draft-line transition; legacy recovery must inspect the complete bounded lines/submissions. The maximum current Order line count is 200. Do not infer absence from one page or from a frontend cache.

**Engaged business Order:** accepted snapshot/submission ever existed, even if its price is zero, its lines were later cancelled, its remaining payable value is zero or its preparation is resolved. Any payment/commercial/Inventory/preparation evidence or inconsistent counters disqualifies pure technical cleanup. Never downgrade such an Order to technical based on current balance.

Current transitions make the zero accepted-count/revision DRAFT predicate useful: acceptance increments both and does not return to DRAFT. There are no universal `hasDocument`/`hasIrreversibleFact` flags. Do not invent them or claim that a balance-only predicate proves their absence.

## Options evaluated

| Option                           | Feasibility, benefit and limitation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — atomic create + first item   | Reuse domain validation/conditional transactions and durable command receipts. One first line adds bounded writes/config checks; measure actual action count against existing 90-action service guard rather than guessing headroom. One identity commits Order, first item, projections/counters and canonical versions together. A failed first Add creates no Order; replay returns the same identities. Requires staff adapter/schema and composer integration, retaining old CREATE compatibility. Does not solve final removal or existing orphans alone. Existing Guest atomic staging/acceptance demonstrates composition feasibility, but is not a reusable staff authorization grant. |
| B — server last-draft resolution | Resolve only a proven never-engaged Order in the same transaction as final removal, retaining CANCELLED history. Correct across response loss and version races; no manager escalation. Reuse terminal-write composition, not a nested management CANCEL_ORDER call or a second post-commit transaction. Alone it misses CREATE-success/ADD-failure and older orphan Orders.                                                                                                                                                                                                                                                                                                                    |
| C — frontend cleanup             | Existing management CANCEL_ORDER works technically, but automatic calls would fail WAITER authorization, add a hidden second mutation and leave crash/reload/network gaps. Stable UUIDs do not make two commands atomic. Rejected as lifecycle authority; no role widening.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D — selected hybrid              | A prevents the initial hole, B resolves the final removal, server normal-closure recovery covers legacy/old-client holes. This closes all identified origins without depending on browser survival.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Frozen target behavior

1. **First staff item:** use one atomic create-with-first-draft-item operation with the existing draft authorization scope. Validate configuration before commit; return canonical Order/item identifiers and versions; retain exact intent on ambiguous result. Preserve legacy CREATE_ORDER/read/replay compatibility. No remote Order exists if this new atomic operation fails.
2. **Final draft removal:** if the resulting Order satisfies the pure technical predicate, terminalize it as CANCELLED in that transaction. Preserve the removed line, Order identity, audit and historical locators. Remove active/waiter/open-session locators, decrement `openOrderCount` once, increment versions and preserve `orderCount`. If it is an engaged SUBMITTED Order, remove only the draft line; do not auto-cancel the Order.
3. **Legacy/reload recovery:** normal authenticated closure must resolve eligible pure empty drafts on the server as part of its existing Order-close sequence. Extend CLOSE_ORDER to use the narrowly qualified technical terminal composition and return CANCELLED for that case; preserve its current CLOSED behavior for engaged eligible Orders. Update the frontend close adapter, which currently rejects CANCELLED. This is not permission to manually CANCEL_ORDER as CASHIER/WAITER and does not relax business-order cancellation permissions.
4. **Checkout prerequisite:** remove technical-empty candidates from the user-facing UNACCEPTED obstacle to requesting normal closure, but include them in the server close sequence. The server rechecks every predicate/version and may reject changed/inconsistent facts. Do not simply filter them out of the close loop and leave `openOrderCount` nonzero. Direct CLOSE_SESSION retains its guard; normal Order → GuestSession closure remains authoritative and resumable.
5. **No automatic table close:** final-draft cleanup leaves the GuestSession OPEN and occupancy intact. Only an explicit normal service-close workflow may subsequently close/release it. Other Orders, debt, reservations, pending payments and work continue to block closure.
6. **Attribution:** cleanup is a system-derived consequence of the authenticated operation. Keep the real initiating actor in audit/closedBy; use a deterministic internal technical-resolution reason. Do not impersonate an OWNER or create a fictitious human system account. Retain command/trigger correlation using existing audit/receipt machinery.

The prerequisite is extracting/reusing terminal staging inside the domain transaction builder, plus freezing backward-compatible first-item and close-response adapters. Calling `mutate(CANCEL_ORDER)` from inside another command would be a separate transaction and apply the wrong management permission boundary; it is not the chosen implementation.

### History and presentation

Pure technical empty drafts should **not** appear as normal business Order history. Retain them internally as CANCELLED, with cancelled draft lines, audit and durable command receipts; no destructive deletion. Frontend history classification must use the canonical `resolutionKind` defined below, never a status/count/balance inference. Explicitly cancelled engaged Orders remain visible under normal history rules.

Keep existing session-history projections initially for compatibility, receipt consistency and audit. Keep `orderCount` as physical historical count and `openOrderCount` as actual nonterminal count. UI visibility is separate from raw pagination/completeness: filtering technical artifacts must not create false INCOMPLETE states or make `orders.length === session.orderCount` compare a filtered list. The existing 50 historical Orders/session limit remains a capacity constraint; do not silently decrement the total counter or expand the limit. Test repeated draft cycles and record that bound in implementation review.

Expected UI: no persisted Order → composer only; active technical draft → “À valider”; pure empty technical artifact → system-resolved/recovered, no management cleanup action or blocking phantom card; SUBMITTED → normal service Order and OWNER/MANAGER “Annuler la commande”, subject to canonical guards; engaged terminal → ordinary history. **Explicit Cancel Order should not be shown for DRAFT Orders.** UX1/UX2 masking is not an accepted lifecycle solution. Reconcile canonical results/caches; do not put fetched collections in Signals, add polling or request per-row eligibility.

## Safety and concurrency contract

Automatic technical resolution must never enter accepted-sale reversal/preparation cancellation/payment/cash/document commands. Existing CANCEL_ORDER selects no reversal target for no accepted snapshots, and the empty-order test proves no synthetic movement; its generic Inventory traversal/resume is safe in valid pure cases but is unnecessary and undesirable as the automatic implementation. Reuse terminal writes without invoking Inventory reconciliation. Accepted free-item CANCEL_ORDER remains unchanged and can legitimately reverse stock.

Source supports the absence of these effects for valid never-accepted drafts: Preparation and SALE staging occur on submission, payment allocation requires SUBMITTED, and receipt item construction omits cancelled drafts without snapshots. Corrupt/contradictory legacy facts are not silently cleaned. Future tests must establish the target's no-effect guarantees; this audit is not runtime proof of unimplemented behavior.

| Race/failure                                   | Required result                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final removal vs ADD_ITEM                      | Both condition the same Order version. ADD wins → removal retries against nonempty facts; removal/terminalization wins → ADD cannot mutate that terminal identity. A new user intent may create a new Order; never silently replay an ambiguous ADD onto a new identity.                  |
| Final removal vs SUBMIT                        | One versioned transaction wins. Accepted snapshot/submission winning disqualifies cleanup; terminal removal winning rejects stale submit. No orphan task/sale or second count decrement.                                                                                                  |
| Legacy CREATE succeeds, first ADD fails/reload | No mutation on GET. Recovery occurs through server normal closure and safely terminalizes only a still-pure artifact. New atomic first-item flow prevents this hole for updated clients.                                                                                                  |
| Cleanup replay/two cleanup attempts            | Existing durable intent receipt plus conditional terminal transition yields one result, audit and decrement. Same identity/different payload conflicts. Terminal replay does not reapply cleanup.                                                                                         |
| Cleanup vs management CANCEL_ORDER             | Same Order/session version checks serialize them. One terminal transition and one decrement; never downgrade management guards for engaged Orders.                                                                                                                                        |
| Session close vs item creation/cleanup         | Preserve session read/write conditions and final open-count/financial guards. Merge a session ConditionCheck into its conditional Put when cleanup updates that same item; DynamoDB cannot target it twice in one transaction.                                                            |
| Several legacy artifacts                       | Existing paginated Order/session access patterns, bounded by current session limits; resolve per Order with durable resumable close identities, then close GuestSession. Do not put all 50 Orders into one potentially oversized transaction or release occupancy after partial progress. |

Existing helpers define `OI#`, `SUB#`, `ORD#` and `OPENORD#` within tenant/Outlet-scoped partitions. Use complete bounded Query/keyed reads and conditional TransactWriteItems, not Scan or a new index. No expiry/age heuristic is safe evidence of business emptiness. Unknown effects/facts or a changing version cause conflict/review, never force cleanup.

## Required implementation tests

1. Atomic first-item success: one Order/item, correct versions, one session increment and exact replay identities.
2. Invalid first item/configuration/failure: no partial Order/projections/counter increment; ambiguous committed response replays the same pair.
3. Legacy CREATE success then ADD failure or reload: persisted pure candidate; server normal closure resolves it without manager Cancel Order.
4. Remove one of several drafts: only line/counter change; Order remains DRAFT/open.
5. Remove final never-accepted draft: line retained CANCELLED, Order terminal, actor/cause/audit retained, active/open projections removed atomically.
6. Final-removal replay and conflicting intent: one decrement/audit, canonical conflict for changed payload.
7. Final removal vs ADD, vs SUBMIT, two resolutions, and management CANCEL_ORDER: one canonical outcome; stale versions rejected.
8. N Orders/session: exactly N−1 after cleanup, other Orders unchanged, GuestSession OPEN and table occupied.
9. Normal closure recovery: pure artifact no longer blocks; engaged draft/work/debt/reservation/payment/occupancy guards still block appropriately; partial close retry safe.
10. No Inventory movement/effect, Preparation mutation, financial revision/value change, payment/cash/document mutation for pure cleanup; inconsistent facts reject cleanup.
11. Mixed engaged history: any accepted snapshot, including free/cancelled accepted lines, disqualifies automatic cleanup; manual SUBMITTED CANCEL_ORDER and exactly-once reversal unchanged.
12. UI: only composer during active drafting; no phantom business Order/manager action; submitted/engaged terminal history remains visible; WAITER permissions unchanged.
13. Raw pagination/history counters versus filtered presentation, receipt pagination/completeness and session 50-Order boundary remain truthful; no unbounded hydration/N+1/polling.
14. Updated first-item adapter, old CREATE clients, close adapter accepting only the server-qualified technical CANCELLED outcome, existing stored idempotency receipts and ambiguous retries remain compatible.

## Relationship and execution boundary

### READMODEL1 canonical classification

`RestaurantOrder.resolutionKind` is an optional shared enum: `BUSINESS | TECHNICAL_EMPTY_DRAFT`. It is persisted on the existing Order META in the same conditional terminal transaction as status, actor, audit, projections and session count. Only the fully qualified system technical-resolution path writes TECHNICAL_EMPTY_DRAFT. Ordinary terminal closure and explicit management CANCEL_ORDER write BUSINESS. Nonfinal draft/accepted CANCEL_ITEM does not set this field; final pure draft CANCEL_ITEM sets TECHNICAL_EMPTY_DRAFT through its terminal composition. This is one semantic classification, not additional overlapping flags.

New technical resolution of an old orphan writes the marker going forward. Missing legacy marker means unknown/non-technical for presentation; it is never hidden as technical, never defaulted to TECHNICAL_EMPTY_DRAFT, and never guessed from reason text or header counters. Existing historical records/command receipts are not backfilled. A replay returns its committed result and does not rewrite old records to add classification.

SESSION_ORDERS, GET_ORDER, TABLE_ORDERS and the other existing Order hydration paths use the same stored Order schema/decoder, so the field travels with current reads and mutation responses. No classification lookup, extra GetItem, audit/receipt traversal, query, endpoint, index or migration is introduced. Existing per-Order hydration is unchanged, not multiplied by classification.

Raw Orders remain the full physical paginated collection: identical partition, ordering, page sizes/cursors and session.orderCount ownership. Do not filter records in the backend query. Checkout completeness remains based on raw loaded rows, canonical nextCursor and physical orderCount. A future presentation collection may exclude **only** explicit TECHNICAL_EMPTY_DRAFT after maintaining those raw completeness checks; BUSINESS and missing markers remain visible according to the existing workflow. Empty visible pages must not imply the remote collection is exhausted. The same rule applies to Service and Checkout. READMODEL1 does not implement that UX filtering or change the lifecycle.

### DRAFT-LIFECYCLE-1 implementation compatibility

The uncommitted domain/adapters implement additive `CREATE_ORDER.firstItem` on the existing POST Orders route. The existing no-item request remains supported. Atomic creation returns the canonical Order (version 1) and first DRAFT item (version 1); both are stored in the same durable command receipt for exact replay. No initial ADD_ITEM request is required by the updated composer. Transaction/configuration failure leaves no partial Order or session increment.

Final draft CANCEL_ITEM can now terminalize a qualified never-engaged Order inside its transaction, using internal audit reason `EMPTY_DRAFT` and the actual actor. The Order/session terminal writes are shared with normal closure; Inventory is not resumed for technical resolution or its replay. The canonical terminal Order is retained in the receipt. An additive `includeOrder: true` request opts into its Order sidecar in the HTTP item response; requests without this flag retain the original strict `{ data }` envelope, including old-client replay. Existing stored requests are not silently rewritten to add this flag.

CLOSE_ORDER returns CANCELLED for a fully qualified legacy technical artifact and CLOSED for an ordinarily closed business Order. The Checkout adapter accepts that qualified terminal result; its normal close chain still explicitly invokes CLOSE_SESSION only after all Orders resolve and the fresh canonical session guards pass. Technical header candidates no longer create a client UNACCEPTED blocker, but the server additionally checks all retained lines, submissions, Preparation and Order payment references. No manager CANCEL_ORDER permission is granted to WAITER/CASHIER. Existing accepted/free-item commercial cancellation remains separate.

Internal Order/session history links and physical counts are retained. Normal user-facing history and final action/card visibility are deliberately not finalized in this implementation phase; UX1/UX2 are still unaccepted. No deployment, commit, parent closure or Product Owner UX acceptance is implied by these domain changes.

This supersedes the empty-DRAFT UX direction of UX1/UX2, without discarding their current worktree. It does not reopen RESTO-PILOT-CANCELLATION-1 or alter proven SUBMITTED CANCEL_ORDER semantics. Next implementation should deliver the domain composition/compatibility prerequisite, atomic first-item/final-removal/legacy closure recovery, focused invariants, then the derived UI adjustment and Product Owner review. RESTO-PILOT-ABANDONMENT-1 remains OPEN; no pilot acceptance or launch is authorized here.
