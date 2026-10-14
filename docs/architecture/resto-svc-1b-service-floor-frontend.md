# RESTO-SVC-1B — Service en salle V2

Date: 2026-10-14. Classification: `VERTICAL_SOLUTION`; owner: RESTAURANTS. Branch/HEAD retained: `main` / `cdf5e66`.

## 1. Approved UX blueprint reference

Reference: user-approved `Restaurant Floor Service Dashboard.png`, supplied from `/Users/kpadonou/Downloads/Restaurant Floor Service Dashboard.png`. It guides composition, hierarchy, density and interaction, not authorization or invented domain data.

Reconnaissance covered AGENTS/SPEC, the invoked design/platform skills, UI principles/tokens/components, restored Material theme, RESTO-UX-2A and SVC-1A reports, shared schemas, central API/query/capability helpers, routes, shell/sidebar/breadcrumbs and configuration table composition. Existing approved visual tokens and semantic Material controls remain authoritative.

## 2. Backend contract consumed

`RestaurantsApi.serviceFloor` calls `GET /restaurants/outlets/{outletId}/service-floor` with `limit=100` and optional opaque cursor. It parses `RestaurantServiceFloorResponseSchema` and verifies the returned outlet matches the requested outlet.

DTO remains exactly `{ outletId, items, nextCursor? }`. FREE/OCCUPIED union fields are unchanged: tableId/code, optional name, areaId, optional areaName/capacity; occupied rows additionally carry guestSessionId/openedAt/openedBy/currentAmountMinor/currency. The actual exported schema makes areaName optional, so the UI preserves that possibility. No frontend DTO widening or shared-schema change.

The central API previously lacked transactional adapters. Added `openSession` for `POST /restaurants/outlets/{outletId}/sessions`, validating `OpenGuestSessionRequestSchema` and `GuestSessionResponseSchema`, including tenant/outlet/table/area response relationships. Both adapters have a 35-second network timeout; opening is never automatically retried.

## 3. Route/navigation

Added `/restaurants/service` under existing Restaurants product routing and ProductAccess guards. Its lazy page owns the operational workflow. SERVICE contains only “Service en salle”, visible when transactional read capability permits. Configuration entries remain intact. Route context supplies the correct concise Service en salle breadcrumb and exact sidebar active state.

Workspace/product selectors, product landing routes (`/dashboard`, `/sales`, `/restaurants`), mobile drawer architecture and other products are unchanged.

## 4. Configuration versus Service Floor separation

`/restaurants/setup/tables` remains physical configuration with identity, optional capacity, area, activation, QR and management menus. It was not repurposed. Service Floor has only occupancy consultation and explicit opening of a free table. Configuration remains reachable from meaningful empty states for managers.

## 5. Outlet/area context

Reused shared searchable Material select for establishments, with bounded configuration queries and explicit load-more for additional establishments. `outlet`/`area` query parameters follow RESTO-UX-2A context conventions and browser history. Sidebar movement preserves appropriate parent context.

Default area is Toutes/All. Complete sets of up to six areas use Material chip-listbox/options; larger or paginated sets use the shared searchable select with an explicit area load-more action. Area filtering and summary derivation are local; they do not refetch the floor. Unknown/not-loaded outlet context remains explicit, with load-more/reset rather than silently substituting another outlet. Root configuration is queried through the existing cache so first-time setup does not become a misleading loading or failure screen.

## 6. Pagination behavior

TanStack InfiniteQuery accumulates floor pages. Each fetch skips empty physical pages carrying a cursor until a nonempty page or cursor end, with an eight-request maximum per fetch. Repeated cursor detection within a fetch and against earlier loaded page positions rejects cycles. Normal multi-page refetch remains valid.

Nonempty pages with more results stop automatic consumption; users choose “Load more tables”. Empty loaded results are definitive only after cursor exhaustion. Partial metrics use `+`, a loaded-results explanation and explicit pagination. Table IDs are deduplicated across changing page boundaries; data is derived from query state, not copied into long-lived Signals.

