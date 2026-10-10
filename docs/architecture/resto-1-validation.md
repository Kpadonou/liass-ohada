# RESTO-1A / RESTO-1B validation report — 2026-10-10

## 1. Repository reconnaissance

Started from clean `main`, HEAD `0853480 RESTO-0 — Liass-Resto Product Foundation`. Consulted AGENTS.md, SPEC.md, platform-architecture and DynamoDB skills/references, OHADA skill domain mapping, KeyFactory and the nested-stack placement guide before implementation. Existing patterns: canonical ProductCode in shared; ProductAccess on organization keys; effective direct/cabinet workspace resolution; createHandler JWT/tenant/ProductAccess/permission chain; scoped productRoles.RESTAURANTS; DomainAuthorizationService; shared strict Zod subpath exports; DomainConstructFactory; backend Jest SDK mocks. RESTO-0 frontend core landing/guard/navigation and translations remain unchanged.

## 2. Domain decisions

RESTAURANTS owns operational setup and menu configuration in `lambda/domains/restaurants`. This is a vertical bounded context within shared Platform V2 physical infrastructure. No parallel platform, tenant, membership, entitlement or RBAC mechanism. Configuration only; no transactional restaurant behavior.

## 3. Restaurant vs Organization decision

Organization remains the tenant/legal business identity. Restaurant is a separate operational root, with name, policy, active lifecycle and version/timestamps. Tenant identity is backend persistence context, not a public mutable Restaurant field.

## 4. Restaurant/Outlet ownership model

Exactly one Restaurant per current organization in this phase, owning multiple Outlets. Each Outlet belongs to one Restaurant. Each ServiceArea, Table and PreparationStation is site scoped; Table has exactly one immutable ServiceArea. Parent changes/moves are not supported. Bounded reads and transactional parent conditions validate ownership/activity.

## 5. Menu ownership decision

Exactly one Menu per Outlet, with one immutable currency and multiple Categories/Items. This scopes optional preparation-station assignment to the same Outlet and preserves future table/session/order locality. No scheduled menus or shared cross-outlet menu abstraction.

## 6. Aggregate/entity model

Restaurant, Outlet, ServiceArea, RestaurantTable, PreparationStation, Menu, MenuCategory, MenuItem. Active/inactive history rather than destructive deletion. Item availability AVAILABLE/UNAVAILABLE is distinct from isActive. GuestOrderingPolicy supports exactly DISABLED/STAFF_APPROVAL/DIRECT, default STAFF_APPROVAL. guestReorderEnabled is boolean, default false; no ordering behavior.

## 7. Shared contracts

New `@liass-ohada/shared/restaurants` subpath exports strict entity/create/update/lifecycle/list/response schemas and inferred DTOs. UUID IDs, trimmed bounded names, normalized uppercase table code, optional positive bounded capacity, safe nonnegative integer minor-unit price with three-letter currency, availability, reorder, policy and version metadata. No PK/SK/GSI/entityType/orgId leaks. Create requires clientRequestId; mutations require expectedVersion. Null clears capacity/station. Empty PATCH rejected. No dependencies added or lockfile changes.

## 8. DynamoDB item model

Existing shared table. Organization-partitioned configuration records have uppercase entityType, orgId, createFingerprint and nested schema-validated public data; tables additionally retain private qrToken. Outlet-scoped table-code reservation records and globally keyed QR hash locator records are backend-only. No new indexes/migrations.

## 9. Access patterns

Exact consistent GetItem for Restaurant/Outlet/Area/Table/Station/Menu/Category/Item; bounded Query for Outlets, Areas, Tables by Area, Stations, Categories and Items by Category. Default limit50/max100. Logical scoped cursor rederives physical keys and rejects another tenant/collection. QR direct GetItem plus four bounded ownership/activity GetItems. No Scan, FilterExpression or broad partition load. Full item/access-pattern table is in [resto-1-domain-api.md](resto-1-domain-api.md).

## 10. KeyFactory additions

