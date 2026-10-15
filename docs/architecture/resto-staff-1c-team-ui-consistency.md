# UI-GUARDRAIL-2 + RESTO-STAFF-1C — Team UI consistency

Date: 2026-10-15. Frontend presentation and canonical framing only. User visual approval remains pending.

## 1. User feedback

STAFF-1B passed technical checks, but its large two-column staff-card collection was not visually approved. A clean appearance did not justify diverging from the ERP's management-list conventions.

## 2. Why the card grid was inappropriate

Team members are homogeneous records with repeated name, role, status, establishment and action attributes. Managers compare these attributes across people. Large individual cards made comparison slower and repeated an oversized assignment action. A table is the appropriate desktop information architecture.

## 3. Canonical collection-presentation rule

Inspect approved product patterns first. Tables are the default for comparable management collections, one record per row, with actions in the final column. Cards require a concrete workflow justification such as spatial/state-heavy interaction or visual summaries; they are not synonymous with premium. Accounting is a canonical ERP management-list reference. Narrow-screen stacked adaptations are permitted while desktop remains table-oriented. Definition of Done includes rendered cross-product interaction consistency.

## 4. Framing files updated

- `AGENTS.md`: concise rule and pointer to the skill; no Team-specific charter.
- `.agents/skills/liass-design-system/SKILL.md`: authoritative Collection presentation section.
- Existing `references/liass-component-guidelines.md`: Cards and Tables guidance aligned.
- Existing `references/liass-page-templates.md`: List Page default aligned.

No duplicate guidance document or global design-token change.

## 5. Accounting reference inspected

`packages/frontend/src/app/domains/accounting/feature/journals/journals.page.html` and `.ts`: page header/divider, Material filters, table hierarchy/density, translated status chips, final narrow actions column, Material menu icons and semantic action classes, local table preferences, loading/error/empty states, and responsive stacked records below `md`.

Also inspected the shared page header, status chip and table-preferences primitives, existing `liass-data-table` styles, central tokens, and the design skill's principles, tokens, component, interaction and page references. Journaux was rendered with deterministic local fixtures for direct visual comparison.

## 6. Desktop Team table design

Route stays `/restaurants/setup/team`. A native semantic table enhanced with `MatTableModule` replaces the card grid. It uses existing `liass-data-table` surfaces, alternating rows and theme tokens, with a 56px ordinary row height. No giant enclosing card, KPI panel or decorative surface.

## 7. Columns and hierarchy

Default order: Membre, Rôle, Statut, Établissements, Actions. Name remains primary; no opaque identifiers or email added. Roles remain translated and read-only. Status uses existing small `liass-status-chip` with visible Actif/Inactif text. Existing inactive-membership guidance remains available.

Assigned establishments show human-readable labels, including inactive/historically unavailable states. First two loaded assignments appear inline; `+N` expands the remaining loaded labels with an accessible translated name and expanded state. N describes only loaded additional assignments, not an invented overall total. The existing explicit assignment load-more control remains available.

Canonical local table preferences are reused under `restaurants.team`, as required by repository table guardrails. Membre and Actions remain mandatory and ordered; only optional presentation columns may be hidden. Preferences contain column IDs only, with no staff data or backend persistence.

## 8. Action-column strategy

Actions is always the last column. Authorized managers get one labelled Material vertical-dots trigger per record. Menu items have icons and existing semantic classes: assignment configuration/info, deactivation/danger, reactivation/info. No persistent large assignment button per row. Lifecycle eligibility constraints remain unchanged.

Assignment and lifecycle dialogs restore focus to the persistent row trigger after their disappearing menu item closes. Organization-context verification guards focus restoration.

## 9. Filter/header consistency

Existing title, subtitle and shared page-header separator remain unchanged. Establishment and status filters retain their typed controls, Material select behavior and bounded outlet discovery. Filters stay unframed below the header divider. The compact member count keeps existing loaded/complete-page semantics. No search, sorting, totals or new business capability was invented.

## 10. Responsive/mobile adaptation

At desktop 1440px and tablet 900px, the collection is a readable five-column table with actions on the far right. Below 768px, the same records become compact stacked items with field labels and the same menu. This follows Accounting's desktop-table/mobile-stacked-record strategy, using a single DOM/query instance per person rather than mounting two parallel collections.

Page-local CSS controls layout and existing token references only. No global theme, Material defaults, AppShell, palette, token or radius changes. Mobile fills the available content width; no forced five-column horizontal scrolling.

## 11. Assignment workflow preservation

Existing assignment dialog TS/HTML and delta/retry implementation are byte-identical to the STAFF-1C starting snapshot. The former staff card's assignment query, pagination, error handling and label hydration were extracted into `StaffAssignmentsSummaryComponent`; no new server-state store. Existing idempotency, version checks, partial-failure recovery, targeted invalidation and tenant-scoped query keys remain unchanged.

## 12. Lifecycle workflow preservation

Existing status dialog is unchanged. Activation/deactivation remains versioned and guarded, with current confirmation semantics. Inactive members remain records and remain visible under the existing filters. No delete action.

## 13. Platform features intentionally absent

