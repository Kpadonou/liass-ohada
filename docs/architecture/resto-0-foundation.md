# RESTO-0 — Liass-Resto Product Foundation

Date: 2026-10-10. Classification: **VERTICAL_SOLUTION**. Commercial name: **Liass-Resto**. Canonical ProductCode: **RESTAURANTS**.

## 1. Repository findings

`SPEC.md` already reserved the `restaurants` business-domain name and `RESTAURANTS` future product code. This authorized implementation phase advances only the foundation. Platform Core owns identity, organization access, entitlement, permission projection, and shell navigation. No restaurants business domain is introduced.

Canonical patterns inspected:

| Concern | Existing owner |
| --- | --- |
| ProductCode / ProductAccess contracts | `packages/shared/src/shared/product-access.ts` |
| Entitlement reads, activation transaction builder | `ProductAccessRepository`, `ProductAccessService` |
| Workspace discovery / membership | `OnboardingRepository`, `TenantAccessService` |
| Effective direct / cabinet context | `EffectiveOrganizationAccessService` |
| Server authorization chain | `handler-wrapper.ts`, `DomainAuthorizationService`, `domain-permission.ts` |
| Physical keys | `packages/backend/lambda/shared/key-builder.ts` |
| Frontend entitlement API / cache | `core/product-access/`, organization-scoped TanStack Query |
| Frontend context / headers | Identity `AuthStore`, tenant guards and HTTP tenant context |
| Navigation / page identity | AppSidebar, AppShell, UiStore, AppContextBreadcrumb |
| Routes | `core/routing/app.routes.ts` |
| Translations | `public/assets/i18n/fr.json`, `en.json` |
| Infrastructure registration | `api-domain-stacks.ts`, existing endpoint constructs and nested-stack placement guide |

Existing SALES pages gate their content with ProductAccess and capabilities; there was no generic product route guard. Existing auth and tenant guards remain in place; RESTO-0 adds a small generic guard using the existing product query/cache. Existing direct roles are global and cabinet permission projection is Accounting-only, so a separate optional product-role assignment is needed for independent RESTAURANTS RBAC.

## 2. Implementation summary

Registers RESTAURANTS in the canonical product vocabulary and existing persistence validation, adds its initial role vocabulary and minimal permission projection, and exposes a translated, protected platform landing page at `/restaurants`. No restaurant business entity, workflow, domain folder, API registration, settings aggregate, integration, or physical infrastructure is created.

## 3. Files changed

- `SPEC.md`
- `packages/backend/lambda/shared/authorization/domain-permission.ts`
- `packages/backend/lambda/shared/repositories/onboarding-repository.ts`
- `packages/backend/lambda/shared/repositories/product-access-repository.ts`
- `packages/backend/lambda/shared/services/domain-authorization-service.ts`
- `packages/backend/lambda/shared/services/effective-organization-access-service.ts`
- `packages/backend/lambda/shared/services/tenant-access-service.ts`
- `packages/backend/test/unit/fiscal-compliance/fiscal-authorization.test.ts`
- `packages/backend/test/unit/identity/get-product-access.test.ts`
- `packages/backend/test/unit/shared/domain-authorization-service.test.ts`
- `packages/backend/test/unit/shared/product-access-contracts.test.ts`
- `packages/backend/test/unit/shared/product-access-service.test.ts`
- `packages/backend/test/unit/shared/restaurants-foundation.test.ts`
- `packages/frontend/public/assets/i18n/en.json`
- `packages/frontend/public/assets/i18n/fr.json`
- `packages/frontend/scripts/product-naming-contract.test.mjs`
- `packages/frontend/src/app/core/product-access/product-access.guard.spec.ts`
- `packages/frontend/src/app/core/product-access/product-access.guard.ts`
- `packages/frontend/src/app/core/product-access/product-availability.spec.ts`
- `packages/frontend/src/app/core/restaurants/restaurants.page.html`
- `packages/frontend/src/app/core/restaurants/restaurants.page.spec.ts`
- `packages/frontend/src/app/core/restaurants/restaurants.page.ts`
- `packages/frontend/src/app/core/routing/app.routes.ts`
- `packages/frontend/src/app/core/state/ui.store.ts`
- `packages/frontend/src/app/shared/layout/app-context-breadcrumb/app-context-breadcrumb.component.ts`
- `packages/frontend/src/app/shared/layout/app-shell/app-shell.component.ts`
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.html`
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.spec.ts`
- `packages/frontend/src/app/shared/layout/app-sidebar/app-sidebar.component.ts`
- `packages/shared/src/shared/index.ts`
- `packages/shared/src/shared/product-access.ts`
- `packages/shared/src/shared/restaurants-access.ts`
- `docs/architecture/resto-0-foundation.md` (this report)

