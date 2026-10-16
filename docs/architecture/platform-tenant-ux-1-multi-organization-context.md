# PLATFORM-TENANT-UX-1 — Multi-Organization Session & Context Hardening

Date: 2026-10-16. Classification: **PLATFORM_CORE**. Owner: Platform identity/session, tenant context and shell; Restaurants retains ownership of operational context. Frontend-first; no RBAC expansion, persistence migration, business rule, endpoint or infrastructure change.

## 1. Real multi-organization E2E motivation

The user exercised Chrys, one Cognito identity belonging to BETA and CLO COMPTABILITE, switching without logout. In BETA, explicit RESTAURANTS WAITER, RestaurantStaff and outlet assignment enabled Service en salle and responsibility on occupied tables. This report distinguishes that user-supplied evidence, source inspection, automated fixtures and observations performed during this audit.

## 2. Canonical active-organization model

One authenticated identity may have multiple independent memberships. An active organization resolves its own ProductAccess, member productRoles and operational authorization. Persisted organization identifiers are selection hints; workspace discovery must validate them before tenant use. ProductAccess never grants a member role.

## 3. Multi-tab model decision

**Model A: global across tabs sharing the same browser storage origin/context.** Existing code persists active workspace and cabinet dossier in localStorage and uses Amplify's shared Cognito session; it contains no tab-local organization storage or URL tenant model. SPEC previously did not explicitly define multi-tab behavior. This decision preserves those storage contracts and makes their coordination explicit. Normal and Incognito Chrome have separate storage contexts and do not synchronize with each other.

Previously, each tab retained its own SignalStore copy while overwriting the other's shared persisted selection. There was no storage-event synchronization. After hardening, external organization, dossier or Cognito principal changes synchronously invalidate protected local state and replace the location with `/dashboard`, allowing authentication, discovery and guards to establish the new canonical destination. A tab must not silently continue independent operations.

## 4. Authentication identity state

`AuthStore.user` contains Amplify's AuthUser; `currentUserId` derives from `userId`. Amplify owns token/session persistence. Hydration uses getCurrentUser, fetchAuthSession and profile claims. Profile attributes are in memory. A changed principal now clears memberships, dossiers and every query/mutation cache. Authentication/profile requests capture a context revision; outdated completion cannot restore an old principal.

## 5. Active organization state

`activeOrgId` is the selected workspace; `effectiveOrgId` is the COMPANY organization or verified selected cabinet dossier. `activeWorkspace` finds the membership by activeOrgId. `liass-ohada.activeOrgId` and `liass-ohada.activeDossierOrgId` are localStorage values shared across tabs. Memberships, roles and dossiers are not persisted by AuthStore. Reload rehydrates Cognito, discovers memberships and validates selection. No Restaurants outlet/area localStorage or sessionStorage persistence was found; its operational selection is component Signals and URL query parameters.

## 6. ProductAccess scoping

ProductAccessQueries uses `['product-access', effectiveOrgId]`, gated by authenticated identity, discovered workspaces and effective organization. The API validates the response organization. ProductAccessState derives availability from that query. Organization switch removes tenant caches, now including ProductAccess. Account invalidation clears the entire QueryClient. ProductAccess is organization data; user separation is enforced by complete account cleanup and captured-request fencing rather than changing its organization key.

## 7. Product-role scoping

WorkspacesApi parses optional productRoles from `/me/workspaces`. RestaurantsCapabilities resolves only the active direct COMPANY membership whose orgId matches effectiveOrgId. No global OWNER or another product's role grants Restaurants authority. Shell workspace switching now refreshes memberships before selecting the destination and rejects completion after a context revision change. Entitlements and roles remain separate. Accounting was inspected as a cache/UI comparison, never used as an RBAC template.

## 8. Query-key audit

