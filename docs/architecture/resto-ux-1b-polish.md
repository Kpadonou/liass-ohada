# RESTO-UX-1B — Premium Navigation & Empty-State Polish

Date: 2026-10-10 (Africa/Porto-Novo).

## 1. Starting issues and ownership

The current RESTO-UX-1 architecture is preserved. A native Chrome inspection of the existing `/restaurants/setup/locations` page confirmed the baseline: the global dashboard was visually adjacent to restaurant modules without a platform label; Restaurant configuration was truncated; Overview and Menu grouping repeated their entries; Establishments appeared as both a page title and a collection heading; the empty card contained a single sentence with its Add action outside the card.

Classification: **PLATFORM_CORE**, owned by platform navigation/presentation. Routed restaurant content remains in `domains/restaurants`. This pass changes presentation and action placement only.

Architecture invariants: organization/tenant context, ProductAccess, independent restaurant permissions, authentication, guards, APIs, shared business contracts, queries, cache keys, pagination, mutation behavior, audit and AWS resources remain unchanged. No persistence access pattern, cross-domain contract, dependency, migration or infrastructure change was introduced. Existing routes and cabinet, ACCOUNTING and SALES behavior remain compatible.

## 2. Labels changed

Sidebar labels are now independent of descriptive task titles:

| Surface            | French                  | English              |
| ------------------ | ----------------------- | -------------------- |
| Platform label     | Plateforme              | Platform             |
| Restaurant entry   | Restaurant              | Restaurant           |
| Locations entry    | Établissements          | Locations            |
| Dining areas entry | Espaces de restauration | Dining areas         |
| Tables entry       | Tables                  | Tables               |
| Stations entry     | Postes de préparation   | Preparation stations |
| Menu section       | CARTE                   | MENU                 |
| Menu entry         | Menu                    | Menu                 |

Section casing is supplied through the existing uppercase typography convention. Restaurant's page title remains `Configuration du restaurant` / `Restaurant configuration`. PreparationStation's model and its page meaning are unchanged. Menu categories and items retain their current combined route.

## 3. Sidebar hierarchy

Within RESTAURANTS context, the static Platform label precedes the dashboard link. The existing product-switch menu remains distinct from module navigation. The first restaurant group is identified as Liass-Resto, followed by Overview; Configuration contains the five existing setup links; Carte/Menu contains the Menu entry.

Labels use existing section typography: small, semibold, uppercase with restrained tracking. Static section labels remain noninteractive. No horizontal sub-navigation was added. Product discovery, read-capability filtering, active state and switching routes retain the RESTO-UX-1 behavior. ACCOUNTING and SALES do not receive the restaurant-specific platform label or new module labels.

## 4. Empty-state changes

Empty outlet, area, table, station and item collections now use a compact, left-aligned detail surface inside the existing `liass-card`. Each has a translated title, explanation and, when existing permissions/parent prerequisites allow, a primary `liass-button` to open its existing creation dialog.

Locations uses the requested copy:

- French title: `Aucun établissement`.
- French description: `Ajoutez votre premier établissement pour commencer à configurer ses espaces, ses tables et ses postes de préparation.`
- French action: `Ajouter un établissement`.
- English title: `No locations yet`.
- English description: `Add your first location to start configuring its dining areas, tables, and preparation stations.`
- English action: `Add location`.

Equivalent translated copy is supplied for Dining Areas, Tables, Preparation Stations and Menu Items. The Menu category panel now has a title/description and primary Add category action when empty; the existing secondary Add category button remains only when categories exist. Missing-parent location/area guidance uses the same concise title/description/primary-action pattern, without introducing another operation.

Loading, errors, empty data and read-only presentation remain distinct. Empty CTAs are suppressed when management is not allowed and disabled while busy. Existing editor dialogs, confirmation behavior, pagination, availability/reorder controls and QR management remain unchanged.

## 5. Page-header and action changes

The shared page header is unchanged. Restaurant Edit remains in its header. Collection Add actions appear in the header for populated, successfully loaded collections. Empty collections instead own their CTA within the empty state. The same Add operation is never presented simultaneously in both places.

Removed the repeated collection heading from Locations and equivalent configuration collections. The page header now leads directly to loading, errors, empty state or records. Meaningful Menu category headings are retained because they identify the current item collection; they are covered by a regression assertion.

## 6. Content width and layout

Reused RESTO-UX-1's shared `--spacing-app-settings` token (72rem / 1152px), existing `max-w-3xl` utility for sparse empty/detail cards, existing card padding and brand/control tokens. No new per-page width values or layout utility was needed. Sidebar width remains 15rem expanded and 4rem collapsed; no global token was widened.

Shorter labels resolve the identified long Restaurant/Stations copy. Baseline desktop inspection showed that the longer Dining Areas label already fit the current sidebar. Actual final label fitting still requires rendered acceptance; no final screenshot-based claim is made.

## 7. Responsive and accessibility notes

The existing desktop/sidebar/drawer architecture and breakpoints are retained. Empty states stack the decorative icon above content on narrow widths and align it beside the text from the existing small breakpoint. Paragraphs wrap within bounded content; existing primary buttons retain their focus rings and native keyboard behavior.

Sidebar selections continue to expose `aria-current="page"`. Section labels are static paragraphs. Empty-state icons are wrapped with `aria-hidden="true"`; titles and descriptions carry the meaning. Existing Material menu/dialog focus handling and translated action labels remain. Collapse/mobile-close regression tests pass. Rendered tablet/mobile overflow and final keyboard/contrast acceptance were not manually verified.