No add/invite/user-creation flow, role editing, waiter/session assignment, Service Floor modification, scheduling or Table Workspace. Existing ProductAccess, guards, roles and permissions were not widened.

## 14. Tests and exact results

Commands use the installed Node v22.22.3 runtime.

- Targeted Angular selection: Team, staff API, assignment plan, Restaurants capabilities, routes and sidebar — **6 files, 112 tests PASS**.
- Full `npm test -w @liass-ohada/frontend -- --watch=false` — **130 files, 1,069 tests PASS**; includes **21 frontend contract tests PASS**, zero failures.
- `npm run build:development -w @liass-ohada/frontend` — **PASS**. Existing shared-package side-effect warnings remain non-blocking.
- Prettier on all STAFF-1C touched files — **PASS**.
- `git diff --check` — **PASS**.

Added/updated assertions cover Material table and exact columns, final actions cell, translated identity/role/status/outlet labels, menu reachability, inactive reactivation, read-only triggers, dialog focus restoration, mandatory-column preferences and bounded assignment-label expansion. Existing route, filters, pagination, errors (400/403/404/409/network/Zod), isolation, lifecycle, assignment retry/idempotency and partial-command-failure tests remain green. No pixel assertions.

Logs: `/tmp/staff1c-targeted.log`, `/tmp/staff1c-full.log`, `/tmp/staff1c-build.log`, `/tmp/staff1c-prettier.log`.

Production configuration/build was not changed or fabricated; development build is the requested validation. No backend/infrastructure validation or deployment needed for this presentation correction.

## 15. Browser inspection

Actual in-app-browser inspection against the existing local-only deterministic fixture harness at `http://localhost:4200`, not a live backend integration:

- Desktop 1440×1000: four named members, translated roles, active/inactive mix, one/multiple establishments, last-column menus and compact comparable rows.
- Tablet 900×1000: full table remains readable, document width equals viewport.
- Mobile 390×844: stacked labelled records fill the content width; document width equals viewport; menu and assignment dialog accessible. Closing the dialog returns focus to “Actions pour Aïssatou S.”.
- Empty Team, consultation-only and denied scenarios inspected; no fake add/invite/role controls.
- Accounting Journaux rendered with three fixture journals and visually compared.

Screenshots in `/tmp/resto-staff-1c-visual/`: `desktop.png`, `tablet.png`, `mobile.png`, `mobile-dialog.png`, `empty.png`, `readonly.png`, `denied.png`, `accounting-journals.png`. These are local review artifacts, not committed assets.

## 16. Cross-product consistency assessment

Reused Accounting's shared header/divider, table colors and row hierarchy, small status chips, outlined Material filters, semantic final-column menu and local preferences. Intentional differences: Team has no outer giant card (explicit request), no creation action (Platform dependency remains), no search/sort (existing behavior preserved), and mobile adapts one table DOM rather than duplicating desktop/mobile markup. Journaux currently uses a native table; Team uses Material table directives with the same approved visual grammar, as requested. Business-specific accounting behavior was not copied.

## 17. Files changed in STAFF-1C

- `AGENTS.md`.
- `.agents/skills/liass-design-system/SKILL.md`.
- `.agents/skills/liass-design-system/references/liass-component-guidelines.md`.
- `.agents/skills/liass-design-system/references/liass-page-templates.md`.
- `packages/frontend/public/assets/i18n/fr.json` and `en.json` (table/summary labels only in this correction).
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-team.page.ts`, `.html`, `.css`, `.spec.ts`.
- `packages/frontend/src/app/domains/restaurants/ui/staff-assignments-summary.component.ts` (extracts assignment presentation); obsolete uncommitted `staff-card.component.ts` removed.
- `packages/frontend/scripts/team-review/main.ts` (local Accounting visual-reference fixtures only, excluded from production entry).
- This report.

All pre-existing STAFF-1B working-tree changes are preserved. The previous STAFF-1B report remains historical and does not constitute visual approval.

## 18. Backend changes: NONE

No backend or shared-contract file changed. SHA-256 comparison against `/tmp/staff1c-baseline.json` confirms no backend modification and unchanged Restaurants API/query/capability and assignment/status-dialog sources. No domain, API, RBAC, DynamoDB, infrastructure or AWS action. No deployment.

## 19. Git status

Working tree intentionally remains uncommitted. It already contained STAFF-1B implementation/report/fixtures at the start. STAFF-1C adds the framing changes, table correction, presentation test updates, local reference fixture and this report. Existing route/navigation/API/query/capability/sidebar changes shown by `git status` belong to STAFF-1B and were not modified in STAFF-1C. No backend paths are dirty. No commit created. Full status captured in `/tmp/staff1c-git-status.txt`.

## 20. RESTO-STAFF-1C: PASS

Technical and agent visual-consistency checks PASS. This does not imply user visual approval.

## 21. User visual-review readiness: YES

The Team correction is ready for explicit user review. Preview uses deterministic local fixtures, not a deployed integration.

## 22. RESTO-SVC-2 readiness: NO

Do not start SVC-2 until explicit user visual approval of Team. The existing staff foundation remains available, but this correction implements no responsible-waiter assignment or transactional permission changes. Stop after STAFF-1C.
