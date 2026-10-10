# ONB-PRODUCTS-A/B — Contracts, backend and product bootstrap

## 1. Repository findings

Classification: **PLATFORM_CORE**, owned by identity/onboarding. Inspected SPEC, repository guidelines, shared onboarding/Organization/workspace contracts, POST and GET `/me/workspaces`, onboarding service/repository, tenant/effective organization access, ProductAccess service/repository and activation builder, KeyFactory, AccountingSettings bootstrap, SALES activation/settings and direct-owner authorization, cabinet/dossier bootstrap, frontend payload and tests, RESTO-0 foundation and RESTO-1 validation documentation.

The starting working tree already contained RESTO-1C and other edits, including workspace/product-role projection, authorization, SPEC and frontend changes. Those are preserved; this report attributes only the A/B changes listed below. No delegation, browser workflow or external service interaction was used.

Skills consulted: platform architecture; DynamoDB access-pattern, single-table and modeling-principles references; OHADA domain mapping and AUDCIF reference. This task changes product configuration selection, not legal accounting rules; no new legal obligations, accounts or article claims are introduced.

## 2. Existing onboarding behavior

COMPANY wrote five conditional rows in one TransactWriteItems: Organization, USER_ORG_ACCESS with global OWNER, INITIAL_WORKSPACE_LOCK, ACCOUNTING ProductAccess and AccountingSettings. Framework was universally required by the request, Organization and creation membership schema.

ACCOUNTING_FIRM wrote eight rows: those five plus cabinet metadata, OWNED initial dossier link and CabinetSettings. It assigned CABINET_ADMIN and retained cabinet audit logging. Creation of later client dossiers remains separately Accounting-oriented.

SPEC's Accounting-only onboarding and operational-only SALES activation descriptions were explicitly called out before implementation and updated for this authorized evolution. Platform identity, entitlement independence, domain ownership and stateful-resource boundaries remain intact.

## 3. New request/response contract

Existing exported schema/type names remain. The request is a strict discriminated union:

```ts
// COMPANY
{
  workspaceType: "COMPANY",
  organizationName: string,
  country: WorkspaceCountry,
  products: ProductCode[],
  accountingFramework?: "SYSCOHADA_REVISED" | "SYCEBNL"
}
// ACCOUNTING_FIRM: existing fields, required accountingFramework, no products
```

Response retains Organization, nullable cabinet, workspace and activeOrgId; runtime adds `productAccess: ProductAccess[]` with canonical public records (orgId, productCode, ACTIVE status and timestamps). The response schema accepts an absent array for compatibility with older responses/fixtures; new service responses always supply it. C can count the activated products without backend URLs or physical keys. Organization framework is optional to represent non-Accounting companies; existing records with a framework remain valid.

## 4. COMPANY validation rules

Products required, length 1–3, canonical enum only, strict uniqueness. ACCOUNTING requires a framework; without ACCOUNTING a framework is rejected. Unknown fields, client orgId/userId and productRoles fail shared schema validation. Existing authenticated wrapper behavior still strips orgId/userId before schema parsing; those fields cannot influence server-generated identity. Existing trimming, name length and country/framework enumerations remain.

## 5. ACCOUNTING_FIRM compatibility

Existing request retained without products; supplied products are rejected. Framework still required. Eight-row transaction, Accounting entitlement/settings, global OWNER, CABINET_ADMIN, cabinet metadata, initial dossier and CabinetSettings preserved. One later client-dossier call now passes its already validated request framework to the AccountingSettings builder because Organization's public framework is optional. No dossier workflow redesign.

## 6. ProductAccess creation

Existing `ProductAccessService.buildActivationWrite` and repository conditional builder used for every selected code. FIRM selects ACCOUNTING internally. No implicit dependencies, fourth product, second entitlement mechanism, migration or backfill. Compatibility-baseline builders remain unchanged for other existing callers.

## 7. ACCOUNTING bootstrap

Selected ACCOUNTING uses the existing AccountingSettingsService builder and direct OWNER permission projection. Legacy Organization/membership framework fields retained for selected ACCOUNTING. No framework field or AccountingSettings row persisted for SALES-only/RESTAURANTS-only. Cabinet behavior retained.

## 8. SALES bootstrap

Existing direct COMPANY OWNER already grants SALES_READ/WRITE; no SALES role subsystem added. Selected SALES includes its existing domain-owned SalesSettings activation write in the same onboarding transaction. Initial defaultCurrency is **XOF**, version 1. This is a documented application default, not a claim that every supported country uses XOF. The existing operational activation command remains available and unchanged. SALES entitlement does not initialize fiscal settings.