17 helpers: restaurantSK; restaurantOutletPrefix/SK; restaurantServiceAreaPrefix/SK; restaurantTablePrefix/SK; restaurantTableCodeSK; restaurantStationPrefix/SK; restaurantMenuSK; restaurantCategoryPrefix/SK; restaurantMenuItemPrefix/SK; restaurantQrPK/SK. Existing formats unchanged. All service/repository physical keys delegate to these helpers and existing orgKey.

## 11. QR identity and lookup design

Server-generated 32-byte cryptographic random token, base64url43; no internal identity embedded. Locator PK hashes token with SHA-256, SK LOOKUP. Administrative QR response exposes only token and requires SETUP_MANAGE. No public resolver HTTP route or rotation. Internal resolution verifies mapping/current token and active ancestor/table ownership. Wrong/stale mappings fail closed. Configuration audit logs contain no tokens/internal entity IDs; existing platform entitlement-denial logging conventions remain unchanged.

## 12. Atomicity/idempotency design

Conditional TransactWriteItems creates Table+code reservation+QR mapping together; every parent participates with type/org/id/version/activity checks. QR/code collision rolls everything back. Code rename atomically acquires new reservation/releases owned old reservation while preserving token. Inactive rows and reservations remain. Custom UUIDv8 is derived from org/kind/parent scope/clientRequestId; normalized create fingerprint returns same current row for identical retries and rejects changed intent (409). Conditional singleton keys prevent a second Restaurant/Menu. Optimistic expectedVersion guards updates; no automatic cascading/hard deletes.

## 13. RESTAURANTS permissions

RESTAURANTS_READ, RESTAURANTS_SETUP_MANAGE, RESTAURANTS_MENU_READ, RESTAURANTS_MENU_MANAGE. Explicit OWNER/MANAGER assignment gets all four; WAITER/CASHIER/KITCHEN get the two reads and cannot manage or retrieve QR. Global OWNER, Accounting, Sales and cabinet grants remain independent. `_MANAGE` is recognized as a mutation permission through existing isWritePermission.

## 14. API surface

38 authenticated tenant-scoped routes. Restaurant GET/POST/PATCH; Outlets, Areas, Tables, Stations, Categories, Items each list/create/get/update/deactivate; Menu GET/POST/PATCH; administrative Table GET /qr; Item POST /availability. Canonical full paths/methods/permissions: `packages/backend/lambda/domains/restaurants/restaurant-routes.ts`, reused by CDK. Success semantics follow existing wrapper (200; data envelope; translated mutation message; items/nextCursor lists; QR token only). Errors: 400 validation/currency/cursor, 403 access/role, 404 foreign/missing entity, 409 conflicts/inactive parents.

## 15. Tenant-isolation enforcement

Cognito sub → verified x-org-id and workspace membership → active RESTAURANTS ProductAccess → exact permission → validated immutable route parents → bounded owner reads → conditional transaction. Client orgId/userId never select context: schemas reject them and canonical wrapper strips them. Stored org/type/key/ID/parent identity also checked. Cross-tenant/site/area/category/station references denied. Frontend visibility is irrelevant to backend authorization.

## 16. Files changed

Grouped changes: new Restaurants domain (43 files: 38 thin handlers and five domain-specific implementation modules), shared contracts/subpath, endpoint construct, six test/fixture/harness files, domain and validation documents. Extended KeyFactory, permission projection, API stack registration, en/fr backend messages, SPEC and CDK placement guide. Updated shared permission regression, infrastructure ownership regression, and one Fiscal Compliance regression expectation solely to exclude the expanded RESTAURANTS namespace; no fiscal implementation changed. Full path inventory appears at the end of this report.

## 17. Infrastructure/CDK impact

Owning stack: RestaurantsApiStack. Added 38 Lambda functions +38 JWT routes +38 integrations +38 Lambda permissions +1 CDK metadata resource (153 nested-template resources); core adds one nested-stack declaration. No new IAM role/policy/action, LogGroup construct, table, GSI, Cognito pool, API Gateway, bucket, secrets system or identity stack. Existing shared role/table/authorizer/API and LogGroup naming convention reused.