| Surface                           | Existing scope                                                   | Assessment                                                                         |
| --------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Workspaces/memberships            | AuthStore memory, pre-tenant authenticated request               | Principal and revision checks now reject late discovery; reset on account change   |
| ProductAccess                     | organization                                                     | Correct organization key; account-wide purge was incomplete and is fixed           |
| Company member directory          | organization + authenticated user + cursor page                  | Already isolated                                                                   |
| Restaurants Team                  | organization + cursor page                                       | Correct tenant scope; account change now purges all caches                         |
| Staff detail/candidate            | organization + subject user                                      | Subject identity differs from authenticated actor; actor caches purged on change   |
| Staff outlets                     | organization + subject user + cursor page                        | Correct                                                                            |
| My service outlets                | organization + authenticated user + cursor page                  | Already correct; no key change required                                            |
| Service Floor                     | organization + outlet + cursor page                              | Correct tenant/parent scope; account purge and request fence protect actor changes |
| Guest session                     | organization + outlet + session                                  | Correct parent scope; same actor cleanup                                           |
| Configuration collections/details | organization + kind + outlet + area + category + optional entity | Parent-aware and tenant-aware                                                      |
| Accounting                        | effective organization + resource/filter/fiscal context          | Comparison only; existing query tests retained                                     |

QueryClient is created once per application runtime in app.config.ts. No query-cache persistence plugin was found. Tabs have separate in-memory clients. TanStack Query stores late results under captured keys; the HTTP fence additionally rejects obsolete results/errors before component-local consumers receive them.

## 9. Self-context isolation

`restaurantKeys.myOutlets(org, user)` already includes both required dimensions. RestaurantsApi checks expected organization and expected authenticated user before and after the request. OrganizationMembersQueries also includes actor identity. Existing same-organization user-change tests and the new account-switch tests preserve this separation.

## 10. Organization-switch behavior

The workspace selector remains canonical; no sign-out is required. The topbar re-discovers memberships, verifies the initiating context still applies, selects the refreshed membership, clears the dossier and tenant caches, and navigates to `/dashboard` or `/cabinet/dashboard`. Product queries and role capabilities then resolve for the destination. A monotonic context revision fences A → B → A async completions. Restaurant configuration now also resets selection on account changes, and open dialogs close when the platform context is invalidated or switched.

## 11. Account-switch behavior

Logout invalidates identity/tenant/caches immediately, before awaiting signOut; final cleanup removes persisted selections. Every query root and the mutation cache are cleared, including Restaurants, Sales, Identity and ProductAccess. Hydration/profile/login detecting another principal uses the same reset. The HTTP interceptor checks the access-token subject against captured identity before transmission. Same-organization account switches cannot reuse OWNER caches or self-context.

## 12. Two-tab observations

Automated storage-event tests cover organization, dossier, Cognito LastAuthUser and full storage clearing; they verify invalidation occurs before refresh and prepared dialogs close. An interceptor test changes persisted organization before storage-event delivery and proves a prepared mutation is blocked before credentials or HTTP transmission. Actual two-tab testing with Chrys confirmed both tabs converge on CLO after switching B from BETA, and both return to BETA after the reverse switch. See section 22.

## 13. Deep-link safety

Service Floor queries areas/floor only after the selected outlet resolves within the active tenant's allowed outlet collection (self-assigned collection for WAITER). Foreign management outlet links now clear outlet/area and show the existing context error. Existing WAITER tests cover rejected assignments. Configuration pages gate child collections on a resolved active-tenant outlet and area, with contextUnavailable for foreign/stale parents. Team has no organization selector in its URL; subject member/outlet requests remain tenant-scoped. Configuration collection pagination is bounded; an unloaded parent remains unavailable rather than being treated as globally valid.

## 14. Late-response safety

The interceptor captures principal, effective organization, workspace, persisted selection and context revision before fetching credentials. It rechecks before dispatch and on returned events, including successful mutation responses. Obsolete errors cannot invoke authorization recovery or redirect the next organization. Workspaces/dossiers/profile completion also compare captured context before patching Signals. Existing real-handler HTTP integration covers collections switching organizations and late invalidation; Service Floor covers reads and opening feedback after switch.

