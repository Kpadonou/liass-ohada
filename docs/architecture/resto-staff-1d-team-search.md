# UI-GUARDRAIL-3 + RESTO-STAFF-1D — Searchable Team table

Date: 2026-10-15. Frontend/UI and canonical framing only. Explicit user visual approval remains pending.

## 1. User feedback

The corrected Team management table still needed search. Structured establishment/status filters do not let a manager quickly find a known person by name. Search is now a permanent management-table requirement, regardless of fixture size or pagination.

## 2. Canonical searchable-table rule

Comparable management collections default to tables, with row actions in the final column. Every management/list table includes accessible text search alongside structured filters and any appropriate primary action. Search finds recognizable records; filters constrain structured attributes and cannot replace it. Any exception must explain concretely in the feature report why text search is meaningless.

Reuse approved Accounting patterns and a coherent search/filter/action toolbar across products. Cards require a workflow justification. Responsive narrow-screen adaptation remains allowed. Local search must disclose incomplete loaded-page scope and preserve bounded pagination rather than imply global coverage or automatically fetch all records.

This change establishes the rule and applies it to Team; it does not retrofit unrelated product pages.

## 3. Framing files updated

- `AGENTS.md`: concise searchable-management-table rule in existing Frontend Tables section.
- `.agents/skills/liass-design-system/SKILL.md`: existing Collection presentation contract extended with search, filters, exceptions and truthful pagination semantics.
- Existing `references/liass-component-guidelines.md`: Tables guidance aligned.
- Existing `references/liass-page-templates.md`: List Page toolbar guidance aligned.

No duplicate guidance document, Team-specific global rule, global theme or token change.

## 4. Accounting reference used

Accounting Journaux (`feature/journals/journals.page.html` and `.ts`) provides a labelled Material search input with prefix icon before structured filters, shared header/divider, comparable records, status chips and final-column action menus. Reused its trim/case/accent normalization and control ordering, without copying accounting-specific fields or actions. Also inspected Accounting Accounts' search input and the existing table, shared searchable-select and page-header patterns. Journaux was rendered with deterministic local fixtures for visual comparison. Its local journal list is not a server-search or pagination implementation; Team retains its own cursor-based list behavior.

## 5. Search semantics

`FormControl<string>` and a derived Signal implement immediate local filtering. Search matches only the canonical safe `displayName`, using substring comparison after Unicode NFD normalization, removal of combining accents, lowercasing and trimming. For example, `aissATou` matches `Aïssatou S.`.

Null display names remain truthfully represented by the existing presentation fallback; technical references never become searchable fallbacks. Role and establishment names are intentionally not included: those remain structured filters/presentation, avoiding additional hydration, query coupling or misleading scope.

No debounce is needed because typing causes no network requests. No server entities are duplicated into client state.

## 6. Search scope limitation/fullness

Inspected shared `restaurants/staff.ts` response schemas and existing RestaurantsApi `staff`/`outletStaff` methods. Lists expose bounded items and optional `nextCursor`; the client uses existing list parameters (`limit: 50`, opaque cursor). There is no server-search contract.

Search covers all currently loaded pages of the selected directory. When a cursor remains, a visible message states: “La recherche porte sur les membres chargés. Chargez la suite pour élargir les résultats.” The search input references this explanation through `aria-describedby`. The existing explicit load-more action remains accessible even when local search finds no matches. Loading another page preserves the text and recomputes the results. No automatic load-all loop or invented definitive total.

When pagination is exhausted, the loaded selected directory is complete and the scope notice is removed. Search counts use existing “membre(s) affiché(s)” wording. A true full-dataset search without loading subsequent pages requires a separate backend capability in a later micro-lot; none was added here.

## 7. Filter composition

Visible members are the intersection of existing outlet-scoped directory results, the existing status filter, and display-name search. Changing or clearing search does not reset either structured filter. Changing either filter preserves search. Organization changes reset search alongside the existing local filters to prevent context carryover. TanStack Query keys, calls, cursor handling, cache invalidation, tenant guards and permissions remain unchanged.

## 8. Empty-search behavior

An active search with no match shows “Aucun membre ne correspond à votre recherche.” rather than the unconfigured-Team state. Existing truly empty directory, outlet-empty and filtered-empty states remain unchanged when search is absent. If further pages exist, no-match guidance explicitly refers to loaded members and keeps load-more available. Otherwise it suggests changing or clearing search.

## 9. Responsive toolbar

Search precedes Établissement and Statut in one working toolbar. Desktop uses a wider search field; tablet retains three aligned controls with sufficient status width. Narrow screens stack controls vertically. Dynamic subscript sizing is scoped to the Team component so the existing shared outlet selector does not reserve an unnecessary blank hint row; global Material defaults and the shared selector are unchanged.

