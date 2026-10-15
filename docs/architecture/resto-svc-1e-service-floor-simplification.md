# RESTO-SVC-1E — Service Floor Simplification & Empty-Order Semantics

## 1. User feedback

Service Floor is technically complete but remains pending explicit visual approval. This micro-lot moves context below the canonical header separator, removes the large summary cards and displays a no-order label only with canonical evidence. No Workspace, kitchen, checkout or future workflow.

## 2. Zero-amount domain audit

Inspected AGENTS, Design Skill/references, SPEC, LR-TX-1 transaction schemas/model/service, Service Floor query/shared schema and existing tests. Architecture, DynamoDB and OHADA-reference skills consulted; no accounting/legal rule is introduced. The bundled domain mapping does not define restaurant no-order semantics; the canonical implemented Restaurants domain supplies the evidence.

**A — NO:** currentAmountMinor === 0 is not an absence-of-orders invariant.

**B — YES:** an accepted zero-priced item produces a SUBMITTED order with dueMinor=0. Cancelling accepted lines subtracts their snapshot totals; cancelling the resulting order retains historical activity and a zero session total. A draft order also exists before any accepted amount. OFFERED/REFUNDED are not implemented statuses: current items are DRAFT/ACCEPTED/CANCELLED; orders DRAFT/SUBMITTED/CLOSED/CANCELLED.

**C — existing GuestSession.orderCount:** initialized to zero at OPEN_SESSION; incremented atomically with creation of each DINE_IN order; never decremented on submission, line cancellation, order cancellation or closure. Thus zero proves no order has ever been created for that session. It includes drafts and terminal history, not only accepted/current orders. A positive count does not prove accepted activity, but prevents falsely claiming no order. Existing financialRevision tracks financial effects and also advances for zero-priced acceptance; orderCount is the simpler precise evidence for this label.

**D — YES:** the canonical session metadata is already hydrated by the bounded Service Floor BatchGet. Exposing orderCount requires no extra request/query, Scan, fan-out, GSI or projection.

Evidence locations: transaction-service.ts OPEN_SESSION initializer, CREATE_ORDER count update and SUBMIT_ORDER/CANCEL_ITEM/terminal-order session updates; transactions.ts GuestSession/Order/AcceptedSaleSnapshot schemas; existing complimentary-sale tests. New floor tests exercise these cases through real canonical service mutations.

## 3. Whether zero implies no order: NO

Zero-priced acceptance and cancelled commercial history are executable counterexamples. No amount-only substitution was implemented.

## 4. Semantic field reused

Added **optional orderCount** to OCCUPIED Service Floor shared schema: nonnegative safe integer, total orders ever created in the session. Backend always maps the existing canonical session counter. Optionality supports already-deployed older responses; missing means unknown, never zero. FREE DTO remains unchanged and schemas remain strict. No hasAcceptedOrder or new persisted counter is invented.

Frontend shows Aucune commande / No order yet only when orderCount is explicitly zero and currentAmountMinor is also zero. The amount check is a defensive consistency guard, not the source of the no-order semantic. Positive or missing count with zero value displays 0 XOF. An inconsistent zero count/nonzero amount displays the amount rather than hiding it.

## 5. Backend delta and architecture

Classification **VERTICAL_SOLUTION**, owner **restaurants**. One read-model mapping line plus tests; one frontend-safe shared additive field. No domain mutation/schemaVersion/key/lifecycle behavior changes.

Existing keyed outlet table Query and bounded occupancy/session/area BatchGet hydration preserved. Session key remains KeyFactory.restaurantSessionPK = ORG#{org}#OUT#{outlet}#GS#{session}, SK META; strongly consistent bounded batch path unchanged. New occupied-floor test asserts one physical-table Query, three BatchGet operations, zero Scan. No extra per-table query, GSI, denormalization, migration, permission or infrastructure. Existing tenant/outlet/ProductAccess/RBAC, audit/idempotency and observability remain unchanged; OWNER/MANAGER transaction access retained.

No CDK synth/resource count required because infrastructure is unchanged. No deployment or live AWS calls. Rollout should update frontend/schema consumers first: the new frontend accepts old responses, while older strict consumers may reject a newly added property. Until backend deployment, actual older responses continue to render amounts safely.

## 6. Header simplification

Restored shared liass-page-header with title/subtitle only, existing shell breadcrumb and canonical full-width divider `border-b border-app-border/75 pb-3`. No context controls in the header, no header card/background. Global typography/theme unchanged.

## 7. Filter relocation

Two existing liass-searchable-select controls in Material select mode now form a sibling toolbar below the divider. Left aligned 224px fields at desktop/tablet; full-width stacking on narrow screens. Refresh is a secondary Material button at toolbar right, or its own touch-friendly row when narrow. URL selection/history, local filtering, shared search beyond ten options and explicit bounded area load-more remain unchanged.

## 8. Summary-card removal

Removed all three summary cards and unused summary computation. No replacement KPI or inline statistic. Partial-page guidance and load-more remain; no definitive count is claimed for an incomplete dataset. Tables are now primary content.

## 9. Section-title decision

**Tables en service / Service tables** replaces Plan de salle. Current functionality is an operational table grid, with no coordinates or spatial plan mode. Naming describes the implemented surface without a future-feature affordance.

## 10. Empty-order presentation

Aucune commande is secondary text, below the occupied/duration cluster and before capacity/context. It replaces the amount only with canonical zero-order evidence; both are never displayed together. Existing exact price formatter is unchanged. Accepted zero-price activity, cancelled-history activity and unknown older responses retain their 0 XOF amount.

