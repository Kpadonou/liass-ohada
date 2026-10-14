# RESTO-UX-2A — Information architecture and configuration UX

Date: 2026-10-13. Starting branch: `main`. Starting HEAD: `cdf5e66` (`fix(ui): restore Material theme and form consistency`). Working tree was clean at reconnaissance.

## 1. Starting UX assessment

The restored global visual baseline is approved. The task explicitly authorizes restaurant information architecture and composition changes, while preserving Material controls and tokens. The current product has functional configuration surfaces and a product-aware shell. Its main weakness is losing parent context between otherwise useful CRUD screens.

Reconnaissance covered AGENTS, the canonical Liass design and platform architecture skills and design references, SPEC, the restored Material theme/default providers, shell/sidebar/product navigation, restaurant routes, workspace page, editor/QR dialogs, query helpers, capabilities, existing tests and RESTO-0/RESTO-1 reports. Classification remains a RESTAURANTS-owned vertical solution; this change is frontend composition and navigation only.

## 2. Current information architecture

Workspace and product are selected in the top bar. The contextual restaurant sidebar formerly placed Restaurant, Establishments, Dining Areas, Tables and Preparation Stations under Configuration, with Menu in a separate Carte group. Seven stable direct destinations use the existing workspace page and route metadata.

The domain hierarchy is Restaurant → Establishment → Dining Area → Table, Establishment → Preparation Stations, and Establishment → Menu → Category → Item. Entities, API ownership and queries remain distinct.

## 3. Problems identified

- Independent destinations made users reconstruct parent relationships and reselect context.
- Context selectors occupied a full card despite being page context rather than business forms.
- Table cards gave QR configuration similar prominence to identity, capacity and area.
- Area and station dashboard counts had no visible outlet scope.
- Menu and preparation page titles differed from canonical sidebar terminology.

The question was whether separate screens are useful or merely inherited. Direct task screens remain useful for managers and tablet shortcuts. The missing piece is contextual movement between them, rather than a large establishment administration dashboard.

## 4. Target long-term Liass-Resto IA

Dashboard remains a product landing page. When their own phases exist, operational navigation can introduce Service/Dining Room and Orders, Preparation, Checkout, and Management (Inventory/Reporting). Configuration owns restaurant identity, establishments and their spaces/tables/stations, menu and any future team configuration.

Role-specific operational landing pages remain future product work. This task neither defines new role semantics nor exposes unimplemented destinations.

## 5. Routes exposed now versus future concepts

| Current function     | Stable route                   | Optional context                           |
| -------------------- | ------------------------------ | ------------------------------------------ |
| Dashboard            | `/restaurants`                 | Existing selected outlet for summary links |
| Restaurant           | `/restaurants/setup`           | Root object                                |
| Establishments       | `/restaurants/setup/locations` | All loaded establishments                  |
| Dining areas         | `/restaurants/setup/areas`     | `outlet`                                   |
| Tables               | `/restaurants/setup/tables`    | `outlet`, `area`                           |
| Preparation stations | `/restaurants/setup/stations`  | `outlet`                                   |
| Menu                 | `/restaurants/menu`            | `outlet`                                   |

Service Floor, TableSession, Orders, kitchen execution, checkout/payments, inventory, reporting and Guest Web have no new navigation or UI. `/dashboard` remains Accounting and `/sales` remains Sales.

## 6. Changes implemented

Added contextual links and URL-based parent selection, compacted context controls, clarified table hierarchy and aligned titles. Existing dialogs, mutations, pagination, query helpers, validation, ProductAccess and capabilities are reused.

## 7. Navigation changes

Sidebar now consists of Dashboard and one Configuration group containing the six implemented configuration destinations, including Menu. No horizontal product tabs or future placeholders were added.

Establishment cards link to their areas, tables, stations and menu. Area cards link to their tables. Sidebar movement between child screens carries the current URL's outlet, with area carried only to Tables. Dashboard/root links remain direct destinations. Exact active route styling and top-bar selectors are unchanged.

Selectors write `outlet`/`area` into browser history. Query parameters restore parent selection on direct navigation, refresh and history changes. Parent references must exist in the current organization's loaded collections before child queries can run. Unknown or not-yet-loaded references show a message and a reset action instead of being silently treated as another establishment.

## 8. Restaurant page changes

Preserved the root identity, active status, guest-ordering policy and permission-driven Edit action. Added a secondary “View locations” link to make the root → establishment relationship explicit. No outlet details or fields were duplicated.