## 4. ProductAccess changes

The canonical enum accepts ACCOUNTING, SALES, RESTAURANTS. LIASS_RESTO, RESTO, RESTAURANT and unknown aliases remain invalid. Persisted validation derives canonical values from `PRODUCT_CODES`, retaining existing legacy module values only for compatibility tooling.

RESTAURANTS uses the existing organization entitlement row and existing activation transaction builder. No implicit product dependency or automatic activation is introduced. Default onboarding remains ACCOUNTING-only. RESTAURANTS-only, ACCOUNTING + RESTAURANTS, SALES + RESTAURANTS, and all-three combinations are independently supported by the same contract and availability resolution.

## 5. RBAC changes

Initial RESTAURANTS roles: OWNER, MANAGER, WAITER, CASHIER, KITCHEN. An optional `productRoles.RESTAURANTS` value on the existing USER_ORG_ACCESS row carries the explicitly assigned role, independently of its global `role`. Valid assignments map to **RESTAURANTS_READ** through `DomainAuthorizationService`, and the existing handler wrapper enforces it. No business permission matrix is added.

Global OWNER, Accounting permissions, SALES permissions and cabinet access do not imply RESTAURANTS_READ. Missing or malformed assignments produce no restaurant permissions. Conversely, RESTAURANTS_READ does not activate ProductAccess. The existing direct-role grants and cabinet rules remain intact. Role assignment administration and additional business permissions are later work; this phase does not change live roles or entitlements.

## 6. Frontend changes

Liass-Resto is a peer navigation entry, outside SALES and ACCOUNTING groups. It is shown only for confirmed AVAILABLE RESTAURANTS access in the effective organization. UNKNOWN/error access does not reveal the entry. Existing ACCOUNTING disabled/unavailable navigation semantics remain unchanged.

`productAccessGuard` fetches through the existing organization-scoped TanStack cache and denies missing/inactive access, verification errors, missing tenant context, and a workspace change during verification. Denial returns `/dashboard`; inherited auth/tenant guards remain authoritative for context. The landing also reacts to entitlement changes after navigation.

The page lives under `core/restaurants`, because it is a platform foundation surface and no backend restaurants business domain exists. It reuses `liass-page-header`, `liass-card`, `liass-skeleton`, Transloco and the shell's existing responsive/dark-mode primitives. Loading uses an accessible status/busy region and denial an alert. Component tests render the DOM and verify states and block-level primitives; no authenticated browser visual session was exercised.

Design references consulted: UI principles, tokens, component guidelines and page templates; existing Material theme and shell assets/patterns were inspected. No new colors, custom CSS, Material controls or client-state store are needed.

## 7. Backend changes

Existing server path: Cognito subject -> verified x-org-id / membership -> effective workspace context -> active RESTAURANTS ProductAccess -> RESTAURANTS_READ -> operation.

The generic wrapper is tested directly with RESTAURANTS metadata and a read-only test operation. Membership resolution, entitlement reads and permission enforcement run through production services against a mocked DynamoDB client; authorization services are not stubbed. This proves enforcement without inventing an endpoint or domain. `/me/product-access` can expose RESTAURANTS through its existing contract and implementation.

There is no deployed foundation API URL. Any future RESTAURANTS endpoint must use the reviewed domain placement and explicit product/permission metadata. Existing ProductAccess denial logging and normalized errors are reused. No business writes, new audit events, secrets or sensitive logging are introduced.

