# RESTO-TABLE-1A — Table Workspace Foundation

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
