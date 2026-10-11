# RESTO-UX-1D — Product context in the top bar

Date: 2026-10-11 (Africa/Porto-Novo).

## Starting problem and previous responsibilities

The sidebar combined a prominent active-product panel with a highlighted dashboard row. Workspace identity was in `AppTopbar`, while product identity, switching, and module navigation were in `AppSidebar`. Product context came from `UiStore.currentPage`, synchronized by the existing `AppShell` route handling. The company workspace display had a chevron but no switching action; cabinet workspaces had an existing context menu.

## Architecture and responsibility split

Classification: **PLATFORM_CORE**, owned by shell/navigation under `core/navigation` and the existing layout components.

The top bar owns workspace and product context. The sidebar owns contextual navigation. No second shell, ProductAccess mechanism, product state store, business route, or domain contract was added. Organization identity, membership, ProductAccess, and domain action permissions retain their separate responsibilities. All data queries use existing organization-scoped query helpers; no persistence reads/writes, backend changes, cross-domain API changes, audit changes, or AWS resource changes are introduced.

The small `ShellProductNavigation` model centralizes the three current product icons, translated labels, landing routes, active context, and available choices. It reuses `ProductAccessState` and the existing Sales read capability. RESTAURANTS product discovery stays separate from its permission-driven module/action visibility.

## Top-bar design and switching

Compact Material buttons present the workspace's organization icon and the product's canonical icon/name, separated by a subtle vertical divider. There is no “Produit actif” eyebrow or product card. Existing commercial labels remain Comptabilité/Accounting, Ventes/Sales, and Liass-Resto. The future Liass-Facturation branding is not introduced.

| Product     | Existing canonical landing route |
| ----------- | -------------------------------- |
| ACCOUNTING  | `/accounting`                    |
| SALES       | `/sales/customers`               |
| RESTAURANTS | `/restaurants`                   |

Product selection preserves the organization and delegates authorization to existing route/domain checks. The menu lists verified AVAILABLE products, with the existing Sales read restriction. Unknown access is not treated as available. With one product, identity remains a keyboard-accessible button that opens its landing page, without a dropdown or chevron. This also permits entering that product from the platform dashboard.

Workspace selection uses the existing `AuthStore.setTenant` method and its tenant-query cleanup, followed by the established `/dashboard` or `/cabinet/dashboard` destination. Only direct workspace memberships are offered; cabinet-linked dossiers retain their existing context mechanism. The cabinet menu retains its previous actions and gains workspace choices when alternatives exist. Pending-change confirmation remains respected when changing tenants.

The existing ProductAccess query key includes the effective organization. Choices disappear while a new organization's access is unknown, rather than carrying the previous organization's products forward. A real-query regression tests late writes to the previous organization's cache. A known loss of access to the routed product returns to `/dashboard`, matching the existing ProductAccess guard's destination; tenant switching is allowed to finish before this recovery check applies.

## Sidebar simplification and selected state

Removed the product selector from the sidebar for all three products. Liass-Resto begins directly with Tableau de bord, then Configuration and Carte/Menu. It has no Platform group, global dashboard link, active-product block, or Liass-Resto heading. Its existing seven links and permission filters remain.

A reusable `restrained` option on `liass-sidebar-nav-item` gives restaurant rows a lighter selected background with strong brand text, without selected-row shadow/ring or icon tile. Existing row height, focus treatment, and `aria-current="page"` remain. Accounting/Sales keep their previous row treatment.

Top bar and sidebar share product context on platform destinations as well as business routes, preventing a Sales-only workspace from showing Accounting modules next to Sales identity.

## Dashboard title and breadcrumbs

The RESTAURANTS overview route remains `/restaurants`. Its navigation, page-title, and legacy overview translation keys now consistently say **Tableau de bord / Dashboard**. Breadcrumbs already derive the restaurant task title from the same translation key and consequently render `BETA > Liass-Resto > Tableau de bord`. Configuration group names are not inserted. Unrelated Accounting overview terminology remains unchanged.

## Responsive and accessibility behavior

Desktop retains a single top-bar row. Below 640 px, the context selectors occupy a second row; the shared header-spacing variable becomes 6.5rem so the sidebar, overlay, and content stay aligned. The compact logo is used below the desktop-wide breakpoint to protect context/control space. Workspace/product buttons have bounded widths, ellipsis, full-name tooltips, and accessible labels.

Material Menu provides keyboard navigation, popup semantics, focus restoration, and expanded state. The current menu choice is marked programmatically. Product and chevron icons are decorative. Section headings remain noninteractive. The existing hamburger, mobile drawer, desktop collapse, and close-on-selection behavior remain in use.

Design references consulted: `liass-ui-principles`, `liass-design-tokens`, `liass-component-guidelines`, and `liass-interaction-patterns`, alongside current theme/logo assets. Existing brand tokens and Material Button/Menu/Icon/Tooltip are reused, together with `liass-logo`, `liass-dropdown`, and `liass-sidebar-nav-item`.

## Accounting/Sales compatibility and remaining legacy behavior

