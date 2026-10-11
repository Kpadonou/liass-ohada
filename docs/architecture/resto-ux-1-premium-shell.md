# RESTO-UX-1 — Premium Product Shell & Navigation

Date: 2026-10-10 (Africa/Porto-Novo).

## 1. Starting UX problems

The global sidebar stacked Accounting modules, SALES modules and a single Liass-Resto entry. The restaurant product repeated navigation in the content area: Overview / Setup / Menu, followed by five local setup tabs. Setup sections were not independently addressable; the shell used one active page and breadcrumb for all restaurant sections. The product header repeated platform/product identity before the task itself. Primary create actions appeared below context selectors rather than consistently in the page header.

## 2. Existing navigation architecture and ownership

Classification: **PLATFORM_CORE**, owned by platform shell/navigation. Restaurant workflows remain in the existing `domains/restaurants` frontend domain.

The existing AppShell composes AppTopbar, AppSidebar, AppBackdrop, the context breadcrumb and a router outlet. AppShell synchronizes UiStore.currentPage from initial URLs and NavigationEnd. UiStore owns sidebar collapse/open state and persists desktop collapse locally. ProductAccessState derives entitlement availability for the effective organization. SALES uses SalesCapabilities; RESTAURANTS uses RestaurantsCapabilities, based on the existing independent product role projection.

There was no dedicated top-level product switcher: switching products used the peer sidebar entries. Those entries are consolidated into one Material menu within the same sidebar. The existing workspace identity/navigation and cabinet navigation remain in place. No second shell, authentication system or mobile navigation was introduced.

Architecture checklist:

- Tenant identity and effective-organization selection are unchanged.
- Entitlement remains ProductAccess, independent of workspace type and action RBAC.
- Shell owns product selection/navigation; restaurant pages own workflow presentation.
- No cross-domain persistence/service imports or writes were introduced.
- Existing query reads, writes, pagination, tenant keys and invalidation remain unchanged. There is no DynamoDB access-pattern or migration change.
- No new cross-domain API/event/contract.
- Existing identity, membership, product and action authorization remain authoritative.
- No backend security, audit, logging, retry or idempotency change.
- Existing URLs, APIs, cabinet behavior and AWS resources remain compatible. New setup URLs are additive.

## 3. Contextual-sidebar design

The product menu offers Accounting, SALES and Liass-Resto according to existing discovery/access rules. Accounting remains discoverable and disabled when explicitly unavailable; SALES retains its availability/read-capability gate; Liass-Resto discovery retains its AVAILABLE entitlement gate independently of action permission.

Accounting context displays its existing Accounting modules and secondary Accounting surfaces. SALES context displays Customers, Items & services and Invoices. RESTAURANTS context displays only implemented restaurant read surfaces, grouped as Overview, Configuration and Menu. The global dashboard link remains available. The Accounting AI panel stays within Accounting context.

The Liass-Resto menu trigger supplies restrained product identity. Setup items require existing RESTAURANTS_READ; Menu requires existing RESTAURANTS_MENU_READ. No future or disabled restaurant module entries were added.

## 4. Route mapping

| Sidebar/task             | URL                            | Page mode / section |
| ------------------------ | ------------------------------ | ------------------- |
| Overview                 | `/restaurants`                 | overview            |
| Restaurant configuration | `/restaurants/setup`           | setup / restaurant  |
| Locations                | `/restaurants/setup/locations` | setup / outlet      |
| Dining areas             | `/restaurants/setup/areas`     | setup / area        |
| Tables                   | `/restaurants/setup/tables`    | setup / table       |
| Kitchen & bar stations   | `/restaurants/setup/stations`  | setup / station     |
| Menu                     | `/restaurants/menu`            | menu                |

The previous three URLs remain valid. Configuration routes are independent route configurations loading the existing workspace component with section metadata. Direct URLs initialize the corresponding section. Browser history uses Angular Router rather than local setup-tab state. Changing organizations clears tenant selections while retaining the task addressed by the current URL.

ShellRouteContext observes initial URLs and NavigationEnd, normalizing query strings, fragments and trailing slashes. Restaurant sidebar active state matches the exact stable route. Breadcrumbs use organization context, Liass-Resto and the current task; no extra Configuration segment.

Items remain within the existing Menu/category workflow; no separate item route is needed for its current parent-context model.

## 5. Pages redesigned

All seven task pages use the existing block-level page-header component with a translated title and short task description. Primary edit/add actions are in the header when permitted and when existing parent prerequisites are satisfied.

- Overview retains restaurant configuration summaries and useful setup/menu shortcuts, without navigation tab rows.
- Restaurant uses a narrower detail panel containing name, translated status and translated GuestOrderingPolicy, with Edit in the page header.
- Locations retains the CRUD card collection with a prominent Add location action.
- Dining areas retains the searchable parent-location selector, contextual loading/errors and existing dialogs.
- Tables retains location/area selection, table code, name, capacity, area, translated status and management-only QR action. No internal identifiers or service/session behavior were added.
- Kitchen & bar has a specific stations title and preparation-configuration description; existing create/edit/deactivate behavior remains.
- Menu retains the meaningful category/item two-pane management surface, menu editing, availability/reorder configuration and existing pagination. Categories are object context, not another product navigation row.

