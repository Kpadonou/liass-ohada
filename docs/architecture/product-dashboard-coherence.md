# PRODUCT-DASHBOARD-COHERENCE

Date: 2026-10-11. Scope: frontend shell/routing and existing dashboard presentation only.

## 1. Repository reconnaissance

Classification: **PLATFORM_CORE**, owning product navigation and recovery routing. The new routed Sales page belongs to the existing Sales domain; the restaurant dashboard remains Restaurants-owned. Applied `liass-platform-architecture` and `liass-design-system`; inspected `SPEC.md`, repository guidance, global routes, AppShell, AppSidebar, AppTopbar, breadcrumbs, product navigation, ProductAccess queries/state/guard, Sales capability projection, existing ERP dashboard, restaurant overview and tests.

`/dashboard` is a Core ERP presentation page, with Accounting, Projects and Treasury content. It is also the safe destination of entitlement guards. `SPEC.md` keeps platform recovery outside product enforcement. `/accounting` is a separate, established Accounting overview. Sales had no dashboard: `/sales` redirected to Customers. Restaurants already had its domain dashboard on `/restaurants`.

Tenant identity, organization-scoped query keys, independent product entitlements, domain ownership, permission projection and backend authorization remain intact. No persistence access pattern, integration, contract, AWS resource, audit event or migration is introduced.

## 2. Root cause of the Sales dashboard defect

The non-Restaurants sidebar reused a global Dashboard item targeting `/dashboard`. The shell treated that page as having no explicit route product and fell back to the first accessible product. A Sales-only workspace could therefore show Ventes in the shell while rendering the ERP dashboard. The switcher separately entered Sales through Customers, so it did not provide a legitimate dashboard destination.

## 3. Previous product-dashboard route mapping

| Product     | Switcher landing         | Sidebar Dashboard                    |
| ----------- | ------------------------ | ------------------------------------ |
| ACCOUNTING  | `/accounting` (overview) | `/dashboard` (ERP dashboard)         |
| SALES       | `/sales/customers`       | `/dashboard` (incorrect ERP content) |
| RESTAURANTS | `/restaurants`           | `/restaurants`                       |

## 4. New product-dashboard route mapping

| Product     | Canonical landing/dashboard | Preserved routes                                      |
| ----------- | --------------------------- | ----------------------------------------------------- |
| ACCOUNTING  | `/dashboard`                | `/accounting` overview and all business pages         |
| SALES       | `/sales`                    | Customers, Items, Invoices and existing detail routes |
| RESTAURANTS | `/restaurants`              | All setup and menu routes                             |

`/sales` is an explicit page, not a local tab or conditional dashboard renderer. `shellProducts` remains the identity/icon/landing source for the product switcher and Sales Dashboard item. `sales.dashboard` is the route-derived UI page identity. `/dashboard` is explicitly Accounting in the shell when its ERP view is available.

The new Core `DashboardEntryPage` preserves `/dashboard` as an unguarded platform recovery entry. It renders the unchanged ERP DashboardPage only with verified Accounting availability. Without Accounting, it replaces the URL with the first accessible product's canonical landing; without accessible products or successful verification, it displays a neutral recovery message. Pending verification displays a loading card. No unavailable Accounting business data is loaded. The topbar excludes the recovery page from its entitlement-loss redirect to prevent self-navigation loops.

## 5. Sales dashboard implementation

New `domains/sales/feature/dashboard/SalesDashboardPage`: translated Dashboard title, Sales eyebrow, short description and three native RouterLink cards for Customers, Items & services, and Invoices. Shared PageHeader/Card, Material icons, existing settings-width token, responsive grid and focus ring. No business metrics, charts, queries or new operations.

## 6. Product-switcher changes

The existing compact topbar selector and workspace selector remain structurally unchanged. Accounting now lands on `/dashboard`, Sales on `/sales`, and Restaurants on `/restaurants`, through the shared mapping. Existing accessible-product filtering, commercial labels, canonical icons, single-product behavior and active organization retention are preserved. A recovery page awaiting redirection no longer falsely announces Sales while displaying Accounting.

## 7. Sales sidebar changes

Its Dashboard item uses `sales.dashboard` and `/sales`. Customers, Items & services and Invoices remain under the existing Sales group. Selection uses the existing navigation method, closes the mobile drawer, and exposes `aria-current="page"`. Accounting's legacy navigation and Restaurants' contextual group structure remain unchanged.

