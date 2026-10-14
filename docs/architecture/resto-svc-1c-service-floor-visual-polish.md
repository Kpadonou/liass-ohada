# RESTO-SVC-1C — Service Floor Visual Polish

## 1. Starting visual gaps

SVC-1B worked correctly but cards read like configuration CRUD: an 80px illustration block dominated metadata; elapsed time and amount sat in opposing footer corners; occupied status was far from duration; minimum content height was 192px with large padding. Summary icons had no grouping surface. The page-header divider ended before the filters. Refresh appeared separated from the grid.

## 2. Approved mockup comparison

Reference: user-approved `Restaurant Floor Service Dashboard.png`, Service en salle V2. Preserve its quick scan of identity/state/duration/amount, contextual filters, three summaries, table-specific opening and four-column desktop/two-column tablet grid. Its illustrative future data is not implemented. The approved Liass Material theme, typography, surfaces, radii, shadows and shell take precedence over pixel replication.

## 3. Table-card hierarchy changes

Code remains primary. Free cards show status, capacity when configured, area when useful, optional secondary name and explicit opening action. Occupied cards show code, grouped occupancy/duration, prominent amount, then supporting capacity/context/name. No occupied-card interaction or chevron.

## 4. Occupied status/duration treatment

One wrapping cluster contains the shared Occupée badge, decorative middle dot and elapsed duration. The existing minute timer/formatting is unchanged. No separate clock icon competes with the amount.

## 5. Amount hierarchy

Moved directly below status, increased from text-lg to text-2xl with tabular numerals. Uses the unchanged exact restaurantPrice formatter and currency; no payment/balance label.

## 6. Card density/spacing

Existing liass-card padding md replaces lg. Content minimum height 176px replaces 192px; gaps 12px replace 16px. Table icon now supports the code in a 32px muted container instead of an 80px block/scaled icon. Desktop/tablet fixture cards measured 210px high; original desktop cards were approximately 234px. No new radius/shadow tokens. Content can grow for names, wrapped metadata or unusually long values.

## 7. Area-context behavior

Cards render areaName only when the selected area is Toutes. Specific-area selection hides the redundant per-card area line. Existing area filtering, URL context, summary scope and query/pagination logic are untouched. Secondary names remain optional, visually muted, suppressed when identical to code, with title for full truncated names.

## 8. Free-table action treatment

Existing action now uses Material's supported tonal button appearance, full width and 44px height. Page-scoped supported button token mixin reuses the central contextual hover surface and primary navy; no global button variant/theme change. Existing labels, accessible table-code label, loading/disabled semantics, idempotency and event handler remain intact.

## 9. Status styling

Free keeps shared success badge. Ordinary occupancy uses the shared brand badge rather than error/red. Explicit text remains alongside color. No new status semantics.

## 10. Summary-card polish

Shared liass-card retained. Number/label form one group with consistent icon container and spacing. Total uses table_restaurant; occupied/free use people/people_outline. Free receives existing success colors, other metrics existing brand colors. At narrow width supporting icons are omitted to preserve the three compact readable counts. No metric or definitive partial-count behavior changed.

## 11. Filter polish

Material listbox/options retained, 44px touch-friendly height, slight top alignment against existing outlined establishment select. Supported page-scoped chips overrides inherit central primary/on-primary for selected background/text/check and focus/hover layers. No internal Material selectors or pseudo-controls. Many-area/shared searchable-select path is unchanged. Header divider removed locally: semantic h1/header reuses the approved page-header typography classes, avoiding a change to the shared page-header for all pages.

## 12. Refresh-action integration

Plan de salle and refresh now belong to one labelled section with 12px internal rhythm. Refresh remains a secondary Material text button with icon, 44px practical target, existing disabled/loading behavior.

## 13. Responsive results

Browser reviewed 1440×1000, 900×1000, 390×844, with Toutes and specific-area selection. Four/two/one grid columns respectively; no horizontal overflow (document scrollWidth equals 1440/900/390). Tablet free actions measured 44px. Mobile establishment select spans available width; area options wrap naturally. Existing contextual shell and responsive drawer unchanged.

## 14. Accessibility

Native Material selection/button semantics retained, status text rather than color alone, decorative icons aria-hidden, existing aria-busy/live opening feedback. Added labelled Plan de salle region. Area keyboard ArrowRight/Space selection exercised successfully on mobile; focus/selected semantics remain Material-owned. No full screen-reader audit claimed.

