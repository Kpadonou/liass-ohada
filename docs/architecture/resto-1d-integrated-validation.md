# RESTO-1D — Integrated Validation + Permanent Frontend Guardrails

Validation date: 2026-10-11. Scope: Restaurant Setup and Menu integration, small frontend compliance corrections and permanent guidance. RESTO-2 is not started.

## 1. Repository starting state

Branch `main`, HEAD `cbc71b1` (`fix(shell): align product dashboards and restaurant labels`); working tree initially clean. Existing RESTO-0, RESTO-1A/B/C, onboarding, restaurant shell and product-dashboard work were inspected rather than rebuilt. Canonical product code remains `RESTAURANTS`; commercial name remains Liass-Resto.

Sources inspected include root `SPEC.md`/`AGENTS.md`; the platform, DynamoDB and design-system skills; design principles/tokens/component/interaction/page references; RESTO-0/1 validation/domain/API/frontend reports; recent restaurant UX and product-dashboard reports; shared contracts; production route registry/handler/service/repository/KeyFactory; frontend API/query/capability/guard/shell/form code and existing tests.

The feature is a RESTAURANTS vertical validation task. Existing organization, ProductAccess, role projection, domain ownership and shared infrastructure remain authoritative.

## 2. Permanent framing files updated

The design rules principally belong to `.agents/skills/liass-design-system/SKILL.md`. Its existing component, interaction and UI-principles references were updated minimally. Root `AGENTS.md` links to that contract instead of duplicating the detailed charter. No parallel design-guide file was created.

## 3. UI/form rules codified

The skill now explicitly requires prior design reconnaissance; visual consistency as part of completion; semantic Material controls; typed Reactive Forms and configured validators for business forms; translated control-state errors; checkbox for form-saved booleans; toggles for immediate activation; genuine validated Material steppers; Material interaction semantics and Tailwind layout responsibilities; meaningful states, responsiveness and keyboard/focus verification.

Per user clarification, standalone context selectors and simple UI selections may use `ngModel` with Signals. This does not turn context selection into a business form. Restaurant context selectors retain their existing bindings.

Per user direction, product sections/subsections belong in the existing contextual sidebar, with permission-aware entries and the existing mobile drawer. Pages retain their current context filters and business actions. Do not duplicate sidebar navigation or accumulate module menus inside pages.

## 4. Integrated-validation strategy

The added regression suite exercises real Angular API methods and shared Zod schemas through loopback HTTP, production RESTAURANTS handlers, platform authorization, domain services, repositories and the existing memory DynamoDB SDK harness. It also observes real TanStack queries and rendered Angular pages/dialogs. These boundaries are not replaced with mocked API results.

Infrastructure and identity provisioning are fixtures: Cognito session acquisition/JWT authorizer claims and workspace membership/roles/entitlements. Permission resolution and tenant/ProductAccess verification inside production wrappers execute normally.

## 5. Local runtime/test architecture

No established local restaurant HTTP runner existed. The repository did have an atomic in-memory DynamoDB test harness and a LocalStack setup script. The smallest extension is a test-only Node HTTP adapter listening on `127.0.0.1` with an ephemeral port, launched and stopped by Vitest global setup.

The adapter dispatches from the existing `RESTAURANTS_ROUTES` registry and also exposes the existing production `GET /me/product-access` handler. It supplies simulated authorizer claims, real tenant/language headers, bodies, parameters and cursors. Test-only controls reset fixtures, record SDK/route calls and inject malformed responses or network failures. They are not deployed or part of the production route registry.

The SDK mock intercepts the DynamoDB client; Scan attempts throw. No AWS credentials, deployment, external identity login, live AWS or DGI call is required. The existing memory harness was extended only to accept the canonical finite ProductAccess-prefix Query used by the identity repository.

## 6. Frontend/backend contract verification

An automated coverage test calls every one of the 38 registered RESTO-1 operations using `RestaurantsApi`, then compares observed canonical route names against the production registry. Incorrect methods, paths or route parameters fail dispatch; incompatible request/response shapes fail shared schemas or production handler validation. Singleton, collection/detail, lifecycle, availability and QR response envelopes all pass.