## 8. DynamoDB / KeyFactory impact

References consulted: `liass-ohada-access-patterns.md`, `liass-ohada-single-table-conventions.md`, `dynamodb-modeling-principles.md`.

| Access pattern | Operation / physical shape |
| --- | --- |
| Verify authenticated user membership and assigned restaurant role | Existing strongly consistent GetItem; PK via `orgKey(orgId)` = ORG#{orgId}; SK via `orgUserAccessSK(userId)` = USER#{userId}; entityType USER_ORG_ACCESS |
| Verify one product entitlement | Existing strongly consistent GetItem; PK via `orgKey`; SK via `productAccessSK(RESTAURANTS)` = PRODUCT_ACCESS#RESTAURANTS; entityType PRODUCT_ACCESS |
| Discover organization products | Existing paginated Query over the PRODUCT_ACCESS# prefix |
| Build explicit activation | Existing conditional transaction builder; not executed against AWS in this task |
| Discover user workspaces | Existing user workspace index; unchanged |

Only additive business attribute `productRoles` is supported on USER_ORG_ACCESS. No new item type, key helper/format, GSI, index projection, scan, persistence operation or migration/backfill is introduced. Existing DTO mapping keeps physical keys private. Reads remain bounded; no additional partition fan-out, hot-partition mechanism or pagination requirement is introduced. No new write workflow requires idempotency or atomicity design. Existing activation conditions remain in effect.

Old rows remain valid; absent roles fail closed for restaurant permission. Reverting foundation code is the code rollback; no external data changes were performed. Explicit entitlement activation and restaurant role assignment must precede a future protected business operation.

## 9. Infrastructure impact

No CDK file changed. Existing API core, Identity, Accounting, Projects, Treasury, Sales, Fiscal Compliance and Data stack ownership is preserved. Added/replaced resources: **0 / 0**. Stateful-resource impact: **none**. Resource-count delta for every stack: **0**; no new templates. Synth, resource-count and diff were not required or run because this task adds no infrastructure resources. Deployment: **not performed**. No production or DGI calls were made. Fiscal TEST work remains suspended and must resume from S4C-0B1 later.

## 10. Tests added / updated

- Shared contract tests cover all three valid products and invalid aliases; persistence fields remain rejected.
- RESTO-0 backend proof covers all five role assignments, missing/inactive entitlement, missing/malformed role, global OWNER independence, wrong tenant, forged body identifiers, mismatched stored user, alternate cabinet workspace, missing identity/header, and unchanged key construction.
- Existing entitlement observation tests include RESTAURANTS.
- Permission tests preserve existing direct OWNER grants independently of the expanded permission vocabulary. One fiscal regression assertion is updated for that vocabulary only; fiscal runtime behavior and integration work are unchanged.
- Frontend guard tests cover independent combinations, denial, loading, query error, workspace races, missing context and top-level route registration.
- Navigation tests cover visibility, hidden/unknown availability, and peer SALES navigation; existing Accounting/SALES tests remain in the full suite.
- Landing component tests verify translations, loading and reactive access loss.
- The earlier naming contract that prohibited implementation is updated for the authorized RESTO-0 phase; public restaurant business availability remains COMING.

## 11. Validation commands and exact results

Validation uses Node v22.22.3 through `/Users/kpadonou/.nvm/versions/node/v22.22.3/bin` prepended to PATH, because npm was absent from the initial shell PATH.

