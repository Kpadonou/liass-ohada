# RESTO-STAFF-UX-2 — Organization members available for Liass-Resto integration

Date: 2026-10-16. Classification: **VERTICAL_SOLUTION**, owner Restaurants. Frontend management UX, consuming the Platform-owned organization-member directory. PLATFORM-TENANT-UX-1 and RESTO-ACCESS-UX-1 remain accepted and unchanged.

## 1. Motivation from real Chrys E2E

After accepting BETA's COMPANY invitation, Chrys was an active direct organization member but was initially absent from the Restaurants team. The OWNER had to locate Chrys indirectly through Add Member before assigning a product role, creating Staff and assigning an outlet. This lot exposes a discoverable secondary entry point without declaring that every organization member intends to work in Restaurants.

## 2. Reconnaissance findings

AGENTS.md, SPEC.md, Platform architecture and Design System skills, existing frontend conventions/tokens, STAFF-1A–1E reports and runtime, STAFF-2B, MEM-2A/2B and accepted tenant/access reports were inspected. MEM-1A member discovery, MEM-1B initial role assignment and STAFF-2A2's keyed Staff read/binding are verified in the existing shared contracts, Platform services and Restaurants adapters/runtime; no separate report was needed to establish their observable contracts.

The ten pre-implementation findings:

1. The Platform directory returns direct COMPANY members, including ACTIVE/SUSPENDED/REVOKED status and safe display name/verified administrative email.
2. The Restaurants directory returns canonical Staff keyed by user ID.
3. It includes both ACTIVE and INACTIVE Staff; the Team status and outlet filters are frontend views, not an exhaustive absence test.
4. Product role can exist before Staff is created: the provisioning sequence is deliberately multi-step.
5. Staff can survive role/membership loss; DTOs join current nullable product role and membership activity.
6. OWNER/MANAGER need no Staff record for their broad canonical management access.
7. Both collections have opaque cursor pagination; only an exhausted successful unfiltered Staff collection can prove absence in that snapshot.
8. `GET /restaurants/staff/{memberUserId}` exists; only its 404 is interpreted as absence by the existing selected-member helper.
9. No per-row lookup fan-out is needed: complete Staff pages can be compared to loaded Platform rows; the selected member is checked again by the existing dialog.
10. **No backend read-model gap and no new endpoint required** for this explicit paginated strategy.

## 3. Canonical datasets and ownership

| Dataset                 | Existing contract / helper                                                            | Scope                                                              |
| ----------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Organization members    | `/me/organization/members`, `OrganizationMemberSummary`, `OrganizationMembersQueries` | Platform-owned, current organization plus authenticated actor      |
| Restaurants Staff       | `/restaurants/staff`, `RestaurantStaff`, `RestaurantsQueries.staff`                   | Restaurants-owned unfiltered tenant directory, ACTIVE and INACTIVE |
| Individual Staff        | `/restaurants/staff/{memberUserId}`, `staffCandidate`                                 | Exact tenant/user, canonical selected-member verification          |
| Outlets and assignments | Existing outlet and staff-outlet helpers                                              | Explicit operational scope; unchanged STAFF-2B reconciliation      |

Platform members expose no product-role projection. The new list therefore does **not** claim that a person has no Restaurants role or that provisioning has never started. Membership, role, Staff and outlet configuration remain separate.

## 4. Candidate derivation rule

While the existing combined OWNER provisioning capability and Restaurants entitlement hold, candidates are named/email-labelled ACTIVE Platform members, excluding the current OWNER identity and every user ID present in the successful complete unfiltered Staff collection. Deduplication is by canonical user ID. Local search then filters the derived rows.

No persisted pending state, intent marker, invitation state or new business status is created. Copy says “Membres disponibles” and explains that these people may be configured **if** they need to join the team. It also states that product access may already exist.

## 5. Pagination safety