Versions remain in request bodies. Lists use `limit=50` and `cursor`, with bare `items`/`nextCursor` responses. No duplicate route registry or contract model was introduced.

## 7. ProductAccess results

Real `/me/product-access` responses feed the frontend ProductAccess query/state. RESTAURANTS entitlement permits navigation and setup/menu reads. An organization without that entitlement has no restaurant product entry, receives the existing guard redirect and gets server-side 403 on direct calls. Scoped business roles do not grant ProductAccess by themselves.

## 8. RBAC results

| Role    | Setup/Menu reads | Management controls | Direct mutation | QR retrieval |
| ------- | ---------------- | ------------------- | --------------- | ------------ |
| OWNER   | Allowed          | Present             | Allowed         | Allowed      |
| MANAGER | Allowed          | Present             | Allowed         | Allowed      |
| WAITER  | Allowed          | Hidden              | 403             | 403          |
| CASHIER | Allowed          | Hidden              | 403             | 403          |
| KITCHEN | Allowed          | Hidden              | 403             | 403          |

The existing shared permission map and workspace product-role projection govern frontend capabilities and backend authorization. No parallel role checks or SALES/ACCOUNTING grants were added.

## 9. Tenant-isolation results

Missing authentication fails with 401; missing tenant header with 400; foreign membership with 403. Forged body/query `orgId` does not change the verified tenant. Foreign entity identifiers cannot read or mutate another organization. An API call using a stale frontend scope fails before dispatch. Organization B loads independently from A.

## 10. Restaurant workflow results

The integrated fixture creates Héritage Bistro through the actual Angular client and production handlers, then reads it back. Default guest policy is `STAFF_APPROVAL`. Updating it to `DIRECT` sends the loaded version, increments the version and refreshes the rendered/query state after invalidation. The real Restaurant editor is also exercised, including retry after a committed create response is lost.

## 11. Outlet/Area/Table results

Agla, Main Room, Terrace and T01–T04 are created and read through the same HTTP path. Tables appear under their selected area, with operational codes and optional capacity. Create/update/lifecycle contracts are covered for outlets, areas and tables. Duplicate T01 returns conflict and leaves the original table unchanged; the form preserves entered values for review/retry. Existing regression tests cover optional capacity and inactive-parent behavior.

## 12. QR administration results

OWNER/MANAGER retrieve the protected 43-character opaque identity; staff are denied. The real QR dialog shows the table code, token and future-feature explanation without exposing persistence IDs or inventing a public URL. Create retries preserve the table and QR identity. Existing backend tests additionally resolve tokens internally to the correct table and test inactive/invalid identities.

There is no public resolver or guest route. Unregistered public-resolution attempts return 404. QR rendering/scanning remains outside this phase; the existing copyable token administration is retained.

## 13. PreparationStation results

KITCHEN/BAR assignment survives the shared-contract/HTTP/persistence/read-back path. Missing and foreign-outlet assignments fail; inactive assignment fails according to existing backend semantics. Historical item references remain intact. Explicitly clearing an assignment is supported through the canonical request. The frontend uses a genuine Material select while preserving paginated options and selected-reference hydration.

## 14. Menu workflow results

Agla Menu initializes in immutable XOF. Main Dishes, Drinks and Desserts contain the five established items. Chicken/plantain use KITCHEN; water/beer use BAR; cake has no station. Beer and Bottled Water allow guest reorder; the other three do not.

Rendered items show prices, stations and reorder status. The dedicated availability operation independently changes temporary availability and refreshes the query/UI. Item/category lifecycle contracts pass; historical reorder/assignment values remain available after deactivation. No ordering, execution, payment or integration domain was added.

## 15. Reactive Forms / Angular Material compliance audit

All eight entity editors already shared an inferred typed Reactive Form. Name/code/capacity/currency/price use Material fields; policy/initial availability use Material selects. Corrections are limited to:

- Material checkbox for booleans saved with the form: restaurant active state and guest reorder.
- Material select mode in the existing shared reference component for preparation station and location/area context; existing autocomplete consumers keep their default behavior.
- Configuration validators for whitespace-only name, optional integer capacity, currency and canonical price input, driving inline errors.
- `subscriptSizing="dynamic"` in editor fields so translated multiline hints/errors occupy their real height on mobile.