Collection empty states gain calm spacing and a restrained icon. Cards, skeletons, status chips, searchable selects, confirmation/editor/QR dialogs and notification behavior are reused.

## 6. Product identity and design references

Liass-Resto is identified by the sidebar product trigger and breadcrumb. The repeated Liass-OHADA / Liass-Resto / generic product subtitle stack was removed from content. Page headers omit empty eyebrows without affecting other headers.

Consulted `SPEC.md`, `AGENTS.md`, both invoked skills and the design-system references: UI principles, design tokens, component guidelines, interaction patterns and page templates. Inspected existing styles, Material theme, logo component/assets and adjacent shell/page patterns. Existing brand colors, rounded-control/card tokens and active-navigation styling are retained.

Shared components reused: `liass-sidebar-nav-item`, `liass-page-header`, `liass-card`, `liass-status-chip`, `liass-skeleton`, `liass-searchable-select` and existing confirmation dialog. Material buttons, icons, menus and the existing dialogs continue to provide controls and focus behavior.

The shared settings-width token is 72rem (1152px). Configuration/menu content is restrained to that width; the Restaurant panel uses the existing narrower `max-w-3xl` utility. No decorative gradients, new color palette or additional shell were introduced.

## 7. Responsive behavior

Existing persistent desktop sidebar, collapsed icon rail, mobile translated drawer, backdrop and toggle remain. Compact labels stay visually hidden only at desktop breakpoints, so the mobile drawer retains labels even when desktop collapse was persisted. Selecting a restaurant item closes the mobile drawer through the existing UiStore method. The product selector is available in expanded and collapsed layouts. Content grids/selectors retain existing responsive breakpoints and wrapping behavior.

Automated tests verify desktop collapse classes, accessible labels, drawer-open state and closing after selection. Actual viewport rendering/overflow has not been visually accepted; see section 14.

## 8. Accessibility

Active sidebar items now expose `aria-current="page"`, in addition to the existing brand-selected treatment. Existing translated accessible labels, compact-item tooltips and focus rings remain. Product selection uses MatMenu and its keyboard/focus handling. Breadcrumbs expose the current page. Existing loading announcements, contextual alerts, status text, Material dialogs and labelled action menus remain. Color is not the only status or selection indicator.

## 9. Permission behavior

Product discovery remains separate from action permission. A user with ACTIVE RESTAURANTS access and no product read role still discovers Liass-Resto, but sees no restaurant module entries and the existing permission recovery surface. WAITER/CASHIER/KITCHEN retain read setup/menu surfaces. OWNER/MANAGER retain existing management actions. Edit, create, deactivation, availability and QR management still use the existing capability checks and parent prerequisites.

ProductAccess loss removes the restaurant navigation/content as before. Existing AVAILABLE/UNKNOWN/UNAVAILABLE behavior and organization-scoped availability tests pass. Frontend visibility is not security; no backend authorization changes were made.

## 10. Accounting / SALES regression behavior

Existing Accounting routes, module labels, disabled entitlement treatment, cabinet/dossier navigation and cabinet permission behavior pass regression tests. SALES retains its existing routes and SALES_READ projection independently of Accounting availability. The intentional UX change is that product modules no longer render simultaneously: users switch through the consolidated product menu.

## 11. Files changed by RESTO-UX-1

Under `packages/frontend/`:

- `src/app/core/navigation/product-navigation.ts` (new route metadata and URL observation).
- `src/app/core/routing/app.routes.ts` and `.spec.ts`.
- `src/app/core/restaurants/restaurants.page.ts`, `.html`, `.spec.ts`.
- `src/app/domains/restaurants/feature/restaurants-workspace.page.ts`, `.html`, `.spec.ts`.
- `src/app/shared/layout/app-sidebar/app-sidebar.component.ts`, `.html`, `.spec.ts`.
- `src/app/shared/layout/app-context-breadcrumb/app-context-breadcrumb.component.ts`, `.html`, `.spec.ts`.
- `src/app/shared/ui/page-header/page-header.component.html`.
- `src/app/shared/ui/sidebar-nav-item/sidebar-nav-item.component.html`.
- `src/styles.css`.
- `public/assets/i18n/en.json`, `fr.json`.
- `scripts/restaurants-translations.test.mjs`.

Report: `docs/architecture/resto-ux-1-premium-shell.md`.

Existing uncommitted ONB-PRODUCTS, identity and deployment work was preserved, including prior changes in the restaurant workspace and translation files. Backend changes shown by git status predate this task.

## 12. Tests added / updated

