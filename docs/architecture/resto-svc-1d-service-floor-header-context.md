# RESTO-SVC-1D — Service Floor Header & Context

## 1. User visual feedback

SVC-1A/B/C are technically validated, but the user has not approved the rendered Service Floor. Requested corrections: replace area chips with a Material select and restore the canonical header/content divider. This report records technical completion, not user visual approval.

## 2. Starting header/filter issue

SVC-1C combined an outlined establishment field with selected chips, giving context controls different heights, shapes and emphasis. Its local heading had no divider. Current-state evidence: SVC-1C implementation/report and `/tmp/svc1c-evidence/desktop-all.jpg`; approved direction: the user-supplied Service en salle V2 mockup. Inspected AGENTS, canonical Design Skill and shared header/select patterns. Canonical page-header template uses `border-b border-app-border/75 pb-3`.

## 3. Dining-area select implementation

Reuse `liass-searchable-select`, `controlType="select"`, for both establishment and area. The shared component renders outlined `mat-form-field` + `mat-select`, with search beyond ten options. Removed the entire chip/listbox branch, MatChips import and page-scoped chips overrides. No custom/native select, Material internal selector, shared component or global theme change.

Area select is available whenever the selected outlet is resolved, including outlets with zero loaded areas (the All option remains useful). Existing explicit area load-more/error controls remain unchanged and bounded; no automatic unbounded fetch or pagination change.

## 4. All-areas semantics

First option remains the UI sentinel `ALL`, translated as **Tous les espaces** / **All dining areas** using the existing SERVICE.ALL key. Actual loaded areas follow. Selecting ALL maps to null through unchanged selectArea logic, showing all currently loaded tables. No server DTO change.

## 5. URL context preservation

Existing outlet/area query parameters and merged router navigation remain intact. Null clears area; a specific selection persists its ID. Establishment changes still reset area. QueryParamMap restores direct-load/history state. Area remains a local presentation filter, not a Service Floor query-key parameter. Tests assert no extra floor request solely from area selection/reset/history.

Actual browser Back, Forward and Reload restored all/specific context and corresponding card metadata/counts correctly.

## 6. Header layout

At xl desktop, heading/subtitle on left and two 224px selects on right with 12px gap. Both use the same shared field/default appearance and baseline. At tablet, context sits beneath the heading, fields remain side by side. Below sm, fields stack using available width. No additional card/background.

## 7. Horizontal separator restoration

Applied the exact shared page-header `border-b border-app-border/75 pb-3` pattern to the outer heading/context block, so the separator spans the complete content width. No new border color/thickness or modification to the shared header.

## 8. Vertical rhythm

Retained existing gap-4 inside header, shared Material field spacing, pb-3 before divider and outer space-y-6 before summaries. Header typography unchanged. One full-width transition groups title/context and separates them from metrics/floor.

## 9. SVC-1C card polish preserved

Card markup/layout, compact sizing, table code, grouped occupancy/duration, prominent exact amount, secondary icon, optional capacity/name, area suppression for a specific filter, tonal opening action, summaries and integrated refresh remain unchanged. Opening/idempotency, permissions, timers, queries, polling and floor pagination untouched.

## 10. Zero-amount microcopy decision

**Keep 0 XOF.** The read model exposes canonical currentAmountMinor, not order count or an absence-of-orders flag. A zero amount does not prove “Aucune commande”. No speculative semantic substitution or payment wording.

## 11. Responsive behavior

Browser inspected 1440×1000, 900×1000 and 390×844, all/specific area at each size. Desktop fields: same y=112, width=224 and host height=71.5px. Tablet fields: same y=183.5, width=224. Mobile stacked fields have equal 351px width in the available 375px document width (390px viewport with vertical scrollbar). No horizontal overflow: scrollWidth 1440/900/375 ≤ viewport 1440/900/390. Four/two/one-column card layout preserved. Narrow total-summary label can wrap naturally; numbers and labels remain readable.

## 12. Accessibility