Context selectors retain `ngModel`/Signals by explicit user clarification. They are independent of business forms. No cosmetic stepper was added. Existing retry/version/currency/domain semantics remain unchanged.

## 16. Visual-charter compliance audit

The actual current shell and seven restaurant destinations were inspected in a local browser: Dashboard, Restaurant, Établissements, Espaces de restauration, Tables, Postes de préparation and Menu. Product context stays in the topbar; the sidebar owns section navigation. Dashboard shortcut cards remain contextual overview actions; normal setup/menu pages contain no second module-navigation bar.

Approved headers, cards, primary actions, compact row menus, labels and responsive composition are preserved. Desktop inspection used the normal 1512px viewport; Menu was checked at 900px and Menu/Tables/dialog/drawer at 400px. Mobile drawer selection navigates and closes the drawer. No theme, token, shell layout or product-navigation redesign was made.

The mobile Table editor exposed a wrapped hint overlapping capacity. Dynamic Material subscript sizing fixes this: measured hint bottom 491px and following field top 507px, leaving 16px space. Keyboard opening/closing of the station select and negative-price inline error were observed. This is a focused audit, not a full assistive-technology certification.

## 17. Money roundtrip results

Real Reactive Form price inputs of 500, 1,000, 1,500 and 5,000 XOF produce exact canonical integer `amountMinor`, shared validation, persistence and read-back. Formatting remains the existing money helper. Negative input fails; values beyond safe integer bounds fail; the allowed maximum-safe integer roundtrip remains exact. No floating-point persistence or new formatting system was introduced.

## 18. Optimistic concurrency results

A real Table editor loads version N; another HTTP update produces N+1. Its stale mutation is rejected with 409. The dialog remains open, displays conflict/review UX, refreshes current data while preserving intended edits, then succeeds on an explicit retry with the new version. No silent overwrite occurs.

## 19. Idempotency results

Same create request identifier and intent returns the same Restaurant, Menu or Table/QR result without adding rows; changed intent under that identifier is rejected. The real Restaurant dialog also handles a socket drop after persistence, keeps its logical create request and retries without creating a second Restaurant. User review/edit creates a new intent only under the existing frontend behavior.

## 20. Query-cache isolation results

Keys retain `['restaurants', org, kind, outlet, area, category]`. Organization switching clears local context selections and changes query scope immediately. A's item/menu content does not remain in B; late invalidation of A does not populate B; switching back restores A predictably. Mutation invalidation refreshes the correct scoped data. Server entities were not copied into a Signal Store.

## 21. Error-mapping results

Tests cover missing/foreign parents, validation, ProductAccess/RBAC denial, duplicate/version conflict, invalid station assignment, transport failure and malformed response. Zod rejects malformed HTTP DTOs; normalized restaurant errors provide the existing safe UI keys/messages. Empty singleton 404, pending fetch and genuine failure stay distinct. Forms retain input on recoverable errors. No persistence keys, AWS errors or stack traces are exposed in user-facing messages.

## 22. Pagination results

51 preparation stations produce a first page of 50 and a second page of one. TanStack accumulation contains all 51 unique rows without duplication. Cursors from another collection/tenant are rejected; foreign-parent access also fails independently. Existing bounded load-more UX is retained; no infinite scrolling was introduced.

## 23. No-Scan verification

Production restaurant source contains no `ScanCommand`/`.scan(` matches. Existing backend architecture tests remain green. The test adapter registers a throwing Scan mock and counts calls; integration stats assert zero Scans, positive GetItem and Query usage. This test-only forbidden-command detector is not a production Scan implementation.

Production keys, exact QR lookup, bounded restaurant Queries and conditional transactions still use existing KeyFactory methods. No persistent entities, index formats or migration were added.

## 24. API route-consumption audit

