# RESTO-TABLE-1A — Table Workspace Foundation

**Current result: PASS after resumption on 2026-10-16.** Sections 1–27 retain the original BLOCKED reconnaissance as historical context. The resumed implementation and final validation follow below; this is the same lot, not a replacement lot.

Date: 2026-10-16. Result: **BLOCKED during reconnaissance**. Classification: `VERTICAL_SOLUTION`; owner: Restaurants transactional frontend. No application implementation was started.

## 1. Motivation

Service Floor supervises many tables; Table Workspace operates one active GuestSession. GuestSession, rather than a single Order, is the visit-level context. The requested foundation must support OWNER, MANAGER and the existing outlet-authorized WAITER service model without widening server permissions through frontend assumptions.

## 2. Reconnaissance findings

Inspected root `AGENTS.md`, `SPEC.md`, platform architecture and Design System skills, Restaurants transaction architecture reports, shared transaction/service-floor contracts, production route registry, transaction handler/queries, service-access authorization, responsible-staff hydration, server role projection, frontend API/query/capability helpers, Service Floor page/template, product route guard and app routes. Existing platform HTTP interception captures principal and context revision.

No separate Restaurants architecture skill or dedicated frontend framing file was found in the repository skill directories or personal skills. Existing Restaurants architecture documents, `SPEC.md`, and the two applicable repository skills provide the available framing. No new parallel charter was created.

**Blocking evidence:** `DomainAuthorizationService.permissionsForRestaurantsRole` grants OWNER/MANAGER the transaction permission set. WAITER receives only configuration reads and the two service permissions: `RESTAURANTS_SERVICE_FLOOR_READ` and `RESTAURANTS_SERVICE_SESSION_OPEN_MANAGE`. WAITER does not receive `RESTAURANTS_SESSION_READ` or `RESTAURANTS_ORDER_READ`.

`transaction-routes.ts` requires `RESTAURANTS_SESSION_READ` for keyed GuestSession, active-table and active-session reads. `transaction-handler.ts` applies `RestaurantServiceAccess.authorize` to Service Floor reads, not keyed session reads. Merely adding a legacy session-read grant would therefore expose the other legacy session-read routes without the scoped service gate.

The task explicitly requires stopping when a critical read is missing and prohibits broadening WAITER authorization. A reload-safe, server-authorized keyed GuestSession read for WAITER is missing. Service Floor's paginated projection is not a substitute for that read, and transient opening responses cannot validate a direct session URL.

## 3. Canonical GuestSession reads

All paths below are relative to `/restaurants/outlets/{outletId}` and require authenticated organization context:

- `GET /sessions/{sessionId}`: keyed `GuestSessionResponseSchema`, whose `data` is `GuestSessionRead`.
- `GET /sessions`: paginated active sessions.
- `GET /tables/{tableId}/active-session`: nullable active GuestSession.
- `GET /sessions/history` and `GET /tables/{tableId}/sessions/history`: bounded historical reads; not proposed as workspace fallbacks.

GuestSession carries `orgId`, `outletId`, `guestSessionId`, `tableId`, `areaId`, `tableCode`, `tableName`, `openedAt`, canonical `OPEN | CLOSED` status, `version`, `financialRevision`, financial aggregates and order counters. Table occupancy points to its active GuestSession; a new visit must not reuse table identity as session identity.

## 4. Order/read capability findings

Existing bounded reads include `GET /sessions/{sessionId}/orders`, `GET /orders/{orderId}`, and `GET /orders/{orderId}/items`. Additional existing reads cover active/unpaid orders, active table orders and bounded order history. Lists default to 50 and cap at 100 with cursors. Session order creation is capped at 50; retained lines per order at 200.

Accepted lines contain an immutable sale snapshot with name, quantity, unit price, line total, currency, accepted timestamp and `submissionId`. Draft lines do not contain that accepted name/price snapshot. Persisted Submission records contain identity, count, actor, fingerprint and commit timestamp; no dedicated submission/round HTTP read is registered. Accepted snapshots permit faithful grouping by submission identity without inventing preparation state; drafts must not be presented as accepted sales or priced from a fresh menu.