Chosen strategy: complete paginated Staff comparison, with explicit additional-page loading, followed by the existing keyed check for the selected member. The candidate component shares the canonical unfiltered Staff cache with Team. Team search/status/outlet filters do not affect the comparison.

If Staff is pending, fetching, in error, or has another cursor, no candidate is classified or actionable. The UI asks to load the remaining Staff pages, one explicit action at a time. There is no automatic load-all loop and no N+1 Staff lookup per directory row. Large teams may require multiple explicit page loads before comparison is available; generic Add Member remains usable independently.

The Platform directory starts with a bounded page of 50. Additional pages use its existing explicit load-more action. Search covers loaded Platform rows only, with visible scope guidance whenever a cursor remains. Empty pages with a cursor retain load-more. No global candidate count is shown. Exhausted and partially loaded empty states have different wording.

## 6. OWNER handling

The current OWNER is excluded by canonical authenticated user ID even when no Staff exists. No Staff record is fabricated to align datasets. Visibility requires the existing `canProvisionStaff` combination: direct active COMPANY OWNER membership plus Restaurants Staff management capability and product availability. Organization entitlement or a product MANAGER role alone is insufficient.

## 7. ACTIVE / INACTIVE RestaurantStaff handling

All existing Staff IDs are excluded, including INACTIVE, roleless or membership-inactive records. An inactive member continues through the established explicit reactivation action, confirmation and expected-version handling. Active Staff with missing assignments uses Team's existing assignment action. Nothing creates a duplicate Staff identity.

## 8. Platform membership status handling

Only ACTIVE direct COMPANY directory rows with a safe human label are offered. SUSPENDED and REVOKED members are excluded. Restaurants neither reactivates nor modifies Platform membership. Backend authority remains unchanged and still validates every command.

## 9. Information architecture chosen

The primary Team table, toolbar, search, status/outlet filters, final Actions column, menu actions and general “Ajouter un membre” flow are preserved. A collapsed secondary “Membres disponibles” section appears below the primary collection for OWNER only. It defers directory reads and its second search control until expanded.

The expanded area uses the existing Material table grammar, identity/email in the first column and Configurer in the final Actions column. Existing Team density and mobile stacked-table adaptation are reused. The only additional sizing rule reserves the desktop candidate action column and lets it expand normally on mobile. No decorative cards, KPI dashboard, tabs or global shell redesign.

## 10. Search behavior

Both searches remain independently labelled and adjacent to their respective collections. Candidate search matches canonical display name and safe administrative email, case-insensitively and accent-insensitively using the established NFD normalization. Team search and filters remain unchanged. A no-match search message is distinct from a failed directory request and from an exhausted available-member list.

## 11. Configure/Add integration

Configurer opens **the same `AddStaffDialogComponent`** with the captured organization, principal and selected canonical directory member. The member is clearly identified and cannot be switched in this entry point. The dialog still reloads/validates membership and performs the canonical keyed Staff read; stale list snapshots do not bypass duplicate detection.

The normal Add Member entry retains its searchable selector. Allowed initial roles remain MANAGER/Gérant, WAITER/Serveur, CASHIER/Caissier and KITCHEN/Cuisinier. OWNER is not assignable. Outlets remain explicit, optional and non-destructive; the OWNER's selected outlet is never inferred.

## 12. Existing STAFF-2B reuse

No second orchestration was introduced. The same immutable `StaffProvisioningIntent` performs initial role assignment, Staff reread/bind or explicit reactivation, complete assignment reconciliation and precise cache invalidation. Stable command UUIDs, same-role replay, different-role conflict handling and expected versions are unchanged. Existing invitation creation remains an existing generic dialog entry; no invitation administration/list was added.

## 13. Successful transition

The dialog's existing finalization invalidates Staff, detail/assignments and organization-member queries. The candidate component and primary Team observe the same canonical Staff cache. After successful readback, the candidate disappears and Team shows the new row without full-page reload.