| Entity             | Frontend API operations validated                 | Registry count |
| ------------------ | ------------------------------------------------- | -------------: |
| Restaurant         | Create/read/update singleton                      |              3 |
| Outlet             | Create/list/detail/update/deactivate              |              5 |
| ServiceArea        | Create/list/detail/update/deactivate              |              5 |
| RestaurantTable    | Create/list/detail/update/deactivate/QR           |              6 |
| PreparationStation | Create/list/detail/update/deactivate              |              5 |
| Menu               | Create/read/update singleton                      |              3 |
| MenuCategory       | Create/list/detail/update/deactivate              |              5 |
| MenuItem           | Create/list/detail/update/deactivate/availability |              6 |
| **Total**          | **All registered RESTO-1 operations**             |         **38** |

All operations have a frontend API method and are invoked by the coverage regression. Detail reads are also available for conflict refresh/reference hydration rather than requiring separate detail screens for each entity. Route registry equality is asserted dynamically, so adding a route requires deliberate contract coverage. No dead or mismatched route was discovered; none was deleted. Platform ProductAccess discovery is additionally exercised outside this count.

## 25. Defects discovered and fixes applied

Frontend compliance issues: form-saved toggles and reference autocomplete where Material selects were required; validation placement for price/capacity; multiline mobile hint overlap. Fixed in the existing components with regression coverage and browser confirmation.

Context `ngModel` is explicitly accepted for standalone local UI selections and was not treated as a defect. Existing sidebar organization already satisfies the user's navigation guidance. No production backend contract defect was found.

## 26. Files changed

Existing:

- `AGENTS.md`
- `.agents/skills/liass-design-system/SKILL.md`
- `.agents/skills/liass-design-system/references/liass-component-guidelines.md`
- `.agents/skills/liass-design-system/references/liass-interaction-patterns.md`
- `.agents/skills/liass-design-system/references/liass-ui-principles.md`
- `packages/backend/test/unit/restaurants/memory-dynamo.ts`
- `packages/frontend/angular.json`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-editor.component.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-editor.component.html`
- `packages/frontend/src/app/domains/restaurants/feature/restaurant-editor.component.spec.ts`
- `packages/frontend/src/app/domains/restaurants/feature/restaurants-workspace.page.html`
- `packages/frontend/src/app/shared/ui/searchable-select/searchable-select.component.ts`
- `packages/frontend/src/app/shared/ui/searchable-select/searchable-select.component.html`
- `packages/frontend/src/app/shared/ui/searchable-select/searchable-select.component.spec.ts`

New:

- `packages/backend/test/integration/restaurants/http-server.ts`
- `packages/frontend/scripts/restaurants-integration.setup.mjs`
- `packages/frontend/vitest.config.mts`
- `packages/frontend/src/app/domains/restaurants/data-access/restaurants-http.integration.spec.ts`
- `docs/architecture/resto-1d-integrated-validation.md`

The temporary browser bootstrap was removed; preview/evidence files remain outside the repository.

## 27. Infrastructure impact

Production backend, shared contracts and CDK code are unchanged. Existing owning nested stack: `RestaurantsApiStack`. Resources added/replaced: zero; stateful-resource impact/migration: none. No Cognito pool, table, secrets, API or nested stack was created. No domain route was added.

CDK synth/resource-count are not rerun: backend modifications are test-only and do not alter production assets or templates. Before/after template counts are therefore not newly measured. Cloud diff and deployment were not run; no live AWS call was made.

## 28. Tests added/updated

The new integrated suite contains 16 tests, including five parameterized role cases. It proves all 38 routes, real fixture workflows, entitlement/RBAC, tenant isolation, QR, canonical money, stale versions, create idempotency/lost response, station integrity, pagination, cache isolation and errors.

Restaurant editor regression covers selects, form-saved checkboxes, configured price validation and accessible inline error association. Shared select regression covers actual Material select, growing-list filtering and preserved selected business label. Existing restaurant/backend/shell/accounting/sales suites remain green.

## 29. Validation commands and exact results

Commands use Node v22.22.3 available at `/Users/kpadonou/.nvm/versions/node/v22.22.3/bin`.

| Command                                                                                                                                                          | Result                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `npm run build -w @liass-ohada/shared`                                                                                                                           | Exit 0; CJS, ESM and declarations built                                 |
| `npm run build -w @liass-ohada/backend`                                                                                                                          | Exit 0; TypeScript compilation passed                                   |
| `npm test -w @liass-ohada/backend -- --runInBand`                                                                                                                | Exit 0; 153 suites, 1,236 tests passed                                  |
| `npm exec --workspace @liass-ohada/frontend -- ng test --watch=false --include '**/restaurants/**/*.spec.ts' --include '**/searchable-select.component.spec.ts'` | Exit 0; 11 files, 139 tests passed                                      |
| `npm test -w @liass-ohada/frontend -- --watch=false`                                                                                                             | Exit 0; 20 script contracts passed; 124 Angular files, 982 tests passed |
| `npm run build:development -w @liass-ohada/frontend`                                                                                                             | Exit 0; development application built                                   |
| Prettier `--check` on all changed/new files                                                                                                                      | Exit 0; all checked files conform                                       |
| `git diff --check`                                                                                                                                               | Exit 0; no whitespace errors                                            |
| Production restaurant source Scan search                                                                                                                         | No matches                                                              |

The targeted run passed with the final inline-error assertion. One intermediate run during a concurrent build timed out in an existing five-second fixture test (138 passed, one timeout); the isolated rerun passed all 139 without changing that test. Full Angular tests were also rerun after the corrections. A later full rerun was interrupted when the root dev-server script rebuilt/cleaned shared artifacts concurrently (123 files / 963 tests passed, one SALES suite could not import its temporarily missing shared module). This orchestration error was corrected by running tests before restarting the frontend directly. Development compilation reports one existing shared SALES side-effect-import warning, with exit 0. Production build/config generation was not attempted: legitimate production Cognito configuration remains a separate known prerequisite; none was fabricated. No separate lint script is available in these workspace manifests.

## 30. Browser/manual observations actually performed

A temporary bootstrap rendered actual current AppShell, Sidebar, Topbar, restaurant pages, editors and QR dialog against the same local production-handler runtime and established fixture. Only identity/session context and unrelated shell capabilities were fixtures. No production application auth path was altered.

Observed all seven destinations from sidebar, French labels, restaurant policy, area/table parent context, station options, menu categories/items/XOF prices, form checkboxes, protected QR explanation, keyboard station selection, inline price errors, tablet/mobile layouts and mobile drawer navigation. The mobile hint overlap was reproduced, corrected and measured.

Temporary screenshots: `/tmp/resto1d-evidence/menu-desktop.png` and `/tmp/resto1d-evidence/table-dialog-mobile.png`. Browser viewport overrides were reset. Local preview/runtime are stopped after validation; the ordinary repository Angular dev server was restored at `http://localhost:4200`. No remote services were used.