## 9. RESTAURANTS OWNER bootstrap

Selected RESTAURANTS adds `{ RESTAURANTS: "OWNER" }` to membership productRoles and response workspace. Existing effective-access projection supplies RESTAURANTS_READ, SETUP_MANAGE, MENU_READ and MENU_MANAGE. Global OWNER alone still implies no restaurant role. No Restaurant, Outlet or Menu is provisioned by onboarding; users configure them through RESTO-1 afterwards.

## 10. USER_ORG_ACCESS changes

One membership per workspace, still global OWNER and existing GSI6 projection. Persist existing optional productRoles when selected; allow absent accountingFramework. No separate users, memberships per product or tenant identities. FIRM retains CABINET_ADMIN and no restaurant role.

## 11. Transaction atomicity

All rows use one existing TransactWriteItems submission and conditional Put operations. COMPANY row count is `3 + selected products + ACCOUNTING settings if selected + SALES settings if selected`:

| Selection                | Rows |
| ------------------------ | ---: |
| ACCOUNTING               |    5 |
| SALES                    |    5 |
| RESTAURANTS              |    4 |
| ACCOUNTING + SALES       |    7 |
| ACCOUNTING + RESTAURANTS |    6 |
| SALES + RESTAURANTS      |    6 |
| All three                |    8 |
| ACCOUNTING_FIRM          |    8 |

Restaurant role is part of the membership write. Tests simulate conditional conflicts for entitlement, AccountingSettings and SalesSettings and verify no new Organization, membership, lock or remaining bootstrap rows survive. No asynchronous compensation.

## 12. Idempotency/duplicate protection

Existing active-workspace precheck retained. Existing user-scoped initial-workspace lock guarantees a stale GSI read or concurrent retry cannot create another organization. Successful retries are rejected with the existing 409 behavior, rather than returning the first response. Tests verify unchanged state for ordinary retry and stale-discovery retry with changed product intent. Existing transaction-cancellation error mapping retained.

## 13. Workspace discovery

No new discovery algorithm required: membership GSI6 Query plus consistent Organization BatchGet already supports missing framework and does not read Accounting entitlement. Preserved the pre-existing RESTO-1C productRoles projection. Production discovery tests confirm SALES-only and RESTAURANTS-only records, canonical Organization retrieval and role projection.

## 14. DynamoDB/KeyFactory impact

Access patterns: active memberships by user GSI6; Organization BatchGet; membership/Organization/ProductAccess/settings direct consistent Get; one conditional creation transaction. Existing keys only:

- `orgKey` + `organizationSK`: Organization.
- `orgKey` + `orgUserAccessSK`: membership.
- `userWorkspacesPK` + `initialWorkspaceLockSK`: duplicate guard.
- `userWorkspacesPK`/`userWorkspaceSK`: existing GSI6 membership discovery.
- `orgKey` + `productAccessSK`: selected entitlements.
- Existing Accounting/Sales settings and cabinet/dossier key helpers through their owning builders.

No changed physical key format, table, GSI, manual service PK/SK construction, Scan or ScanCommand in changed runtime onboarding code. Test harness observes zero Scan commands. Keys remain backend-only. Current discovery pagination/batch retry behavior is outside this task.

## 15. Fiscal Compliance separation

ProductCode unchanged: ACCOUNTING, SALES, RESTAURANTS only. No fiscal ProductAccess, provider bootstrap, DGI calls, token refresh or TEST interaction. Existing global-owner fiscal permission vocabulary is untouched and does not mean provider configuration exists. Fiscal work remains suspended at **S4C-0B1**.

## 16. Files changed by this task

1. `SPEC.md` — reconcile onboarding descriptions.
2. `packages/shared/src/shared/workspace.ts` — strict request variants, optional Organization framework, canonical response access list.
3. `packages/backend/lambda/shared/services/onboarding-service.ts` — selected entitlements and settings/role bootstrap.
4. `packages/backend/lambda/shared/repositories/onboarding-repository.ts` — optional framework/settings write, persist productRoles.
5. `packages/backend/lambda/shared/services/cabinet-dossier-service.ts` — validated framework compatibility adjustment.
6. `packages/backend/test/unit/identity/onboarding-products.test.ts` — new acceptance/contract/persistence/authorization/rollback tests.
7. `packages/backend/test/unit/identity/onboarding-service.test.ts` — explicit ACCOUNTING request fixtures.
8. `packages/backend/test/unit/identity/create-workspace.test.ts` — explicit ACCOUNTING requests and expected calls.
9. `packages/backend/test/unit/shared/workspace-schema.test.ts` — explicit ACCOUNTING request fixtures.
10. `packages/frontend/src/app/domains/identity/feature/onboarding/onboarding.page.ts` — existing COMPANY workflow explicitly submits ACCOUNTING.
11. `packages/frontend/src/app/domains/identity/feature/onboarding/onboarding.page.spec.ts` — expected request compatibility.
12. This report.

