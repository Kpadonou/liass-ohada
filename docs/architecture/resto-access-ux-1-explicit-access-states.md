# RESTO-ACCESS-UX-1 — Explicit Restaurant access states

Date: 2026-10-16. Classification: Restaurants frontend access UX / role-aware product landing (VERTICAL_SOLUTION, Restaurants ownership; limited existing shell integration).

## 1. Motivation from the real Chrys E2E

An accepted COMPANY invitation made Chrys an active direct BETA member. BETA already enabled Restaurants, but Chrys initially had no Restaurants product role. Entering Liass-Resto produced an empty navigation area and “Votre accès a changé”, although nothing had been revoked. Subsequent WAITER, RestaurantStaff and outlet provisioning enabled real Service Floor use. This lot makes those distinct stages understandable without expanding authority.

PLATFORM-TENANT-UX-1 remains accepted and authoritative. Its global cross-tab organization model is preserved. No deployment or commit was performed.

## 2. Reconnaissance findings

The existing contracts are sufficient for a frontend-only implementation. `AuthStore` exposes authenticated identity, effective organization, canonical workspace discovery and context revision. `/me/workspaces` exposes active membership and its optional organization-scoped `productRoles.RESTAURANTS`; `ProductAccessState` independently exposes organization product availability. `RestaurantsCapabilities` already distinguishes management and service permissions.

Previously the Restaurants wrapper checked product availability, the dashboard was reachable by WAITER, and the sidebar exposed its overview to read roles. Service Floor already fetched user-scoped assigned outlets and protected operational selections. The workspace-selection page immediately redirected an already-selected member, requiring an explicit change-selection mode for the new action.

The platform architecture and Design System skills, AGENTS.md, SPEC.md, tenant hardening report, routes, guards, shell, capabilities, workspaces/ProductAccess contracts and self-outlet backend behavior were inspected before implementation. No Team provisioning or invitation administration was added.

## 3. Observable canonical access inputs

| Input                            | Authoritative frontend source                                        | Meaning                                                     |
| -------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Organization enables Restaurants | Active organization ProductAccess query / availability state         | Entitlement only                                            |
| Active direct COMPANY membership | Matching `/me/workspaces` projection in AuthStore                    | Current workspace membership                                |
| Member Restaurants role          | That exact membership's `productRoles.RESTAURANTS`                   | Member authorization; never inferred from organization role |
| Operational assignments          | Successful `/restaurants/me/outlets`, keyed by organization and user | Active accessible establishments                            |
| Previously valid role            | In-memory observation for the exact organization and principal       | Supports truthful role-removal messaging in this runtime    |
| Discovery/HTTP failure           | Explicit error state                                                 | Insufficient evidence to invent a business lifecycle stage  |

A present malformed product-role projection now fails schema parsing. It cannot silently become an absent role. An absent valid projection remains supported.

## 4. Explicit state model

`restaurant-access-state.ts` separates canonical membership mode from product availability, refresh progress and prior valid authorization. `restaurant-access-notice.component.ts` presents stateless translated notices. Initial discovery and refresh use a checking state so protected content is not rendered while authorization is unresolved.

## 5. No-role member behavior

An active direct COMPANY member with organization Restaurants entitlement and no Restaurants member role sees “Votre accès à Liass-Resto est en cours de configuration”. Copy explains that an owner must finalize access; it does not claim a pending invitation. Actions refresh canonical access or open the workspace selector. This is an ordinary configuration state, without alert semantics or an unexplained empty sidebar.

## 6. WAITER zero-outlet behavior

Only a successful complete self-outlet response containing zero active assignments produces “Aucun établissement ne vous est encore affecté”. The explanation names a gérant or owner as the next actor. Refresh and workspace change remain available. No Team link or unauthorized outlet is offered.

## 7. WAITER ready behavior

WAITER enters `/restaurants/service`, including a direct reload of `/restaurants`. Existing Service Floor queries, table rendering and authorized outlet selection remain intact. Navigation contains SERVICE → Service en salle only; no management overview or configuration links are shown.