OWNER/MANAGER can read current orders/items without a new endpoint. WAITER cannot use any of these order reads under current permissions. Missing round-list HTTP access alone would not block the foundation: unsupported content can be omitted truthfully. Missing WAITER keyed session authorization does block it.

## 5. Route design

No route added. A suitable direction after the prerequisite is `/restaurants/service/outlets/:outletId/sessions/:guestSessionId`: explicit outlet plus immutable visit identity matches the existing outlet-scoped server API and supports reload without stored navigation state. Validate the outlet under the active organization and authorized self-context before exposing session content. Final route implementation remains pending.

## 6. Authorization

OWNER/MANAGER currently have legacy session/order reads. WAITER has scoped floor/open access only. CASHIER/KITCHEN have neither workspace nor service grants. Existing product entitlement, organization membership and direct COMPANY rules remain unchanged. The current frontend route guard accepts exactly `service` for WAITER; any future contextual route needs an explicit guard update following the server prerequisite, without adding navigation destinations.

### Proposed separate backend micro-lot

Smallest missing capability: **keyed GuestSession service read authorized with the existing Restaurants operational outlet model**.

Prefer adapting the existing `GET /restaurants/outlets/{outletId}/sessions/{sessionId}` route to a narrowly scoped service-session-read permission and applying the existing `RestaurantServiceAccess.authorize` gate before reading. Preserve OWNER/MANAGER behavior; verify active product, membership/product role, active WAITER staff and outlet assignment under the authenticated organization. Do not grant the broad legacy `RESTAURANTS_SESSION_READ` permission to WAITER. Preserve denial of legacy session lists/history/active-table routes and all order reads/mutations. No new endpoint, persistence model or infrastructure resource is inherently required; the exact implementation requires its own review and tests.

Required prerequisite tests: OWNER/MANAGER allowed; assigned active WAITER allowed; inactive/unassigned/wrong-outlet WAITER denied; foreign organization/session/outlet denied; CASHIER/KITCHEN denied; revocation reevaluated on every request; legacy history/list and order permissions remain denied. Follow existing outlet-wide service scope; do not invent responsible-staff-only visibility.

Scoped order-content access can remain a separate decision. The frontend must not infer permission from knowing an order ID. This proposal is not implemented or an approval to change authorization in this lot.

## 7. Tenant/account isolation

No new queries or state introduced. Existing `SPEC.md` multi-organization contract remains authoritative: organization context is global across tabs; logout clears account caches; principal/context revision guards reject late responses, including switch-away-and-back. Existing `auth.interceptor.ts` captures user, organization and revision. Future workspace queries must retain these guards and never seed a new session page from an unvalidated floor/navigation object.

Requested BETA-under-CLO, OWNER-to-Chrys and late-response workspace scenarios are **not exercised**, because the workspace was not implemented.

## 8. Service Floor entry behavior

Unchanged. Free-table session opening and occupied-card responsibility management remain intact. No occupied-card navigation was added that would lead WAITER into a known forbidden session read. Future entry should use a semantic link/Material action as primary interaction, with responsibility controls as independent sibling controls.

## 9. Workspace information architecture

Pending implementation. Intended compact header, single transactional content region and return action within the existing application shell. No new shell, KPI dashboard or speculative functional modules.

## 10. Header/context fields

Canonical session fields support table code/name, opening time/duration, currency and amount. Outlet/area names require validated configuration or authorized outlet-context reads; session carries their IDs. Capacity belongs to table configuration/floor projection, not GuestSession. No header was rendered.

## 11. Responsible staff

`GuestSessionRead` already returns server-hydrated `responsibleStaff` with nullable `displayName` and `available`; raw `responsibleStaffId` is removed from that read DTO. Hydration uses the operational label or identity display name. Reuse established unavailable/unknown/unassigned wording when the name is absent; never expose IDs or equate an assigned unavailable person with no assignment. No frontend identity hydration endpoint is needed.