The frontend changes do not introduce product selection, conditional wizard steps or new routing.

## 17. Tests added/updated

New suite: 32 cases covering all seven selections through production services/repositories, exact rows and settings, single membership, response entitlement list, Organization/discovery, creator permission projection, protected RESTO-1 setup/menu handlers, cabinet regression, retries and three rollback conflicts. Contract cases cover required/nonempty/unique products, unknown and fiscal codes, framework requirements and strict client fields. Existing onboarding/handler/schema and frontend request assertions updated. Existing ProductAccess, discovery, role, Accounting, SALES and restaurant authorization suites retained.

## 18. Acceptance-fixture results

**A — Héritage Bistro: PASS.** COMPANY/BJ/RESTAURANTS; four onboarding rows; RESTAURANTS ACTIVE and OWNER; no SALES/ACCOUNTING/settings/framework; discoverable; protected setup and menu creation succeed after onboarding.

**B — Demo Sales: PASS.** COMPANY/BJ/SALES; only SALES entitlement, SalesSettings XOF, direct OWNER SALES_READ/WRITE; discoverable.

**C — Full Company: PASS.** All three selected, eight rows, SYSCOHADA_REVISED AccountingSettings and legacy framework, SalesSettings, restaurant OWNER, creator permissions and all exact entitlements verified.

**D — Accounting Firm: PASS.** Existing Cabinet Demo fixture, eight rows, only ACCOUNTING, CABINET_ADMIN, cabinet/dossier/settings regression preserved.

Names, product input and generated UUID sequence deterministic in the new test suite. Services and repositories are real; SDK storage and conditional atomicity are modeled in memory. No AWS/LocalStack/live acceptance run is claimed.

## 19. Validation commands and exact results

Node v22.22.3 via `PATH=/Users/kpadonou/.nvm/versions/node/v22.22.3/bin:$PATH`.

