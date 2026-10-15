# RESTO-STAFF-1B — Équipe / Team management frontend

Date: 2026-10-15. Classification: **VERTICAL_SOLUTION**. Owner: **Restaurants**. Frontend only; consumes the existing STAFF-1A foundation.

## 1. Backend contracts consumed

The shared strict Zod contracts in `@liass-ohada/shared/restaurants` remain unchanged. `RestaurantsApi` validates staff list/detail, outlet-staff and staff-outlet lists, lifecycle requests/results, and assignment/unassignment requests/results. All list requests use limit 50 and opaque cursors. Response ownership checks reject mismatched staff or outlet references. Scope is checked before requests and after staff responses, preventing late old-organization responses from entering a current interaction.

| Existing route                                                         | Use in this lot                                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| GET `/restaurants/staff`                                               | Paginated organization directory                                                          |
| GET `/restaurants/staff/{memberUserId}`                                | Current member details and explicit conflict review                                       |
| PATCH `/restaurants/staff/{memberUserId}`                              | Versioned ACTIVE/INACTIVE lifecycle                                                       |
| GET `/restaurants/staff/{memberUserId}/outlets`                        | Paginated retained assignments                                                            |
| POST `/restaurants/staff/{memberUserId}/outlets/{outletId}`            | New assignment or versioned reactivation                                                  |
| POST `/restaurants/staff/{memberUserId}/outlets/{outletId}/deactivate` | Versioned unassignment                                                                    |
| GET `/restaurants/outlets/{outletId}/staff`                            | Server-keyed establishment filter                                                         |
| POST `/restaurants/staff`                                              | Available in STAFF-1A but intentionally not exposed: eligible member discovery is missing |

Existing paginated outlet configuration and individual outlet reads supply human-readable labels and active status. No endpoint, DTO, role or backend business rule changes.

## 2. Platform dependencies discovered

Reconnaissance inspected repository instructions, SPEC, the architecture/design skills, STAFF-1A report/contracts/routes/lifecycle, Restaurants API/query/capability patterns, Platform workspaces/profile and Cabinet member clients, product routing/navigation, existing configuration and dialogs, and responsive components.

The current frontend member directory and invitation APIs are Cabinet-specific. There is no bounded generic COMPANY member discovery/selection endpoint suitable for Restaurants. Authentication, membership, product entitlement and product-role administration remain Platform-owned. The UI cannot truthfully invite a person, discover arbitrary eligible members or change a Restaurants role.

Design references consulted: `liass-ui-principles`, `liass-design-tokens`, `liass-component-guidelines`, `liass-interaction-patterns`, `liass-page-templates`, central `material-theme.scss`, `styles.css` tokens, existing logos, Restaurants configuration/editor/Service Floor patterns, and shared page/header/card/status/searchable-select/confirmation patterns. The approved theme is reused unchanged.

## 3. Route and navigation

Adds lazy `/restaurants/setup/team` inside the existing Restaurants wrapper and ProductAccess route guards. The contextual CONFIGURATION sidebar ends with Restaurant, Établissements, Espaces de restauration, Tables, Postes de préparation, Menu, **Équipe**. English label: **Team**. The shared sidebar implementation also supplies the existing mobile drawer.

The entry requires `canReadStaff()`. `ShellRouteContext` recognizes Team for highlighting and the existing breadcrumb title. No new product area, HR navigation, AppPage category, AppShell code, authentication guard or global theme/default changes.

## 4. Team information architecture

One task-oriented page: restrained page header, establishment/status filters, accurate loaded-member summary, and a readable collection. There are no KPI/dashboard tiles, role editor, invitation controls or standalone staff workspace. The page answers identity, current role, lifecycle and establishment assignments.

## 5. Staff-card/list design

Cards form two columns on wide screens and one on tablet/mobile. Each uses a name-first header, readable role, textual status chip, named establishments and one primary contextual action, “Gérer les affectations”. A compact Material menu contains the lifecycle action. Historical inactive relations and inactive establishments have distinct text labels.

Reuses `liass-page-header`, `liass-card`, `liass-status-chip`, `liass-skeleton`, `liass-searchable-select` and the semantic `liass-button` danger action for deactivation. Uses supported Material buttons, icons, menus, selects/form fields, checkboxes and MatDialog. Layout uses existing Tailwind/token classes; no new palette, decorative gradient, component token override or local stylesheet is needed.