## 15. Mutation safety

Restaurants APIs already validate captured organization before writes; self APIs additionally validate actor. Dialogs now capture original actor and refuse submission after a same-organization principal change. Shared platform context changes close open dialogs. Header workspace context is captured rather than read again after credentials resolve. If a command was already transmitted under A, server completion may still commit in A; the frontend does not claim to cancel a server commit. Its obsolete result cannot update B, and no stale intent is silently retargeted to B.

## 16. Product-switch behavior

Workspace switch always chooses the platform destination instead of retaining a product URL. ProductAccess recomputes by organization; capability resolution uses the active membership. The switcher is currently a mixture: ACCOUNTING and RESTAURANTS reflect organization availability; SALES additionally requires member read capability. Thus Restaurants may appear for an entitled organization even when its member has no Restaurants role. This ambiguity is documented for RESTO-ACCESS-UX-1; protected capability remains denied. No role-specific landing or access-lifecycle page was implemented. The real WAITER landing still presents configuration-oriented text/links although management navigation is absent; this is existing RESTO-ACCESS-UX-1 UX scope, with server authorization unchanged.

## 17. Backend tenant-isolation evidence

The passing Angular real-HTTP integration suite invokes production handlers/services/repositories against memory DynamoDB. It rejects missing auth/tenant, wrong membership, foreign resource IDs, forged body/query tenant and foreign cursors, including an organization-B request for organization-A outlet returning 404. Existing backend authorization, waiter-service-access, service-floor and staff tests also explicitly cover foreign organization/outlet and revoked assignment cases. Separate Jest execution was attempted; results/limitations are in section 21. Backend remains authoritative; frontend checks are additional safeguards.

## 18. Defects found

- Shared organization persistence had no cross-tab synchronization.
- Logout's fixed root list omitted Restaurants, Sales, Identity and ProductAccess, allowing account-sensitive cache retention.
- A credential fetch could complete after a context/account change without a platform-wide request fence; obsolete errors could affect the new context.
- Late workspace/dossier/profile requests could patch a later context.
- Configuration dialogs checked product/organization but did not capture the initiating account.
- Management Service Floor foreign outlet links stayed unresolved without clearing their operational URL context.
- Workspace switching reused discovered roles without refreshing memberships.
- The membership refresh temporarily replaced a known workspace label with a placeholder (and a literal null in the cabinet accessible label). The current verified label is now retained until selection changes.

## 19. Fixes made

BrowserSessionContext coordinates shared storage changes with invalidation and canonical refresh. AuthStore adds context revision, complete principal cleanup, broader tenant-root cleanup and async state checks. The interceptor validates captured context and JWT subject and suppresses stale authorization recovery. The topbar refreshes membership before switching and retains the verified current label during that refresh. Restaurant dialogs capture actor identity; configuration resets on organization/account change; Service Floor clears a foreign outlet context. No concrete self-query key defect was found, so those keys were preserved.

## 20. Canonical framing updates

The existing SPEC frontend/platform section now explicitly defines many memberships per identity, organization-scoped product roles, org+user self-query keys, context revalidation, stale-link and async isolation, and global multi-tab behavior. Permanent rules were added there instead of duplicating them in AGENTS.md or a new guidance file. This report is audit evidence, not a second specification.

## 21. Tests and exact results

