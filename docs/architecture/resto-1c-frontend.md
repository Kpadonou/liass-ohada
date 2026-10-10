# RESTO-1C — Frontend Setup & Menu

Status: **PASS**. RESTO-1D readiness: **YES**, for a separately authorized integrated-validation phase. No RESTO-1D work was performed.

## 1. Repository reconnaissance

Reviewed SPEC.md, repository instructions, liass-platform-architecture, dynamodb-data-modeling and liass-design-system skills; resto-0-foundation.md, resto-1-validation.md, resto-1-domain-api.md; shared/restaurants contracts, backend restaurant routes, KeyFactory, workspace discovery, domain authorization, core product guards/navigation, TanStack Query, Angular standalone features, local Signals, Material theme, Tailwind tokens, Transloco and reusable components. The initial checkout was clean at `0935249`.

Classification: VERTICAL_SOLUTION owned by RESTAURANTS. The existing backend `restaurants` domain authorizes the matching frontend domain. ProductAccess and tenant selection remain existing Platform V2 mechanisms. No parallel platform, entitlement, role store or business model was added.

## 2. Frontend architecture

The existing core restaurant product wrapper hosts routed domain pages. `domains/restaurants/data-access` owns validated requests, responses, queries and permission projection; `feature` owns administration pages/dialogs; `utils` owns exact money conversion and safe errors. Shared page headers, cards, status badges, skeletons, searchable selects, confirmation dialogs and NotificationService are reused. Material components and existing Tailwind tokens provide the visual surface.

## 3. Routes/navigation

- `/restaurants`: lightweight overview.
- `/restaurants/setup`: Restaurant, Locations, Dining Areas, Tables, Kitchen & Bar.
- `/restaurants/menu`: outlet menu, categories, items.

Parent and children retain the existing RESTAURANTS ProductAccess guard under the authenticated tenant shell. Product navigation remains top-level and entitlement-aware; menu/setup links use the applicable read permission. No future operational modules are registered.

## 4. API client/query layer

RestaurantsApi centralizes existing RESTO-1 endpoints. Shared Zod request/response schemas validate data, including bare list envelopes and the opaque QR response. Only an explicit RESTAURANTS_NOT_FOUND for a singleton permits initialization. Access/network/validation failures never masquerade as missing setup.

TanStack Query keys include organization, entity kind, outlet, dining area and category; detail queries add entity ID. Each request captures its organization and rejects a stale scope before HTTP execution. No placeholder data bridges workspaces. Queries use a 60-second stale time, explicit cursor pagination and at most one transient retry; validation and HTTP 4xx failures are not retried. Mutations invalidate only their captured tenant/context collection. Access denial invalidates the existing ProductAccess query. QR identities are not placed in a query cache.

## 5. State-management choices

Signals hold selected outlet, area, category, subsection, pending actions and errors. Selections reset on organization change. Server entities remain TanStack Query state; no Signal Store duplicates them. The existing AuthStore remains the workspace source.

## 6. Restaurant Setup UX

Natural first-time Restaurant initialization, name/status editing and translated guest-ordering policy labels. Disabled, Staff approval and Direct map exactly to existing enums. Policy is configuration only; it implements no ordering behavior.

## 7. Outlet/Area/Table UX

List/create/edit/deactivate locations, dining areas and tables. Parent names are visible; persistence identifiers are never shown. The first active location is selected for the common single-location case; additional locations/pages remain selectable. Tables display code, optional capacity, area, active status and prepared QR identity. Deactivation requires confirmation. Inactive parents suppress child management, preserving backend constraints.

## 8. QR administration UX

OWNER/MANAGER may retrieve and copy the existing opaque token using the protected endpoint. The dialog explains that digital-table access arrives in a later version. No public endpoint, invented guest URL, QR-resolution behavior, dependency or QR image was added. Clipboard failure offers manual copying. The token is cleared and the dialog closes on workspace, role or entitlement loss; delayed responses are discarded.

## 9. Preparation Station UX

Create/edit/deactivate user-named kitchen/bar stations within a location. Item editing selects active stations; an existing selected station is hydrated through the existing detail endpoint even when it is outside the first list page. Optional assignments can be cleared. Internal station IDs never become labels.

## 10. Menu UX