## 7. Summary metrics

Three compact shared cards show loaded/complete total, occupied and free counts for the selected establishment and area. No chart, revenue KPI or guest count. Incomplete data is never labelled as a definitive total; error/loading states do not display invented zero counts.

## 8. Free-table cards

Prominent table code, useful optional name, positive Libre/Free badge, area and optional capacity. No capacity line or zero is invented when absent. A full-width Material outlined opening button provides a minimum 44px touch target. Root/outlet/known area inactivity and missing capability suppress opening.

## 9. Occupied-table cards

Prominent identity, labelled Occupée/Occupied badge, area, optional capacity, elapsed duration and exact current amount. Cards have no dead chevron, link, detail dialog or drawer. Opening actions exist only on free cards. Shared card treatment and consistent minimum content height keep the grid scannable.

## 10. Elapsed-time behavior

A local minute timer updates a Signal. Durations derive from openedAt, clamp future timestamps to `< 1 min`, and format minutes or hours/minutes through translations. No network request is made merely to advance the clock. DestroyRef clears the timer.

## 11. Current-amount semantics

Uses existing `restaurantPrice`, currency precision and exact BigInt-based money presentation. `currentAmountMinor` is the canonical accepted commercial session amount, not paid money or outstanding balance. Existing ISO display is preserved (`12 500 XOF`, rather than inventing a new currency formatter for FCFA). No floating-point money calculation or speculative aggregation.

`openedBy` is consumed as part of the validated contract but never rendered or treated as assigned staff.

## 12. Open-table UX

One explicit “Ouvrir la table” action. No confirmation, partySize, guest-count form or global new-opening flow. Request contains only clientRequestId/tableId/areaId. Duplicate submissions are blocked while pending, opening progress is announced and shown inside the existing action without moving the grid. Success stays on this route, invalidates the precise floor and uses the shared notification service with safe backend text/fallback.

## 13. Concurrency/idempotency UX

A per-page intent map keys the stable request ID by organization/outlet/table. Ambiguous network/timeout failures retain the same ID for an explicit retry. Backend durable replay remains authoritative. Completed/conflicting intents retire; workspace changes clear local intents. IDs are not persisted across component destruction; a new page entry starts a new explicit intent, with canonical backend occupancy still preventing duplicate active visits.

409 opening conflict produces a concise translated contextual message and invalidates/refetches the captured floor. Progress always clears. Read 409 triggers one immediate refresh per conflict episode; repeated conflicts cannot form a refetch loop. Stale completions do not notify or overwrite another workspace/outlet. No closure/cancellation UI was added.

## 14. RBAC/capabilities

Frontend capabilities mirror the current direct COMPANY product-role matrix: OWNER/MANAGER can read Service Floor and open; WAITER/CASHIER/KITCHEN cannot read/write transactions. Global OWNER alone grants nothing. Workspace/tenant/accessSource checks remain in the existing capability helper; no entitlement, staff-assignment or backend role change.

Navigation is hidden when capability is absent, and direct URL entry shows a denial without issuing floor requests. Missing write capability suppresses opening independently. ProductAccess guards and runtime availability remain intact; backend remains authoritative. 403 fails closed and invalidates the organization-scoped ProductAccess query.

## 15. Query/cache strategy

Extended the existing Restaurants API and query helpers rather than introducing another client or server-state store. Floor keys are `['restaurants', orgId, 'service-floor', outletId]`; configuration queries retain their existing scoped keys. Area filters are local and do not belong in the server floor key.

Successful opening invalidates the exact captured org/outlet key. Table/area/outlet configuration changes also invalidate the affected floor cache so configuration edits do not leave an apparently current floor behind. No previous-tenant placeholder data is used. Selected context, pending intent and local clock remain UI Signals/state only.

## 16. Refetch/polling decision