## 9. Establishments changes

The restaurant name provides root context. Each existing establishment card has a compact configuration navigation row. These are links to existing capabilities, available during read-only consultation; management menus retain their existing restrictions. Existing empty-state/header action behavior is preserved.

No per-establishment aggregate counts were added: obtaining every child's count would require extra bounded queries and potentially incomplete totals. The micro-lot avoids fan-out requests and misleading completeness metrics.

## 10. Dining Areas changes

The selected establishment appears in a compact Material context selector and on each area card. “View tables” carries both parent identifiers to the existing Tables route. CRUD, deactivation and pagination are preserved.

## 11. Tables changes

Cards prioritize code, optional name, dining area and capacity. Active/inactive status remains a labelled badge; QR readiness is a quiet secondary detail. Missing capacity is explicitly described instead of being rendered as a false count. Icons are decorative.

Establishment and area selectors share a wrapping row on larger screens and stack on narrow screens. The former full-width filter card was removed. These remain semantic shared Material selects, with their existing loading and reference handling. The French area label is now “Espace de restauration”. No table session or service status was introduced.

## 12. Preparation Stations changes

The page title now matches “Postes de préparation” / “Preparation stations”. The selected establishment remains visible and survives contextual navigation. This page still configures stations only; create/edit/deactivate behavior and its existing dialog are unchanged.

## 13. Menu changes

Menu belongs to Configuration in the sidebar. The French page title is now “Menu”, matching the sidebar and breadcrumb. The establishment context is compact and linkable. Existing category selection, item list, preparation station references, availability and future guest-reorder eligibility presentation remain unchanged. No new menu functionality or category route was added.

## 14. Dashboard changes

Preserved existing content and bounded configuration counts. Area and preparation station summaries now name the selected establishment and link to that same context. Existing `+` indicators for paginated partial counts remain. No operational metrics, speculative charts or new queries were introduced.

## 15. Responsive/tablet behavior

Reused existing shell breakpoints and drawer behavior. Context selectors wrap at the existing `sm` breakpoint; cards retain the current responsive grid. Shared settings max-width is unchanged. Native Material links/buttons remain usable without hover.

Browser observations below cover desktop 1440×1000, tablet 900×1000 and narrow 390×844. The mobile shell retains workspace/product selection in its second top-bar row. No separate mobile navigation architecture was added.

## 16. Accessibility

Context controls retain labelled Material combobox semantics. Contextual navigation uses real RouterLink anchors and existing Material button focus behavior. Establishment navigation has a translated accessible name containing the establishment name. Decorative icons use `aria-hidden`. Sidebar route-current semantics are preserved. No gesture-only interaction was introduced.

This is not a full screen-reader audit; semantic and permission behavior are covered by component tests and browser accessibility observations.

## 17. Design-system compliance

No central theme, token, radius, typography, button, form, dialog or overlay changes. Navy primary actions, outline fields and approved shared cards are retained. Tailwind changes concern layout, spacing and composition only. Editor forms remain typed Reactive Forms with the existing semantic Material controls. AGENTS and the canonical Design Skill were consulted and left unchanged; their preserve-first guidance remains authoritative.

## 18. Explicit deviations from previous UI

- Menu moved from its own sidebar group into Configuration.
- Full filter cards became compact context regions.
- Establishment and area cards gained related-destination links.
- Parent selection became URL-addressable.
- Table details were reordered, without altering their data.
- Root configuration gained a child navigation link; dashboard summary links gained outlet scope.

## 19. Why deviations improve restaurant workflow

Configuration grouping leaves space for future operations without displaying dead entries. Contextual links let a manager follow the establishment's physical hierarchy rather than reselecting parents on every page. URL context makes refresh/back/forward meaningful. Compact selectors expose more tables on a tablet. Table identity and capacity are easier to scan, while QR remains available as a configuration concern. Explicit dashboard scope prevents a selected establishment's partial count from appearing to describe the whole restaurant.

## 20. Files changed

- `packages/frontend/src/app/domains/restaurants/feature/restaurants-workspace.page.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurants-workspace.page.html`
- `packages/frontend/src/app/domains/restaurants/feature/restaurants-workspace.page.spec.ts`
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.ts`
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.spec.ts`
- `packages/frontend/public/assets/i18n/fr.json`
- `packages/frontend/public/assets/i18n/en.json`
- This report.