Design references: the previously consulted Liass UI principles, design tokens, component guidelines, interaction patterns and page templates, together with `SPEC.md`, the two invoked skills, current Material theme and existing shared components. Shared primitives reused: `liass-card`, `liass-button`, `liass-page-header`, `liass-sidebar-nav-item`, status chips, skeletons and selectors. Existing Material icons, menus and dialogs remain; no new palette, gradients, shadow system or decorative animation was added.

## 8. Files changed in this pass

- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.ts`
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.html`
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.spec.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurants-workspace.page.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurants-workspace.page.html`
- `packages/frontend/src/app/domains/restaurants/feature/restaurants-workspace.page.spec.ts`
- `packages/frontend/public/assets/i18n/fr.json`
- `packages/frontend/public/assets/i18n/en.json`
- `packages/frontend/scripts/restaurants-translations.test.mjs`
- `docs/architecture/resto-ux-1b-polish.md`

Routes, breadcrumb components, shared UI implementations, styles/tokens, backend, shared contracts, ProductAccess, RBAC, onboarding and Fiscal Compliance/e-MECeF were not modified by this pass. Pre-existing work remains in the working tree.

## 9. Tests added / updated

- Sidebar hierarchy: Platform/dashboard separation, Liass-Resto group, Restaurant and Postes de préparation labels, Carte > Menu, nonduplicated descriptive title and compact labels.
- Empty outlet/area/table/station/item collections: exact translated title/description, absence of header Add, existing dialog opened by the empty CTA, permission-driven CTA suppression and absence of horizontal navigation.
- Locations: one page heading, no repeated collection heading, populated-state header Add, correct editor dialog.
- Menu: empty category CTA and retained selected-category heading.
- Errors: no collection empty state or header create action during a collection error.
- Script contract: exact FR/EN short labels and menu hierarchy, platform label and empty location title; existing translation parity/nonempty checks include new keys.
- Existing active route/history, setup/menu deep-linking, permissions, ProductAccess, breadcrumbs, desktop collapse/mobile closing and ACCOUNTING/SALES regression coverage continues to pass.

## 10. Validation results

| Check                            | Result                                            |
| -------------------------------- | ------------------------------------------------- |
| Targeted RESTO-UX Angular tests  | PASS — 9 files / 133 tests                        |
| Full Angular suite               | PASS — 120 files / 942 tests                      |
| Frontend script contracts        | PASS — 17 tests                                   |
| Frontend development build       | PASS                                              |
| Scoped Prettier                  | PASS                                              |
| git diff --check                 | PASS                                              |
| Local dev server                 | Restarted successfully on `http://localhost:4200` |
| Deployment / live AWS validation | Not performed                                     |

The development build retains the existing shared SALES bare-import/sideEffects warning and succeeds. No backend/domain/CDK validation was required for this presentation-only change.

## 11. Browser/manual observations

Inspected the user's already-open, authenticated Chrome page at `/restaurants/setup/locations`. Accessibility text and a desktop screenshot confirmed the starting issues in section 1 and the concise `BETA > Liass-Resto > Établissements` breadcrumb. This was baseline inspection, not final visual acceptance.

Temporarily set that tab to Offline before source updates to prevent live AWS requests during hot reload. The old watcher surfaced a shared declaration-resolution error; restarting this repository's frontend on port 4200 compiled successfully. With network access disabled, the page's reload could not complete. Final desktop/tablet screenshots of the changed interface were consequently not captured or accepted.

Restored Chrome's original No throttling setting and cleared the temporary filter after unloading the application to `about:blank`, preventing an online transition from triggering AWS requests. DevTools was closed. The original local route remains in that tab's history; the local server remains available. No credentials, business mutations or AWS operations were submitted.

## 12. Deviations

No architecture or business-scope deviation. Reused card/button primitives instead of adding an empty-state component: the existing card's dedicated empty mode does not project an action, while its normal surface supports the required contextual CTA cleanly. Final responsive browser acceptance is deferred because this pass explicitly prohibits live AWS calls.

## 13. Known limitations

Final visual fit, narrow-viewport overflow and keyboard/contrast acceptance require a separate authenticated or mocked browser pass. Automated responsive-state and DOM checks cannot establish screenshot-level visual quality. Menu's existing category/item relationship and local parent selections are preserved. No future restaurant module or operation was introduced.

## 14. Git status

No commit was created. This pass started with existing uncommitted RESTO-UX-1, ONB-PRODUCTS, identity and backend deployment/relink changes; they were preserved. The task-specific changes are listed in section 8. Full working-tree status at report creation:

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
?? docs/architecture/resto-ux-1-premium-shell.md
?? packages/backend/docs/user-identity-relink.md
?? packages/backend/scripts/identity/
?? packages/backend/scripts/relink-user-identity.ts
?? packages/backend/test/unit/identity/relink-user-identity.test.ts
?? packages/frontend/scripts/onboarding-products-translations.test.mjs
?? packages/frontend/src/app/core/navigation/
?? packages/frontend/src/app/core/restaurants/restaurants-availability.integration.spec.ts
?? packages/frontend/src/app/domains/identity/data-access/onboarding.api.spec.ts
?? docs/architecture/resto-ux-1b-polish.md
```

## 15. RESTO-UX-1B status

**PASS** — implementation, frontend tests, contracts, build and formatting checks. Final rendered desktop/tablet acceptance remains outstanding and is excluded from this PASS.

## 16. RESTO-1D readiness

**NO** — complete final visual acceptance before advancing the UX readiness gate. RESTO-1D and RESTO-2 were not started. No deployment or commit was performed.