30-second staleTime, normal stale-query window-focus refresh, conservative 60-second foreground polling and no background interval. Manual refresh and successful-write invalidation are available. Empty-page consumption is bounded; polling never automatically exhausts all remaining nonempty pages. Refetch refreshes the user's already-loaded page set. No sub-minute network interval, websocket, subscription or realtime transport.

## 17. Empty/error states

Distinct states cover first-time root setup, no establishment, no active outlet tables, no active tables in the selected area, partial loaded results and failure. Configuration links are management-only. Incomplete results offer load-more rather than a false “no tables” conclusion.

Loading has translated status text and a Material spinner for floor hydration. 400/403/404/409 use existing safe restaurant error mappings; 503/network/timeout failures provide retry and do not render free cards from incomplete or stale hydration. Zod-invalid payloads fail validation and show response guidance. Raw codes, IDs, AWS/storage details and private actor IDs are not shown.

## 18. Responsive/tablet behavior

Four-column grid at desktop, two on tablet, one on narrow screens. Header/context wrap naturally; controls remain compact rather than a full filter card. Cards use shared surfaces/radii and token-aligned spacing; button targets are touch-friendly and do not rely on hover. The three summary cards remain compact at narrow widths.

Actual browser inspection covered 1440×1000, 900×1000 and 390×844. Document widths equalled viewport widths at all three sizes. The existing responsive shell remains responsible for workspace/product context and the drawer.

## 19. Accessibility

Labelled Material select and chip-listbox semantics; meaningful opening labels include table code. Status text accompanies semantic color. Decorative table/people/clock icons are hidden from assistive technology. Opening uses disabled action, aria-busy and a live status; pending text does not shift the grid. Native Material focus styling is preserved. Keyboard Enter/Escape on the establishment selector was exercised. This is not a full screen-reader audit.

## 20. Elements intentionally omitted from approved mockup

No waiter names/assignment, kitchen alerts or preparation states, articles-to-serve count, guest calls, reservations, cleaning, payments/checkout/receipts, inventory or Guest Web. No Plan toggle, floor-plan coordinates, global opening action, occupied-card navigation or Table Workspace placeholder. No dead future sidebar links.

## 21. Visual comparison with approved mockup

Preserved the top-bar workspace/product context, SERVICE grouping, header plus compact context controls, three summary cards, four-by-two desktop grid, strong table identity and card-specific opening flow. The floor remains the main content, with calm whitespace and aligned information.

Intentional design-system adaptations: existing Liass page-header typography, approved shared cards, Material table icon instead of a decorative illustration, info badge for ordinary occupancy rather than an error/alert treatment, native Material area options, outlined navy opening controls and existing ISO currency formatting. Occupied cards are simpler because unsupported staff/alert/footer interactions are absent. No palette, theme, control-radius, shadow or central styling was changed.

## 22. Tests and exact results

Twenty-four new tests cover transport/schema/context validation, exact opening body, retained request ID, empty-page skipping/completion, partial pages, cursor guards/refetch, key isolation/invalidation, card/summary/filter rendering, optional capacity, exact amount text, no fake data, opening/concurrency, 409 read refresh, 503, first-time/empty configuration, restricted/read-only behavior, workspace changes and timer cleanup/duration boundaries.

Updated existing route inventory, capability projections and sidebar active/current-route/navigation tests, retaining Accounting/Sales/configuration regressions.

| Command                                                                                                                                                                                                                                                   | Final result                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `npm exec --workspace @liass-ohada/frontend -- ng test --watch=false --include='**/*service-floor*.spec.ts' --include='**/restaurants*.spec.ts' --include='**/restaurant*.spec.ts' --include='**/app-sidebar*.spec.ts' --include='**/app.routes.spec.ts'` | 215 tests, 14 files passed                              |
| `npm exec --workspace @liass-ohada/frontend -- ng test --watch=false`                                                                                                                                                                                     | 1,012 tests, 127 files passed                           |
| `npm run test:frontend-contracts -w @liass-ohada/frontend`                                                                                                                                                                                                | 21 passed, 0 failed                                     |
| `npm run build -w @liass-ohada/shared`                                                                                                                                                                                                                    | PASS, CJS/ESM/declarations generated; schemas unchanged |
| `npm run build:development -w @liass-ohada/frontend`                                                                                                                                                                                                      | PASS, development bundle generated                      |
| Scoped Prettier write/check                                                                                                                                                                                                                               | PASS                                                    |
| `git diff --check`                                                                                                                                                                                                                                        | PASS                                                    |