## 8. OWNER / MANAGER behavior

OWNER and MANAGER retain the existing `/restaurants` dashboard and management capabilities. Existing capability checks still determine Service, configuration, menu and Team visibility. MANAGER's human label remains “Gérant”. Business-role enums and backend permissions are unchanged.

## 9. CASHIER / KITCHEN behavior

These roles receive the truthful “Votre espace Liass-Resto n’est pas encore disponible” notice and existing translated labels “Caissier” / “Cuisinier”. They receive neither a management destination nor a WAITER destination, and no dead sidebar links. Their operational workspaces were not implemented.

## 10. Genuine revocation behavior

When a previously observed canonical role disappears for the same principal and organization, the wrapper shows “Votre accès a changé”. Invalid membership/tenant and product authorization remain protected by existing guards and unavailable states. Previously successful operational context followed by denial also retains access-change handling. Initial ambiguous denial is treated separately.

Role-history evidence is scoped in memory to organization plus identity and cleared when the principal changes. It does not create a persistent backend revocation history. After a fresh browser runtime with no historical evidence, a valid no-role membership is correctly represented by its current configuration state.

## 11. `/restaurants` landing matrix

| Canonical state                      | Destination / result                                                      |
| ------------------------------------ | ------------------------------------------------------------------------- |
| OWNER                                | Existing dashboard at `/restaurants`                                      |
| MANAGER                              | Existing dashboard at `/restaurants`                                      |
| WAITER                               | `/restaurants/service`; operational state determined by self-outlet query |
| Entitled direct member, no role      | Setup notice at `/restaurants`                                            |
| CASHIER / KITCHEN                    | Unavailable operational interface notice at `/restaurants`                |
| Previously valid role removed        | Access-changed notice at `/restaurants`                                   |
| Access discovery unresolved / failed | Checking / neutral verification notice                                    |
| Product unavailable                  | Existing ProductAccess guard remains authoritative                        |

The child route guard runs before protected page activation. Direct WAITER Team/configuration URLs resolve to Service; a no-role member's Service URL resolves to the safe Restaurants root. This does not grant page capabilities or replace backend authorization.

## 12. Sidebar matrix and product switcher

| Member state                | Sidebar                                                             |
| --------------------------- | ------------------------------------------------------------------- |
| OWNER / MANAGER             | Existing capability-allowed dashboard, Service and configuration    |
| WAITER                      | Service en salle only                                               |
| No role / CASHIER / KITCHEN | No empty rail, backdrop, toggle or reserved desktop sidebar spacing |
| Canonical role removed      | Protected links disappear with capabilities                         |

The product switcher remains organization-entitlement based for Restaurants. Liass-Resto may remain selectable without a member role; entry now has an explicit useful state. No badge or switcher redesign was added. The root breadcrumb says “Accès Liass-Resto” for non-management states.

## 13. Refresh-access behavior

`Actualiser mon accès` forces workspace discovery, invalidates/refetches only the active organization's ProductAccess query, then resets the exact self-outlet query for that organization and authenticated user. Context revision, principal and organization are captured and checked between stages. A stale refresh cannot apply feedback or reset self-context in a newly selected tenant/account. No polling, sign-out or browser-storage reset is required.

Browser fixture sequence: no member role → click refresh after assigning a canonical WAITER fixture role → explicit zero-outlet state → click refresh after exposing an assigned outlet → Service Floor with establishment, area and T01. All transitions occurred without logout. Requests for workspace discovery, ProductAccess and self-outlets were observed. A fixture-only missing service-area handler was corrected before final visual approval; no application fix was required by review.

## 14. Partial-provisioning behavior

Membership without role is observable independently. WAITER plus successful empty self-outlets is observable independently. WAITER with assigned outlet reaches Service Floor.

