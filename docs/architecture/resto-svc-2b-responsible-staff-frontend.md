# RESTO-SVC-2B — Responsible staff on Service Floor

Date: 2026-10-15. Classification: `VERTICAL_SOLUTION`, Restaurants-owned frontend. Canonical design and platform skills applied. No backend, shared-contract, infrastructure, domain, or authorization change.

## 1. SVC-2A contract consumed

`GuestSessionReadSchema` and occupied `RestaurantServiceFloorResponseSchema` entries expose optional `responsibleStaff: { staffId: string; displayName: string | null; available: boolean }`. Free entries have no responsibility. `openedBy` remains the opening actor and is never rendered as the responsible person.

The centralized client consumes `GET /restaurants/outlets/{outletId}/sessions/{sessionId}` and `PATCH /restaurants/outlets/{outletId}/sessions/{sessionId}/responsible-staff`. The strict shared request is `{ clientRequestId: UUID, expectedVersion: positive integer, staffId: staff user reference | null }`; response uses `GuestSessionResponseSchema`. Request, response organization/outlet/session, intended returned staff reference, and tenant context before/after the asynchronous call are checked. No endpoint or shared schema was added.

## 2. Responsible-staff terminology

FR uses « Responsable de la table », « Affecter un responsable », « Changer le responsable » and « Retirer l’affectation ». EN uses table responsibility terminology. Existing role translations are reused, including Gérant / Manager and Cuisinier / Cook; enums remain unchanged.

## 3. Service Floor card presentation

Occupied cards gain one subdued person/name line after the commercial amount or no-order text. Identity, occupancy/time and amount keep their hierarchy. Names truncate with a full title and explicit accessible context. Canonical `available: false` renders « Indisponible » without hiding the retained name. No availability is inferred from the candidate list.

## 4. Unassigned presentation

An occupied session without responsibility displays « Responsable non affecté » as neutral text. Opening without responsibility remains possible. Free cards show neither this line nor responsibility actions.

## 5. Management action pattern

A named Material `more_vert` trigger appears on authorized occupied cards. Its menu exposes assign, or change plus clear. Icons and existing info/warning action treatments are reused. Cards remain non-navigable; there is no workspace, chevron, or persistent action-button row.

## 6. Assignment dialog

A focused canonical Material dialog reuses the premium panel class, task title, table/area context, shared searchable select, typed Reactive Form control and explicit primary action. Current responsibility is shown during replacement. Loading, inaccessible/closed session, candidates, errors and pending states remain contextual.

## 7. Eligible staff sourcing

The existing centralized `outletStaff` API/query is reused. Frontend candidates require matching outlet and staff/assignment identity, ACTIVE staff, ACTIVE explicit outlet assignment, active organization membership and an eligible current restaurant role. Missing role/access information excludes a candidate. Backend eligibility remains authoritative, including product state that can change after a cached list was read.

## 8. Role eligibility handling

SVC-2A permits OWNER, MANAGER and WAITER as responsible subjects. All three require real active RestaurantStaff and explicit active outlet assignment; organization-wide management authority does not create a candidate automatically. CASHIER and KITCHEN are omitted. The selector displays safe name plus the existing translated role. Provider identifiers, emails and technical keys are not displayed; unresolved names use the existing neutral unnamed label.

## 9. Pagination

The existing outlet-staff response has `items` and optional opaque `nextCursor`. Infinite Query retains org/outlet-scoped pages. Search applies to loaded candidate labels only. While another cursor exists, copy states this scope and an explicit load-more button remains available, including when the first page contains no eligible candidate. No automatic load-all loop or fabricated total is introduced. Complete cross-dataset text search would need a later backend capability.

## 10. expectedVersion strategy

Service Floor does not expose the session version. Opening the editor reads the canonical GuestSession using a dedicated org/outlet/session key, zero stale time and mandatory refetch on mount. Submission waits for that read to finish and verifies OPEN status and matching table. It uses that session's version, never configuration/table versions. Closing or reassigning concurrently is still rejected authoritatively.

## 11. clientRequestId / idempotency UX

A UUID, version and intended target form one stable local command intent. Duplicate submissions and closing while pending are disabled. Network, server and malformed-response ambiguity preserve that exact request for explicit replay, including cancel/reopen in the same page context. Selection is frozen until replay resolves; no automatic write retry or new UUID is generated. Intents are organization/outlet/session scoped and cleared on organization change. No server entities are copied into long-lived Signals.

## 12. Assign / reassign / clear flows

Assign and replace use the same atomic command. Clear sends `staffId: null` and confirms removal from the table only; copy explicitly preserves Team and establishment membership. No delete or clear-then-assign sequence exists. Success closes the editor, refreshes authoritative reads and uses the shared success notification service; no fake local name is written to a card.

## 13. Concurrency handling

400/401/403/404/409 are definitive failures and release the rejected intent. A 409 refreshes session, floor and candidates, clears selection and explains that the latest information was reloaded. Replacement requires another explicit choice/confirmation. Permission failures disable further management and invalidate product availability. Missing/closed/wrong-table sessions block submission. Network/timeout/5xx/Zod ambiguity offers stable-intent retry. Business-safe existing error copy is used; no raw IDs, versions or exception internals are displayed.

## 14. Cache invalidation

Session key: `['restaurants', org, 'session', outletId, sessionId]`. Existing floor key: `['restaurants', org, 'service-floor', outletId]`. Existing candidate key: `['restaurants', org, 'outlet-staff', outletId]`. Success invalidates the exact floor and session. Rejections also refresh the exact candidate list; authorization failures reuse existing product-access invalidation. Other outlets/organizations are not invalidated. API scope checks reject a tenant change during a request, and dialogs close on originating outlet/organization change.