## 12. Current amount

Service Floor computes `currentAmountMinor` directly from `GuestSession.dueMinor`. Session also provides `paidMinor`, `reservedMinor`, `pendingPaymentCount`, `orderCount` and `openOrderCount`. A future workspace can use canonical `dueMinor` with existing `restaurantPrice` formatting; it must not recalculate a competing total from lines. No checkout/payment controls or claims are justified by these fields.

## 13. Session-content behavior

Not implemented. Existing order/item endpoints support read-only content for OWNER/MANAGER. WAITER content must remain unavailable unless server-authorized reads are explicitly established; no unrelated endpoint reconstruction or new convenience endpoint was added.

## 14. Empty-session behavior

Not implemented. A future empty state must rely on successful canonical reads/counters, distinguish unreadable content from no orders, and show no fake disabled ordering CTA. An opened session with `orderCount === 0` is normal.

## 15. Stale/closed-session behavior

Not implemented. Future keyed read must distinguish `CLOSED`, missing/inaccessible context and transient failure, suppress old transactional contents, and offer a safe return to Service Floor. It must never open a replacement session or invent post-close history.

## 16. Query-key design

No new keys. Existing session helper is `['restaurants', org, 'session', outletId, sessionId]`; self-outlets include user identity. Workspace work must audit principal-sensitive session/order caches and use canonical helpers with user, organization, outlet and session scope as appropriate. Route identity must remain tab-local; no global persisted active-session ID.

## 17. Responsive behavior

Not implemented or validated. Required widths remain 1440, 900 and 390 pixels. Existing shell and mobile drawer remain unchanged.

## 18. Accessibility

No interactive markup changed. Workspace heading, announced states, return action, keyboard card entry and independent secondary focus targets remain required implementation work.

## 19. Browser review 1440 / 900 / 390

**NOT RUN at all three widths.** The explicit reconnaissance stop prevents a truthful Table Workspace implementation. No fixture screenshots or unit tests are represented as completed browser evidence. Occupied transition, empty/content, assigned/unassigned staff, closed/unavailable, back navigation and OWNER/WAITER framing remain unreviewed for this lot.

## 20. Tests and exact results

No application tests added or run: execution stopped at the required missing-read gate before coding. Targeted workspace, floor regression, routing/capabilities, tenant/account regressions, Angular suite, frontend contracts and shared/frontend development builds are **NOT RUN** for this documentation-only blocked result. Backend tests are **NOT RUN**; no backend code changed. No application correctness or release-readiness PASS is claimed.

Documentation validation: `/Users/kpadonou/.nvm/versions/node/v22.22.3/bin/node node_modules/prettier/bin/prettier.cjs --check docs/architecture/resto-table-1a-table-workspace-foundation.md` — PASS, exit 0. `git diff --check` — PASS, exit 0. Because this report is untracked, its whitespace was also checked explicitly using `git diff --no-index --check /dev/null docs/architecture/resto-table-1a-table-workspace-foundation.md` — no whitespace diagnostics; exit 1 indicates the new-file difference.

## 21. Files changed

Only `docs/architecture/resto-table-1a-table-workspace-foundation.md` added. No canonical runtime/framing update was made while the feature is blocked; conceptual guidance and proposed route above are findings/proposals, not a claim of implemented behavior.

## 22. Backend changes YES / NO

**NO.** The proposed prerequisite is separate and unimplemented.

## 23. Infrastructure changes YES / NO

**NO.** Resources added/replaced: zero. Stateful-resource impact: none. Existing owner remains RestaurantsApiStack. Synth/resource counts/diff: not run, no CDK change. No deployment performed.

## 24. Git status

Working tree was clean at reconnaissance start. Final intended change is this untracked report only. No commit made.

## 25. RESTO-TABLE-1A PASS / FAIL / BLOCKED