| Template owner | Before | After |
|---|---:|---:|
| API core |277|278|
| Restaurants |0|153|
| Accounting |51|51|
| Sales |161|161|
| Identity |81|81|
| Fiscal Compliance |41|41|
| Projects |12|12|
| Treasury |11|11|
| Data |4|4|
| Root |1|1|

All10 templates <=350. Offline baseline-vs-final resource comparison: no removed resources; no shared stateful resource changes; every existing resource keeps its type/logical ID. Shared permission/i18n bundling changes Code/asset metadata on150 existing Lambdas (Accounting50, Sales37, Identity32, Projects11, Treasury10, Fiscal10), with all other Lambda properties identical. Six existing nested-stack template URLs update accordingly. This comparison is not a deployed-cloud cdk diff. No AWS/cloud diff or deployment performed, honoring the explicit no-external-calls constraint. No stateful migration required.

## 18. Tests added/updated

New: contracts39; domain/persistence12; authorization106; architecture3. In-memory SDK harness executes actual GetItem/Query/TransactWriteItems requests and supported conditional expressions atomically; fixture uses production services/repositories, not manual domain-row seeding. Identity/entitlement records alone are seeded for authorization tests. Tests cover all38 route access requirements, OWNER/MANAGER API operation, read-role restrictions, QR/admin denial, wrong tenant/parents/stations, bounded pagination, normalized uniqueness, singleton roots/menus, retry fingerprints, token collisions/rollback, stale/inactive parent transactions, lifecycle/history, price/currency/availability/reorder and corrupted lookup. Existing RESTO-0, Accounting/Sales/Fiscal, infrastructure and frontend suites included as regressions.

## 19. Validation commands and exact results

Commands used Node v22.22.3 via `PATH=/Users/kpadonou/.nvm/versions/node/v22.22.3/bin:$PATH` (not otherwise present in the execution PATH).

| Command | Exact final result |
|---|---|
| `npm run build -w @liass-ohada/shared` | exit0; CJS/ESM/declarations successful |
| `npm run build -w @liass-ohada/backend` | exit0; strict TypeScript compile successful |
| `npm test -w @liass-ohada/backend -- --runInBand --runTestsByPath test/unit/restaurants/contracts.test.ts test/unit/restaurants/domain.test.ts test/unit/restaurants/authorization.test.ts test/unit/restaurants/architecture.test.ts test/unit/shared/restaurants-foundation.test.ts test/unit/shared/domain-authorization-service.test.ts test/unit/shared/key-builder.test.ts` | initial targeted checkpoint:7 suites,210 tests passed; subsequent domain additions:12/12 passed; all final tests included in full suite |
| `npm test -w @liass-ohada/backend -- --runInBand --runTestsByPath test/unit/infrastructure/api-stack-decomposition.test.ts` |14/14 tests passed |
| `npm test -w @liass-ohada/backend -- --runInBand` |150 suites passed;1,168 tests passed;0 failures |
| `npm test -w @liass-ohada/frontend -- --watch=false` |111 Angular test files passed;800 tests passed; script contracts12 passed;0 failures |
| `npm run build:development -w @liass-ohada/frontend` |exit0; development compilation successful |
| `npm run build -w @liass-ohada/frontend` |exit1: known legitimate production configuration blocker described below |
| `AWS_EC2_METADATA_DISABLED=true npm exec --workspace @liass-ohada/backend -- cdk synth --lookups=false --no-notices --quiet` |exit0; synthesized locally; no deployment |
| `npm run cdk:resource-count -w @liass-ohada/backend` |exit0; all10 templates at or below350 resources |
| `python3 /tmp/resto1-compare.py` |exit0; local baseline/final comparison assertions passed |
| `node node_modules/prettier/bin/prettier.cjs --check 'packages/backend/lambda/domains/restaurants/*.ts' 'packages/backend/test/unit/restaurants/*.ts' packages/backend/lib/constructs/domains/restaurants-endpoints.ts packages/shared/src/restaurants/index.ts` |exit0; all matched implementation/test files use Prettier style |
| `git diff --check` |exit0; no whitespace errors |
| lint |no lint script configured in root/workspaces; not available |
| cloud `cdk diff` |not run: external calls prohibited |