- `npm test -w @liass-ohada/frontend -- --watch=false`: **140 files / 1,233 tests passed** in the first successful complete run; final rerun results below, frontend contracts **21 passed**. Covers Platform/ProductAccess, guards/routes, Restaurants queries/capabilities, Service Floor, Team, forms, real-handler HTTP integration and Accounting regression.
- Additional final targeted run (auth store, interceptor, Service Floor): **3 files / 103 tests passed**, including four subsequently added principal-switch/foreign-link assertions.
- Earlier focused platform/auth/storage/real-HTTP run: **4 files / 74 tests passed**.
- Shared build: **PASS**, JS and declarations.
- Angular development build: **PASS**. Two shared-package side-effect warnings; no Angular compilation failure.
- Direct production `ng build --progress=false`: **BLOCKED**, missing `environment.production.generated.ts` required by the repository's production configuration workflow. No production configuration was invented.
- Backend targeted Jest: default and 8 GiB heap runs aborted with Node heap exhaustion before results; an isolatedModules command-line attempt also aborted. No backend runtime/configuration source was changed to bypass this limitation. Production-handler tenant proof is supplied by the passing Angular HTTP integration above.
- Backend build / CDK synth: not applicable, backend and infrastructure unchanged.
- Final `npm test -w @liass-ohada/frontend -- --watch=false`: **140 files / 1,238 tests passed**, contracts **21/21 passed**; Vitest duration 16.37 s. This includes the final label-retention change and all added assertions.
- Final `npm run build:development -w @liass-ohada/frontend`: **PASS** (same two shared-package side-effect warnings).
- Targeted topbar regression after retaining the workspace label during refresh: **1 file / 33 tests passed**.
- Prettier check on all changed/new files: **PASS**. `git diff --check`: **PASS**.

| Required scenario                     | Automated evidence                                                                     | Real browser evidence                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Chrys BETA → CLO → BETA               | Role/capability fixture and tenant query integration pass                              | PASS: products, sidebar and canonical destination update                                               |
| BETA OWNER → Chrys → OWNER            | Both login orderings and full cache cleanup pass                                       | DEFERRED, explicitly non-blocking by user instruction; separate sessions are not claimed as proof      |
| WAITER in A, no Restaurants role in B | Explicit capability recalculation test passes                                          | CLO is a cabinet context with no Restaurants navigation; two-COMPANY/no-role variant is fixture-tested |
| Two tabs BETA / CLO                   | Storage-event and before-event mutation fence tests pass                               | PASS: switching B refreshes A to the canonical global context                                          |
| Stale BETA outlet URL under CLO       | Foreign-link and real-handler foreign-resource tests pass                              | PASS: Service and Tables saved URLs recover to CLO; no BETA data shown                                 |
| Late BETA request after switch        | GET/POST A → B → A fence, collection/Floor tests pass                                  | Controlled browser network delay not performed; automated evidence only                                |
| Mutation intent after context change  | Before-storage-event block, credential-wait block and original-actor dialog tests pass | PASS: prepared CLO form is destroyed when the other tab switches; no write sent                        |

## 22. Browser observations

Chrome extension automation twice failed with `Unable to load browser request-header policy`; native Chrome accessibility control remained available. Normal Chrome: SENAKPON REMI KPADONOU, BETA, OWNER navigation with Team/configuration and occupied tables; protected Service Floor reload restored the correct BETA context. User confirmed a separate Chrys Incognito window; it displayed only Service en salle navigation and BETA tables/assigned outlet before reload. A transient development overlay after rebuilding shared declarations required restarting the dev server; no source workaround was applied.

Actual checks performed in the shared Chrys Incognito context:

1. Opened a second Service Floor tab with the same BETA outlet/area URL. Both showed only the WAITER Service navigation, the assigned LP-3 outlet and the BETA occupied tables.
2. Switched tab B to CLO COMPTABILITE. B landed at `/cabinet/dashboard`; switching focus to A showed that A had independently refreshed into that same CLO dashboard. No BETA tables or Restaurants navigation remained. Normal Chrome OWNER/BETA was unaffected, as expected for separate storage contexts.
3. While CLO was active, opened the saved BETA Service URL with outlet and area, then the saved `/restaurants/setup/tables` URL with those same IDs. Each recovered to `/cabinet/dashboard`; no BETA outlet/area/table data was displayed.
4. Switched CLO → BETA without signing out. The destination was `/dashboard`; the product menu showed Accounting and Liass-Resto. Reopening Liass-Resto restored only Service navigation for Chrys, and Service en salle loaded the authorized outlet. Historical Back/Forward navigation retained BETA; an old cabinet destination recovered to the current platform destination instead of changing organization.
5. Repeated the switch to CLO, opened Nouveau travail, typed a test title without submitting, then switched the other tab to BETA. The prepared form's tab refreshed to `/dashboard`; the title/form/Create control no longer existed. No business mutation was sent. The automated request-boundary tests separately prove a stale request cannot transmit even before storage-event handling.
6. Protected BETA Service reloads worked for OWNER in normal Chrome and WAITER in Incognito. Saved protected links rehydrated and recovered safely under CLO.
7. Reviewed native Chrome responsive screenshots at **1440 × 900**, **900 × 900**, **390 × 900**. Workspace/product controls stayed visible and legible; the 390 workspace menu showed BETA and CLO correctly within the viewport. Existing responsive sidebar and stacked floor cards were preserved. No styling/theme/control redesign was made. Device emulation and test DevTools were closed afterward.