**BLOCKED:** missing server-authorized keyed GuestSession read for the accepted WAITER service model. Stop is required by the task's backend policy and authorization constraints.

## 26. Readiness for RESTO-TABLE-1B

**NOT READY.** Complete the separate scoped-read prerequisite, then implement and validate RESTO-TABLE-1A before beginning ordering work.

## 27. Remaining limitations

No Table Workspace shipped; no browser review or runtime validation claim. Existing session and order reads cannot currently support the full requested role matrix. No order mutations, Kitchen, checkout/payment, closing, guest-count, notes or other future workflows were added. No AWS access or deployment was attempted. Historical deployment statements in older architecture reports were not used as live deployment evidence.

## Resumed implementation — final result, 2026-10-16

### 1. Initial blocker and SVC-2D resolution

The initial stop was required because WAITER lacked a scoped keyed GuestSession read. Accepted RESTO-SVC-2D resolved that prerequisite using `RESTAURANTS_SERVICE_SESSION_READ` on the existing keyed route and `RestaurantServiceAccess` before lookup. OWNER/MANAGER retain management authority without staff-binding requirements; WAITER requires current operational outlet authorization. Legacy session discovery and all order permissions remain independent. The original reconnaissance above is preserved unchanged apart from the current-result banner.

### 2. Delta reconnaissance and scope

Confirmed the additive permission, OWNER/MANAGER/WAITER server projection, keyed-route permission and service gate. GuestSession frontend DTOs are unchanged; no generated/deployed contract prerequisite blocks local implementation. Classification: `VERTICAL_SOLUTION`; owner: Restaurants transactional frontend. Platform architecture and Design System skills were applied. No backend or shared source change was needed in this resumed lot.

### 3. Route and authorization

Implemented `/restaurants/service/outlets/:outletId/sessions/:guestSessionId` within the existing application and Restaurants wrapper. Outlet and immutable visit identity are route-local and support direct loading, reload and browser history. No global active-session state or sidebar destination was introduced.

The frontend `canReadSession` capability mirrors SVC-2D for navigation suppression. OWNER/MANAGER/WAITER may enter; CASHIER/KITCHEN and missing/invalid Restaurants roles are denied through existing route/access patterns. Staff/outlet eligibility is not duplicated in Angular: the keyed backend read remains authoritative. Responsible staff is not an authorization boundary.

### 4. Canonical query and principal isolation

The existing `RestaurantsApi.guestSession` adapter issues only `GET /restaurants/outlets/{outletId}/sessions/{sessionId}`, parses `GuestSessionResponseSchema`, and checks organization/outlet/session ownership. It now captures principal and context revision as well as organization, rejecting late responses after context changes, including switch-away-and-back revisions.

The canonical session query key is `['restaurants', orgId, 'session', outletId, sessionId, userId]`. The helper without its final principal remains a prefix for targeted session invalidation; responsibility changes invalidate only that session's principal variants and its floor context. This avoids a separate workspace-specific key family. Existing platform logout/cache clearing, context revisions and HTTP interception remain intact.

Queries have zero stale time, revalidate on mount and window focus, and provide explicit refresh with no automatic retries or polling. The minute timer updates elapsed text only. No previous-data placeholder is used. Cached contents are hidden during authorization refetches, errors, invalid context or capability loss. Session display additionally checks current organization/outlet/session identity.

### 5. Service Floor entry and return

Occupied cards expose a single explicit Material/router link labelled “Ouvrir”, with a table-specific accessible name and a minimum 44 px height. It is a sibling of responsibility controls, not a clickable card wrapper. Those controls remain usable without navigation. Free-table opening retains its accepted create-and-refresh-floor behavior; there is no open-and-navigate redesign.

The return link uses validated session outlet context. An area filter is retained only when it matches the canonical session area; invalid or inaccessible contexts contribute no return hints. Existing Service Floor validation still checks whether outlet/area selections remain authorized and valid. Browser Back/Forward works. Service en salle remains the selected contextual sidebar entry; WAITER still has that entry only.