Natural singleton menu initialization per location; required currency at creation and explicit immutable-currency explanation afterward. Menu name editing, category create/edit/deactivate and category-scoped item cards. Item editing covers only supported name, price, preparation station and guest-reorder fields. Availability uses the dedicated operation and is separate from deactivation. No spreadsheet, recipe, modifier, image upload or future business workflow was introduced.

## 11. Price/money handling

Shared canonical `amountMinor` safe integer and currency contracts remain authoritative. Human input is parsed through decimal strings and BigInt, with currency precision from Intl; only an exactly representable safe integer is converted to Number. XOF has zero fractional digits. Grouped `5 000` is accepted; negatives, malformed grouping, excess fractions, exponential notation and overflow are rejected. The existing pure exact-money presentation utility was moved to shared frontend utilities; its SALES path reexports it for compatibility. No SALES business abstraction is used by RESTAURANTS.

## 12. Permission/read-only behavior

The shared existing-role projection grants OWNER/MANAGER both reads and both management permissions. WAITER/CASHIER/KITCHEN receive read-only surfaces without edit/create/deactivate/availability/QR controls. Missing restaurant assignment, a global OWNER role or an accounting-firm workspace grants no restaurant capability. Frontend checks are presentation controls; the existing backend wrapper remains authoritative.

## 13. Conflict/error handling

Requests carry the DTO expectedVersion; create intent carries a stable clientRequestId across retries. HTTP 409 preserves the form, invalidates current data and requires explicit review/retry. An edit refreshes its current version and unchanged fields while retaining the user's changed fields; no silent retry or overwrite occurs. Duplicate table code and inactive-parent conflicts use safe translated review guidance. Validation, malformed response, invalid assignment, missing/inactive parent, access denial and network failures have page/dialog states. Safe backend user messages are preferred except generic conflicts, for which translated refresh guidance is clearer. Pending mutations cannot be double submitted; confirmation-time permission loss prevents submission.

## 14. Responsive/accessibility notes

Responsive card grids, wrapping navigation, stacked selectors and bounded scrolling dialogs support desktop/tablet/mobile. Visual checks used an isolated local copy with HTTP fixtures, not live AWS or integrated backend validation. French overview/setup/menu, tables and item dialog were inspected; widths 390 and 768 had no horizontal document overflow. Read-only WAITER menu was inspected. The shared shell was not redesigned. Labels, semantic buttons, translated action names, focusable/copyable token, Material dialog focus, inline control errors, status/alert announcements and aria-pressed availability follow existing conventions.

## 15. Transloco changes

French/English `RESTAURANTS.UI` keys cover product navigation, configuration labels, policies, forms, empty/loading/error states, confirmations, currency, availability, future reorder helper text and QR administration. Existing other-product translations remain intact. A script contract reads the actual JSON files and checks product-root placement, nonempty values and bilingual key parity.

## 16. Files changed

Backend/shared:

- packages/shared/src/shared/workspace.ts
- packages/shared/src/shared/restaurants-access.ts
- packages/backend/lambda/shared/authorization/domain-permission.ts
- packages/backend/lambda/shared/services/domain-authorization-service.ts
- packages/backend/lambda/shared/repositories/onboarding-repository.ts
- packages/backend/test/unit/identity/restaurants-workspace-projection.test.ts

Frontend:

- packages/frontend/src/app/core/restaurants/restaurants.page.{ts,html,spec.ts}
- packages/frontend/src/app/core/routing/app.routes.{ts,spec.ts}
- packages/frontend/src/app/core/product-access/product-access.guard.spec.ts
- packages/frontend/src/app/domains/restaurants/data-access/restaurants-model.ts
- packages/frontend/src/app/domains/restaurants/data-access/restaurants.api.{ts,spec.ts}
- packages/frontend/src/app/domains/restaurants/data-access/restaurants.queries.{ts,spec.ts}
- packages/frontend/src/app/domains/restaurants/data-access/restaurants-capabilities.{ts,spec.ts}
- packages/frontend/src/app/domains/restaurants/data-access/restaurants.test-fixture.ts
- packages/frontend/src/app/domains/restaurants/feature/restaurants-workspace.page.{ts,html,spec.ts}
- packages/frontend/src/app/domains/restaurants/feature/restaurant-editor.component.{ts,html,spec.ts}
- packages/frontend/src/app/domains/restaurants/feature/restaurant-qr-dialog.component.{ts,spec.ts}
- packages/frontend/src/app/domains/restaurants/utils/restaurant-money.{ts,spec.ts}
- packages/frontend/src/app/domains/restaurants/utils/restaurant-errors.ts
- packages/frontend/src/app/shared/utils/exact-money-display.ts
- packages/frontend/src/app/domains/sales/utils/exact-money-display.ts
- packages/frontend/src/app/shared/ui/searchable-select/searchable-select.component.{ts,spec.ts}
- packages/frontend/public/assets/i18n/{fr,en}.json
- packages/frontend/scripts/restaurants-translations.test.mjs