## 15. RBAC / capabilities

`canManageResponsibility()` names the existing OWNER/MANAGER management projection. It delegates to the existing canonical Restaurants role helper rather than modifying role data or permissions. SVC-2A's backend responsibility permission remains authoritative. Read-only users retain canonical names but no action trigger. Product availability and current page context remain required.

## 16. WAITER restrictions preserved

No route access, ProductAccess, shared role matrix, backend permission or transactional capability was changed. WAITER/CASHIER/KITCHEN remain restricted. No self-assignment, automatic opener assignment, My Tables, Orders, Kitchen, Checkout or Table Workspace was added.

## 17. Responsive behavior

Actual browser checks used 1440×1000, 900×1000 and 390×844. The existing four/two/one-column grid is retained. A long fixture name revealed mobile intrinsic-width overflow; an explicit single base grid column and local `min-w-0` constraints fix it without changing shared components/theme/shell. Final document widths equal viewport widths at 900 and 390. Person icons do not shrink. Dialog width is bounded by viewport minus 24 px, selectors remain touch/keyboard accessible, and long names truncate without increasing every card's height.

## 18. Accessibility

Person icons are decorative; names have explicit table-responsible context and full titles. Menus have table-specific accessible names. Material dialog title/focus trapping and labelled searchable selection are retained. Pending copy uses a live status; unavailable and unassigned states use text. Closing restores focus to the persistent originating menu trigger, including after success. Keyboard option selection is supported by the shared Material control. No status depends on color alone.

## 19. Browser observations

Deterministic local fixtures were used at `http://localhost:4200/restaurants/service?scenario=service`; this is not live backend validation. The existing review bootstrap intercepts business requests locally and does not change production bootstrap/configuration.

Observed: T01 free with no responsible UI; T02 Aïssatou S. (WAITER); T03 Élodie A. (MANAGER); T04 unassigned/no orders; T05 a long retained unavailable name. Browser interactions assigned T04 to Aïssatou, replaced her with Élodie, then cleared the assignment. The authoritative card changed after each local command; focus returned to T04's trigger. Mobile selector/options and desktop replacement/clear dialogs were inspected. A simulated 409 (`scenario=service-stale`) changed T04 concurrently to Élodie; the dialog reloaded that name, cleared the rejected selection and prevented an overwrite. Candidate pagination and non-authorized behavior are covered by automated tests, rather than claimed as additional live integration.

Evidence: `/tmp/resto-svc-2b-visual/floor-1440.png`, `floor-900.png`, `floor-390.png`, `dialog-desktop.png`, `dialog-390.png`, `clear-desktop.png`, `conflict-409.png`. Viewport override reset after review.

## 20. Tests and exact results

- Targeted Service Floor/API/dialog/capability frontend tests: **5 files, 73 tests PASS**.
- `npm test -w @liass-ohada/frontend -- --watch=false`: **132 files, 1,110 Angular tests PASS**; frontend contracts included: **21 tests PASS, 0 failed**.
- `npm run build -w @liass-ohada/shared`: **PASS**, generated artifacts only; source unchanged.
- `npm run build:development -w @liass-ohada/frontend`: **PASS**.
- Prettier on all changed TS/HTML/JSON/report files: **PASS**.
- `git diff --check`: **PASS**.

Coverage includes canonical name/unavailable/unassigned/free rendering, never opener, menus/read-only access, exact API requests and strict response validation, version selection, replace/clear, duplicate prevention, stable ambiguous retries across reopen, 400/403/404/409/network/5xx/Zod handling, eligibility changes, bounded pagination, cache invalidation, organization/outlet isolation and the existing opening/filter/navigation regressions. Builds retain existing package `sideEffects` warnings; no production configuration was fabricated and no production build was required.

## 21. Files changed

Frontend:

- `packages/frontend/public/assets/i18n/fr.json`
- `packages/frontend/public/assets/i18n/en.json`
- `packages/frontend/scripts/team-review/main.ts` (local fixtures only)
- `packages/frontend/src/app/domains/restaurants/data-access/restaurants.api.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurants.queries.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurants-capabilities.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurants-capabilities.spec.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/responsible-staff.api.spec.ts` (new)
- `packages/frontend/src/app/domains/restaurants/data-access/responsible-staff.test-fixture.ts` (new)
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.html`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.spec.ts`
- `packages/frontend/src/app/domains/restaurants/feature/responsible-staff-dialog.component.ts` (new)
- `packages/frontend/src/app/domains/restaurants/feature/responsible-staff-dialog.component.html` (new)
- `packages/frontend/src/app/domains/restaurants/feature/responsible-staff-dialog.component.spec.ts` (new)

Report: `docs/architecture/resto-svc-2b-responsible-staff-frontend.md` (new).

## 22. Backend changes: NONE

Backend and shared source hashes match the start-of-lot baseline. Git diff contains no backend, shared, infrastructure or API-contract changes. No CDK resource changed, so synth/resource-count delta is not applicable. No live AWS call, deployment or commit occurred.

## 23. Git status

Uncommitted working tree: 10 modified frontend files and 6 untracked files (five frontend additions plus this report). No unrelated file was reset or committed. Backend/shared/global theme/AppShell files are absent from this lot's diff.

## 24. RESTO-SVC-2B: PASS

Technical implementation, regression checks and fixture browser review pass. Visual acceptance remains the user's decision.

## 25. User visual-review readiness: YES

The local fixture screen and focused assignment workflows are ready for review. Browser observations establish frontend behavior only; they do not claim deployed backend integration.

## 26. RESTO-SVC-2C readiness: NO pending visual approval

SVC-2B provides the manager-facing responsibility controls needed before the next lot. Explicit user visual acceptance is still required. No SVC-2C work or WAITER authorization expansion was started.