Labelled Material comboboxes, native option selection/popup semantics and outlined focus appearance retained. Mobile Enter/ArrowDown/Enter selection exercised. Explicit status text, decorative icon treatment, existing aria-busy/live opening feedback and button labels unchanged. No full screen-reader audit claimed.

## 13. Tests and exact results

Added two component tests: real Material selectors/no chip listbox, All option and actual option selection/reset, precise URL updates, independence of establishment, no area-only floor refetch, direct URL/history restoration in displayed select. Existing SVC-1C card/context test and functional coverage remain.

| Command                                                                                                      | Result                        |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| `npm exec --workspace @liass-ohada/frontend -- ng test --watch=false --include='**/*service-floor*.spec.ts'` | PASS: 27 tests / 2 files      |
| `npm exec --workspace @liass-ohada/frontend -- ng test --watch=false`                                        | PASS: 1,015 tests / 127 files |
| `npm run test:frontend-contracts -w @liass-ohada/frontend`                                                   | PASS: 21 tests                |
| `npm run build:development -w @liass-ohada/frontend`                                                         | PASS, exit 0                  |
| Scoped Prettier                                                                                              | PASS                          |
| `git diff --check`                                                                                           | PASS                          |

Initial history-control assertion ran before asynchronous ngModel synchronization; test now waits for rendered select state. Final results above pass. Build retains existing shared-package sideEffects warnings; no blocking error. Backend tests not run because backend source unchanged.

## 14. Browser observations

Used existing deterministic SVC-1B preview/bootstrap, compiled outside repo, normal AppShell on localhost:4200. No AWS request or live data mutation. Inspected desktop/tablet/mobile with All and Salle principale. Counts changed 8/5/3 → 4/2/2, area text disappeared on selected-area cards, and URL/reset/history/refresh behaved correctly. Both fields matched; divider was visible, subtle and full width. Keyboard focus/selection worked.

Evidence: `/tmp/svc1d-evidence/desktop-all.jpg`, `desktop-area.jpg`, `tablet-all.jpg`, `tablet-area.jpg`, `mobile-all.jpg`, `mobile-area.jpg`. Temporary bootstrap removed, preview stopped, normal dev server restored as found at start. User visual approval remains pending.

## 15. Remaining differences vs approved mockup

Area select deliberately replaces mockup chips according to explicit user correction and canonical project field language. Existing Liass typography/cards/icons and current currency formatting remain. No waiter/openedBy display, future alerts, kitchen/preparation, guest calls/counts, reservations/cleaning, payment, Workspace interaction, occupied chevron or Plan view. Differences are intentional business truth/design-system constraints.

## 16. Files changed in this micro-lot

- `packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.html`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.ts` (remove chips import only)
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.scss` (remove unused chips overrides; opening-button treatment retained)
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.spec.ts`
- `packages/frontend/public/assets/i18n/fr.json` and `en.json` (SERVICE.ALL only)
- This report.

## 17. Backend changes: NONE

Before/after SHA-256 comparison confirms backend/shared files, central Material theme/styles and Restaurants query implementation unchanged. No API/domain/RBAC/opening changes. AppShell/shared components/framing untouched. No deployment or commit.

## 18. Git status

Branch main, HEAD cdf5e66. Existing uncommitted SVC-1A/B/C and UX-2A changes preserved. Current task is limited to the seven files above. Status evidence `/tmp/svc1d-status-before.log`, `/tmp/svc1d-status-after.log`; frozen-file evidence `/tmp/svc1d-frozen-before.json`. Test/build logs `/tmp/svc1d-targeted.log`, `/tmp/svc1d-full.log`, `/tmp/svc1d-contracts.log`, `/tmp/svc1d-build.log`.

## 19. RESTO-SVC-1D status: PASS

Requested header/context corrections implemented and technically validated. This does not freeze the UI or constitute user visual approval.

## 20. User visual-review readiness: YES

Ready for explicit user review. No Table Workspace, Kitchen, Checkout or other next micro-lot started.