Browser fixture: Sènami A. initially available, Configurer opens with that identity, Serveur selected and Fidjrossè explicitly assigned, success closes the dialog, Sènami appears in Team as ACTIVE/Serveur/Fidjrossè and the secondary list becomes empty. The sequence used only local in-memory fixtures, not real permissions or outlet assignments.

## 14. Partial-failure resume

The existing dialog retains unresolved immutable intent and command IDs for “Poursuivre”. Successful role/Staff/assignment steps are reread and reused, never rolled back or duplicated. A role without Staff is described as available for configuration, not as an untouched or pending employee. The Platform initial-role command remains authoritative for same-role continuation versus a conflicting role.

If Staff creation has succeeded but assignment failed, canonical Staff refresh removes the person from the available list. The open dialog can resume; after closing it, Team's assignment action remains the recovery path. Reopening generic Add detects active Staff rather than creating a duplicate. Inactive Staff remains the explicit reactivation path. No role replacement or cross-context transaction is claimed.

## 15. Multi-organization and account isolation

Organization members use existing keys `['identity', org, 'company-members', actorUser]`. Staff remains on the accepted organization-scoped Restaurants key. No placeholder data or derived row state is copied into a new tenant/account. Permission loss immediately hides the component and its actions.

The preselected action captures the current organization and principal. The existing dialog now also captures `contextRevision`, rejecting/closing on context changes even if a user switches away and back before interacting again. Existing before/after-command checks and backend authorization remain in force. Closing the dialog restores focus only in the same authorized organization/principal/revision; subscriptions terminate with the component.

Tests cover BETA-like → CLO-like → BETA-like rows, a non-OWNER account transition, stale dialog submission and shared-cache convergence. Accepted global cross-tab context behavior is unchanged.

## 16. Accessibility and error states

The secondary section has an h2, an expand/collapse button with aria-expanded/aria-controls and a labelled table. Material provides semantic headers, search controls, buttons and dialog focus containment. Configure actions have member-specific accessible labels; names/statuses are readable without color. Existing dialog focus starts on role selection for the locked-member entry; close restores focus to the secondary search even when the candidate button disappeared after success.

Staff verification failure and Platform directory failure are separate inline alerts with retry actions. Neither becomes an empty list. Loading/completeness and empty states use status semantics. Search remains available when an exhausted list is empty. No technical identifiers are visible labels.

## 17. Browser review — 1440 / 900 / 390

Chrome against the existing isolated Angular `scripts/team-review` entry on localhost:4200, entirely synthetic in-memory datasets. Desktop/tablet viewport height 1000; mobile 390×844. No real identity role or assignment was modified, and no fixture changes were deployed.

| Surface / interaction                                      | 1440 | 900  | 390  |
| ---------------------------------------------------------- | ---- | ---- | ---- |
| Existing Team with several roles and ACTIVE/INACTIVE Staff | PASS | PASS | PASS |
| Secondary available-member table and associated search     | PASS | PASS | PASS |
| Preselected Configure dialog                               | PASS | PASS | PASS |
| Canonical post-add Team row and exhausted available state  | PASS | PASS | PASS |
| Readable identity and reachable final-column action        | PASS | PASS | PASS |

Additional observations: `SENAMI` matches “Sènami”; absent search produces the search empty state; primary Team search/status filters do not alter the Staff comparison; paginated Staff blocks candidates until explicit load-more; MANAGER has no new section. Mobile long identity/email wraps, with viewport width and document scroll width both 390. Desktop/tablet measurements likewise matched 1440/900. The mobile candidate action column was adjusted to use the existing full-width stacked-row layout; that final rendering was reinspected. No separate mobile information architecture.

The complete add/assignment transition was exercised at 390; its resulting Team row and empty secondary area were then visually reviewed at 900 and 1440. The general Add flow and existing recovery tests remain intact. Responsive overrides were reset after review; the fixture server was stopped and normal localhost development restored.

## 18. Tests and exact results