| Command | Exact result |
| --- | --- |
| `npm run build -w @liass-ohada/shared` | Exit 0; CJS, ESM and declaration builds succeeded. |
| `npm run build -w @liass-ohada/backend` | Exit 0; TypeScript compile succeeded (also rerun after final backend edits). |
| `npm exec --workspace @liass-ohada/frontend -- ng build --progress=false --configuration development` | Exit 0; Angular application bundle generation succeeded after the loading fix. Existing import side-effect warnings remain. |
| Targeted backend `npm test -w @liass-ohada/backend -- --runInBand --runTestsByPath test/unit/shared/restaurants-foundation.test.ts test/unit/shared/product-access-contracts.test.ts test/unit/shared/domain-authorization-service.test.ts test/unit/shared/product-access-service.test.ts` | Exit 0; 4 suites, 68 tests passed. |
| Targeted frontend `npm exec --workspace @liass-ohada/frontend -- ng test --watch=false --include='**/product-access.guard.spec.ts' --include='**/product-availability.spec.ts' --include='**/app-sidebar.component.spec.ts'` | Exit 0; 3 files, 49 tests passed. Landing tests were subsequently included in the full suite. |
| Final `npm test` | Exit 0; backend 146 suites / 1,007 tests passed; frontend script contracts 12/12 passed; Angular 111 files / 800 tests passed. |
| `npm run build` | Exit 1 at production frontend configuration generation: missing LIASS_COGNITO_REGION / cdk-outputs.prod.json. Its shared and backend stages passed. No configuration was fabricated; development frontend build above passed. |
| Lint | No lint script or ESLint configuration is available in the repository. |
| `node_modules/.bin/prettier --check` on the new shared/backend/frontend source and test files, including restaurants.page.html | Exit 0; all matched files use Prettier style. |
| `git diff --check` | Exit 0; no whitespace errors. |

Final test log: `/tmp/resto-validation-tests.log`. Build logs: `/tmp/resto-shared-build.log`, `/tmp/resto-backend-build-final.log`, `/tmp/resto-frontend-build-final.log`; production configuration failure: `/tmp/resto-full-build.log`. These are local verification logs, not repository deliverables.

The first simultaneous full build/test attempt was invalidated by shared build cleaning dist while Jest read declaration files; tests were rerun after shared build completed. A loading-state test found a real composition defect, which was fixed by explicitly composing skeleton and translated text inside the shared card.

## 12. Acceptance-scenario results

| Scenario | Result / evidence |
| --- | --- |
| A — RESTAURANTS only | PASS: restaurant entry and guard allow active RESTAURANTS; availability resolves ACCOUNTING and SALES as unavailable; scoped restaurant mapping grants only RESTAURANTS_READ. |
| B — ACCOUNTING + RESTAURANTS | PASS: both resolve independently; restaurant guard permits entry; Accounting regression tests pass. |
| Additional — SALES + RESTAURANTS / all three | PASS: independent availability/guard combinations; SALES and Liass-Resto render as peers. |
| C — SALES only | PASS: no restaurant navigation, route redirected, generic server operation denied without RESTAURANTS entitlement. |
| D — backend bypass | PASS: invoking the production wrapper directly without RESTAURANTS access returns 403 and never invokes operation logic. No new API was registered. |
| E — insufficient restaurant authorization | PASS: active product with missing/invalid restaurant role returns DOMAIN_PERMISSION_REQUIRED (403), including a global OWNER without explicit assignment. |

Acceptance evidence is automated local testing, not deployment or remote live testing.

## 13. Deviations and rationale

- No existing generic frontend product guard existed; a minimal guard was added using the existing query/cache and auth/tenant context.
- Independent restaurant roles required one additive optional attribute on existing membership storage, not a new entity or RBAC subsystem.
- Backend proof uses the existing generic wrapper in tests, as explicitly preferred, instead of adding a fake RESTAURANTS foundation endpoint.
- Default production build requires environment configuration unavailable locally; development Angular compilation is validated. No dummy production values are introduced.
- SPEC.md now records the authorized foundation while keeping all restaurant business behavior deferred.

No Restaurant Setup, restaurant entities, SALES business coupling, fiscal provider work or RESTO-1 implementation is included.

## 14. Git status

Initial working tree: clean. Final changes are the files listed above, all uncommitted. No branch change, commit, staging, deployment or external activation was performed. `git diff --check` passes.

## 15. RESTO-1 readiness

**YES**, at the code-foundation level with all relevant local validations passing. RESTO-1 has not started. Future work must design its own reviewed restaurants business domain and permissions, explicitly activate ProductAccess and assign roles, and follow the existing CDK/domain ownership rules when real endpoints are added. Production build/release still requires the legitimate production configuration.