The normal OWNER and Incognito Chrys sessions were preserved. The live same-storage OWNER → Chrys → OWNER sequence was **not** performed: the user explicitly deferred it as a non-blocking residual E2E check. No password was requested or handled. Controlled late-response behavior is covered by automated collection, floor and mutation tests; browser network throttling was not used and no live write was submitted.

## 23. Files changed

Changed files:

- `SPEC.md`
- `docs/architecture/platform-tenant-ux-1-multi-organization-context.md`
- `packages/frontend/src/app/app.ts`
- `packages/frontend/src/app/core/auth/browser-session-context.spec.ts`
- `packages/frontend/src/app/core/auth/browser-session-context.ts`
- `packages/frontend/src/app/core/http/auth.interceptor.spec.ts`
- `packages/frontend/src/app/core/http/auth.interceptor.ts`
- `packages/frontend/src/app/domains/identity/data-access/auth.store.spec.ts`
- `packages/frontend/src/app/domains/identity/data-access/auth.store.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurants-capabilities.spec.ts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurants-http.integration.spec.ts`
- `packages/frontend/src/app/domains/restaurants/feature/responsible-staff-dialog.component.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-editor.component.spec.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-editor.component.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.spec.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurants-workspace.page.ts`
- `packages/frontend/src/app/shared/layout/app-topbar/app-topbar.component.spec.ts`
- `packages/frontend/src/app/shared/layout/app-topbar/app-topbar.component.ts`

AuthStore and its spec also receive Prettier normalization; the resulting formatting diff is larger than the behavioral patch.

## 24. Backend changes

**NO.** No handlers, authorization rules, role projections, persistence, endpoints or backend tests modified.

## 25. Infrastructure changes

**NO.** No resource additions/replacements, stateful impact, CDK changes, synth, diff or deployment.

## 26. Git status

Initial checkout was clean. Changes remain uncommitted; no commit or deployment performed. All changed paths are listed in section 23; no backend or infrastructure path is modified. This report and the two BrowserSessionContext files are untracked until the user chooses to commit.

## 27. PLATFORM-TENANT-UX-1 PASS / FAIL

**PASS**, subject to the explicitly accepted residual manual account-switch check and the validation limitations listed above. The mandatory real two-tab/multi-organization checks were performed. The user explicitly authorized finalizing on the passing automated account-switch tests without claiming manual validation of that precise scenario.

## 28. RESTO-ACCESS-UX-1 readiness

**YES**. Multi-organization hardening is complete within the agreed verification scope. No deferred Restaurants feature has been started.

## 29. Remaining blockers

No implementation blocker remains. Residual non-blocking manual E2E: perform OWNER → logout → Chrys → logout → OWNER in one disposable browser profile without clearing storage, as explicitly deferred by the user. Controlled late-response scenarios have automated evidence, not a live network-delay claim. Standalone backend Jest runs exhaust heap; the real-handler Angular HTTP suite supplies tenant proof. A production-mode build still requires canonical production configuration; the development build is validated. The development server remains on `http://localhost:4200`. No deployment or commit was performed.