| Check                                                                                                                            | Result                                                           |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Initial existing Team/Add regression                                                                                             | 2 files / 58 tests PASS                                          |
| Targeted Team, available members, preselected dialog, Platform member adapter, STAFF-2B intent, capability and route guard tests | **7 files / 118 tests PASS**                                     |
| Full `npm test -w @liass-ohada/frontend -- --watch=false`                                                                        | **144 files / 1,281 Angular tests PASS**, 14.56s Vitest duration |
| Frontend contracts in the same command                                                                                           | **21 PASS, 0 failures**                                          |
| Shared build                                                                                                                     | PASS                                                             |
| Frontend development build                                                                                                       | PASS                                                             |
| Prettier on all task files                                                                                                       | PASS                                                             |
| `git diff --check`                                                                                                               | PASS                                                             |

The full suite preserves tenant/account-switch, current-user access lifecycle, Team filters/search, routing, Service Floor and Accounting regressions. Initial new-test failures were asynchronous observer-notification assertions, corrected by waiting for canonical readback rather than altering application behavior. The final mobile-only column sizing was visually reinspected after the full suite; no test logic or application behavior changed thereafter.

Backend tests/build and CDK synth are not required for this frontend-only lot. No speculative change was made for the known backend Jest memory limitation. No production build is claimed; the required development build is used.

## 19. Files changed

- `SPEC.md`
- `docs/architecture/resto-staff-ux-2-organization-members.md`
- `packages/frontend/public/assets/i18n/en.json`
- `packages/frontend/public/assets/i18n/fr.json`
- `packages/frontend/scripts/team-review/main.ts`
- `packages/frontend/src/app/domains/restaurants/feature/add-staff-dialog.component.html`
- `packages/frontend/src/app/domains/restaurants/feature/add-staff-dialog.component.spec.ts`
- `packages/frontend/src/app/domains/restaurants/feature/add-staff-dialog.component.ts`
- `packages/frontend/src/app/domains/restaurants/feature/available-organization-members.component.html`
- `packages/frontend/src/app/domains/restaurants/feature/available-organization-members.component.spec.ts`
- `packages/frontend/src/app/domains/restaurants/feature/available-organization-members.component.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-team.page.css`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-team.page.html`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-team.page.ts`

## 20. Backend changes

**NO.** No new endpoint, permission, contract, repository, persisted state, migration or backend orchestration.

## 21. Infrastructure changes

**NO.** No AWS/CDK changes, synth or deployment.

## 22. Git status

Branch `main`. The working tree was clean at this lot's start, so the accepted prior lots are preserved as baseline. This lot's 14 files (10 modified tracked files and 4 new files) remain unstaged and uncommitted. No commit, push or deployment was performed. Exact inventory is in section 19.

## 23. RESTO-STAFF-UX-2 result

**PASS**, with the final recorded checks above. Candidate availability is derived from canonical complete Staff data and loaded eligible memberships, never persisted or inferred from partial absence. OWNER-only provisioning and accepted tenant/access behavior are preserved.

## 24. Remaining limitations

- Staff completeness requires explicit additional-page actions for large teams. No automatic unbounded loading, global candidate count or server-wide search is provided.
- The Platform directory does not expose other members' product roles. “Available” means absent from the Staff snapshot; it does not imply no role, no prior provisioning or business intent. Existing role conflicts remain explicit.
- Concurrent changes can make any list snapshot stale. The selected-member canonical check and existing backend commands remain authoritative; an existing active member is not recreated.
- Browser evidence is deterministic fixture validation, not a new live provisioning run. The previously deferred same-storage OWNER/Chrys manual scenario remains outside this lot and unchanged.
- No invitation administration, role replacement, Mon service, Table Workspace, Orders, Kitchen/Preparation workflows, Checkout, Payments or guest ordering was implemented.

## 25. Readiness for the next Restaurants lot

**YES** for a separately requested next lot. No backend/read-model blocker remains for this discovery affordance. This work stops at RESTO-STAFF-UX-2; subsequent operational features have not been started.