## 6. Display-name handling

Only STAFF-1A's safe `displayName` is presented. A null value becomes translated “Membre de l’équipe” / “Team member”. Canonical user references are used internally for requests/query keys only, never visible identity labels. No provider username, Cognito subject or email is rendered. The optional operational label is not edited in this micro-lot; no personal identity fields are duplicated.

## 7. Role presentation

The DTO's current `restaurantRole` is read-only. FR: Propriétaire, Responsable, Serveur, Caissier, Cuisine; EN: Owner, Manager, Waiter, Cashier, Kitchen. Null becomes “Rôle indisponible”. No role-changing control or fake action exists.

## 8. Lifecycle UX

The menu offers Désactiver/Réactiver based on current staff status. Focused confirmation dialogs explain consequences: no deletion; retained assignment/history; explicit reactivation can restore the eligibility of retained active assignments, subject to current access/outlet checks. Reactivation is unavailable from the menu when membership/role is missing.

Each command retains its UUID and expected version across retries. A conflict stays visible and offers explicit reload/review. Review reads current authoritative staff, uses a new version/UUID only after that explicit step, or reports no change if the intended status already exists. Success uses the safe response message or translated fallback via NotificationService. Failures stay in the dialog. Pending submissions and dismissal are blocked. Organization changes close dialogs and prevent further commands/toasts for the previous organization.

## 9. Outlet-assignment UX

A single typed Reactive Forms editor presents Material checkboxes, including selected establishments outside the initially loaded outlet page. Current assignments must be fully known before editing/saving; further assignment pages are loaded only through an explicit button. Outlet options have their own explicit load-more action. Unknown referenced labels hydrate through bounded individual outlet queries; they never show IDs. Missing references display “Établissement indisponible”, and inactive establishments remain visibly inactive.

Active relations to inactive establishments can be removed. New assignments to inactive establishments are disabled. Inactive/ineligible staff can have existing relations removed; new assignments are disabled. The service still decides whether each submitted action is permitted.

The backend has no atomic replacement operation. The editor computes a delta against a frozen, complete assignment snapshot, retains per-command UUID/version/payload, submits sequentially and stops on the first failure. Acknowledged commands are skipped on retry; an uncertain command is retried with its original identity. No automatic mutation retry or optimistic whole-editor success is used.

Partial/uncertain failure leaves the editor open, choices preserved and frozen, with clear contextual explanation, “Réessayer les changements restants” and “Recharger et vérifier”. Explicit review discards the local intent and rebuilds controls from current authoritative state. A background version change before first submission blocks saving and requires review; it cannot silently rebase old checkbox choices onto new versions. Success is announced only after every command succeeds. Partial results are independently auditable by the unchanged backend.

## 10. Existing-member addition behavior

No Add button/dialog is exposed. Asking a manager to type a user ID or arbitrary email would not be a usable member-selection flow. Existing directory, lifecycle and outlet management remain fully usable. The empty state explains that people must first belong to the workspace and have Liass-Resto access, without a dead action.

## 11. Invitation behavior intentionally absent

No invitation UX, email subsystem, authentication calls, Cognito creation or second staff identity. Generic workspace member onboarding remains a separate Platform dependency.

## 12. Role administration intentionally absent

No role-editing API client, control or capability. `productRoles.RESTAURANTS` is consumed through the canonical projection; it is never modified.

## 13. Permissions and read-only behavior

`RestaurantsCapabilities` checks the canonical STAFF_READ / STAFF_MANAGE permissions within a direct active COMPANY context. OWNER/MANAGER retain their current broad semantics and need no staff record themselves. Current WAITER/CASHIER/KITCHEN have no Team administration/read grants. Global OWNER or entitlement alone does not supply those grants.

Read-only rendering is coherent when read exists without manage: one contextual explanation and no mutation actions. The current canonical roles grant both staff permissions together; the read-only browser scenario explicitly demonstrates this rendering through a local capability fixture, not a new production role.

ProductAccess guards/wrapper remain intact, direct unauthorized navigation shows a business-safe denial, and denied list responses suppress cached staff cards. Backend authorization remains authoritative. No Service Floor, session, `openedBy`, waiter assignment or transactional permission changes.

## 14. Query/cache strategy