The existing desktop Material table, final Actions column, menus, responsive stacked mobile records, count and table preferences remain intact. No CSS/theme files or global layouts were modified.

## 10. Accessibility

Search uses a proper translated `mat-label`, `input matInput type="search"` and prefix search icon. The suffix clear button has the translated accessible name “Effacer la recherche”, is keyboard operable, and returns focus to the search input after clearing. Partial scope is programmatically associated with the input. Existing table headers, record-menu names, dialog focus behavior and visible status labels are preserved. All added visible copy is in FR/EN Transloco resources.

## 11. Tests and exact results

- Targeted Team Angular tests: **1 file, 37 tests PASS** (31 existing plus 6 new search tests).
- Full `npm test -w @liass-ohada/frontend -- --watch=false`: **130 files, 1,075 Angular tests PASS**.
- Frontend contracts, run by the same command: **21 tests PASS, zero failures**.
- `npm run build:development -w @liass-ohada/frontend`: **PASS**. Existing shared-package side-effect warnings are non-blocking.
- Prettier check on all STAFF-1D touched files: **PASS**.
- `git diff --check`: **PASS**.

Tests cover labelled Material search, display-name match, case/accent/whitespace normalization, no match, search clearing, intersection with establishment/status, preservation of other controls, distinct empty-search state, last Actions column, explicit cursor pagination and loaded-scope messaging, no extra search requests, unsearchable/undisplayed opaque IDs, and organization-context reset. Existing lifecycle, assignment retry/partial-failure, permissions, error and isolation tests remain green. No snapshots or pixel assertions.

Logs: `/tmp/staff1d-targeted.log`, `/tmp/staff1d-full.log`, `/tmp/staff1d-build.log`, `/tmp/staff1d-prettier.log`. Installed Node v22.22.3 used. Production configuration was neither fabricated nor changed; production build is outside the requested validation.

## 12. Browser inspection

Actual in-app-browser inspection at `http://localhost:4200` with the existing isolated local fixtures; no deployed integration or AWS call:

- 1440×1000: search/filter alignment, naturally following count/table, compact existing rows and final menu column.
- 900×1000: wider search than closed filters, table remains readable, no document overflow.
- 390×844: vertically stacked controls and existing labelled record adaptation, document width equals viewport.
- Typed `aissATou`: only Aïssatou shown. Typed an unknown name: dedicated no-match state. Clear restored the full collection and input focus.
- Local paged fixture: searching `Elodie` initially has no match with explicit loaded-scope guidance; manually loading the next page reveals Élodie and removes the incomplete-scope message without clearing the search.
- Accounting Journaux visually compared for search-first filter-toolbar grammar.

Artifacts in `/tmp/resto-staff-1d-visual/`: `desktop.png`, `tablet.png`, `mobile.png`, `search-match.png`, `no-match.png`, `partial-no-match.png`, `partial-loaded-match.png`, `accounting-reference.png`. Local fixture screenshots are review evidence, not committed application assets.

## 13. Files changed in STAFF-1D

- `AGENTS.md`.
- `.agents/skills/liass-design-system/SKILL.md`.
- `.agents/skills/liass-design-system/references/liass-component-guidelines.md`.
- `.agents/skills/liass-design-system/references/liass-page-templates.md`.
- `packages/frontend/public/assets/i18n/fr.json` and `en.json` (five search-copy keys each).
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-team.page.ts`, `.html`, `.spec.ts`.
- `packages/frontend/scripts/team-review/main.ts` (bounded paged fixture only, excluded from production entry).
- This report.

## 14. Backend changes: NONE

No backend, shared contract, domain, API or RBAC changes. SHA-256 comparison against `/tmp/staff1d-baseline.json` confirms that the only changed existing files under backend/shared/frontend source are the three Team page files. Query/API/capability sources, assignment/status dialogs, Service Floor and table styling remain identical to the start of this correction. No infrastructure changes, backend search, deployment or live AWS call.

## 15. Git status

Working tree remains intentionally uncommitted. Existing STAFF-1B/1C implementation, reports and fixture changes were already present and are preserved. This task modifies only the framing/search/report files listed above. No backend/shared paths are dirty. Full final status captured in `/tmp/staff1d-git-status.txt`. No commit created.

## 16. RESTO-STAFF-1D: PASS

Technical and agent visual checks pass. This does not constitute explicit user visual approval.

## 17. User visual-review readiness: YES

The searchable Team table is ready for review with deterministic local fixtures.

## 18. RESTO-SVC-2 readiness: NO

Await explicit user visual approval before SVC-2. No waiter/session assignment, Service Floor change, Table Workspace, invitation, role administration or transactional permission widening. Stop after STAFF-1D.