## 21. Tests and exact results

Five new tests cover parent deep links/history changes, unavailable foreign context without child queries, read-only establishment shortcuts, area → table links without aggregate requests, and sidebar context transfer. Existing tests now distinguish legitimate card navigation from forbidden horizontal tab lists. Root read-only coverage also checks its establishment link. Existing Accounting/Sales sidebar, route, product switcher and permission tests remain green in the full suite.

Commands executed from the repository with Node 22.22.3 on PATH:

| Command                                                                                                                                                                                                            | Exact final result                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `npm exec --workspace @liass-ohada/frontend -- ng test --watch=false --include='**/restaurants*.spec.ts' --include='**/restaurant*.spec.ts' --include='**/app-sidebar*.spec.ts' --include='**/app.routes.spec.ts'` | 12 files passed, 191 tests passed    |
| `npm exec --workspace @liass-ohada/frontend -- ng test --watch=false`                                                                                                                                              | 125 files passed, 988 tests passed   |
| `npm run test:frontend-contracts -w @liass-ohada/frontend`                                                                                                                                                         | 21 passed, 0 failed                  |
| `npm run build:development -w @liass-ohada/frontend`                                                                                                                                                               | Exit 0, development bundle generated |
| Scoped `npx prettier --write` and final `--check` on the eight files above                                                                                                                                         | Formatting passes                    |
| `git diff --check`                                                                                                                                                                                                 | Exit 0, no whitespace errors         |

The build retains the existing shared-package `ignored-bare-import` / `sideEffects: false` warning. No backend test run was needed; no backend files changed. Logs are in `/tmp/resto-ux-2a-{targeted,full,contracts,build,format}.log`.

## 22. Browser/manual inspection results

Performed through Codex browser tooling with the actual AppShell and RestaurantsWorkspacePage, using an isolated local preview and deterministic API/capability fixtures. Preview served at `localhost:4200`; there were no live AWS calls. It is not an authenticated production-tenant or end-to-end authorization validation.

All seven restaurant pages were visually inspected at 1440, 900 and 390 px. Observed navy actions, approved cards/outline controls, coherent page titles and contextual navigation. At desktop, sidebar and breadcrumbs identify the active restaurant screen. At tablet, the existing drawer opened and selecting Tables closed it. At mobile, cards stack, selectors fill available width, actions wrap and workspace/product identity remains discoverable. After shell layout settled, all seven narrow pages had headings below the header and document width equal to viewport width.

Followed Establishment → Areas → Tables, then sidebar Stations → Menu with outlet preserved. Root → Establishments works. Reload on contextual Tables and browser back/forward retained coherent content. Opened the Material area select on mobile and observed the themed option panel. Inspected empty Establishments with one in-content CTA and read-only Establishments with child links but no management action. Dialogs were not changed; no dialog visual change is claimed. Real multi-establishment data and all read-only role permutations were not manually exercised.

Evidence screenshots: `/tmp/resto-ux-2a-evidence/` (desktop examples and all seven tablet/mobile screens). Temporary bootstrap/source was removed. Temporary preview server and browser tab were closed, viewport override reset, and the normal Angular dev server restarted on port 4200.

## 23. Known limitations

Parent references resolve only among loaded paginated results. A target beyond the first loaded page can require “load more” or choosing/resetting context; this avoids unbounded requests and silently wrong parents. Categories retain existing local selection behavior. Dashboard remains configuration-oriented until operational data exists. Child configuration counts/completeness are deferred rather than estimated. Tablet validation used emulation, not physical touch hardware; no fresh dark-mode visual audit was performed because the central theme is untouched.

## 24. Backend/domain changes

**NONE.** No API, persistence, KeyFactory, entity, ProductAccess, RBAC, TableSession, Order/OrderItem, GuestSession, fiscal or transactional changes. All existing backend authorization remains authoritative.

## 25. Git status

Branch `main`, HEAD `cdf5e66` retained. Seven frontend files modified and this report untracked at completion; no other task files. No commit, deployment or repository reset performed.

## 26. RESTO-UX-2A status

**PASS** — scoped implementation, frontend validation and local browser review completed. User visual approval remains the next checkpoint.

## 27. Visual-review readiness

**YES.** Normal application is available on `http://localhost:4200`. Stop here for user review. Service Floor, TableSessions, Orders, RESTO-UX-2B and subsequent transactional phases were not started.