Documentation: SPEC.md and this report. Existing route files also receive Prettier normalization.

## 17. Backend changes and why

Actual blocking contract defect: `/me/workspaces` omitted existing productRoles, so management visibility could not safely distinguish restaurant roles from global roles. The public workspace schema now accepts the optional existing ProductRoles shape and discovery projects the verified access record's roles. The role-to-permission function was centralized in frontend-safe shared code and reused by existing backend authorization without changing grants. Invalid/missing product roles fail closed while retaining otherwise valid workspaces. No RESTO-1A/1B business semantics, route or new capability changed.

DynamoDB access patterns are unchanged: workspace discovery queries the existing user-workspace GSI (configured GSI6) and BatchGets organizations. KeyFactory remains untouched. No Scan, new key/index/entity, persistence migration or ProductAccess storage was introduced.

AWS infrastructure: no changes. Existing RestaurantsApiStack remains owner of all restaurant endpoints; identity workspace discovery remains in IdentityApiStack. Resources added/replaced: zero. Stateful impact: none. Before/after template counts are unchanged; synth/count/diff were not rerun because no CDK/resource configuration changed in RESTO-1C. Deployment: not performed.

## 18. Tests added/updated

Backend: eight discovery-projection cases cover all five restaurant roles plus missing/invalid assignments; existing full authorization/tenant/API tests remain green.

Frontend: validated HTTP envelopes/paths and expectedVersion; initialization versus denied access; malformed DTO rejection; tenant keys, invalidation, pagination and workspace isolation; role projection; create/edit forms for all eight entities; optional capacity/assignment clearing; exact price input; policy, station and reorder fields; explicit conflict refresh/retry and duplicate code preservation; setup/menu empty/populated/read-only/error states; confirmed deactivation; dedicated availability; QR management denial/copy/delayed scope loss; actual bilingual translations; asynchronous searchable labels without ID exposure. Direct Setup/Menu guard entry and existing ACCOUNTING/SALES route regressions are covered.

## 19. Validation commands and exact results

Commands run with Node v22.22.3 from `/Users/kpadonou/.nvm/versions/node/v22.22.3/bin` on PATH.