- Sidebar: contextual product isolation, shared product menu, entitlement gates, missing restaurant read permissions, staff read navigation, exact active state, direct URL normalization, real Router selection and Location back/forward events, collapsed rail and mobile drawer closing.
- Workspace: direct initialization of each setup section, no local navigation tabs, per-task page header, task preservation across organization changes; existing CRUD/menu/QR/read-only/parent-context tests continue to pass.
- Product wrapper: router outlet without duplicate horizontal navigation or product header, access loading/loss.
- Routes: all seven implemented URLs retain RESTAURANTS ProductAccess guards.
- Breadcrumb: organization > Liass-Resto > Tables, with no redundant Configuration segment.
- Script contract: matching, nonempty French/English task descriptions, titles, actions and product-menu label.

## 13. Validation results

| Check                                                       | Result                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| Targeted restaurant/sidebar/breadcrumb/routes Angular tests | PASS — 9 files, 125 tests                                      |
| Full Angular tests                                          | PASS — 120 files, 934 tests                                    |
| Frontend script contracts                                   | PASS — 16 tests                                                |
| Root npm test (backend + frontend)                          | PASS — backend 153 suites / 1236 tests, frontend results above |
| Shared build                                                | PASS                                                           |
| Backend TypeScript build                                    | PASS                                                           |
| Frontend development build                                  | PASS                                                           |
| Prettier on task files/report                               | PASS                                                           |
| git diff --check                                            | PASS                                                           |
| Deployment                                                  | Not performed                                                  |
| Live AWS calls for validation                               | Not performed                                                  |

The development build reports the existing shared SALES sideEffects/bare-import warning; it succeeds. No CDK changes were made; synth/resource-count/diff are outside this frontend-only phase.

## 14. Manual / browser inspection

Attempted the local application at `http://localhost:4200/restaurants` using the Codex browser. After a background attachment failure, a visible retry succeeded and the application redirected to `/login`. The browser had no authenticated session. No credentials were entered and no authenticated AWS requests were initiated for inspection. The temporary inspection tab was closed.

Consequently, Overview, Restaurant, Locations, Dining Areas, Tables, Kitchen & Bar and Menu were **not visually inspected** at desktop/tablet widths. No screenshot-based visual regression, rendered contrast review or actual narrow-viewport overflow validation is claimed. Automated DOM/routing/responsive-state checks are reported separately above.

## 15. Deviations

No dedicated product switcher existed, so the existing peer product navigation was consolidated into one sidebar Material menu. Workspace switching was not replaced. New additive setup URLs were necessary because those sections previously existed only as local tabs. Categories/items remain together in Menu, where category selection supplies necessary object context.

Browser acceptance is deferred because the available local browser session requires authentication. No additional business feature, backend change, entitlement/RBAC change or future navigation entry was introduced.

## 16. Known limitations

Desktop/tablet visual and keyboard acceptance of authenticated pages remains outstanding. Outlet/area/category selections retain the current local-state behavior and are not encoded in URLs; sections themselves are deep-linkable. Dashboard keeps its existing Accounting-focused default navigation rather than acquiring a new product-neutral design. Existing backend/runtime behavior and future RESTO phases remain outside this task.

## 17. Git status

Working tree remains dirty; no commit was created. Task modifications are limited to the frontend and this report. Pre-existing changes include `cdk-outputs.dev.json`, `package-lock.json`, `packages/backend/package.json`, identity/onboarding/workspace files, ONB-PRODUCTS translations/tests, identity-relink scripts/tests/docs and the earlier backend deployment report. These were not reverted or included in a task commit.

Full status at report completion:

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
 M packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.html
 M packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.spec.ts
 M packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.ts
 M packages/frontend/src/app/shared/ui/page-header/page-header.component.html
 M packages/frontend/src/app/shared/ui/sidebar-nav-item/sidebar-nav-item.component.html
 M packages/frontend/src/styles.css
?? docs/architecture/backend-dev-deployment-2026-10-10.md
?? docs/architecture/onb-products-c-frontend.md
?? packages/backend/docs/user-identity-relink.md
?? packages/backend/scripts/identity/
?? packages/backend/scripts/relink-user-identity.ts
?? packages/backend/test/unit/identity/relink-user-identity.test.ts
?? packages/frontend/scripts/onboarding-products-translations.test.mjs
?? packages/frontend/src/app/core/navigation/
?? packages/frontend/src/app/core/restaurants/restaurants-availability.integration.spec.ts
?? packages/frontend/src/app/domains/identity/data-access/onboarding.api.spec.ts
?? docs/architecture/resto-ux-1-premium-shell.md
```

## 18. RESTO-UX-1 status

**PASS** — frontend implementation and automated validation. Authenticated desktop/tablet visual acceptance remains explicitly outstanding and is not included in this PASS.

## 19. RESTO-1D readiness

**NO** — perform authenticated browser acceptance before using this UX phase as a readiness gate. RESTO-1D and RESTO-2 were not started. No deployment or commit was performed.