All HTTP work lives in the existing centralized RestaurantsApi. TanStack Query owns server state; typed form controls/signals hold only filters, pending state and local editing intent.

Organization-scoped keys:

- `['restaurants', org, 'staff']`
- `['restaurants', org, 'staff-member', userId]`
- `['restaurants', org, 'staff-outlets', userId]`
- `['restaurants', org, 'outlet-staff', outletId]`

Existing configuration keys are reused for outlet lists/detail hydration. Stable outlet details use a five-minute staleTime; staff lists/relations use one minute. Editors request fresh staff/assignment reads at opening. Shared observers deduplicate card/dialog reads. Organization switches reset filters, change query keys, close stale dialogs, and reject late responses.

Assignment mutations invalidate the exact member's assignment list and only affected cached outlet directories, even on uncertain/partial results. Lifecycle mutations invalidate the staff directory, that member/detail/assignments and outlet-directory family where their status is projected. No unrelated Accounting, Sales, Service Floor or global server caches are refreshed.

## 15. Pagination

Directory and establishment-filter results are infinite queries with explicit load-more; no load-all loop. Each staff card can load more retained assignments. The editor requires complete assignment knowledge before mutation; it never assumes one page is complete. Outlet choices remain explicitly paginated and assigned-value references hydrate independently.

The establishment filter uses the server's outlet-staff query, then excludes retained inactive relations. Status filtering is explicitly local to loaded pages. Counts say “membres affichés” while further pages remain or a local status filter is applied; no global total is fabricated. A partial page with no matches says no loaded members, not no team. Opaque cursors are preserved unmodified.

## 16. Errors and empty states

Distinct states cover initial loading skeletons; empty complete team; no active relation at the selected establishment; empty status-filter result; empty partial page; list/reference load errors; denied access; dialog validation/concurrency/partial errors; and unavailable historical outlets. Retry/refresh controls stay in context.

Staff-specific business fallbacks handle 400/401/403/404/409, network and Zod failures. Safe backend HTTP messages are preferred; raw JavaScript/protocol-context exceptions and technical/Zod metadata are never surfaced. Success/no-change feedback uses NotificationService; blocking/dialog errors remain visible inline. No normal copy mentions ProductAccess, USER_ORG_ACCESS, backend, AWS or persistence keys.

## 17. Responsive behavior

Inspected at 1440×1000, 900×1000 and 390×844. Cards use two columns only at wide sizes; tablet/mobile remain one column. Filters stack on mobile. Dialogs have `maxWidth: calc(100vw - 24px)` and wrapping actions. Names/labels wrap and the mobile document width equals its 390px viewport. Existing responsive topbar/drawer/layout remain unchanged.

## 18. Accessibility

Cards are labelled articles with h2 identity headings under the page h1. Role/status are text, never color-only. Reference checkboxes have human labels; native Material dialog title semantics, focus trap, Escape/cancel and focus restoration are reused. Pending states disable duplicate commands and dismissal and announce progress; errors use role=alert; loading has role=status/aria-busy and translated labels. The menu trigger names its member. Lifecycle dialogs explicitly restore focus through the persistent Material menu-trigger button, since the clicked menu item is removed when its menu closes. Read-only/disabled states remain understandable.

Browser verification observed initial focus on the first checkbox, focus returning to the invoking “Gérer les affectations” button after save/cancel, and Tab moving to the named member menu. The mobile drawer's Team destination uses the same permission-aware navigation.

## 19. Browser observations

**Actual Angular UI reviewed with local deterministic HTTP fixtures, not live backend integration.** The review entry boots the real App, routes/guards, shell, product wrapper, query helpers/API client, Team components and Material controls. Its local in-memory fixture supplies dummy identity/membership/entitlement and blocks non-fixture business requests; it does not import production authentication bootstrap. Fixture state is disposable and resets on reload.

Run separately from the normal dev server (same required port 4200):

```sh
node packages/frontend/scripts/team-review.mjs
```

The runner creates its build configuration in memory through Angular Architect; `angular.json`, production entry, guards, global defaults and AppShell remain unchanged. Review code stays under `scripts/`, outside the production tsconfig/browser graph. NgRx's testing `unprotected` helper seeds only the local dummy fixture store; no production auth protection changes.

URLs:

- `/restaurants/setup/team`: four members, active/inactive mix, multiple/single assignments and inactive Calavi.
- `?scenario=empty`: empty team without fake Add/invitation action.
- `?scenario=readonly`: directory/assignments visible, zero management actions.
- `?scenario=denied`: operational role; Team navigation absent and direct page denied.
- `?scenario=partial`: one successful command followed by a simulated network failure; explicit retry completes only remaining intent.

Observed: contextual Team navigation/highlighting; translated role/status; active/inactive establishment labels; mobile wrapping without horizontal overflow; loaded filter labels; focused assignment dialog; successful unassignment retained as inactive history; safe partial failure with disabled choices and no success toast until retry; role denial and read-only action absence. No live AWS, Cognito, backend deployment or cloud integration is claimed.

Local screenshot evidence is under `/tmp/resto-staff-1b-visual/`: desktop, tablet, mobile, mobile-dialog, empty, readonly, denied, partial-failure assignment-dialog and deactivate-dialog PNGs. These are local review artifacts, not production media assets.

## 20. Tests and exact results

Final validation on 2026-10-15:

| Validation                                                                                                               | Exact result                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Targeted `ng test --watch=false` including Team page, staff API, assignment plan, capabilities, routes and sidebar specs | **PASS: 6 files, 107 tests**                                                                                                                                   |
| `npm test -w @liass-ohada/frontend -- --watch=false`                                                                     | **PASS: 130 Angular/Vitest files, 1,064 tests**; the same command also passes all 21 frontend contract tests                                                   |
| `npm run build -w @liass-ohada/shared`                                                                                   | **PASS**, no shared source or contract changes                                                                                                                 |
| `npm run build:development -w @liass-ohada/frontend`                                                                     | **PASS**, final source                                                                                                                                         |
| Prettier write/check on all 28 STAFF-1B files                                                                            | **PASS**                                                                                                                                                       |
| `git diff --check`                                                                                                       | **PASS**                                                                                                                                                       |
| Backend tree hash comparison                                                                                             | **PASS: zero changed/added/deleted backend source/config/test/script files**                                                                                   |
| Browser review                                                                                                           | **PASS on local fixtures**, desktop/tablet/mobile, populated/mixed state, assignment dialog, empty/read-only/denied, filter, partial retry and lifecycle/focus |

New/focused coverage includes strict response/request ownership checks; opaque pagination; HTTP 400/403/404/409/network and Zod failures; organization cache and late-response isolation; safe names/null names/roles/statuses; inaccessible IDs/provider metadata; absence of role/invitation UI; OWNER/MANAGER versus operational capabilities; route/navigation visibility; server outlet filtering and local status filtering; empty/partial states; versioned deactivate/reactivate/retry; complete assignment pagination; multi-command deltas; duplicate submission prevention; durable retry payload/UUID identity; partial failure/review; background concurrency detection; out-of-page label hydration/unavailable labels; targeted cache invalidation; and lifecycle menu focus restoration.

Existing Restaurants configuration, Service Floor and the full adjacent frontend suites remain green. Nonblocking existing shared-package sideEffects/bare-import and outdated Browserslist notices remain. Production build was not attempted in this lot because the legitimate production configuration dependency remains absent; no fake production values were supplied.

## 21. Production-build limitation

Production frontend configuration remains an accepted environment dependency from STAFF-1A: legitimate production Cognito/CDK outputs are not supplied. This lot validates the development build and does not fabricate production configuration or deploy. No production-readiness claim is made from a development build.

## 22. Files changed