Production generator's exact blocker: `Missing production frontend configuration: LIASS_COGNITO_REGION. Expected a production CDK outputs file at /Users/kpadonou/Projects/liass-ohada/cdk-outputs.prod.json, or explicit LIASS_* build variables.` No configuration fabricated. Initial full backend run had one outdated domain-name allowlist assertion (149 suites/1,164 tests passed, one failed); after extending that regression and adding stack ownership coverage, the full final suite above passed. Two transient test-development issues (crypto namespace spy and mistyped route name) were corrected and all final assertions pass.

## 20. Acceptance-fixture results

PASS: Héritage Bistro; Agla; Main Room/Terrace; T01–T04 (capacity4); KITCHEN/BAR; STAFF_APPROVAL; Agla Menu (XOF); Main Dishes/Drinks/Desserts; Grilled Chicken (5000)/Fried Plantain (1500), KITCHEN and reorderfalse; Bottled Water (500)/Beer (1000), BAR and reordertrue; Chocolate Cake (2000), no station and reorderfalse.19 configuration entities created through real services/repositories, four code locks and four QR locators. Deterministic names/IDs/request intent; QR tokens intentionally random. All required read patterns pass. Four distinct opaque256-bit tokens resolve with five GetItems and no Query/Scan. Cross-tenant access and invalid/cross-outlet station assignment fail. Duplicate token conditions leave original mapping/table and row count unchanged. HTTP OWNER/MANAGER setup/menu operation and unauthorized management denial pass.

## 21. Deviations and rationale

No scope expansion into RESTO-1C/1D/2 or fiscal/transactional integrations. Domain nested stack is required by canonical resource placement for a coherent new domain with expected growth. Individual read endpoints accompany list/mutation endpoints to support required exact access patterns. Reads for all three staff roles include menu read, within the requested minimal capability design. QR rotation remains deferred. Standard wrapper ignores forged orgId/userId rather than changing platform-wide semantics. Cloud cdk diff intentionally skipped because explicit user prohibition overrides the conditional repository requirement for external credential-backed comparison.

## 22. Known limitations

No AWS/LocalStack persistence integration or live endpoint test; SDK atomic-condition unit harness and local CDK synthesis establish this phase's proof. No public QR resolver, rotation, restaurant-role provisioning UI/API, hard delete, parent moves, cascade deactivation/reactivation, multiple roots/menus, or display-order sorting in DynamoDB. All inactive historical rows remain readable to authorized users. Station deactivation preserves assigned historical references; subsequent normal item updates must unlink/reassign to an active station. Menu currency is immutable. Actual endpoint availability requires a later reviewed deployment. Production frontend build requires real production Cognito configuration. No deployed change-set/replacement claim is made from the local comparison alone.

## 23. Git status

Branch main; initial HEAD0853480 unchanged.66 changed/untracked files (13 modified tracked,53 new), all from this task; no staged files, commit or deployment. No frontend source changes, dependency changes or lockfile edits.

## 24. RESTO-1A status

**PASS.** Model, contracts, persistence, documented access patterns, KeyFactory, opaque QR identity, direct lookup and atomic consistency implemented and locally validated.

## 25. RESTO-1B status

**PASS.** APIs, server ProductAccess/RBAC, tenant/parent isolation, setup/menu operations and deterministic fixture validated; Accounting/Sales regressions green. Fiscal Compliance remains suspended and future work resumes at S4C-0B1 only on separate authorization.

## 26. RESTO-1C readiness

**YES** for frontend implementation against the shared contracts and registered API surface. RESTO-1C has not started. RESTO-1D integrated validation and RESTO-2 are also untouched. API deployment and production frontend configuration remain separate future prerequisites for live usage.

## Full file inventory