### 6. Information architecture and header

Reuses the existing global shell, Material buttons/icons and `liass-page-header`, `liass-status-chip`, and `liass-skeleton` primitives with approved typography, theme, tokens and Tailwind spacing. A compact header and one session content region provide table code, meaningful table name, canonical state, opening timestamp/duration, responsible staff and current amount. There are no KPI cards or speculative modules.

No outlet/area label or capacity request was added solely for decoration. Canonical table snapshot fields are sufficient. Technical IDs/revisions, guest count, notes and unsupported operational states are not displayed.

### 7. Responsible staff and current amount

Uses server-hydrated `responsibleStaff`: human name when present, established unnamed wording for an assigned person without a display name, unavailable indication when appropriate, and “Responsable non affecté” only when no assignment exists. Internal staff/user IDs are not rendered. Long names wrap on mobile. Assignment management is unchanged.

“Montant actuel” displays canonical `dueMinor` through the existing exact minor-unit/currency helper. No line-based total is calculated and no paid/checkout/fiscal interpretation is introduced. Zero is displayed only after a canonical zero-valued response resolves.

### 8. Counters, empty and OPEN state

An OPEN session with `orderCount === 0` shows “Aucune commande pour le moment” and concise contextual text. A nonzero counter shows singular/plural recorded-order wording, without rows, item details or implied preparation state. OWNER/MANAGER and WAITER share this same information structure. There is no disabled/fake ordering CTA.

### 9. CLOSED, missing, malformed and temporary failure states

A canonical CLOSED response shows “Cette session est terminée”, suppresses active context/contents and retains a return path. OPEN-to-CLOSED refresh is handled without reopening or replacing the session. No history, receipt or payment action is implied.

Missing/404 sessions show a safe unavailable state; 401/403 use neutral access-denial wording, not an unsupported revocation claim; malformed identifiers/400 show invalid-link wording. Temporary/network failures offer retry. No raw backend error payload is displayed. Stale card data is never substituted for the keyed response.

### 10. Explicit absence of order reads

No workspace call is made to session orders, individual orders, order items, active orders, unpaid orders or order history, for any role. The HTTP-backed test renders a nonempty counter through the real RestaurantsApi adapter, expects exactly the keyed session GET, rejects outstanding requests matching `orders|items|service-areas|tables|menu`, and finishes with `HttpTestingController.verify()`. The component tests also provide an API substitute containing only the keyed-session method. No order-read fixtures or role-dependent richer workspace were added.

No order mutation, menu picker, draft/composer, round/submission, Kitchen, checkout/payment, closing, receipt or guest workflow was implemented.

### 11. Tenant/account and late-response tests

Tests reject foreign organization/outlet/session responses and malformed contracts. Workspace tests cover late responses after organization, principal and route-session changes. API tests cover principal and context-revision changes after request start. Two final tests start with an already rendered cached OWNER session and prove that changing organization to CLO or principal to Chrys immediately removes table identity and amount while the new read is pending. Both passed; no isolation defect required a code fix.

Each tab's session identity remains in its route. No new cross-tab state mechanism was added; existing global organization/account behavior remains authoritative.

### 12. Accessibility and browser review

Semantic heading, accessible return/navigation controls, independent focus targets and announced loading/error/closed/content states are implemented. Keyboard entry focuses the workspace heading. Loading never flashes a default amount or previous session. Navigation and occupied-entry targets are at least 44 px high; status meaning is textual, not color-only.

Deterministic localhost fixtures exercised the real application shell and workspace at 1440, 900 and 390 px. Reviewed occupied-card entry, empty and nonempty counters, assigned/unavailable/unassigned responsible staff, CLOSED and missing states, retry, OPEN-to-CLOSED refresh, OWNER and WAITER framing, direct reload, return action and browser Back. Responsibility-menu activation did not navigate; keyboard entry worked. At 390 px the long name wrapped, amount/status remained readable, the return action measured 44 px, and document width matched the 390 px viewport with no horizontal overflow. The existing mobile WAITER drawer contained Service en salle only.