Accounting and Sales landing routes, modules, cabinet/dossier context, fiscal-year selector, availability checks, and management permissions remain intact. Their sidebar product selectors are removed because switching now lives in the top bar. Regression tests cover both products and Sales-only platform context.

Accounting and Sales retain established sidebar group headings and their global dashboard entry; Accounting also retains its secondary and AI panel sections. This phase does not redesign those product interiors. Platform-only pages choose the first verified accessible product for shell context; there is no new persistent last-used-product preference.

## Files changed in this phase

- `packages/frontend/src/app/core/navigation/product-navigation.ts`
- `packages/frontend/src/app/core/navigation/product-navigation.spec.ts`
- `packages/frontend/src/app/shared/layout/app-topbar/app-topbar.component.{ts,html,spec.ts}`
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.{ts,html,spec.ts}`
- `packages/frontend/src/app/shared/layout/app-context-breadcrumb/app-context-breadcrumb.component.spec.ts`
- `packages/frontend/src/app/shared/ui/sidebar-nav-item/sidebar-nav-item.component.{ts,html}`
- `packages/frontend/src/app/domains/restaurants/feature/restaurants-workspace.page.spec.ts`
- `packages/frontend/src/styles.css`
- `packages/frontend/public/assets/i18n/{fr,en}.json`
- `packages/frontend/scripts/restaurants-translations.test.mjs`
- This report.

The breadcrumb implementation and AppShell routing need no code change.

## Tests and validation

Added/updated coverage includes active workspace/product labels and icon, menu contents, canonical product navigation, single-product behavior, workspace switching, access-loss recovery, real organization-scoped query isolation, Sales read visibility, Sales-only sidebar context, removal of sidebar context blocks, exact active/deep-link states, collapsed labels, dashboard breadcrumb, and French/English naming consistency. Existing restaurant permission, CRUD, empty-state, route history, Accounting, Sales, and cabinet tests remain included.

Commands run:

```sh
npm exec --workspace @liass-ohada/frontend -- ng test --watch=false --include='**/product-navigation.spec.ts' --include='**/app-topbar.component.spec.ts' --include='**/app-sidebar.component.spec.ts' --include='**/app-context-breadcrumb.component.spec.ts' --include='**/*restaurants*.spec.ts'
npm test -w @liass-ohada/frontend -- --watch=false
npm run build:development -w @liass-ohada/frontend
npx prettier --check <files changed in this phase>
git diff --check
```

Results: targeted tests **138 passed / 10 files**; full Angular suite **949 passed / 121 files**; frontend script contracts **19 passed**; development build **PASS**; scoped Prettier **PASS**; `git diff --check` **PASS**. The development build retains the pre-existing shared Sales ignored-bare-import warning.

## Browser inspection — separate from automated tests

Actual Chrome inspection used a temporary local Angular bootstrap with the real AppShell, top bar, sidebar, breadcrumb, restaurant pages, styles, and translation assets, plus entirely local synthetic authentication/API responses. This was **not** an authenticated integration test and made no live AWS requests. The temporary bootstrap was removed from the repository, its preview server stopped, and the normal frontend dev server restored on localhost:4200.

Observed:

- Desktop at approximately 1512 CSS px: Dashboard, Establishments, and Menu; workspace and product selectors align cleanly, restaurant labels fit, the active row is clear, and no sidebar product panel or horizontal sub-navigation appears.
- Multi-product preview: product menu lists Comptabilité, Ventes, and Liass-Resto.
- Workspace switch to a synthetic single-product workspace: top-bar availability updates to Liass-Resto only, its switch chevron disappears, and a long workspace name is truncated without displacing controls.
- 400 CSS px: contexts occupy a readable second row; product identity remains visible with the long workspace name. Drawer opens below the header, all restaurant entries remain accessible, and choosing Establishments closes it.
- 900 CSS px: contexts and controls fit on one line with the compact logo; the drawer remains the navigation mechanism below the existing desktop breakpoint. No visible horizontal overflow was observed at these widths.

A desktop screenshot is available locally at `/tmp/resto-ux-1d-evidence/desktop-locations.png`. Synthetic page fixtures validate presentation and local interactions, not production authentication, real entitlements, or backend workflows.

## Deviations and limitations

The company workspace display becomes a working selector using existing tenant-selection methods because its former chevron had no action. The mobile header uses a second context row instead of hiding product identity. Accounting/Sales interior groups remain legacy as described above. Single-product identity acts as a landing-page link rather than a menu with no alternatives.

No live integrated validation, deployment, or exhaustive assistive-technology/device testing was performed. No restaurant business capability was added. No backend/API, ProductAccess persistence, RBAC, onboarding, fiscal, or e-MECeF change was introduced.

## Git status and stopping point

The working tree already contained uncommitted earlier RESTO-UX/onboarding/identity/deployment changes. They remain preserved. This phase adds the product-navigation test and this report, and updates only the listed frontend files. No commit was created. The full end-of-pass status is saved locally in `/tmp/resto-ux-1d-status.txt`.

**RESTO-UX-1D status: PASS**.

**RESTO-1D readiness: YES** for proceeding to a separately authorized integrated-validation phase; that phase has not been started or certified here. RESTO-2 has not started. No deployment.