## 8. Restaurants dashboard polish

Kept the hero, four summary cards, responsive layout and existing bounded query state. Added chevrons and native links to the four cards. Removed the outlet-name section heading that produced “Configuration de test” for an outlet named “test”. The hero menu action now uses the same Menu label as the sidebar.

## 9. Restaurants terminology cleanup

Dashboard card titles directly reuse the sidebar's UX navigation keys: Restaurant, Établissements, Espaces de restauration, Postes de préparation. Updated the existing area/station kind translations to match those canonical concepts in French and English. Tables and Menu retain their canonical names. Dashboard remains Tableau de bord / Dashboard; no Vue d’ensemble label is introduced for Restaurants. No kitchen execution terminology or behavior is added.

## 10. Restaurants shortcut behavior

| Card                    | Destination                    |
| ----------------------- | ------------------------------ |
| Restaurant              | `/restaurants/setup`           |
| Établissements          | `/restaurants/setup/locations` |
| Espaces de restauration | `/restaurants/setup/areas`     |
| Postes de préparation   | `/restaurants/setup/stations`  |

Menu remains the existing hero action to `/restaurants/menu`, subject to existing menu read capability. Location/area/station counts still use the current loaded rows and retain `+` for paginated results. Area/station counts remain scoped to the selected/default outlet, not organization-wide aggregates. No additional request or table count was introduced.

## 11. Accounting regression behavior

Preserved the existing ERP DashboardPage implementation and `/accounting` overview. Accounting switcher now enters the actual ERP Dashboard. Existing Accounting navigation, ProductAccess tests and route tests pass. Browser selection showed Comptabilité and the existing ERP content at `/dashboard`. The legacy sidebar still contains both Tableau de bord and Comptabilité > Vue d’ensemble; this remains a later UX cleanup, not a removed page. Existing static ERP demo metrics were neither changed nor validated as live financial data.

## 12. ProductAccess / guard behavior

The new Sales dashboard route uses the existing `productAccessGuard` with `productCode: SALES`, followed by a small Sales read guard reusing `SalesCapabilities.canRead()` (the same current COMPANY/OWNER projection as existing read surfaces). Guard failures continue to use `/dashboard`. No backend entitlement or RBAC semantics changed. Recovery filtering excludes unreadable Sales. Accounting business guards and Restaurants guards/capabilities remain intact. Frontend visibility is still presentation, not backend security.

The recovery page observes the existing cached ProductAccess query; it does not create a separate access mechanism. Same organization-specific key and stale-time rules apply, so observers share the request/cache.

## 13. Workspace-switch behavior

Kept the existing topbar workspace transition through the safe Core destination. The new recovery entry resolves the next landing from that organization's available products. With Accounting available, it retains the existing preference for the ERP dashboard; otherwise it selects accessible Sales or Restaurants. Query keys include organization id, so old data cannot authorize or supply choices for a new organization. Tests cover a delayed new-organization response and a late old-organization cache update, plus unmounting Accounting content during an organization transition.

Manual fixture transition from BETA (three products) to a Restaurants-only workspace while on Sales resulted in `/restaurants` and a single Liass-Resto identity without a misleading dropdown chevron.

## 14. Breadcrumb consistency

Sales pages now include their product segment; Dashboard is BETA > Ventes > Tableau de bord. Restaurants retains BETA > Liass-Resto > Tableau de bord and concise section breadcrumbs. Accounting preserves its established BETA > Tableau de bord breadcrumb. No sidebar grouping level was added.

## 15. Responsive / accessibility notes

Reused the existing shell, desktop sidebar and mobile drawer, including the existing two-row phone topbar. Sales cards use a one-column mobile / three-column desktop grid and the existing settings-width token. Restaurant cards keep their existing responsive two-column grid. Native links provide keyboard activation; translated accessible names, decorative aria-hidden chevrons/icons and `liass-focus-ring` are retained. Existing sidebar buttons retain current-route semantics. No separate mobile navigation or horizontal sub-navigation was introduced.

Observed at desktop, 900px and 400px: controls fit, cards reflow, and no visible horizontal overflow. A long workspace name truncates while keeping Liass-Resto readable. Screen-reader and complete keyboard-only end-to-end sessions were not performed.

## 16. Files changed in this task