## 31. Known limitations

The integration proves application boundaries using the existing memory DynamoDB harness; it does not prove Cognito token cryptographic verification, API Gateway deployment/CORS configuration, AWS DynamoDB service behavior, LocalStack parity or distributed concurrency. Those require separately authorized infrastructure validation.

Browser observations are focused, use a fixture identity and are not a full accessibility certification. The existing mobile navigation toggle still uses its desktop collapse/expand wording; drawer behavior itself works. QR is an administrative opaque identity, not a guest flow or rendered scan experience. Production configuration remains legitimate configuration work outside this task.

Fiscal Compliance/e-MECeF is untouched; DGI TEST remains suspended, with future continuation at `S4C-0B1`.

## 32. Git status

Branch remains `main`. Initial tree clean; final scope is 14 modified tracked files and five new files listed above, all uncommitted. No user changes were overwritten, no commit or deployment was made. No RESTO-2 or additional domain was started.

## 33. RESTO-1 overall status: PASS

PASS for the requested local application integration and focused frontend compliance scope. Entitlement, authoritative RBAC, tenant isolation, fixture workflows, QR administration, money, availability/reorder, optimistic versioning, idempotency, pagination and cache isolation are proven across actual frontend/backend boundaries. Permanent design rules live in the canonical skill. ACCOUNTING/SALES regressions remain green.

This does not claim cloud deployment validation or production identity configuration completion.

## 34. RESTO-2 readiness: YES

YES for starting a separately authorized RESTO-2 implementation phase on this validated RESTO-1 application foundation. RESTO-2 has not started. Stop here; no deployment or commit.