| Command                                                                                                                                                                                                                       | Final result                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build -w @liass-ohada/shared`                                                                                                                                                                                        | PASS, exit 0, all shared entry points and declarations                                                                             |
| `npm run build -w @liass-ohada/backend`                                                                                                                                                                                       | PASS, exit 0                                                                                                                       |
| `npm test -w @liass-ohada/backend -- --runInBand`                                                                                                                                                                             | PASS: 151 suites, 1176 tests                                                                                                       |
| `npm test -w @liass-ohada/frontend -- --watch=false --include '**/restaurants/**/*.spec.ts' --include '**/product-access.guard.spec.ts' --include '**/app.routes.spec.ts' --include '**/searchable-select.component.spec.ts'` | PASS: 11 files, 141 tests; 13 script contracts                                                                                     |
| `npm test -w @liass-ohada/frontend -- --watch=false`                                                                                                                                                                          | PASS: 118 files, 894 tests; 13 script contracts                                                                                    |
| `npm run build:development -w @liass-ohada/frontend`                                                                                                                                                                          | PASS, exit 0                                                                                                                       |
| `npm run build -w @liass-ohada/frontend`                                                                                                                                                                                      | BLOCKED, exit 1: missing production `LIASS_COGNITO_REGION`; expected legitimate cdk-outputs.prod.json or LIASS\_\* build variables |
| Scoped Prettier checks, below                                                                                                                                                                                                 | PASS, exit 0                                                                                                                       |
| `git diff --check`                                                                                                                                                                                                            | PASS, exit 0                                                                                                                       |

Frontend Prettier: `npm exec --workspace @liass-ohada/frontend -- prettier --config .prettierrc --check 'src/app/domains/restaurants/**/*.{ts,html}' 'src/app/core/restaurants/*.{ts,html}' src/app/core/product-access/product-access.guard.spec.ts src/app/core/routing/app.routes.ts src/app/core/routing/app.routes.spec.ts 'src/app/shared/ui/searchable-select/*.ts' src/app/shared/utils/exact-money-display.ts src/app/domains/sales/utils/exact-money-display.ts scripts/restaurants-translations.test.mjs`.

Shared/backend Prettier: `node_modules/.bin/prettier --check packages/shared/src/shared/restaurants-access.ts packages/shared/src/shared/workspace.ts packages/backend/lambda/shared/authorization/domain-permission.ts packages/backend/lambda/shared/repositories/onboarding-repository.ts packages/backend/lambda/shared/services/domain-authorization-service.ts packages/backend/test/unit/identity/restaurants-workspace-projection.test.ts`.

No lint npm script is available. Translation JSON is checked by the bilingual script contract; existing formatting outside RESTAURANTS was preserved. The development build retains an esbuild ignored-bare-import warning for a generated shared package chunk marked sideEffects:false; compilation succeeds. One intermediate test run overlapped shared dist cleanup and failed module resolution; rerunning after the shared build completed passed. Test-harness change-detection errors in the new selector tests were corrected. Visual QA caught misplaced translations and a regression contract now prevents recurrence.

## 20. Acceptance-scenario results

PASS at frontend unit/fixture level, not a live integrated RESTO-1D run. The full fixture test displays/manages Héritage Bistro, Agla, Main Room/Terrace, T01–T04, KITCHEN/BAR, STAFF_APPROVAL, Agla Menu/XOF, Main Dishes/Drinks/Desserts and all five specified items. Beer and Bottled Water reorder eligibility is true; the other three are false. Scoped editors, exact prices, expectedVersion and dedicated availability operations are verified. No persistence IDs are visible. Full backend tests establish the unchanged protected contracts; live user/workspace setup is deferred to RESTO-1D.

## 21. Deviations and rationale

Only the optional workspace-role projection contract correction required backend/shared changes. It prevents unsafe frontend permission inference; it adds no business capability. No QR image/library was introduced: the explicitly allowed opaque identity view/copy provides administration without a fictional public URL. A domain-specific common editor covers the small supported configuration forms without a duplicate platform framework.

## 22. Known limitations

QR scanning/printing/public resolution is deferred; opaque identity administration is available. Overview counts are bounded loaded-page counts, marked `+` when more pages exist; no fan-out count/analytics endpoint is added. Station list pages load explicitly; an existing item assignment has independent detail hydration. Role assignment administration remains outside scope. Backend inactive-entity and immutable-currency rules are preserved; no unsupported reactivation/currency-change workflow was invented. Production compilation needs genuine Cognito build configuration. Permission projection is conservative until the corrected workspace response is available, so shared/backend/frontend must be released together through a later authorized workflow. No live browser/API/AWS acceptance claim is made.

## 23. Git status

Branch: `main`. Final status: 17 modified tracked files and 23 new files, all uncommitted and unstaged. Initial checkout was clean. No commit, deployment or external production call occurred. Temporary local visual fixtures/browser tabs/server were cleaned up; no preview authentication mock is included in repository application code.

## 24. RESTO-1C status

**PASS** — authenticated frontend setup/menu administration, permissions, tenant-safe state, concurrency, translations, relevant tests and development compilation are complete. The explicitly permitted production-configuration blocker is recorded above.

## 25. RESTO-1D readiness

**YES** — ready for a separately authorized integrated-validation task. STOP here. RESTO-1D, RESTO-2, RESTO-3 and RESTO-4 have not started. Fiscal Compliance/e-MECeF remains suspended with future continuation at S4C-0B1; no DGI/token/fiscal work occurred.