The following task-scoped files sit alongside substantial pre-existing uncommitted work:

- `packages/frontend/src/app/core/navigation/product-navigation.ts`
- `packages/frontend/src/app/core/navigation/product-navigation.spec.ts`
- `packages/frontend/src/app/core/state/ui.store.ts`
- `packages/frontend/src/app/core/routing/app.routes.ts`
- `packages/frontend/src/app/core/routing/app.routes.spec.ts`
- `packages/frontend/src/app/core/feature/dashboard/dashboard-entry.page.ts`
- `packages/frontend/src/app/core/feature/dashboard/dashboard-entry.page.spec.ts`
- `packages/frontend/src/app/domains/sales/data-access/sales-dashboard-read.guard.ts`
- `packages/frontend/src/app/domains/sales/feature/dashboard/sales-dashboard.page.ts`
- `packages/frontend/src/app/domains/sales/feature/dashboard/sales-dashboard.page.html`
- `packages/frontend/src/app/domains/sales/feature/dashboard/sales-dashboard.page.spec.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurants-workspace.page.html`
- `packages/frontend/src/app/domains/restaurants/feature/restaurants-workspace.page.spec.ts`
- `packages/frontend/src/app/shared/layout/app-shell/app-shell.component.ts`
- `packages/frontend/src/app/shared/layout/app-shell/app-shell.component.spec.ts`
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.ts`
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.html`
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.spec.ts`
- `packages/frontend/src/app/shared/layout/app-topbar/app-topbar.component.ts`
- `packages/frontend/src/app/shared/layout/app-topbar/app-topbar.component.spec.ts`
- `packages/frontend/src/app/shared/layout/app-context-breadcrumb/app-context-breadcrumb.component.ts`
- `packages/frontend/src/app/shared/layout/app-context-breadcrumb/app-context-breadcrumb.component.html`
- `packages/frontend/src/app/shared/layout/app-context-breadcrumb/app-context-breadcrumb.component.spec.ts`
- `packages/frontend/public/assets/i18n/fr.json`
- `packages/frontend/public/assets/i18n/en.json`
- `packages/frontend/scripts/product-dashboard-translations.test.mjs`
- `docs/architecture/product-dashboard-coherence.md`

## 17. Tests added / updated

- New Sales dashboard routing tests: direct `/sales`, re-entry, native shortcut destinations, absence of the ERP component, missing entitlement, and missing read permission.
- New recovery tests: Accounting rendering only when available, workspace change removes the old ERP view, Sales-only / Restaurants-only redirection, and no-products recovery without a redirect loop.
- Sidebar tests: Dashboard route and selected state, and a real router/harness click that renders the Sales page.
- Topbar tests: all three canonical product destinations, organization retention, accessible choices, and context transition without an invalid Sales identity on the ERP page.
- Product navigation tests: route identities, landing mapping and existing organization isolation coverage.
- Routes/AppShell tests: dashboard ownership and direct Sales URL resolution, preserving all existing Sales and Accounting routes.
- Breadcrumb test: Sales product and Dashboard label.
- Restaurants dashboard test: native shortcut routes, existing counts, chevrons and removal of the outlet configuration heading; existing permission/navigation tests remain green.
- Translation contract: real French/English dashboard names, canonical area/station wording, Sales key parity and recovery copy.

## 18. Validation commands and exact results

Commands run with Node v22.22.3 available on PATH:

```sh
npm exec --workspace @liass-ohada/frontend -- ng test --watch=false --include='**/dashboard*.spec.ts' --include='**/sales-dashboard.page.spec.ts' --include='**/product-navigation.spec.ts' --include='**/app-*.spec.ts' --include='**/restaurants-workspace.page.spec.ts' --include='**/product-access*.spec.ts'
npm test -w @liass-ohada/frontend -- --watch=false
npm run test:frontend-contracts -w @liass-ohada/frontend
npm run build:development -w @liass-ohada/frontend
# Prettier --write, then --check on the files in section 16
git diff --check
```

- Targeted Angular: **133 tests, 11 files — PASS**.
- Full Angular: **964 tests, 123 files — PASS**.
- Frontend script contracts: **20 tests — PASS** (also run by the full frontend command).
- Development build: **PASS**. Existing shared-package sideEffects / ignored bare import warning remains; no build error.
- Scoped Prettier: **PASS**.
- `git diff --check`: **PASS**, no whitespace errors.
- No backend regressions were run: this task changed no backend/shared source. The backend package modification already existed at task start.

Initial test failures were limited to old expected routes/context fallback and a test menu selector; these were corrected and the final suites pass. The final build contains the normal application entry point, not the temporary visual harness.

Logs: `/tmp/dashboard-coherence-targeted.log`, `/tmp/dashboard-coherence-full.log`, `/tmp/dashboard-coherence-contracts.log`, `/tmp/dashboard-coherence-build.log`, `/tmp/dashboard-coherence-prettier-check.log`.

## 19. Browser / manual observations

Actually inspected native Chrome with the real Angular AppShell, Sidebar, Topbar, Breadcrumb, ERP Dashboard, Sales Dashboard and Restaurants pages, backed by local synthetic workspace/ProductAccess/restaurant providers. The temporary preview used `localhost:4200` and static local hosting; it was removed from the repository afterwards. No live authentication, AWS or fiscal requests were used for this inspection. Actual application guard behavior was tested automatically rather than through the simplified visual fixture router.

- Desktop `/sales`: Ventes selector and sidebar, BETA > Ventes > Tableau de bord, Sales-only shortcut content; no Accounting dashboard.
- Product menu -> Accounting: `/dashboard`, Comptabilité selector, existing ERP content and Accounting navigation.
- Product menu -> Restaurants: `/restaurants`, canonical sidebar, correct breadcrumb/title, four chevron shortcuts and existing count values; no configuration section heading.
- 900px: Sales and Restaurants topbars and card grids fit; drawer architecture remains available.
- 400px: Sales cards stack, workspace/product remain discoverable, drawer opens and Dashboard selection remains on `/sales` and closes the drawer.
- Browser refresh of `/sales` restores Sales page and identity.
- Workspace change to a Restaurants-only organization redirects to `/restaurants`, removes other product choices and safely truncates a long workspace name.
- Restaurant Établissements card opens `/restaurants/setup/locations` with the correct title and breadcrumb.

Evidence saved locally in `/tmp/product-dashboard-evidence/`: `sales-desktop.png`, `accounting-desktop.png`, `restaurants-desktop.png`, `restaurants-900.png`, `sales-900.png`, `sales-400.png`, `sales-mobile-dashboard.png`, `restaurants-single-400.png`, `shortcut-locations.png`.

Closed only the temporary preview tab, reset Chrome device emulation, closed DevTools, stopped the temporary server, and restored the repository Angular dev server on `http://localhost:4200`.