```text
M SPEC.md
M packages/backend/docs/cdk-nested-stack-architecture.md
M packages/backend/lambda/shared/authorization/domain-permission.ts
M packages/backend/lambda/shared/key-builder.ts
M packages/backend/lambda/shared/services/domain-authorization-service.ts
M packages/backend/lib/stacks/api-domain-stacks.ts
M packages/backend/lib/stacks/api-stack.ts
M packages/backend/locales/en.json
M packages/backend/locales/fr.json
M packages/backend/test/unit/fiscal-compliance/fiscal-authorization.test.ts
M packages/backend/test/unit/infrastructure/api-stack-decomposition.test.ts
M packages/backend/test/unit/shared/domain-authorization-service.test.ts
M packages/shared/package.json
A docs/architecture/resto-1-domain-api.md
A docs/architecture/resto-1-validation.md
A packages/backend/lambda/domains/restaurants/availability-menu-item.ts
A packages/backend/lambda/domains/restaurants/create-menu-category.ts
A packages/backend/lambda/domains/restaurants/create-menu-item.ts
A packages/backend/lambda/domains/restaurants/create-menu.ts
A packages/backend/lambda/domains/restaurants/create-outlet.ts
A packages/backend/lambda/domains/restaurants/create-preparation-station.ts
A packages/backend/lambda/domains/restaurants/create-restaurant.ts
A packages/backend/lambda/domains/restaurants/create-service-area.ts
A packages/backend/lambda/domains/restaurants/create-table.ts
A packages/backend/lambda/domains/restaurants/deactivate-menu-category.ts
A packages/backend/lambda/domains/restaurants/deactivate-menu-item.ts
A packages/backend/lambda/domains/restaurants/deactivate-outlet.ts
A packages/backend/lambda/domains/restaurants/deactivate-preparation-station.ts
A packages/backend/lambda/domains/restaurants/deactivate-service-area.ts
A packages/backend/lambda/domains/restaurants/deactivate-table.ts
A packages/backend/lambda/domains/restaurants/get-menu-category.ts
A packages/backend/lambda/domains/restaurants/get-menu-item.ts
A packages/backend/lambda/domains/restaurants/get-menu.ts
A packages/backend/lambda/domains/restaurants/get-outlet.ts
A packages/backend/lambda/domains/restaurants/get-preparation-station.ts
A packages/backend/lambda/domains/restaurants/get-restaurant.ts
A packages/backend/lambda/domains/restaurants/get-service-area.ts
A packages/backend/lambda/domains/restaurants/get-table.ts
A packages/backend/lambda/domains/restaurants/list-menu-category.ts
A packages/backend/lambda/domains/restaurants/list-menu-item.ts
A packages/backend/lambda/domains/restaurants/list-outlet.ts
A packages/backend/lambda/domains/restaurants/list-preparation-station.ts
A packages/backend/lambda/domains/restaurants/list-service-area.ts
A packages/backend/lambda/domains/restaurants/list-table.ts
A packages/backend/lambda/domains/restaurants/qr-table.ts
A packages/backend/lambda/domains/restaurants/restaurant-handler.ts
A packages/backend/lambda/domains/restaurants/restaurant-model.ts
A packages/backend/lambda/domains/restaurants/restaurant-repository.ts
A packages/backend/lambda/domains/restaurants/restaurant-routes.ts
A packages/backend/lambda/domains/restaurants/restaurant-service.ts
A packages/backend/lambda/domains/restaurants/update-menu-category.ts
A packages/backend/lambda/domains/restaurants/update-menu-item.ts
A packages/backend/lambda/domains/restaurants/update-menu.ts
A packages/backend/lambda/domains/restaurants/update-outlet.ts
A packages/backend/lambda/domains/restaurants/update-preparation-station.ts
A packages/backend/lambda/domains/restaurants/update-restaurant.ts
A packages/backend/lambda/domains/restaurants/update-service-area.ts
A packages/backend/lambda/domains/restaurants/update-table.ts
A packages/backend/lib/constructs/domains/restaurants-endpoints.ts
A packages/backend/test/unit/restaurants/acceptance-fixture.ts
A packages/backend/test/unit/restaurants/architecture.test.ts
A packages/backend/test/unit/restaurants/authorization.test.ts
A packages/backend/test/unit/restaurants/contracts.test.ts
A packages/backend/test/unit/restaurants/domain.test.ts
A packages/backend/test/unit/restaurants/memory-dynamo.ts
A packages/shared/src/restaurants/index.ts
```