Browser evidence is local synthetic data, not live API/Cognito authorization or deployed acceptance. The completed browser review was retained during closure and was not repeated.

### 13. Exact validation results

- Initial targeted workspace/floor/route/capability/API selection: 5 files, 95 tests PASS.
- Final workspace selection, including both already-rendered OWNER isolation tests: 1 file, 22 tests PASS; 5.30 seconds, no failed tests.
- Latest completed full Angular run: 145 files, 1,307 tests PASS; 12.69 seconds, no failed tests. This supersedes the earlier 1,305-test run.
- Frontend contracts: 21 tests PASS, 0 failures, included in the final frontend test command.
- Shared development build: PASS, `npm run build -w @liass-ohada/shared`; shared has one build script rather than a separate development configuration.
- Frontend development build: PASS, `npm run build:development -w @liass-ohada/frontend`.
- Prettier: PASS for every changed/new file, including this report.
- `git diff --check`: PASS, no whitespace diagnostics.
- Backend tests: not rerun; no backend source changed. No production build, synth, AWS diff or deployment was performed.

Commands used for the final test selections were `npm exec --workspace @liass-ohada/frontend -- ng test --watch=false --include='**/restaurant-table-workspace.page.spec.ts'` and `npm test -w @liass-ohada/frontend -- --watch=false`. Existing nonblocking shared side-effects/Browserslist warnings remain. The report-only closure required no application suite rerun. Previously completed builds/tests were retained rather than repeated.

### 14. Files changed and Git status

23 files in this lot: 20 tracked modifications and 3 new workspace files. Paths below are repository-relative for the inventory:

- `docs/architecture/resto-table-1a-table-workspace-foundation.md` — historical report retained, resumed outcome appended.
- `docs/architecture/restaurants-staff-sessions-orders.md` — concise permanent frontend context guidance.
- `packages/frontend/public/assets/i18n/en.json`
- `packages/frontend/public/assets/i18n/fr.json`
- `packages/frontend/scripts/team-review/main.ts` — deterministic preview scenarios only.
- `packages/frontend/src/app/core/navigation/product-navigation.ts`
- `packages/frontend/src/app/core/routing/app.routes.ts`
- `packages/frontend/src/app/core/routing/app.routes.spec.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurant-route.guard.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurant-route.guard.spec.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurants-capabilities.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurants-capabilities.spec.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurants.api.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/responsible-staff.api.spec.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurants.queries.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.html`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.spec.ts`
- `packages/frontend/src/app/domains/restaurants/feature/responsible-staff-dialog.component.spec.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-table-workspace.page.ts` — new.
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-table-workspace.page.html` — new.
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-table-workspace.page.spec.ts` — new.
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.ts`
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.spec.ts`

No backend/shared source or infrastructure change is included. No commit was made. No duplicate report or replacement lot was created.

### 15. Final outcome and next prerequisite

**RESTO-TABLE-1A: PASS. Backend changes: NO. Infrastructure changes: NO.** Resources added/replaced: zero; stateful impact: none. Existing backend owner remains RestaurantsApiStack. Template counts/synth/AWS diff were not rerun because no infrastructure changed. No deployment occurred.

The next smallest prerequisite for WAITER order access is a separate scoped service-order-read authorization decision/implementation: bounded session-order and required linked order/item reads must reuse current outlet service access and validate organization/outlet/session/order ownership, without granting broad legacy `RESTAURANTS_ORDER_READ`. Its exact endpoints and permission projection need their own review; responsibility must not become authorization. No part of this prerequisite was implemented here.

**RESTO-TABLE-1B actual order-taking readiness: NO.** The workspace foundation is ready for the next prerequisite, but does not authorize WAITER order reads or drafting/submission mutations. Order-taking additionally requires explicit scoped mutation authorization and validation. Kitchen, checkout/payment and other later workflows remain outside this lot.