## 20. Deviations and rationale

`/dashboard` is not protected by a new Accounting route guard: existing entitlement guards use it for safe recovery, and guarding it would cause loops and violate the Platform Core boundary in `SPEC.md`. The small Core entry component checks access before rendering the unchanged ERP page and redirects to explicit product routes when needed. It does not conditionally render Sales or Restaurants within the ERP dashboard.

Accounting switcher landing changes from its separate overview to the existing dashboard to make product landing and Dashboard navigation coherent. The overview remains available. Browser validation used local fixtures, not authenticated remote data, to respect the no-live-AWS constraint.

## 21. Known limitations

The Accounting ERP dashboard still has legacy static demonstration content and duplicate overview/dashboard navigation. Restaurant area/station counts remain bounded and outlet-scoped, with `+` for additional pages, not aggregate totals. Real authenticated refresh, remote ProductAccess revocation, complete keyboard-only navigation and browser back/forward across all three products were not exercised manually; route resolution, permission denial, context restoration and organization isolation are covered by automated tests. This is not RESTO-1 integrated validation.

## 22. Git status

No commit, deployment or unrelated cleanup was performed. The working tree was already dirty (47 status entries at reconnaissance); prior shell, onboarding, identity and backend changes are preserved. The status below includes earlier work and new task files, so it is not a task-only diff:

```text
 M cdk-outputs.dev.json
 M package-lock.json
 M packages/backend/package.json
 M packages/frontend/public/assets/i18n/en.json
 M packages/frontend/public/assets/i18n/fr.json
 M packages/frontend/scripts/restaurants-translations.test.mjs
 M packages/frontend/src/app/core/restaurants/restaurants.page.html
 M packages/frontend/src/app/core/restaurants/restaurants.page.spec.ts
 M packages/frontend/src/app/core/restaurants/restaurants.page.ts
 M packages/frontend/src/app/core/routing/app.routes.spec.ts
 M packages/frontend/src/app/core/routing/app.routes.ts
 M packages/frontend/src/app/core/state/ui.store.ts
 M packages/frontend/src/app/domains/identity/data-access/onboarding.api.ts
 M packages/frontend/src/app/domains/identity/data-access/workspaces.api.spec.ts
 M packages/frontend/src/app/domains/identity/data-access/workspaces.api.ts
 M packages/frontend/src/app/domains/identity/feature/onboarding/onboarding.page.html
 M packages/frontend/src/app/domains/identity/feature/onboarding/onboarding.page.spec.ts
 M packages/frontend/src/app/domains/identity/feature/onboarding/onboarding.page.ts
 M packages/frontend/src/app/domains/restaurants/feature/restaurants-workspace.page.html
 M packages/frontend/src/app/domains/restaurants/feature/restaurants-workspace.page.spec.ts
 M packages/frontend/src/app/domains/restaurants/feature/restaurants-workspace.page.ts
 M packages/frontend/src/app/shared/layout/app-context-breadcrumb/app-context-breadcrumb.component.html
 M packages/frontend/src/app/shared/layout/app-context-breadcrumb/app-context-breadcrumb.component.spec.ts
 M packages/frontend/src/app/shared/layout/app-context-breadcrumb/app-context-breadcrumb.component.ts
 M packages/frontend/src/app/shared/layout/app-shell/app-shell.component.spec.ts
 M packages/frontend/src/app/shared/layout/app-shell/app-shell.component.ts
 M packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.html
 M packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.spec.ts
 M packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.ts
 M packages/frontend/src/app/shared/layout/app-topbar/app-topbar.component.html
 M packages/frontend/src/app/shared/layout/app-topbar/app-topbar.component.spec.ts
 M packages/frontend/src/app/shared/layout/app-topbar/app-topbar.component.ts
 M packages/frontend/src/app/shared/ui/page-header/page-header.component.html
 M packages/frontend/src/app/shared/ui/sidebar-nav-item/sidebar-nav-item.component.html
 M packages/frontend/src/app/shared/ui/sidebar-nav-item/sidebar-nav-item.component.ts
 M packages/frontend/src/styles.css
?? docs/architecture/backend-dev-deployment-2026-10-10.md
?? docs/architecture/onb-products-c-frontend.md
?? docs/architecture/resto-ux-1-premium-shell.md
?? docs/architecture/resto-ux-1b-polish.md
?? docs/architecture/resto-ux-1c-sidebar-header.md
?? docs/architecture/resto-ux-1d-product-context.md
?? packages/backend/docs/user-identity-relink.md
?? packages/backend/scripts/identity/
?? packages/backend/scripts/relink-user-identity.ts
?? packages/backend/test/unit/identity/relink-user-identity.test.ts
?? packages/frontend/scripts/onboarding-products-translations.test.mjs
?? packages/frontend/scripts/product-dashboard-translations.test.mjs
?? packages/frontend/src/app/core/feature/dashboard/dashboard-entry.page.spec.ts
?? packages/frontend/src/app/core/feature/dashboard/dashboard-entry.page.ts
?? packages/frontend/src/app/core/navigation/
?? packages/frontend/src/app/core/restaurants/restaurants-availability.integration.spec.ts
?? packages/frontend/src/app/domains/identity/data-access/onboarding.api.spec.ts
?? packages/frontend/src/app/domains/sales/data-access/sales-dashboard-read.guard.ts
?? packages/frontend/src/app/domains/sales/feature/dashboard/
?? docs/architecture/product-dashboard-coherence.md
```

## 23. PRODUCT-DASHBOARD-COHERENCE status

**PASS**. Separate canonical dashboards, Sales routing/content coherence, guarded access, safe recovery, Restaurants terminology/shortcuts, regression tests, build, formatting and scoped browser inspection are complete. No business functionality or backend/domain persistence change was introduced. Fiscal Compliance remains suspended; no DGI/token work was performed.

## 24. RESTO-1D readiness

**YES — ready to resume the separate integrated-validation phase when requested.** This is UX/routing readiness, not a claim that RESTO-1D integration has passed. STOP here: RESTO-1D and RESTO-2 were not started; no deployment or commit.