## 15. Unsupported data still intentionally absent

No openedBy/waiter names, alerts, preparation counts/status, guest calls, reservation, cleaning, payment/receipt, Plan toggle, Workspace/detail dialog/chevron or occupied-card navigation. No fake operational data enters application code. Deterministic review fixtures are the existing isolated SVC-1B preview mechanism only.

## 16. Visual comparison after changes

Closer scan hierarchy: clear code, grouped status/time, larger amount, subordinate metadata, compact summaries and tonal table-specific opening. Intentional differences from mockup: small Material icon instead of illustration; non-error brand occupancy; current ISO XOF formatting; no unsupported footer/staff/alerts/Plan interactions. Existing shell/header typography is preserved rather than replicating the mockup's oversized title. Equal minimum card heights maintain grid rhythm without forcing absent future content.

## 17. Tests and exact results

| Command                                                                                                      | Result                       |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `npm exec --workspace @liass-ohada/frontend -- ng test --watch=false --include='**/*service-floor*.spec.ts'` | PASS: 25 tests, 2 files      |
| `npm exec --workspace @liass-ohada/frontend -- ng test --watch=false`                                        | PASS: 1,013 tests, 127 files |
| `npm run test:frontend-contracts -w @liass-ohada/frontend`                                                   | PASS: 21 tests               |
| `npm run build:development -w @liass-ohada/frontend`                                                         | PASS, exit 0                 |
| Scoped Prettier write/check                                                                                  | PASS                         |
| `git diff --check`                                                                                           | PASS                         |

One new meaningful presentation test checks area shown for Toutes, hidden for a specific area, restored on reset, occupied badge/duration in one cluster and unchanged exact amount. Existing tests retain optional capacity, unsupported-data absence, permissions, opening, conflicts, errors, pagination, timer and isolation coverage. Initial test compilation failed on repeated union access to openedAt; corrected to a deterministic 26-minute local clock assertion. Final runs above pass. Build retains existing shared-package sideEffects warnings; no new blocking diagnostic. No backend tests needed: backend unchanged.

## 18. Browser observations

Used normal AppShell in the isolated deterministic SVC-1B preview at localhost:4200. Actual dev route initially redirected to login; review therefore used existing local fixture bootstrap with shared schema validation, compiled outside repository. No AWS calls or live data mutation. Inspected free/occupied, missing capacity T08, current amount, Toutes/specific-area filter, desktop/tablet/mobile. Counts changed 8/5/3 → 4/2/2 for Salle principale. Repeated area text disappeared. Keyboard area selection worked. Screenshot evidence: `/tmp/svc1c-evidence/desktop-all.jpg`, `desktop-area.jpg`, `tablet-all.jpg`, `tablet-area.jpg`, `mobile-area.jpg`, `mobile-cards.jpg`. Temporary bootstrap removed and normal Angular server restored after review. User visual approval remains pending.

## 19. Files changed in this micro-lot

- `packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.html`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.ts` (local stylesheet/import and summary icon only)
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.scss` (new, supported page-scoped Material presentation tokens)
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.spec.ts`
- This report.

## 20. Backend changes: NONE

Backend source/test SHA-256 map identical before/after, including untracked SVC-1A files; backend git diff byte-identical. No shared schema/client/query/capability/route/RBAC changes. material-theme.scss, global styles/tokens, AppShell, shared components and canonical framing untouched. No deployment or commit.

## 21. Git status

Branch main, HEAD cdf5e66. Existing uncommitted SVC-1A/SVC-1B/UX-2A backend/shared/frontend work preserved. This micro-lot is limited to the five files above; full status captured in `/tmp/svc1c-git-status.log`. Validation logs `/tmp/svc1c-targeted.log`, `/tmp/svc1c-full.log`, `/tmp/svc1c-contracts.log`, `/tmp/svc1c-build.log`.

## 22. RESTO-SVC-1C status: PASS

Visual refinement implemented and validated locally. No functionality expansion. User approval is required before the next UX micro-lot; no next phase started.

## 23. User visual-review readiness: YES

Ready for user review in the normal local application after sign-in. Browser evidence supports comparison; production/user data was not changed.
