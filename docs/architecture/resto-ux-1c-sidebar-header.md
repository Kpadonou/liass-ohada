# RESTO-UX-1C — Sidebar header polish

Status: PASS for implementation and automated validation. Browser visual inspection was not performed in this pass.

## Scope and architecture

Frontend-only PLATFORM_CORE shell presentation change. The existing Platform V2 sidebar and product menu remain the navigation owners. ProductAccess discovery, RESTAURANTS capability checks, tenant context, routes, API contracts, and domain behavior are unchanged. No backend, infrastructure, persistence, onboarding, or business feature was modified by this pass.

## Starting issue and resulting hierarchy

The RESTAURANTS sidebar repeated platform and product identity through a Platform heading, global dashboard entry, product selector, Liass-Resto heading, and overview entry.

The sidebar now starts with a translated “Produit actif” / “Active product” label and the existing product selector. The selector receives restrained brand colors, a token-based rounded panel, a border ring, and stronger type, with matching dark-mode colors. The product dashboard follows directly, without an extra Liass-Resto group heading.

```text
Produit actif
[Liass-Resto selector]
Tableau de bord
CONFIGURATION
  Restaurant
  Établissements
  Espaces de restauration
  Tables
  Postes de préparation
CARTE
  Menu
```

The product dashboard label is translated separately from page titles and breadcrumbs. It still navigates to `/restaurants`; all setup/menu routes remain unchanged. The global dashboard remains available in the ACCOUNTING and SALES contexts. Cabinet navigation is unchanged.

## Responsive and accessibility behavior

The existing sidebar width, desktop collapse, mobile drawer, and close-on-selection behavior remain in use. Labels use the existing `lg:sr-only` convention when collapsed; drawer labels stay visible below that breakpoint. Material retains keyboard interaction, focus treatment, and menu expanded state. Selector icons are explicitly decorative. Active module items continue to expose `aria-current="page"`.

## Files changed by this pass

- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.html`
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.ts`
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.spec.ts`
- `packages/frontend/public/assets/i18n/fr.json`
- `packages/frontend/public/assets/i18n/en.json`
- `packages/frontend/scripts/restaurants-translations.test.mjs`
- This report.

## Tests and validation

Updated sidebar assertions cover the active-product label and treatment, absence of platform/product duplicate headings, a single product dashboard, its route and active state, preserved Configuration/Carte groups, and collapsed labels. Existing tests also exercise product discovery, permission restrictions, route history, drawer closing, and ACCOUNTING/SALES navigation. Added a French/English translation contract for the active-product and dashboard labels.

- Targeted sidebar, breadcrumbs, and routing tests: 59 passed, 3 files.
- Full Angular suite: 942 passed, 120 files.
- Frontend script contracts: 18 passed.
- Development build: PASS. Existing ignored-bare-import warning in shared Sales output remains.
- Scoped Prettier: PASS.
- `git diff --check`: PASS.

## Limitations and stopping point

No new browser/manual visual inspection was performed. Pixel-level appearance and narrow-screen rendering therefore remain unverified in this pass; automated tests validate the responsive classes and interaction behavior. No sidebar widening or route redesign was needed.

The repository already contained uncommitted changes from earlier work; these remain preserved. This pass leaves its changes uncommitted. No deployment or live AWS call was performed. RESTO-1D and RESTO-2 were not started; this presentation-only task does not establish their readiness.