- `packages/frontend/public/assets/i18n/en.json`
- `packages/frontend/public/assets/i18n/fr.json`
- `packages/frontend/scripts/team-review.mjs`
- `packages/frontend/scripts/team-review/main.ts`
- `packages/frontend/scripts/team-review/tsconfig.json`
- `packages/frontend/src/app/core/navigation/product-navigation.ts`
- `packages/frontend/src/app/core/routing/app.routes.spec.ts`
- `packages/frontend/src/app/core/routing/app.routes.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurants-capabilities.spec.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurants-capabilities.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurants-staff.api.spec.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurants.api.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurants.queries.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/staff.test-fixture.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-team.page.html`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-team.page.spec.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-team.page.ts`
- `packages/frontend/src/app/domains/restaurants/feature/staff-assignments-dialog.component.html`
- `packages/frontend/src/app/domains/restaurants/feature/staff-assignments-dialog.component.ts`
- `packages/frontend/src/app/domains/restaurants/feature/staff-status-dialog.component.ts`
- `packages/frontend/src/app/domains/restaurants/ui/staff-card.component.ts`
- `packages/frontend/src/app/domains/restaurants/ui/staff-outlet.component.ts`
- `packages/frontend/src/app/domains/restaurants/utils/staff-assignment-plan.spec.ts`
- `packages/frontend/src/app/domains/restaurants/utils/staff-assignment-plan.ts`
- `packages/frontend/src/app/domains/restaurants/utils/staff-errors.ts`
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.spec.ts`
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.ts`
- `docs/architecture/resto-staff-1b-team-frontend.md`

## 23. Backend changes: MUST BE NONE

**NONE.** File hashes for the complete backend source/config/test/script tree were captured before work and compared after implementation, excluding ignored dependency/build/CDK directories. No backend file was added, deleted or changed. Shared contracts, DynamoDB keys/indexes, CDK resources, IAM, translations and backend permissions are unchanged in this lot. No backend build/deployment/migration is required by these frontend-only changes.

## 24. Git status

The working tree was clean at the beginning of STAFF-1B. No commit or deployment was made. Global `material-theme.scss`, styles/tokens, AppShell and production bootstrap/configuration were preserved. The completed STAFF-1A implementation and prior Service Floor work remain intact.

```text
 M packages/frontend/public/assets/i18n/en.json
 M packages/frontend/public/assets/i18n/fr.json
 M packages/frontend/src/app/core/navigation/product-navigation.ts
 M packages/frontend/src/app/core/routing/app.routes.spec.ts
 M packages/frontend/src/app/core/routing/app.routes.ts
 M packages/frontend/src/app/domains/restaurants/data-access/restaurants-capabilities.spec.ts
 M packages/frontend/src/app/domains/restaurants/data-access/restaurants-capabilities.ts
 M packages/frontend/src/app/domains/restaurants/data-access/restaurants.api.ts
 M packages/frontend/src/app/domains/restaurants/data-access/restaurants.queries.ts
 M packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.spec.ts
 M packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.ts
?? docs/architecture/resto-staff-1b-team-frontend.md
?? packages/frontend/scripts/team-review.mjs
?? packages/frontend/scripts/team-review/main.ts
?? packages/frontend/scripts/team-review/tsconfig.json
?? packages/frontend/src/app/domains/restaurants/data-access/restaurants-staff.api.spec.ts
?? packages/frontend/src/app/domains/restaurants/data-access/staff.test-fixture.ts
?? packages/frontend/src/app/domains/restaurants/feature/restaurant-team.page.html
?? packages/frontend/src/app/domains/restaurants/feature/restaurant-team.page.spec.ts
?? packages/frontend/src/app/domains/restaurants/feature/restaurant-team.page.ts
?? packages/frontend/src/app/domains/restaurants/feature/staff-assignments-dialog.component.html
?? packages/frontend/src/app/domains/restaurants/feature/staff-assignments-dialog.component.ts
?? packages/frontend/src/app/domains/restaurants/feature/staff-status-dialog.component.ts
?? packages/frontend/src/app/domains/restaurants/ui/staff-card.component.ts
?? packages/frontend/src/app/domains/restaurants/ui/staff-outlet.component.ts
?? packages/frontend/src/app/domains/restaurants/utils/staff-assignment-plan.spec.ts
?? packages/frontend/src/app/domains/restaurants/utils/staff-assignment-plan.ts
?? packages/frontend/src/app/domains/restaurants/utils/staff-errors.ts
```

## 25. RESTO-STAFF-1B PASS / FAIL

**PASS.** Frontend/domain scope completed and verified; live backend integration and production deployment are not claimed.

## 26. User visual-review readiness YES / NO

**YES.** The local deterministic review is available at localhost:4200 and the production Team route is implemented. The user should review Équipe before SVC-2. Actual existing staff API use requires STAFF-1A deployed in the target environment; this lot performs no deployment or live integration test.

## 27. RESTO-SVC-2 readiness YES / NO

**YES for later implementation, after user visual review.** STAFF-1A's prerequisite and STAFF-1B management are available. No waiter/session assignment, waiter names on Service Floor, operational transactional grants, Table Workspace, Kitchen, Checkout, scheduling, invitations or role administration are implemented. `openedBy` remains an opening actor only.
