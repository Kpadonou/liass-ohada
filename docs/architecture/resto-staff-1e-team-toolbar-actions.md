# RESTO-STAFF-1E — Team toolbar and collection actions

Date: 2026-10-15. Frontend only. Explicit user visual approval remains pending.

## 1. User feedback

Bring search and filters directly above the collection, remove the count row and cog icon, and reassess whether collection/member actions truthfully cover supported management operations. Preserve the approved Team table and business behavior.

## 2. Toolbar restructuring

The shared Équipe page header, subtitle and divider remain unchanged. One compact collection group now contains the search-first Material toolbar followed by the table, with 12px spacing in the normal populated state. No intermediate metadata/action row. Existing outlined Material fields, typed controls, label/clear-button accessibility and responsive sizing are reused.

The existing Accounting/Journaux management grammar remains the reference: search, structured filters, collection, final Actions column. Team retains its simpler unframed collection. Conditional pagination-scope guidance and genuine error/loading states remain contextual; they are not removed to force artificial adjacency.

## 3. Removal of cog icon

Removed the settings button, preferences-dialog integration and preference loading for this page. All five Team columns are always visible, including for users who previously stored hidden-column preferences. Existing local storage is not destructively cleared; the page simply no longer consumes those presentation preferences.

This is the explicitly requested Team-specific exception to the repository/skill preference-control convention. No global framing, shared preferences component, theme or defaults changed.

## 4. Removal of count row

Removed the member count markup and unused summary calculation. No KPI, replacement count or decorative control. Pagination remains explicit and bounded; the existing loaded-search-scope message still prevents misleading search expectations when further pages exist.

## 5. Add-member action decision

**Omitted.** Rechecked frontend identity member APIs, Restaurants client/contracts and the STAFF-1B discovery findings. `CabinetTeamApi.listMembers` targets `/cabinet/team/members` with Cabinet context and Cabinet-specific contracts; it is not a generic organization/COMPANY member selector for Restaurants.

STAFF-1A's existing staff binding endpoint does not supply the missing eligible-member discovery UI. No bounded generic organization member search/selection capability is available to this frontend. A button would require manual identity entry, misuse Cabinet scope or invent unsupported identity/invitation behavior. None is appropriate. No disabled fake button or repeated dependency warning was added. Existing empty-state workspace-membership guidance remains unchanged. Generic Platform member discovery remains the prerequisite for a real future add flow.

## 6. Row action clarity

The existing translated Material menu already clearly exposes “Gérer les affectations” and “Désactiver” or “Réactiver”, with icons, semantic styling and named per-member triggers. No relabeling was necessary. Actions remains the final column. Existing lifecycle eligibility constraints, confirmation dialogs, focus restoration and permission checks remain unchanged. Browser review confirmed assignment/deactivation entries on desktop and mobile; existing tests verify inactive reactivation and read-only behavior.

## 7. Supported CRUD scope and intentionally absent operations

Supported: list, name search, establishment/status filtering, bounded pagination, assignment management and activation/deactivation according to current permissions. Search remains local to loaded pages with truthful scope guidance; no query contract change.

Intentionally absent: invite, platform identity creation, generic member discovery/add flow, role editing and hard deletion. No SVC-2, Service Floor, responsible-waiter or Table Workspace changes.

## 8. Responsive behavior and browser inspection

Actual in-app-browser review on deterministic local fixtures at `http://localhost:4200`; no deployed/backend integration claimed:

- 1440×1000: one coherent search/filter row, table immediately below, five columns and final-column menus.
- 900×1000: aligned controls, readable table, measured 12px toolbar/table gap; document width 900px, no horizontal overflow.
- 390×844: vertically stacked controls immediately followed by existing labelled mobile records; document width 390px, no horizontal overflow. Row menu remains accessible.
- No cog/settings action, member-count text or fake add button in the collection.

Screenshots: `/tmp/resto-staff-1e-visual/desktop.png`, `tablet.png`, `mobile.png`, `actions.png`. These are local review artifacts. Existing Material/shared components and theme tokens remain in use; no new visual system or controls.

## 9. Tests and exact results

- Targeted Team: **1 file, 39 tests PASS**.
- Full `npm test -w @liass-ohada/frontend -- --watch=false`: **130 files, 1,077 Angular tests PASS**.
- Frontend contract suite, included in that command: **21 tests PASS**, zero failures.
- `npm run build:development -w @liass-ohada/frontend`: **PASS**; existing shared-package side-effect warnings remain non-blocking.
- Prettier check on all STAFF-1E files: **PASS**.
- `git diff --check`: **PASS**.

Replaced the removed preferences test with a structural assertion that the toolbar directly precedes the table, settings/count/add controls are absent, all five columns remain visible despite old saved preferences, and row menus remain reachable. Updated former count assertions to verify absence. Existing search/filter/pagination/role/assignment/lifecycle/error/read-only/isolation tests remain green. No pixel assertions.

Logs: `/tmp/staff1e-targeted.log`, `/tmp/staff1e-full.log`, `/tmp/staff1e-build.log`, `/tmp/staff1e-prettier.log`. Installed Node v22.22.3 used.

## 10. Files changed in STAFF-1E

- `packages/frontend/src/app/domains/restaurants/feature/restaurant-team.page.html`: compact collection grouping; count/settings removal.
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-team.page.ts`: remove unused summary/preferences; fixed complete column set.
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-team.page.spec.ts`: structural regression coverage and count assertions updated.
- `docs/architecture/resto-staff-1e-team-toolbar-actions.md`: this report.

No translations or global/shared UI files changed in this correction.

## 11. Backend changes: NONE

SHA-256 comparison with `/tmp/staff1e-baseline.json` confirms only the three Team page source/test files changed under backend/shared/frontend source. Backend, shared contracts, Restaurants API/query/capability files, assignment/status dialogs and Service Floor remain byte-identical to the start. No API/RBAC/persistence/infrastructure change, deployment or live AWS call.

## 12. Git status

Working tree was already dirty with the preceding STAFF-1B/1C/1D and role-label work. Those changes are preserved; this lot changes only the four files above. Backend/shared paths remain clean. Full status captured in `/tmp/staff1e-git-status.txt`. No commit created.

## 13. RESTO-STAFF-1E: PASS

Technical validation and agent responsive review pass. This is not user visual approval.

## 14. User visual-review readiness: YES

The refined Team collection is ready for explicit user review. Stop after STAFF-1E; do not start SVC-2 or other operational workflows.