## 11. Card design preservation

Code hierarchy, compact dimensions, muted supporting table icon, grouped status/time, prominent amount, optional capacity/name, conditional area text, tonal opening, touch target and disabled/progress behavior preserved. No waiter/openedBy, service alerts, kitchen status, guest calls/counts, reservation/cleaning, payments or occupied-card interaction.

## 12. Responsive results

Reviewed 1440×1000, 900×1000 and 390×844, all/specific areas. Four/two/one-column grid retained. Header contains no controls; toolbar is structurally/visually below divider. Desktop and tablet grid began at y=344px; previous SVC-1D review grid approximately y=389/460px respectively. Mobile grid began at y=542.5px, approximately 46px earlier than previous SVC-1D rendering. No KPI gap/replacement. Mobile selects stack and refresh remains accessible. No horizontal overflow: document widths 1440, 900 and 375 (390px viewport with scrollbar).

## 13. Tests and exact results

| Command                                                                                                                                  | Result                         |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `npm test -w @liass-ohada/backend -- --runInBand test/unit/restaurants/service-floor.test.ts test/unit/restaurants/transactions.test.ts` | PASS: 45 tests / 2 suites      |
| `npm test -w @liass-ohada/backend -- --runInBand`                                                                                        | PASS: 1,317 tests / 160 suites |
| `npm run build -w @liass-ohada/shared`                                                                                                   | PASS                           |
| `npm run build -w @liass-ohada/backend`                                                                                                  | PASS                           |
| `npm exec --workspace @liass-ohada/frontend -- ng test --watch=false --include='**/*service-floor*.spec.ts'`                             | PASS: 33 tests / 2 files       |
| `npm exec --workspace @liass-ohada/frontend -- ng test --watch=false`                                                                    | PASS: 1,021 tests / 127 files  |
| `npm run test:frontend-contracts -w @liass-ohada/frontend`                                                                               | PASS: 21 tests                 |
| `npm run build:development -w @liass-ohada/frontend`                                                                                     | PASS                           |
| Scoped Prettier / `git diff --check`                                                                                                     | PASS                           |

Backend mixed-floor test now verifies empty-session count, draft/nonzero acceptance, cancelled accepted lines and cancelled order with retained count. New zero-price accepted-sale test checks truth, bounded commands/no Scan, strict unknown-field/negative-count rejection and legacy omitted-counter compatibility. Shared has no standalone test script; shared schema assertions run in backend tests.

Frontend adds structural header/toolbar/no-KPI test and five counter/value combinations. Existing routing/context/filter/opening/idempotency/conflict/error/permission tests retained. Updated obsolete summary-count expectations; no screenshot/pixel tests. Initial cancellation test omitted the required reason; corrected the fixture request, no production contract change. Final runs above pass. Existing shared-package sideEffects build warnings remain nonblocking.

## 14. Browser observations and accessibility

Actual browser review used existing SVC-1B deterministic preview bootstrap, schema-valid fixtures, normal AppShell on localhost:4200. T01/T08 free, T02 nonzero accepted amount, T03 zero with created activity, T06 zero/no order. All and Terrasse selections inspected at all three sizes. Cards omit repeated area after filtering. No-order label is visibly subordinate to amounts; missing capacity omitted. No AWS request/data mutation.

Material labelled selects, keyboard/focus conventions, explicit status text, labelled refresh and opening aria-busy/live feedback preserved. No color-only state, no full screen-reader audit claimed.

Evidence `/tmp/svc1e-evidence/desktop-all.jpg`, `desktop-area.jpg`, `tablet-all.jpg`, `tablet-area.jpg`, `mobile-all.jpg`, `mobile-area.jpg`, `mobile-no-order.jpg`. Temporary bootstrap removed, preview stopped and normal dev server restored as found. User visual approval remains pending.

## 15. Files changed in this micro-lot

- packages/backend/lambda/domains/restaurants/service-floor-query.ts
- packages/backend/test/unit/restaurants/service-floor.test.ts
- packages/shared/src/restaurants/service-floor.ts
- packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.html
- packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.ts
- packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.spec.ts
- packages/frontend/public/assets/i18n/fr.json and en.json (FLOOR/NO_ORDER keys)
- This report.

## 16. Backend changes

Only the narrow orderCount read-model exposure and associated test changes. Before/after source hash comparison confirms only service-floor-query.ts and service-floor.test.ts changed from task start. Transaction service/repositories, KeyFactory, configuration, opening, RBAC, idempotency, occupancy, pagination and infrastructure untouched. Central Material theme, global tokens, AppShell and framing unchanged.

## 17. Git status

Branch main, HEAD cdf5e66. Existing uncommitted SVC-1A/B/C/D and UX-2A work preserved; no commit. Task-specific files listed above. Full status `/tmp/svc1e-git-status.log`; backend comparison baseline `/tmp/svc1e-backend-before.json`. Validation logs `/tmp/svc1e-{shared,backend-build,frontend-build,targeted-backend,targeted-frontend,full-backend,full-frontend,contracts,format}.log`.

## 18. RESTO-SVC-1E: PASS

Simplification implemented; no-order semantics proven and narrowly exposed without new reads. Technical completion does not constitute user visual approval. No next phase started.

## 19. User visual-review readiness: YES

Ready for explicit visual review. Backend additive field remains undeployed as requested; local deterministic preview demonstrates it, and normal older responses conservatively retain amounts.