| Command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Final result                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build -w @liass-ohada/shared`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | exit 0; CJS/ESM/declarations successful                                                                                                                                                     |
| `npm run build -w @liass-ohada/backend`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | exit 0; strict tsc successful                                                                                                                                                               |
| `npm test -w @liass-ohada/backend -- --runInBand --runTestsByPath test/unit/identity/onboarding-products.test.ts test/unit/identity/onboarding-service.test.ts test/unit/identity/create-workspace.test.ts test/unit/shared/workspace-schema.test.ts test/unit/shared/product-access-service.test.ts test/unit/shared/product-access-repository.test.ts test/unit/identity/get-workspaces.test.ts test/unit/shared/domain-authorization-service.test.ts test/unit/restaurants/authorization.test.ts test/unit/sales/sales-customer-routes.test.ts test/unit/sales/sales-catalog-item-routes.test.ts` | exit 0; 11 suites, 221 tests passed                                                                                                                                                         |
| `npm test -w @liass-ohada/backend -- --runInBand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | exit 0; 152 suites, 1,208 tests passed                                                                                                                                                      |
| `npm test -w @liass-ohada/frontend -- --watch=false`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | exit 0; 118 files, 894 tests passed; package script contract tests also passed                                                                                                              |
| `npm run build:development -w @liass-ohada/frontend`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | exit 0; development bundle successful                                                                                                                                                       |
| `npm run build -w @liass-ohada/frontend`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | exit 1; production generator: Missing production frontend configuration: LIASS*COGNITO_REGION; expected cdk-outputs.prod.json or legitimate LIASS*\* variables. No configuration fabricated |
| `node node_modules/prettier/bin/prettier.cjs --check` with the shared/backend changed-file list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | exit 0; all matched files formatted                                                                                                                                                         |
| `node node_modules/prettier/bin/prettier.cjs --check --trailing-comma none` with the two frontend compatibility files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | exit 0; existing frontend comma convention preserved                                                                                                                                        |
| `git diff --check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | exit 0                                                                                                                                                                                      |
| Runtime static search for ScanCommand/manual PK/SK interpolation in onboarding service/repository                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | no matches; exit 1 as expected for no matches                                                                                                                                               |
| CDK synth/resource-count/diff, deployment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | not run; no infrastructure changes, no deployment authorized                                                                                                                                |

An initial validation attempt overlapped backend compilation with shared declaration generation; subsequent investigation found ignored stale `.js`/`.d.ts` generated siblings in `packages/shared/src` (July artifacts) causing declaration bundling to resolve the old contract. These artifacts were preserved under `/tmp/onb-shared-generated-backup` and removed from source, then shared rebuilt successfully. No tracked generated files or build configuration changes. Initial targeted run also referenced a nonexistent SALES authorization test path; final run uses existing SALES route authorization suites. These initial failed attempts are superseded by the final results above.

## 20. Infrastructure impact

No CDK/infrastructure files changed. Existing POST endpoint/Lambda retained in IdentityApiStack; no resources added/replaced, no stateful impact, migration or deployment. Resource counts unchanged by this task. Synth, resource-count and cloud diff not run because there are no CDK changes. No deployment performed.

## 21. Deviations and rationale

Added SalesSettings bootstrap because existing SALES activation requires entitlement and settings together; entitlement-only onboarding would leave invalid partial activation state and fail default-currency invoice behavior. XOF default avoids expanding this request into additional SALES configuration; it is recorded in SPEC. Response productAccess array optional in schema for older response compatibility, always emitted at runtime. Minimal frontend payload adaptation preserves the currently available Accounting onboarding while C is deferred. Existing cabinet caller adapted for TypeScript narrowing only.

## 22. Known limitations

Old COMPANY onboarding clients must add products; backend will not silently assume ACCOUNTING. Client/backend release coordination remains necessary. Current frontend can create Accounting companies and firms only until C. SALES default currency is XOF for every new selection; country-derived defaults or an explicit currency input/settings workflow are separate future decisions. Existing global OWNER authorization conventions remain broad, but active ProductAccess still independently gates product routes. Transaction cancellation retains existing generic duplicate-error mapping. Production frontend config and live deployment remain outstanding external prerequisites.

## 23. Git status

Branch `main`, HEAD `0935249`. Existing dirty tree preserved. No commit, staging, checkout or deployment performed. Git-status snapshot below includes pre-existing work and this task; it is not an A/B-only inventory.

```text
 M SPEC.md
 M packages/backend/lambda/shared/authorization/domain-permission.ts
 M packages/backend/lambda/shared/repositories/onboarding-repository.ts
 M packages/backend/lambda/shared/services/cabinet-dossier-service.ts
 M packages/backend/lambda/shared/services/domain-authorization-service.ts
 M packages/backend/lambda/shared/services/onboarding-service.ts
 M packages/backend/test/unit/identity/create-workspace.test.ts
 M packages/backend/test/unit/identity/onboarding-service.test.ts
 M packages/backend/test/unit/shared/workspace-schema.test.ts
 M packages/frontend/public/assets/i18n/en.json
 M packages/frontend/public/assets/i18n/fr.json
 M packages/frontend/src/app/core/product-access/product-access.guard.spec.ts
 M packages/frontend/src/app/core/restaurants/restaurants.page.html
 M packages/frontend/src/app/core/restaurants/restaurants.page.spec.ts
 M packages/frontend/src/app/core/restaurants/restaurants.page.ts
 M packages/frontend/src/app/core/routing/app.routes.spec.ts
 M packages/frontend/src/app/core/routing/app.routes.ts
 M packages/frontend/src/app/domains/identity/feature/onboarding/onboarding.page.spec.ts
 M packages/frontend/src/app/domains/identity/feature/onboarding/onboarding.page.ts
 M packages/frontend/src/app/domains/sales/utils/exact-money-display.ts
 M packages/frontend/src/app/shared/ui/searchable-select/searchable-select.component.spec.ts
 M packages/frontend/src/app/shared/ui/searchable-select/searchable-select.component.ts
 M packages/shared/src/shared/restaurants-access.ts
 M packages/shared/src/shared/workspace.ts
?? docs/architecture/onb-products-ab-validation.md
?? docs/architecture/resto-1c-frontend.md
?? packages/backend/test/unit/identity/onboarding-products.test.ts
?? packages/backend/test/unit/identity/restaurants-workspace-projection.test.ts
?? packages/frontend/scripts/restaurants-translations.test.mjs
?? packages/frontend/src/app/domains/restaurants/
?? packages/frontend/src/app/shared/utils/
```

## 24. ONB-PRODUCTS-A status

**PASS** — strict contracts and selected-product validation implemented and tested.

## 25. ONB-PRODUCTS-B status

**PASS** — exact entitlements, creator authorization/settings, atomicity, retries, discovery and firm compatibility locally validated.

## 26. ONB-PRODUCTS-C readiness

**YES** for implementation against these contracts, subject to the documented SALES currency default and release coordination. **C has not started.** No RESTO-1D, RESTO-2, fiscal work, commit or deployment.