Absent/inactive RestaurantStaff shares a non-diagnostic `403 DOMAIN_PERMISSION_REQUIRED` with other authorization failures. That initial response is **not** interpreted as setup pending or revocation. The neutral “Votre accès au service ne peut pas être confirmé” notice asks the user to refresh or have a gérant/owner verify access and assignment. Other transport/data errors preserve recoverable error handling. No backend orchestration or new endpoint was introduced.

## 15. Multi-organization isolation regression

The tests exercise generic organization A with WAITER, organization B without role, then return to A: role, access-state history and capability resolution remain scoped correctly. Self-outlet keys continue to include organization plus user. Refresh tests cover a switch during outstanding discovery and another principal in the same organization. Existing platform context-revision, query cancellation and cross-tab behavior are unchanged and their regressions passed in the full suite.

Real BETA ↔ CLO validation belongs to the accepted platform lot; this lot used deterministic synthetic workspaces for access lifecycle review. No real roles or assignments were modified.

## 16. Accessibility

Notices use semantic h1 headings (h2 under Service Floor's existing h1), labelled sections, semantic Material buttons and translated text. Notice transitions focus the heading; this was observed in Chrome's accessibility tree. Setup, unassigned and unsupported states are not announced as errors. Actual access/verification problems use alert semantics. Busy controls prevent duplicate refresh. Actions stack at narrow width and remain keyboard-accessible native buttons. No new custom keyboard interaction or screen-reader certification is claimed.

## 17. Browser review — 1440 / 900 / 390

Chrome Incognito, localhost:4200, responsive viewport widths with 900px height, deterministic local read-only HTTP fixtures on port 4201. Existing authentication was preserved; no credentials were copied. The fixture server rejects writes and does not proxy traffic or log authentication headers.

| State                          | 1440 | 900  | 390  | Observation                                                                          |
| ------------------------------ | ---- | ---- | ---- | ------------------------------------------------------------------------------------ |
| No role / configuration        | PASS | PASS | PASS | Clear title/copy/actions; no empty rail or toggle                                    |
| WAITER / zero outlets          | PASS | PASS | PASS | Explicit assignment state; Service-only navigation; stacked mobile actions           |
| WAITER ready                   | PASS | PASS | PASS | Establishment, area and T01 render; no configuration links; mobile selectors stack   |
| OWNER dashboard                | PASS | PASS | PASS | Existing dashboard and configuration navigation preserved; mobile cards stack        |
| Genuine canonical role removal | PASS | PASS | PASS | Correct access-changed copy, heading focus and safe actions; protected links removed |

Additional checks: Caissier and Cuisinier render the unavailable-yet state without fake destinations; `Changer d’espace de travail` opens `/select-workspace?change=1` and displays both memberships rather than bouncing back. No browser-discovered application changes were necessary. The local development API configuration was restored, the frontend restarted on port 4200, and Chrys's real BETA workspace restored. The fixture server was stopped after review.

## 18. Tests and exact results

| Validation                                                                                     | Result                                                           |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Focused access-state, route-guard, lifecycle and Restaurants wrapper/availability tests        | 5 files / 33 tests PASS                                          |
| Full `npm test -w @liass-ohada/frontend -- --watch=false`                                      | **143 files / 1,268 Angular tests PASS**, 18.61s Vitest duration |
| Frontend contracts (same command pre-step)                                                     | **21 tests PASS, 0 failures**                                    |
| Shared `npm run build -w @liass-ohada/shared`                                                  | PASS                                                             |
| `npm run build:development -w @liass-ohada/frontend` after restoring development configuration | PASS; 10.594s bundle generation                                  |
| Prettier on all changed/new supported files                                                    | PASS                                                             |
| `git diff --check`                                                                             | PASS                                                             |

The passing full suite includes capability, sidebar, Service Floor, routing, tenant/account-switch and Accounting regressions. It was not rerun after browser review because no application code changed; only the read-only review fixture handlers were completed. Production build was not required; generated production configuration is outside this development validation. Backend tests/build and CDK synth were not required because neither backend nor infrastructure changed. Existing shared package side-effect warnings appear in the development build; compilation succeeded.

## 19. Files changed

Paths below are relative to the repository root. Exact working-tree inventory follows; generated bundles and temporary review configuration are not included.

- `SPEC.md`
- `docs/architecture/resto-access-ux-1-explicit-access-states.md`
- `packages/frontend/public/assets/i18n/en.json`
- `packages/frontend/public/assets/i18n/fr.json`
- `packages/frontend/scripts/restaurants-access-review.mjs`
- `packages/frontend/src/app/core/navigation/product-navigation.spec.ts`
- `packages/frontend/src/app/core/navigation/product-navigation.ts`
- `packages/frontend/src/app/core/restaurants/restaurants-availability.integration.spec.ts`
- `packages/frontend/src/app/core/restaurants/restaurants.page.html`
- `packages/frontend/src/app/core/restaurants/restaurants.page.spec.ts`
- `packages/frontend/src/app/core/restaurants/restaurants.page.ts`
- `packages/frontend/src/app/core/routing/app.routes.ts`
- `packages/frontend/src/app/domains/identity/data-access/workspaces.api.spec.ts`
- `packages/frontend/src/app/domains/identity/data-access/workspaces.api.ts`
- `packages/frontend/src/app/domains/identity/feature/select-workspace/select-workspace.page.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurant-access-state.spec.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurant-access-state.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurant-access.test-fixture.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurant-route.guard.spec.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurant-route.guard.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-access-lifecycle.integration.spec.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.html`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.spec.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.ts`
- `packages/frontend/src/app/domains/restaurants/ui/restaurant-access-notice.component.ts`
- `packages/frontend/src/app/shared/layout/app-context-breadcrumb/app-context-breadcrumb.component.spec.ts`
- `packages/frontend/src/app/shared/layout/app-context-breadcrumb/app-context-breadcrumb.component.ts`
- `packages/frontend/src/app/shared/layout/app-shell/app-shell.component.html`
- `packages/frontend/src/app/shared/layout/app-shell/app-shell.component.ts`
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.spec.ts`
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.ts`
- `packages/frontend/src/app/shared/layout/app-topbar/app-topbar.component.html`

## 20. Backend changes

**NO.** Existing contracts and backend authorization remain authoritative. No endpoint, repository, permission or orchestration change.

## 21. Infrastructure changes

**NO.** No CDK resources, configuration, deployment or synth required.

## 22. Git status

Branch `main`; changes remain uncommitted and unstaged. No commit, push or deployment. Working tree was clean at this lot's start. Final inventory: 32 files (23 modified tracked files and 9 new untracked files), all unstaged. See section 19 for the complete list.

## 23. RESTO-ACCESS-UX-1 result

**PASS**, subject to the recorded development validation and browser evidence above. No permissions were expanded. Organization entitlement, member authorization and operational configuration remain independent. SPEC.md now contains one concise permanent Restaurants access-UX rule, alongside the accepted multi-organization framing.

## 24. RESTO-STAFF-UX-2 readiness

**YES.** Current-user access lifecycle UX is explicit and the next owner-facing Team lot may build on the canonical inputs. That lot has not been started.

## 25. Remaining limitations

- Initial missing/inactive staff cannot be diagnosed from the current self-outlet 403. It intentionally remains neutral and recoverable; no business state is invented.
- Genuine role-removal history is limited to the current application runtime; the current canonical no-role state remains safe after a fresh reload.
- CASHIER/KITCHEN operational interfaces remain unimplemented and are described truthfully.
- The prior OWNER → logout → Chrys → logout → OWNER manual scenario in one storage context remains deferred and non-blocking, as accepted by the user. This lot does not claim manual validation or reopen that platform task.
- Browser lifecycle evidence uses deterministic fixtures rather than changing real user authorization. No remaining blocker for this lot.