Existing shared-package `ignored-bare-import` warning remains. No backend tests/deployment were required for this frontend-only lot. Logs: `/tmp/svc1b-{targeted,full,contracts,shared,build,format}.log`.

## 23. Browser inspection

Performed using actual AppShell and Service Floor components in the established deterministic local preview bootstrap/API-fixture mechanism at localhost:4200. Preview floor payloads use the exported shared schema; production API adapters are independently tested through HttpTestingController. Mock authorization is not a live backend authorization audit.

Observed eight configured tables (five occupied/three free), exact sample amounts and absent capacity on T08. Opened T01: progress → occupied, counts changed to six/two, route unchanged. Simulated concurrent opening: contextual conflict and refreshed occupied state, no stuck loading. Filtered Terrasse: four scoped tables and corresponding counts, query parameters updated. Observed loading spinner/text, empty floor/configuration link, no-establishment state and 503 failure without fake/free cards. Read-only fixture suppressed SERVICE navigation and denied direct entry. Select keyboard semantics and three responsive widths were exercised.

Evidence: `/tmp/svc1b-evidence/`, including final 1440/900/390 captures, after-opening, conflict and loading. The screenshot reference was compared directly to the rendered composition. No AWS/DGI or deployed API calls; no transactional records were written outside fixtures. No dark-mode or physical-tablet audit is claimed.

Temporary source was removed. Preview bootstrap/server/bundle remain in `/tmp/svc1b-preview*` for reproducibility. Temporary tab/viewport/server are cleaned up and the normal Angular dev server restored on localhost:4200. Real Service Floor requests need the SVC-1A endpoint deployment; screenshots/fixtures provide current visual-review evidence.

## 24. Files changed in this micro-lot

- `packages/frontend/src/app/core/routing/app.routes.ts` and its spec
- `packages/frontend/src/app/core/navigation/product-navigation.ts`
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.ts` and its spec
- `packages/frontend/src/app/domains/restaurants/data-access/restaurants.api.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurants.queries.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurants-capabilities.ts` and its spec
- `packages/frontend/src/app/domains/restaurants/data-access/restaurant-service-floor.spec.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/service-floor.test-fixture.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.{ts,html,spec.ts}`
- `packages/frontend/src/app/domains/restaurants/utils/service-duration.ts`
- `packages/frontend/public/assets/i18n/{fr,en}.json`
- This report.

No changes to canonical framing, global design tokens, Material theme, shared controls, backend or shared source. Prior RESTO-UX-2A work is retained.

## 25. Backend changes

**NONE.** Compared tracked backend diff and hashes of untracked backend source against task-start snapshots: unchanged. SVC-1A's pre-existing uncommitted backend/shared work is retained intact. No API, persistence, role, domain, infrastructure or fiscal change.

## 26. Git status

Branch `main`, HEAD `cdf5e66` retained; working tree was already dirty with RESTO-UX-2A and SVC-1A work. New/modified frontend files above and this report remain uncommitted alongside that preserved work. No reset, commit or deployment.

## 27. RESTO-SVC-1B status

**PASS** — frontend implementation, automated validation and deterministic browser review completed. User visual approval remains pending.

## 28. User visual-review readiness

**YES**, through saved captures and the local preview fixtures. Normal production-mode frontend wiring is ready for the canonical backend endpoint once deployed separately. Stop here: no Table Workspace, direct occupied navigation, Orders UI, Kitchen, Checkout or Guest Web was started.
