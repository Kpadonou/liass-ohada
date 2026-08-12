# Platform V2 Migration Assessment

## Purpose and scope

This assessment maps the current repository to the accepted Platform V2 model and records the incremental runtime foundations delivered after Phase 0. Phase 1 added ProductAccess, Phase 2 added Accounting-owned AccountingSettings, Phase 3 added explicit opt-in ProductAccess authorization, Phases 4–4G progressively separated entitlement, module RBAC, infrastructure, and tenant-context concerns, and Phase 4H1 realigns ProductAccess with the top-level product taxonomy: current ERP pilots belong to `ACCOUNTING`, while Treasury and Project Accounting remain module-granular for RBAC.

The assessment is based on the current shared schemas, Identity/Cabinet onboarding and authorization paths, centralized `KeyFactory`, domain handlers/services, Angular shell/state/routes, and CDK stack composition.

## Classification

- **KEEP**: retain the implementation and responsibility.
- **EVOLVE**: extend the current owner or contract through a compatible change.
- **MOVE**: transfer responsibility or code to the correct logical owner through a staged migration.
- **ADD**: introduce a missing Platform V2 concept.
- **DEFER**: make no implementation change until a concrete prerequisite or use case exists.

## Current-to-target migration map

| Area                                 | Class  | Current implementation/location                                                                                                                                                                                                                                                                                                          | Target responsibility                                                                                                                                                                                                                                                                          | Risk                                                                                                                                               | Dependencies                                                                                                             | Data migration                                                                                                                       | Recommended phase                                                                                                                                |
| ------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Organization DTO/schema              | EVOLVE | `packages/shared/src/shared/workspace.ts` still defines `OrganizationSchema` with `orgId`, identity fields, `accountingFramework`, and `workspaceType`; organization creation continues to persist the legacy field.                                                                                                                     | Platform Core Organization contains global identity, country, status, and lifecycle fields. AccountingSettings is now the preferred Accounting runtime source; the Organization copy remains a compatibility projection.                                                                       | High: used by onboarding, workspace discovery, cabinet authorization, Accounting, and tests.                                                       | Backfill coverage; compatibility-consumer inventory; versioned DTO plan.                                                 | A future cleanup may remove the legacy field only after compatibility coverage is proven; Phase 2 does not mutate Organization rows. | Phase 2 foundation implemented; physical field removal deferred.                                                                                 |
| Onboarding DTOs and workflow         | EVOLVE | `CreateInitialWorkspaceRequestSchema` remains unchanged. `OnboardingService` now asks the Accounting-owned settings service for a transaction write, and onboarding atomically creates the legacy Organization projection, ProductAccess baseline, and AccountingSettings.                                                               | Preserve the public request/response while Platform Core coordinates domain initialization through an Accounting-owned contract.                                                                                                                                                               | High: first-user flow, idempotency lock, transaction size, and public API compatibility.                                                           | Backfill execution and monitoring; future contract-version plan.                                                         | Existing organizations need only an additive AccountingSettings backfill; existing Organization rows remain untouched.               | Phase 2 dual-write implemented. COMPANY uses 7 transaction operations and ACCOUNTING_FIRM uses 10.                                               |
| `accountingFramework`                | MOVE   | Still required in Organization, onboarding, workspace/access projections, cabinet defaults/settings, and public frontend contracts. Accounting runtime resolution is centralized in `AccountingSettingsService`: settings first, legacy Organization fallback.                                                                           | Accounting owns `AccountingSettings.accountingFramework`. Legacy copies remain compatibility projections until a later reviewed cleanup.                                                                                                                                                       | Very high: Accounting validation and authorization context depend on it; removing early breaks contracts and existing items.                       | Backfill coverage; mismatch reporting; consumer migration; versioned contract removal.                                   | Additive AccountingSettings rows are required. Existing Organization values are neither deleted nor overwritten.                     | Phase 2 foundation implemented; legacy projections and final removal deferred.                                                                   |
| Workspace types                      | KEEP   | `WorkspaceTypeSchema` supports `COMPANY` and `ACCOUNTING_FIRM`; frontend guards, state, and cabinet flows branch on it.                                                                                                                                                                                                                  | Keep workspace context and cabinet supervision semantics. Do not add product codes or interpret workspace type as entitlement.                                                                                                                                                                 | Medium if overloaded by future navigation/authorization work.                                                                                      | ProductAccess and platform permission context.                                                                           | No.                                                                                                                                  | Preserve through all phases; stop new entitlement coupling in Phase 1 onward.                                                                    |
| `USER_ORG_ACCESS`                    | EVOLVE | Organization-partition item plus GSI6 discovery projection in `onboarding-repository.ts`; verified by `TenantAccessService`; contains role, workspace, country, and duplicated `accountingFramework`.                                                                                                                                    | Platform Core membership/access record. Keep direct organization access and user discovery; entitlement remains a separate organization-level concern. Retire accounting-specific projection only after Phase 2 compatibility work.                                                            | High: security-critical direct lookup and pre-tenant discovery path.                                                                               | ProductAccess resolution; workspace response composition; backfill compatibility.                                        | Not for ProductAccess. Yes only if obsolete duplicated attributes are later removed or rewritten.                                    | Phase 1 preserves shape; Phase 2/3 evolve composition and authorization.                                                                         |
| Cabinet model                        | KEEP   | Identity/Cabinet handlers and repositories own cabinet metadata, dossiers, members, assignments, settings, work, and deadlines; `ACCOUNTING_FIRM` drives supervision UX.                                                                                                                                                                 | Preserve the accounting-firm/cabinet supervision model and effective organization access. Cabinet access does not grant products by itself; the dossier organization still needs ProductAccess for domain actions.                                                                             | Medium: entitlement checks must not break supervised dossier access or reader access modes.                                                        | ProductAccess for dossier org; cabinet membership/assignment decision; Accounting permission mapping.                    | No for the cabinet model.                                                                                                            | Phase 3 adds entitlement to the existing decision chain.                                                                                         |
| `KeyFactory`                         | EVOLVE | `packages/backend/lambda/shared/key-builder.ts` centralizes organization, fiscal-year, cabinet, discovery, and domain keys. Phase 1 added ProductAccess helpers; Phase 2 adds `accountingSettingsSK()` returning `SETTINGS#ACCOUNTING`.                                                                                                  | Remain the concrete key authority. Domains use their own internal helpers plus shared Platform Core helpers; formats are not assembled at call sites.                                                                                                                                          | High if key formats or call sites are renamed; low for additive helpers.                                                                           | Domain repository boundaries and access-pattern tests.                                                                   | No for additive keys; any format replacement would require a separate migration.                                                     | ProductAccess and AccountingSettings helpers implemented additively.                                                                             |
| DynamoDB persistence                 | EVOLVE | One table in `DataStack`/`LiassOhadaAccountingTable`, accessed with Get/Query/BatchGet and transactions; Accounting uses fiscal-year partitions.                                                                                                                                                                                         | Keep one table and organization isolation. Add domain-owned item types using documented access patterns, Query/direct reads, conditional writes, and transactions. No domain may mutate another domain's items.                                                                                | High for authorization consistency, hot partitions, transaction limits, and backfills.                                                             | KeyFactory; repository ownership; access-pattern tests; migration metrics.                                               | Additive ProductAccess needs no rewrite; AccountingSettings requires a backfill.                                                     | Phases 1–3; no new table.                                                                                                                        |
| Identity service/repository boundary | EVOLVE | Identity handlers call services/repositories under `lambda/shared`; onboarding, membership, workspace discovery, cabinet, and profile concerns are mixed in the shared layer.                                                                                                                                                            | Platform Core Identity/Organization/Access owns membership and discovery. Product entitlement is resolved through a separate Platform Core contract. Cabinet-specific behavior remains explicit.                                                                                               | High: many handlers/tests import current static services directly.                                                                                 | Stable interfaces; incremental adapters; handler compatibility.                                                          | No.                                                                                                                                  | Phase 1 introduce entitlement owner; Phase 3 compose authorization.                                                                              |
| Authorization wrapper/middleware     | EVOLVE | `handler-wrapper.ts` resolves verified direct-company or cabinet/dossier access through Platform Core `EffectiveOrganizationAccessService`, then applies optional ProductAccess and exact domain permission checks. `AccountingAuthorizationService.resolveAccess` remains a compatibility delegate; Accounting's environment fallback remains unchanged. | Keep effective organization access in Platform Core. Migrate the remaining Accounting-named access-mode and frontend tenant-signal terminology separately only where the compatibility value justifies it. | Medium-high: ProductAccess and permission checks must remain independent, while direct membership, Accounting fallback, cabinet assignment, and public workspace contracts remain stable. | Access-matrix parity tests; route authorization tests; compatibility consumer inventory. | No. Effective access and permissions are derived from current relationships; no permission-code array or access mode is persisted. | Phase 4F extracts the Platform Core service without changing behavior, persistence, frontend, or infrastructure. |
| Frontend active-workspace state      | EVOLVE | `AuthStore` remains the canonical client/UI context. `activeOrgId` identifies the selected workspace, while `effectiveOrgId` is the direct company or selected active dossier organization used for tenant-scoped business requests and ProductAccess. ProductAccess stays in its organization-keyed TanStack Query cache. | Keep workspace/dossier context in Signal Store and organization-scoped ProductAccess in TanStack Query. All Accounting-product module navigation now observes the same canonical entitlement. | High: guards, interceptor headers, navigation, and cached tenant data depend on it. | ProductAccess coverage; backend authorization; query-key policy. | No. | Phase 4G makes the effective tenant signal domain-neutral; Phase 5D1b completes Accounting-product navigation awareness without changing tenant semantics. |
| Frontend shell/navigation            | MOVE   | Stateful shell components remain under `packages/frontend/src/app/shared/layout`. Platform Core ProductAccess orchestration lives under `packages/frontend/src/app/core/product-access`; Accounting Core, Project Accounting, and Treasury items declare canonical `ACCOUNTING` metadata.                                  | Platform Core owns product-aware navigation orchestration. `shared/ui` remains reusable and presentation-only, and the frontend remains a usability signal rather than a security boundary.                                                                                              | Medium-high: imports, lazy routes, responsive behavior, cabinet context, and technical-failure degradation can regress.                            | ProductAccess coverage; design-system skill; route metadata; deployed observation.                               | No.                                                                                                                                  | Phase 5D1b completes current Accounting-product navigation awareness. Physical shell relocation remains backlog only.                         |
| Dashboard                            | EVOLVE | `packages/frontend/src/app/core/feature/dashboard` is already platform-level but presents static cross-domain Accounting, Projects, Treasury, and Reporting data.                                                                                                                                                                        | Remain in Platform Core. Aggregate domain-provided KPIs only for enabled products and do not absorb domain calculations.                                                                                                                                                                       | Medium: accidental cross-domain service coupling or inconsistent loading/error states.                                                             | Product-aware shell context; domain query contracts; permission-filtered widgets.                                        | No.                                                                                                                                  | Phase 4 for visibility; real KPI integrations incrementally afterward.                                                                           |
| Shared schemas                       | EVOLVE | `packages/shared` exports workspace, cabinet, Accounting, Projects, and Treasury schemas. DTO variants omit persistence keys, but several domain subpaths also export persistence schemas containing `PK`, `SK`, `GSI*`, and `entityType`.                                                                                               | Add frontend-safe ProductAccess summaries and later AccountingSettings contracts in owning export boundaries. Move or isolate persistence schemas behind the backend-only export without breaking existing backend imports; keep frontend contracts free of physical keys.                     | High: frontend and backend consume the same domain subpaths, generated JS/declarations must stay synchronized, and export removal can be breaking. | Shared export map; backend import inventory; compatibility re-exports; frontend response validation.                     | No data rewrite, but a staged code/API migration is required.                                                                        | Phase 1 keeps new persistence schemas backend-only; existing schema cleanup is a separate incremental MOVE after consumers are inventoried.      |
| Domain service/repository placement  | MOVE   | Accounting, Projects, Treasury, onboarding, cabinet, and other business services/repositories are physically co-located under `packages/backend/lambda/shared/services` and `repositories`, while handlers are domain-organized.                                                                                                         | Business services and repositories move incrementally behind their owning domain boundary; only business-neutral infrastructure remains shared. Imports across domains use contracts, APIs, or events rather than internals.                                                                   | High: broad import/test churn and potential circular dependencies.                                                                                 | Stable owner map; adapters; focused domain tests; no key changes.                                                        | No.                                                                                                                                  | Do not perform as a broad refactor. Move only the files touched by reviewed Phases 1–5, one owner at a time.                                     |
| CDK stacks                           | KEEP   | `api-domain-stacks.ts` composes Identity, Accounting, Projects, and Treasury nested stacks; API core owns shared API/Cognito/role; DataStack owns the table.                                                                                                                                                                             | Preserve names, ownership, and nested-stack architecture. Add future business resources only to the coherent owning stack; Platform Core only for genuinely shared resources.                                                                                                                  | High if stateful resources move or logical IDs change.                                                                                             | CDK placement guide; synth/resource counts/diff for future runtime phases.                                               | No.                                                                                                                                  | No Phase 0 change; Phase 1 should prefer existing Identity/Platform Core ownership without stack rename.                                         |
| API Gateway                          | KEEP   | One shared HTTP API and authorizer are passed into domain nested stacks.                                                                                                                                                                                                                                                                 | Remain the principal platform API boundary. Cross-domain contracts do not require a new API Gateway or premature microservices.                                                                                                                                                                | Low if reused; high if duplicated.                                                                                                                 | Existing authorizer and route composition.                                                                               | No.                                                                                                                                  | Keep.                                                                                                                                            |
| Cognito                              | KEEP   | One User Pool, client, authorizer, hosted UI domain, and social providers are owned by API core auth constructs.                                                                                                                                                                                                                         | Remain the shared Liass-OHADA identity provider for every product and vertical.                                                                                                                                                                                                                | High if replaced or duplicated.                                                                                                                    | Existing OAuth domains and frontend Amplify configuration.                                                               | No.                                                                                                                                  | Keep.                                                                                                                                            |
| Accounting                           | KEEP   | Mature handlers under `lambda/domains/accounting`, Accounting nested stack, and shared Accounting DTOs remain. All 50 Accounting Core routes require canonical `ACCOUNTING` ProductAccess before their unchanged `ACCOUNTING_READ`/`ACCOUNTING_WRITE` permission. Phase 2 AccountingSettings behavior remains compatible. | Remain an ERP domain with unchanged SYSCOHADA/SYCEBNL authority, fiscal sharding, transactions, and audit requirements. Accounting owns its settings and accepts cross-domain integrations only through owned contracts.                                                                       | High for any rule or persistence change.                                                                                                           | Canonical ACCOUNTING coverage; legacy projection retirement; independent RBAC.                                            | AccountingSettings rows are additive; Accounting transactions are not migrated.                                                      | Phase 5D1b completes ProductAccess coverage; business and persistence behavior remain unchanged.                                                   |
| Project Accounting / technical Projects | EVOLVE | Backend/frontend `projects` domains, Project stack, `/projects` routes, and `PROJECTS_*` RBAC remain. All 11 Project Accounting routes enforce top-level `ACCOUNTING` ProductAccess before module RBAC. Reporting consumes Accounting facts only through `AccountingProjectReportingService`. | Treat the capability as the Project Accounting module of the Accounting product while preserving technical identifiers and the Accounting-owned reporting boundary. | High: SYCEBNL reporting totals, historical queries, GSI4 behavior, and compatibility names must remain stable. | Canonical ACCOUNTING coverage; module RBAC; OHADA/SYCEBNL references; reviewed module contract. | No permission migration. Legacy `PRODUCT_ACCESS#PROJECTS` remains until Phase 4H2. | Phase 5D1a completes module-level ProductAccess enforcement; broad technical rename remains deferred. |
| Treasury                             | EVOLVE | Backend/frontend Treasury modules and Treasury stack remain. All 10 Treasury routes enforce top-level `ACCOUNTING` ProductAccess before `TREASURY_*` RBAC. Reconciliation, account references, and Treasury posting remain behind the three Accounting-owned application boundaries. | Treat Treasury as an Accounting module with independently granular RBAC. Keep module collaboration behind the three narrow synchronous Accounting-owned contracts without inventing module entitlement. | Very high: posting, reconciliation, transaction atomicity, access, and audit behavior are production-sensitive. | Canonical ACCOUNTING coverage; module RBAC; posting/reconciliation parity tests; reviewed integrity hardening. | No permission or data migration. Legacy `PRODUCT_ACCESS#TREASURY` remains until Phase 4H2B. | Phase 5D1a completes module-level ProductAccess enforcement; unsupported Treasury → Accounting persistence access remains zero. |
| Events / EventBridge                 | DEFER  | No application EventBridge producer/consumer implementation was found; only a CDK feature flag references events behavior.                                                                                                                                                                                                               | Introduce versioned event contracts and transport only when a real producer and consumer require asynchronous integration, with idempotency, retries, observability, and ownership.                                                                                                            | High if introduced speculatively: operational complexity, duplicate delivery, ordering, and audit concerns.                                        | Concrete use case; contract owner; consumer idempotency; CDK placement and resource budget.                              | No.                                                                                                                                  | Phase 5, per real integration. EventBridge is an option, not a mandated transport.                                                               |
| ProductAccess                        | ADD    | Public/canonical `ProductCode` contains only `ACCOUNTING`. Backend persistence can still parse historical `PROJECTS`/`TREASURY` rows, but service reads filter them from public semantics. Both module pilots enforce `ACCOUNTING`; their RBAC stays module-specific. | Represent only top-level product or vertical entitlement. Keep membership, workspace type, module RBAC, AccountingSettings, and presentation separate. | High during rollout because canonical ACCOUNTING coverage must precede reliance on the pilots. | Explicit-ID coverage/backfill; legacy-row inventory; pilot telemetry. | Existing ACCOUNTING rows are preserved. Historical PROJECTS/TREASURY rows remain untouched until Phase 4H2. | Phase 4H1 implemented; deletion and storage-compatibility removal deferred. |
| Restaurants                          | DEFER  | No tracked Restaurants backend/frontend/shared/CDK implementation exists.                                                                                                                                                                                                                                                                | First planned `VERTICAL_SOLUTION`, inside the same application, identity, organization boundary, and table strategy, with its own domain ownership.                                                                                                                                            | High if started before entitlement and integration boundaries stabilize.                                                                           | Phases 1–5; reviewed domain model and real access patterns.                                                              | None until implemented.                                                                                                              | Phase 6 only.                                                                                                                                    |

## ProductAccess access patterns implemented in Phase 1

Tenant-owned ProductAccess items use the organization partition and KeyFactory-defined sort keys:

```text
PK = ORG#{orgId}
SK = PRODUCT_ACCESS#{productCode}
```

Implemented and tested patterns:

1. Get one organization's entitlement for one product using a direct organization-scoped key, ready for later authorization composition.
2. List enabled products for one organization for the platform shell using an organization-scoped `Query`.
3. Create baseline entitlements idempotently for a newly onboarded organization, preserving the current onboarding transaction and retry behavior.
4. Backfill baseline entitlements for explicitly supplied organization IDs using conditional puts; no organization-enumeration `Scan` or new GSI is used.

`KeyFactory.productAccessSK` supports direct lookup and `KeyFactory.productAccessPrefix` supports listing with `Query`. Public status mutation remains deferred because Phase 1 has no entitlement administration workflow.

Phase 4H1 distinguishes canonical top-level product codes from backend-only storage compatibility. Canonical writes, authorization, public DTOs, coverage, and observation use `ACCOUNTING` only. The existing organization-partition Query can still parse historical `PRODUCT_ACCESS#PROJECTS` and `PRODUCT_ACCESS#TREASURY` items so they can be reported for later cleanup; the Platform Core service filters those rows before returning public data. No key, index, table, Scan, or legacy-row mutation was introduced.

## AccountingSettings access patterns implemented in Phase 2

Accounting owns the backend persistence model and service under `packages/backend/lambda/domains/accounting/settings`. The public, strict DTO is exported from the shared Accounting boundary without persistence metadata.

```text
PK = ORG#{orgId}
SK = SETTINGS#ACCOUNTING
entityType = ACCOUNTING_SETTINGS
```

Implemented and tested patterns:

1. Resolve one organization's AccountingSettings through a consistent direct `GetItem`.
2. Provision settings in the existing atomic onboarding transaction through an Accounting-owned write contract. After Phase 4H1 taxonomy provisioning, COMPANY onboarding contains 5 operations and ACCOUNTING_FIRM onboarding contains 8, safely below the 100-operation DynamoDB transaction limit.
3. Provision settings when an accounting firm creates a client organization; that transaction now contains 5 operations including canonical ACCOUNTING ProductAccess.
4. Prefer AccountingSettings in the centralized Accounting resolver, falling back to the legacy Organization value only while migration coverage is incomplete. Fiscal-year creation and lettering use this resolver. Fiscal-year framework snapshots and public workspace projections remain unchanged.
5. Backfill explicitly supplied organization IDs in dry-run mode by default. `--apply` uses a conditional put, never overwrites settings, reports mismatches, and does not use `Scan` or a new GSI.

New onboarding continues to write `Organization.accountingFramework` as a compatibility projection. Backfill adds only the AccountingSettings item and never updates or deletes the Organization item.

## ProductAccess authorization foundation implemented in Phase 3

`ProductAccessService` is the Platform Core owner of both the compatibility baseline and the centralized authorization primitive:

```text
ProductAccessService.requireActiveProductAccess({ action, orgId, productCode })
```

The operation validates `orgId` and `productCode`, performs the existing consistent direct `GetItem`, allows only `ACTIVE`, and returns `PRODUCT_ACCESS_REQUIRED` for missing or `INACTIVE` access. Denials emit `[PRODUCT_ACCESS_AUTHORIZATION_DENIED]` with the explicit action, organization, product, and `MISSING`/`INACTIVE` reason, without identity payloads or persistence metadata.

Business handlers opt in through typed wrapper metadata:

```ts
createHandler(schema, logic, {
  action: "GET /treasury/summary",
  permission: "TREASURY_READ",
  productCode: "ACCOUNTING",
});
```

The wrapper preserves this order for annotated handlers:

```text
JWT authentication
-> effective organization membership/access
-> ProductAccess
-> explicit owning-domain permission
-> handler/service
```

Phases 5D1a and 5D1b complete enforcement across the current Accounting product. All 50 Accounting Core, 11 Project Accounting, and 10 Treasury routes require top-level `ACCOUNTING` ProductAccess followed by their unchanged module permission. Identity, onboarding, workspace discovery, `GET /me/product-access`, cabinet recovery/administration, and all pre-tenant flows remain non-enforcing.

All two production Organization-creation workflows now use `ProductAccessService.buildCompatibilityBaselineWrites`, the single baseline definition:

- first-workspace COMPANY and ACCOUNTING_FIRM onboarding now contain 5 and 8 transaction operations respectively;
- cabinet-created client organizations contain Organization, UserOrgAccess, cabinet dossier, one `ACCOUNTING` ProductAccess row, and AccountingSettings: 5 transaction operations.

The explicit-ID ProductAccess backfill remains dry-run by default. Canonical completeness depends only on the presence of `ACCOUNTING`; ACTIVE and INACTIVE are both preserved as existing canonical rows, while a missing row is `MISSING`. Historical Projects/Treasury rows are reported in `legacyPresent` but neither satisfy nor invalidate canonical coverage. `--apply` conditionally creates only missing ACCOUNTING and never overwrites or deletes any row. No `Scan`, GSI, or automatic production migration was introduced.

## Product-aware frontend shell pilot implemented in Phase 4

Platform Core owns the frontend ProductAccess client, TanStack Query options, query state, and pure availability semantics under `packages/frontend/src/app/core/product-access`. The client treats `GET /me/product-access` as `unknown`, validates it with the strict shared `ProductAccessListResponseSchema`, rejects persistence fields and responses containing a different organization, and relies on the existing authenticated interceptor for `x-org-id`.

The query is enabled only after authentication, workspace discovery, and an effective organization context exist. Its key is:

```text
["product-access", effectiveOrgId]
```

For a direct company, the effective organization is the active workspace organization. For an accounting firm operating a client dossier, it is the selected client organization, matching the tenant used by existing business requests. Query keys isolate organization caches, and no previous-organization placeholder data is used. ProductAccess has a five-minute `staleTime` and no polling.

The existing navigation model supports optional typed `productCode?: ProductCode` metadata. Treasury and Project Accounting navigation now both declare `ACCOUNTING`. After a successful query, ACCOUNTING ACTIVE keeps both interactions unchanged, while INACTIVE or missing keeps both annotated items visible with the localized, accessible unavailable state and prevents normal sidebar actions. Loading and technical failures remain `UNKNOWN` and preserve legacy navigation. Accounting Core navigation remains deliberately unannotated. No Angular guard, redirect, administration workflow, or frontend security boundary was added.

Operational prerequisite: verify or backfill canonical ACCOUNTING coverage for existing production organizations before broad use of product-aware navigation. Historical PROJECTS/TREASURY rows do not affect module availability and cannot substitute for a missing ACCOUNTING row.

## Projects ProductAccess rollout implemented in Phase 4B

The technical Projects domain is canonically the Project Accounting module. The backend annotates only `GET /donors` with top-level `ACCOUNTING` ProductAccess and module permission `PROJECTS_READ`. It remains a tenant-scoped read operation that does not traverse the reporting paths querying Accounting-owned GSI4 projections.

The frontend attaches `productCode: "ACCOUNTING"` to both the existing Projects and Treasury navigation items and reuses the established `AVAILABLE`/`UNAVAILABLE`/`UNKNOWN` presentation. Accounting Core navigation deliberately declares no product metadata and remains visually and behaviorally unchanged during this staged rollout.

The organization-keyed query continues to isolate direct-company and selected-dossier contexts. A successful response with missing or INACTIVE ACCOUNTING renders both module pilots unavailable; loading or a technical/validation failure remains UNKNOWN. Conflicting legacy Projects/Treasury rows are absent from the public response and cannot override ACCOUNTING. Direct URLs remain unchanged because no Angular entitlement guard or redirect exists.

## Domain RBAC foundation implemented in Phase 4C

Permission codes are not persisted directly. `USER_ORG_ACCESS` stores membership, status, role, and workspace context; cabinet membership and dossier assignments establish effective access. Platform Core `EffectiveOrganizationAccessService.resolveAccess` preserves those membership rules and derives `READ_ONLY` for assigned Cabinet Readers and `READ_WRITE` for direct-company access and the existing writable Cabinet roles. Accounting route compatibility still obtains its required `ACCOUNTING_READ`/`ACCOUNTING_WRITE` permission from Lambda configuration when typed metadata is absent.

The backend-only permission vocabulary is now:

```text
Accounting: ACCOUNTING_READ, ACCOUNTING_WRITE
Projects:   PROJECTS_READ, PROJECTS_WRITE
Treasury:   TREASURY_READ, TREASURY_WRITE
```

`DomainAuthorizationService` centrally maps current `READ_ONLY` access to all three READ permissions and current `READ_WRITE` access to all six READ/WRITE permissions. This is a role-derived compatibility migration, not a legacy alias: `ACCOUNTING_READ` does not satisfy `PROJECTS_READ` or `TREASURY_READ`, and domain permissions do not grant one another or grant Accounting access. Existing legitimate users retain the same effective read/write access without permission-code persistence or data migration.

The typed pilot metadata and authorization requirements are:

```text
GET /donors
  PROJECTS ProductAccess ACTIVE
  PROJECTS_READ

GET /treasury/summary
  TREASURY ProductAccess ACTIVE
  TREASURY_READ
```

ProductAccess rollout remains Accounting 0/50, Projects 1/11, and Treasury 1/10. Before Phase 4D1, the remaining effective legacy inventory was Projects: 6 read routes and 4 write routes; Treasury: 4 read routes and 5 write routes. Accounting's 50 routes remain canonical `ACCOUNTING_*` consumers. Platform Core routes remain outside business-domain permissions.

Compatibility removal does not apply to an Accounting-to-domain alias because no alias was introduced. The legacy Projects/Treasury route configuration may be retired only after all routes use owning-domain permissions, role/access projections yield the required permissions, any future persisted permission representation is migrated, tests no longer depend on the Accounting-named configuration, and production telemetry shows no legitimate dependency on it.

## Projects and Treasury read RBAC migration implemented in Phase 4D1

Every Projects and Treasury read operation now declares its owning-domain permission through typed handler metadata. Permission-only metadata does not carry `productCode`, so it performs membership and exact RBAC checks without ProductAccess enforcement. The two pilots retain their existing full metadata and authorization order.

```text
Projects:  7 PROJECTS_READ routes; 4 ACCOUNTING_WRITE routes remain
Treasury:  5 TREASURY_READ routes; 5 ACCOUNTING_WRITE routes remain
Accounting: 25 ACCOUNTING_READ routes; 25 ACCOUNTING_WRITE routes

ProductAccess annotations:
Accounting 0/50
Projects   1/11
Treasury   1/10
```

The migrated Projects routes are `GET /projects`, `GET /projects/{projectId}`, `GET /projects/{projectId}/funding-sources`, `GET /projects/{projectId}/budget-lines`, `GET /projects/{projectId}/report`, and `GET /projects/summary`; `GET /donors` was already canonical. The migrated Treasury routes are `GET /treasury/accounts`, `GET /treasury/accounts/{treasuryAccountId}/movements`, `GET /treasury/accounts/{treasuryAccountId}/statement-lines`, and `GET /treasury/reconciliations`; `GET /treasury/summary` was already canonical.

The remaining write debt is Projects: `POST /donors`, `POST /projects`, `POST /projects/{projectId}/funding-sources`, and `POST /projects/{projectId}/budget-lines`; Treasury: `POST /treasury/accounts`, `POST /treasury/transactions`, `POST /treasury/accounts/{treasuryAccountId}/statement-lines/import`, `POST /treasury/reconciliations`, and `POST /treasury/reconciliations/{matchId}/cancel`. These still use `ACCOUNTING_WRITE`; none is ProductAccess-enforced because the two entitlement pilots remain read-only.

No role, access relationship, permission record, `USER_ORG_ACCESS` item, DynamoDB model, frontend behavior, or CDK resource changes in Phase 4D1. Existing Lambda `ACCOUNTING_PERMISSION` values and the Accounting-named Projects/Treasury CDK registries remain as temporary configuration debt; explicit handler metadata overrides them only for migrated reads. Cleanup is deferred until write migration completes.

## Projects and Treasury write RBAC migration implemented in Phase 4D2

The remaining four Projects mutations now declare `PROJECTS_WRITE`, and the remaining five Treasury mutations declare `TREASURY_WRITE`. Permission checks remain exact: Projects, Treasury, and Accounting write permissions do not satisfy one another. Existing `READ_ONLY` and `READ_WRITE` access-mode derivation is unchanged, so no role, membership, cabinet assignment, permission record, or access projection requires migration.

```text
Accounting: 25 ACCOUNTING_READ; 25 ACCOUNTING_WRITE
Projects:    7 PROJECTS_READ;    4 PROJECTS_WRITE
Treasury:    5 TREASURY_READ;    5 TREASURY_WRITE

ProductAccess annotations:
Accounting 0/50
Projects   1/11
Treasury   1/10
```

Projects mutations migrated: `POST /donors`, `POST /projects`, `POST /projects/{projectId}/funding-sources`, and `POST /projects/{projectId}/budget-lines`. Treasury mutations migrated: `POST /treasury/accounts`, `POST /treasury/transactions`, `POST /treasury/accounts/{treasuryAccountId}/statement-lines/import`, `POST /treasury/reconciliations`, and `POST /treasury/reconciliations/{matchId}/cancel`. Their request validation, services, conditions, transactions, persistence, responses, and error behavior are unchanged. In particular, Treasury still delegates transaction posting to `LedgerService` and directly updates Accounting entry-line reconciliation fields; the permission migration does not legitimize or refactor that coupling.

The Projects and Treasury CDK registries still contain 10 Accounting-named handler entries each, covering 11 Projects route mappings and 10 Treasury route mappings. `DomainConstructFactory` therefore still supplies `ACCOUNTING_PERMISSION` to those Lambdas, but every Projects and Treasury handler now ignores it because explicit metadata wins. The wrapper fallback, `ACCOUNTING_PERMISSION_NOT_CONFIGURED` messages, Jest setup, and Accounting endpoint registry remain active for Accounting routes. A separate structural cleanup should stop injecting the obsolete variable into Projects/Treasury while preserving Accounting behavior and CloudFormation identities.

## Projects and Treasury authorization infrastructure cleanup implemented in Phase 4E

`ProjectEndpoints` and `TreasuryEndpoints` no longer pass the optional `accountingPermission` property to `DomainConstructFactory`. The dead `PROJECT_ENDPOINT_PERMISSIONS` and `TREASURY_ENDPOINT_PERMISSIONS` constants were removed; `ACCOUNTING_ENDPOINT_PERMISSIONS`, `requireEndpointPermission`, factory environment support, wrapper fallback, Accounting translations, and Accounting tests remain intact. No replacement domain-permission environment variable was introduced.

All 11 Projects and 10 Treasury route mappings continue using the same handlers, function names, construct IDs, nested stacks, API routes, table, authorizer, and role. Their synthesized Lambda environments lose only `ACCOUNTING_PERMISSION`. The Projects and Treasury ProductAccess pilots and route permission inventory are unchanged. Accounting's 50 route mappings continue receiving `ACCOUNTING_PERMISSION` for the existing fallback.

## Effective organization access extraction implemented in Phase 4F

`EffectiveOrganizationAccessService.resolveAccess` is now the single Platform Core implementation for direct-company and cabinet/dossier effective access. It preserves the existing direct `USER_ORG_ACCESS` lookup, cabinet membership lookup, consistent dossier/organization/assignment snapshot, validation order, access modes, permission derivation, and error codes. `handler-wrapper.ts` depends on this generic service before ProductAccess and domain RBAC.

`AccountingAuthorizationService.resolveAccess` remains a compatibility delegate to the new service. Its `assertPermission` and `resolve` methods remain Accounting-specific helpers; there is no second membership-resolution implementation. ProductAccess annotations remain Accounting 0/50, Projects 1/11, and Treasury 1/10. No shared DTO, frontend, CDK, DynamoDB, `USER_ORG_ACCESS`, KeyFactory, repository access pattern, or business integration changes in Phase 4F.

`AccountingAccessMode` inventory for a possible later terminology migration:

| Classification | Consumers | Future migration type |
| --- | --- | --- |
| `BACKEND_INTERNAL_GENERIC` | `EffectiveOrganizationAccessService`, `DomainAuthorizationService`, and `HandlerContext.accountingAccessMode` | `CODE_ONLY` for internal symbols, while retaining the shared type alias during transition. |
| `BACKEND_ACCOUNTING_SPECIFIC` | `AccountingAuthorizationService` compatibility context and Accounting permission helpers | `COMPATIBILITY_ALIAS`; Accounting callers can migrate after the generic type exists. |
| `SHARED_PUBLIC_CONTRACT` | `AccountingAccessModeSchema`/type exports and `CabinetDossierSummarySchema.accessMode` | `COMPATIBILITY_ALIAS`; keep `accessMode` and serialized `READ_ONLY`/`READ_WRITE` values unchanged. Abrupt removal would be an API/type-contract migration. |
| `FRONTEND` | Identity `AuthStore.activeAccountingAccessMode`, Accounting write gating, and workspace/dossier consumers | `COMPATIBILITY_ALIAS` plus coordinated code rename; no wire-format change is necessary. |
| `TEST_ONLY` | Backend workspace/authorization tests and frontend AuthStore, interceptor, layout, and cabinet fixtures | `CODE_ONLY` after production aliases exist. |
| `PERSISTED_DATA` | None. Access mode is derived from active direct membership or cabinet role/assignment and projected into dossier responses. | No `DATA_MIGRATION`. |

Phase 4G renamed the frontend-only computed signal to `effectiveOrgId`. It returns the active company `orgId`, or the selected active client dossier `orgId` after dossier loading succeeds. The tenant HTTP interceptor, Platform Core ProductAccess query, Accounting/Projects/Treasury query keys, and Accounting fiscal-year context consume this single signal. `activeOrgId` remains the selected workspace and may differ in cabinet/dossier context. The effective signal is not serialized, returned by an API, or persisted, so no compatibility alias, API migration, or data migration was required. `AccountingAccessMode` remains intentionally deferred.

## `accountingFramework` occurrence classification after Phase 2

- **PUBLIC_CONTRACT**: shared Organization, workspace, onboarding, cabinet, fiscal-year, and the new AccountingSettings DTOs. Existing compatibility fields remain required.
- **ORGANIZATION_PERSISTENCE**: onboarding and cabinet-dossier organization/access records continue writing the legacy projection; AccountingSettings is a separate Accounting-owned item.
- **ACCOUNTING_DOMAIN**: the AccountingSettings repository/service owns current configuration resolution. Fiscal-year creation and lettering are `MIGRATE_NOW` and now use it. Fiscal-year snapshots, closing, authorization context, and response projections are `COMPATIBILITY_ONLY` or `DEFER` because changing them would alter established access or historical behavior.
- **PLATFORM_CORE**: onboarding, tenant context, workspace discovery, and cabinet orchestration continue carrying the compatibility projection. Platform Core coordinates the Accounting-owned onboarding write but does not own settings validation or retrieval semantics.
- **PROJECTS**: no direct runtime `accountingFramework` consumer was found.
- **TREASURY**: no direct runtime `accountingFramework` consumer was found.
- **FRONTEND**: onboarding, active-workspace, cabinet settings/dossier, and Accounting display code continue consuming existing public projections; no executable frontend code changes in Phase 2.
- **TEST**: backend and frontend fixtures retain legacy fields while focused AccountingSettings tests cover the new source and fallback.
- **SEED_OR_SCRIPT**: existing seed/local scripts retain legacy inputs; the new explicit-ID AccountingSettings backfill reads them without mutation.
- **DOCUMENTATION**: Platform V2 documents describe AccountingSettings ownership and the temporary compatibility state.

## Proposed implementation phases

### Phase 0 — Architecture canonicalization

Adopt the Platform V2 specification, ADR, Codex skill, instruction updates, and this migration map. Make no runtime or AWS changes.

### Phase 1 — ProductAccess foundation

Implemented additively: frontend-safe ProductAccess contracts, organization-scoped persistence and KeyFactory helpers, a Platform Core repository/service, default Accounting/Projects/Treasury entitlements for onboarding, an explicit-ID idempotent backfill, and the read-only `GET /me/product-access` endpoint. Authorization, menus, workspaces, and user-visible capabilities remain unchanged.

### Phase 2 — Separate AccountingSettings conceptually/runtime-safe

Implemented: Accounting-owned settings and persistence validation, atomic onboarding dual-write, explicit-ID dry-run backfill, and a centralized settings-first resolver with legacy Organization fallback. Fiscal-year creation and lettering use the resolver. Existing onboarding, Organization, workspace, cabinet, and frontend contracts retain `accountingFramework`; removal remains deferred until coverage and consumers are proven.

### Phase 3 — Platform authorization

Implemented as a progressive foundation: centralized ACTIVE entitlement enforcement, typed opt-in handler metadata, denial telemetry, complete new-organization provisioning, coverage reporting, and one read-only Treasury pilot. All other business and Platform Core routes remain non-enforcing until coverage and pilot behavior are verified.

### Phase 4 — Platform shell/navigation

Implemented as a presentation pilot: ProductAccess remains tenant-scoped TanStack Query server state, the shell supports optional typed product metadata, and only Treasury navigation reacts to known entitlement results. Accounting, Projects, dashboard, direct URLs, and Platform Core recovery flows remain unchanged. Broader product rollout and any physical shell relocation remain deferred until the pilot and production coverage are verified.

### Phase 4B — Projects controlled rollout

Implemented as the second product pilot: exactly one read-only Projects route (`GET /donors`) opts into `PROJECTS` authorization, and the existing Projects navigation item consumes the same Platform Core availability state as Treasury. Accounting remains excluded, direct URLs remain unchanged, and 10 of 11 Projects routes stay unannotated.

### Phase 4C — Domain RBAC foundation

Implemented without persistence changes: domain-specific read/write permission codes, one centralized exact-match permission service, and role/access-mode-derived grants preserve current users. Only the two existing ProductAccess pilots declare `PROJECTS_READ` and `TREASURY_READ`; all other route behavior and frontend behavior remain unchanged.

### Phase 4D1 — Projects and Treasury read RBAC migration

Implemented without entitlement, persistence, frontend, or infrastructure changes: every Projects read route declares `PROJECTS_READ` and every Treasury read route declares `TREASURY_READ`. Permission-only metadata does not trigger ProductAccess. The four Projects and five Treasury write routes remain on `ACCOUNTING_WRITE` for Phase 4D2.

### Phase 4D2 — Projects and Treasury write RBAC migration

Implemented without entitlement, persistence, frontend, infrastructure, or business-logic changes: every Projects write route declares `PROJECTS_WRITE` and every Treasury write route declares `TREASURY_WRITE`. All Projects and Treasury route-level RBAC now uses owning-domain vocabulary. Accounting remains unchanged.

### Phase 4E — Projects and Treasury authorization infrastructure cleanup

Implemented as an environment-only CDK cleanup: Projects and Treasury stop receiving `ACCOUNTING_PERMISSION`, and their obsolete Accounting-named registries are removed. Typed handler metadata remains authoritative, ProductAccess counts do not change, and Accounting keeps its historical fallback.

### Phase 4F — Effective organization access service extraction

Implemented as a Platform Core structural refactor: `EffectiveOrganizationAccessService` owns the single direct-company and cabinet/dossier access-resolution implementation, the handler wrapper consumes it directly, and `AccountingAuthorizationService.resolveAccess` remains a compatibility delegate. Access behavior, public contracts, ProductAccess, RBAC, persistence, frontend, and CDK remain unchanged.

### Phase 4G — Effective organization context naming cleanup

Implemented as an atomic frontend-only rename: Identity `AuthStore` now exposes `effectiveOrgId` as the single effective business-tenant signal. The tenant interceptor, ProductAccess, Accounting, Projects, Treasury, fiscal-year context, tests, and mocks use the new name with identical values, headers, and query keys. `activeOrgId`, dossier selection, public contracts, backend authorization, persistence, and infrastructure remain unchanged.

### Phase 4H1 — Product taxonomy realignment

Implemented as a compatibility-first entitlement correction: public and canonical ProductAccess contains only `ACCOUNTING`; new organizations receive one ACCOUNTING row; `GET /donors`, `GET /treasury/summary`, and both module navigation pilots use ACCOUNTING while retaining `PROJECTS_*` and `TREASURY_*` RBAC. Backend persistence continues parsing historical PROJECTS/TREASURY rows, but Platform Core filters them from public and authorization semantics. No legacy row is deleted or rewritten.

### Phase 4H2A — Legacy ProductAccess cleanup tool

Implemented as operational tooling only. `cleanup:legacy-product-access` accepts explicit organization IDs through repeatable `--org-id` arguments and/or `--org-ids-file`; dry-run is the default and writes require `--apply`. It performs three direct, consistent keyed reads per organization for ACCOUNTING, PROJECTS, and TREASURY. It never scans or discovers tenants automatically.

Canonical ACCOUNTING row presence is the deletion gate. ACTIVE and INACTIVE both qualify because cleanup does not change entitlement status; missing or structurally mismatched ACCOUNTING blocks all deletion for that organization. Existing legacy rows are deleted only when their key and stored `entityType`, `orgId`, and `productCode` match the expected organization/code, and the delete repeats those identity checks conditionally to fail safely if the row changes. PROJECTS/TREASURY absence is an idempotent clean result. The migration-only API cannot accept ACCOUNTING as a deletion target.

The safe operational sequence is:

1. Deploy Phase 4H1 so runtime and new provisioning no longer depend on legacy module rows.
2. Verify canonical ACCOUNTING coverage with the existing explicit-ID ProductAccess backfill/coverage tool.
3. Run the Phase 4H2A cleanup in dry-run mode for explicit organization IDs.
4. Resolve missing/mismatched canonical coverage and any legacy-row identity mismatches.
5. Re-run with `--apply` explicitly and retain the per-organization/summary audit output.
6. Re-run dry-run for the same explicit IDs and verify every target is `CLEAN` with no failures.
7. Only after all relevant deployed environments provide equivalent evidence should Phase 4H2B remove backend legacy-code parsing.

Creating this utility does not mean cleanup is complete: it has not been executed against production. The backend-only persisted schema continues accepting PROJECTS/TREASURY so environments can be upgraded before their explicit cleanup window. Public `GET /me/product-access`, authorization, provisioning, ProductAccess pilot counts, module RBAC, and frontend behavior remain unchanged.

### Phase 5A1 — Accounting Core ↔ Treasury reconciliation boundary

Implemented as an in-process module boundary inside the Accounting product. Treasury continues to own bank statement lines, reconciliation match records, workflow orchestration, direction/amount matching, API responses, and the single `TransactWriteItems` call. Accounting Core now exclusively owns reconciliation candidate/entry-line reads, Accounting account reconciliation eligibility, entry-line validation, Accounting key construction, and the apply/cancel entry-line mutation expressions through `AccountingReconciliationService` under the Accounting domain.

The supported Accounting application contract provides:

- `listReconciliationCandidates`: reads the existing account balance and GSI1 entry-line projection and returns a purpose-built key-free read model;
- `getReconciliationLine`: directly reads and validates one tenant/fiscal-year entry line and preserves the existing draft/already-reconciled errors;
- `assertAccountAllowsReconciliation`: validates the Accounting account used by the Treasury reconciliation workflow;
- `buildApplyReconciliationOperation` and `buildCancelReconciliationOperation`: prepare only the Accounting-owned entry-line operation for the existing shared-table transaction.

The narrow transaction-operation output is retained because create and cancellation each already commit three coupled mutations atomically: Treasury match, Treasury statement line, and Accounting entry line. Treasury supplies business identifiers only; Accounting Core constructs the Accounting PK/SK, expressions, and values. The operation is branded for Accounting ownership and reconciliation purpose rather than exposing a generic Accounting write builder. Transaction counts and conditions remain unchanged, so neither module can commit its reconciliation consequence alone.

Removed reconciliation persistence leaks include Treasury's direct GSI1 candidate query, direct exact `ENTRY_LINE` read, direct `KeyFactory.entryLineSK` use, and direct apply/cancel reconciliation expressions. An architecture test prevents those dependencies from returning. No table, GSI, key format, Scan, public contract, ProductAccess annotation, RBAC rule, infrastructure resource, or accounting treatment changed.

Remaining Treasury → Accounting Core inventory for Phase 5A2:

- `ACCOUNT_REFERENCE_QUERY`: resolved in Phase 5A2a through the Accounting-owned `AccountingAccountReferenceService`;
- `MOVEMENT_QUERY`: reconciliation movement/candidate access now uses the supported Accounting boundary; no direct Treasury GSI1 entry-line query remains;
- `LEDGER_POSTING`: resolved in Phase 5A2b through the Accounting-owned `AccountingTreasuryPostingService`;
- `OTHER`: the historical monolithic `TreasuryService` remains physically under `lambda/shared/services`, although its reconciliation dependency now points only to the supported Accounting boundary. Moving the whole service is deferred to avoid mixing directory restructuring with behavior-sensitive integration cleanup.

### Phase 5A2a — Accounting account-reference boundary for Treasury

Implemented as a narrow in-process Accounting Core application boundary. `AccountingAccountReferenceService.assertTreasuryAccountReference` is owned under `lambda/domains/accounting/accounts` and accepts only the verified `orgId` plus the normalized stable Accounting `accountId`. It preserves the existing validation sequence: the requested identifier must be class 5, the Accounting account must exist in the same organization, its persistence row must pass `AccountSchema`, it must be active, and its parsed class must be 5. Existing `ERROR_ACCOUNT_NOT_TREASURY_CLASS`, `ERROR_ACCOUNT_NOT_FOUND`, and `ERROR_ACCOUNT_NOT_ACTIVE` behavior remains unchanged.

The physical access pattern remains one direct eventually consistent `GetItem` against `PK = ORG#{orgId}`, `SK = ACC#{accountId}`. Accounting Core now exclusively constructs that key and parses the Accounting persistence entity. Treasury account creation calls the boundary and then persists only its existing stable `accountId`/`treasuryAccountId` reference; it neither receives nor stores Accounting PK/SK, GSI fields, `entityType`, or a copied Accounting aggregate. An architecture guard prevents Treasury from reintroducing the Accounting shared schema import or `KeyFactory.accountSK` call.

No Treasury-account request, response, item, condition, duplicate behavior, RBAC metadata, ProductAccess metadata, table, index, key format, infrastructure, frontend, or accounting rule changed. The Phase 5A1 reconciliation boundary and transaction atomicity are unchanged. `TreasuryService` remains physically under `lambda/shared/services`, and `POST /treasury/transactions` still invokes `LedgerService.postEntry`; both were deliberately deferred at this phase. The reconciliation integrity weaknesses recorded here were subsequently resolved in Phase 5A3b.

### Phase 5A2b — Treasury transaction posting boundary

Implemented as an in-process Accounting-owned posting contract. `TreasuryService` continues resolving the active request's Treasury account and passes only Treasury business intent and stable references to `AccountingTreasuryPostingService.postTreasuryTransaction`: verified `orgId`/`userId`, Treasury Accounting account ID, counterparty account ID, year/date, requested BANK/MISC journal reference, direction, amount, label/reference, currency, and existing optional third-party/project/budget/donor identifiers. It no longer imports `LedgerService` or constructs Accounting entry lines.

Accounting Core now owns BANK/MISC policy enforcement, journal-code normalization, `STANDARD` entry type, INFLOW/OUTFLOW debit-credit mapping, two-line entry construction, and the `LedgerService.postEntry` invocation. Golden tests for both directions prove the exact pre-extraction payload is retained: INFLOW debits the Treasury class-5 account and credits the counterparty; OUTFLOW credits Treasury and debits the counterparty. Journal, date, fiscal year, voucher, label, currency, optional analytical references, and verified audit context remain identical. Ledger errors pass through unchanged.

The physical write model is also unchanged. No separate Treasury transaction item exists: after one Treasury-account read, LedgerService validates fiscal year/date, journal, period lock, accounts/projects, auxiliary metadata, and budget availability, then commits one Accounting `TransactWriteItems`. For the current two-line Treasury entry this contains five actions: one conditional ENTRY put, two conditional ENTRY_LINE puts, and two account-balance updates. Entry/line IDs remain generated UUID-based identifiers and the ENTRY/ENTRY_LINE/balance keys, GSI projections, audit fields, conditions, and error mapping are unchanged. Consequently there was no Treasury-plus-Accounting atomic transaction before or after this phase.

Phase 5A3a resolves the two posting integrity limitations recorded here through a stable caller request identity, an atomic Accounting-owned idempotency item, and explicit ENTRY source metadata. Phase 5A3b subsequently resolves the two Phase 5A1 reconciliation integrity weaknesses.

Architecture guards now reject direct Treasury imports of `LedgerService`, Accounting ENTRY/ENTRY_LINE schemas, and Accounting posting key helpers. No ProductAccess, RBAC, public API, frontend, DynamoDB model, table, index, key, Scan, infrastructure, or OHADA/SYSCOHADA treatment changed. `TreasuryService` remains physically under `lambda/shared/services` as a separately reviewable structural debt.

### Phase 5A3a — Treasury posting idempotency and source traceability

`POST /treasury/transactions` now requires an opaque UUID `clientRequestId`. No repository-wide financial-idempotency convention previously existed, and voucher/reference values have no uniqueness guarantee, so they remain ordinary material intent fields rather than uniqueness keys. The Angular dialog generates one UUID for a normalized submission, retains it after a failed/ambiguous result, reuses it when that unchanged submission is retried, and generates a new UUID when the material form payload changes. Non-browser callers use the same public body contract.

Accounting Core owns the protection in `AccountingTreasuryPostingService` and its posting-specific repository. The caller identity is SHA-256 hashed for the physical key and safe structured logs. The fixed-order intent fingerprint covers the Treasury aggregate reference, Treasury Accounting account reference, counterparty, fiscal year/date, normalized journal, direction, integer amount, description, voucher/reference, currency, and optional third-party/project/budget/donor allocations; authenticated user identity and server-generated values are excluded. A completed direct lookup is strongly consistent:

```text
PK = ORG#{orgId}
SK = IDEMPOTENCY#TREASURY_POSTING#{sha256(clientRequestId)}
entityType = TREASURY_POSTING_IDEMPOTENCY
```

The record stores the verified `orgId`, operation, opaque `clientRequestId`, its hash, request fingerprint, resulting random Accounting `entryId`, `COMPLETED` status, and original audit timestamps/user. There is no GSI or Scan. The first execution keeps the existing random Accounting entry identifier and expands the existing two-line Ledger transaction from five to six actions: conditional ENTRY put, conditional completed-idempotency put, two conditional ENTRY_LINE puts, and two balance updates. The idempotency record cannot commit without the Accounting effect, and a failed Accounting transaction leaves neither completed evidence nor partial balances.

A completed same-key/same-fingerprint lookup returns the original `{ entryId }` without invoking Ledger. Concurrent missing reads remain safe because the idempotency put has `attribute_not_exists(PK) AND attribute_not_exists(SK)` in the Accounting transaction; the loser strongly rereads the winner's completed record and returns its result. Same organization/key with a different fingerprint returns `409 ERROR_TREASURY_POSTING_IDEMPOTENCY_CONFLICT`. Because the PK is organization-scoped, the same opaque UUID remains independent across organizations. A retry by another authorized user returns the original result while preserving the first poster's audit attribution.

New Treasury-originated ENTRY headers optionally store `sourceType = TREASURY`, the stable `sourceId = clientRequestId`, and `sourceFingerprint`. These attributes are backward-compatible and absent on historical or unrelated Accounting entries, so no entry backfill is required. Journal, date/year, STANDARD entry type, label, voucher, currency input, debit/credit orientation, optional allocations, Accounting validation, line/balance keys, and response shape remain unchanged. Structured logs distinguish `IDEMPOTENCY_FIRST_EXECUTION`, `IDEMPOTENCY_REPLAY`, `IDEMPOTENCY_CONFLICT`, and `IDEMPOTENCY_FAILURE` using only safe context and a truncated request-key hash.

ProductAccess and `TREASURY_WRITE` authorization are unchanged. Phase 5A3b resolves the two reconciliation weaknesses previously recorded here: requested `entryId` equality against the Accounting line, and cancellation ownership conditioning on the original `reconciliationMatchId`.

### Phase 5A3b — Treasury reconciliation integrity hardening

The public reconciliation request remains backward compatible: `entryId` is still optional and `entryLineId` continues to be represented by the existing `movementLineId`/legacy `lineId` request fields. `AccountingReconciliationService.getReconciliationLine` now accepts the optional requested entry as an expected owner and compares it with the authoritative `entryId` parsed from the tenant/fiscal-year-scoped Accounting `ENTRY_LINE`. A mismatch returns `409 ERROR_RECONCILIATION_ENTRY_OWNERSHIP_MISMATCH` before transaction construction or execution. Successful reconciliation records and statement-line metadata now always use the Accounting read model's authoritative entry ID rather than copying request input.

Accounting Core's cancellation operation now requires `reconciliationMatchId = :expectedMatchId` in addition to the existing entry-line existence checks. Treasury passes only the business match ID being cancelled; Accounting Core continues constructing the entry-line key, update expression, condition, and values. If the line is absent, unreconciled, or has moved from `MATCH_A` to `MATCH_B`, DynamoDB rejects the Accounting update and therefore the complete three-operation cancellation transaction. Expected conditional/transaction cancellation races map to `409 ERROR_RECONCILIATION_STATE_CONFLICT`; there is no unconditional retry or forced reset.

Apply and cancellation remain single three-operation `TransactWriteItems` calls covering the Treasury match, Treasury statement line, and Accounting entry line. No API shape, Accounting reconciliation fields, item schema, key, index, table, ProductAccess annotation, RBAC rule, infrastructure, posting/idempotency behavior, or OHADA/SYSCOHADA treatment changed. No historical repair or backfill was run. A historically inconsistent match can now fail cancellation safely and requires separately reviewed operational resolution rather than clearing Accounting state it does not own.

### Phase 5 — Domain integration contracts/events

Phases 5A1, 5A2a, and 5A2b establish the reviewed synchronous Accounting Core boundaries for Treasury reconciliation, account references, and posting. Phase 5A3a adds atomic retry safety and source traceability to that posting boundary, and Phase 5A3b enforces authoritative entry ownership plus exact cancellation match ownership. Treasury has no unsupported Accounting persistence dependency or currently identified reconciliation integrity debt; its remaining Treasury-specific operational debt is the retention policy for posting idempotency records. Phase 5B1 moves Project Accounting reporting off direct Accounting GSI4 access and behind an Accounting-owned query boundary; Phase 5B2 moves reverse analytical-reference validation behind a Project Accounting-owned boundary. Phase 5C1 relocates the canonical Project Accounting services into their owning domain, and Phase 5C2a does the same for `TreasuryService`, without changing the established boundaries. Add transport infrastructure only if asynchronous delivery is justified.

### Phase 5B1 — Accounting Core ↔ Project Accounting reporting boundary

Project Accounting previously queried Accounting's sparse analytical `ENTRY_LINE` projection in three places: project report facts, organization-wide project summary facts, and BudgetService's realized-spend/donor-cash calculation. GSI4 is populated only for posted Accounting entry lines carrying `projectId`. Its physical access pattern remains:

```text
GSI4PK = ORG#{orgId}#PROJECTS_ALL
GSI4SK = PRJ#{projectId}#FY#{year}#DT#{entryDate}#{lineId}
```

`AccountingProjectReportingService`, under `lambda/domains/accounting/reporting`, now exclusively owns the two existing Query shapes: `listProjectFacts({ orgId, projectId, year })` uses the project/year prefix, while `listOrganizationProjectFacts({ orgId })` uses the organization analytical partition. It parses Accounting-owned `ENTRY_LINE` persistence, verifies organization/index and fiscal-year scope, preserves GSI result ordering, and maps each valid row to a strict key-free fact containing only entry/line identity, date/year, account, debit/credit, and existing project/donor/budget-line analytical references. PK, SK, GSI4 keys, `entityType`, and raw DynamoDB attributes never cross the boundary.

Project Accounting retains all report interpretation and calculations. `ProjectService` still composes project master data, funding sources, budget lines, annual resources/expenses, donor cash follow-up, budget-vs-actual, account balances, project summary execution rates, and alerts. `BudgetService` still owns its existing budget-line, donor envelope, realized-spend, and cash-availability rules. These consumers now receive Accounting facts from the boundary and contain no GSI4/index-key fallback. Valid-data numerical behavior, one-page Query behavior, eventual GSI consistency, ordering, currencies, public DTOs, handler errors, and routes remain unchanged. The existing lack of internal pagination beyond DynamoDB's first Query page remains scalability debt rather than being redesigned here.

No table, index, key format, item shape, migration, backfill, Scan, write path, ProductAccess annotation, RBAC metadata, frontend contract, CDK resource, or OHADA/SYSCOHADA/SYCEBNL calculation changed. A deterministic architecture test covers all technical Projects handlers plus ProjectService and BudgetService and rejects GSI4, Accounting entry-line schema, and Accounting reporting-key references outside the supported boundary.

Post-migration Project Accounting → Accounting Core inventory is `SUPPORTED_REPORTING_BOUNDARY`: `AccountingProjectReportingService`; `SUPPORTED_REFERENCE_BOUNDARY`: none in this direction; `SUPPORTED_COMMAND_BOUNDARY`: none; `PERSISTENCE_LEAK`: none found; `OTHER`: none in this direction. The reverse Accounting Core → Project Accounting path remains separate Phase 5B2 debt: Ledger posting still invokes the physically shared `BudgetService` and validates project references through Project-owned persistence/key semantics. That reverse dependency was inventoried but not changed in this read-only phase.

### Phase 5B2 — Project Accounting reference-validation boundary

Before Phase 5B2, Accounting `LedgerService` combined Accounting account and Project existence keys in one `BatchGetItem`, constructing `KeyFactory.projectSK` and interpreting `PRJ#` persistence itself. It also imported Project-owned `BudgetService` directly for every debit posting line carrying `projectId`. That service resolved the optional budget line through `PK = ORG#{orgId}`, `SK = PRJ#{projectId}#BDG#{year}#L#{budgetLineId || GENERIC}`, optionally resolved the donor envelope through `SK = PRJ#{projectId}#FS#{donorId}`, and used the supported Accounting reporting boundary to calculate realized spend and donor cash.

`ProjectAccountingReferenceService`, under `lambda/domains/projects/references`, now owns that Project Accounting side of posting validation. `validateAccountingReferences({ orgId, projectIds })` deduplicates up to the Ledger transaction's 49 project references and resolves them in one tenant-scoped `BatchGetItem`. It preserves `400 ERROR_ACCOUNT_OR_PROJECT_NOT_FOUND`, does not add a project-state rule, and returns no persistence data. `validatePostingLine({ orgId, year, projectId?, budgetLineId?, donorId?, debit, credit })` preserves the existing no-op for lines without a project or without a debit and delegates the existing Project budget/cash validation unchanged.

Current analytical semantics remain deliberately narrow. A project reference requires an existing tenant-scoped project. A missing configured budget line—including the historical `GENERIC` fallback used when `budgetLineId` is absent—does not block posting. A donor identifier is consulted only as the funding-source key for an existing budget line; no standalone donor existence or project-donor eligibility rule exists, and an absent funding-source row retains the existing unbounded contract limit while donor cash remains derived from Accounting facts. `fundingSourceId` is not part of the current Accounting or Treasury posting contract. `ERROR_BUDGET_LINE_EXCEEDED` and `ERROR_DONOR_CASH_EXCEEDED` are unchanged. No new inactive-project, allocation, or funding-source rule was invented.

Ledger validation ordering remains fiscal year/date and opening rules, journal, period lock, Project reference existence, Accounting account/auxiliary validation, per-line Project budget/cash validation, balance validation, then the existing atomic Accounting transaction. Analytical posting retains two batch reads overall: one Project-owned project-reference batch and one Accounting-owned account/auxiliary batch. Previously these were a combined account/project batch followed by the existing account/auxiliary batch. Thus Project persistence is still read once, no redundant Project read was introduced, and postings without Project references now avoid the obsolete duplicate account batch. Budget-line/funding-source direct Gets and the GSI4 fact Query remain exactly conditional on the same existing states.

The bilateral supported model is now:

```text
Project Accounting
→ AccountingProjectReportingService
→ Accounting-owned GSI4

Accounting Core
→ ProjectAccountingReferenceService
→ Project-owned reference keys and BudgetService rules
```

The two boundary implementations do not import each other, and no implementation-level cycle was introduced. Accounting continues persisting the stable `projectId`, `budgetLineId`, and `donorId` references plus its Accounting-owned GSI4 projection on `ENTRY_LINE`; stable identifiers are not persistence leakage. Accounting no longer imports `BudgetService`, constructs Project `PRJ#` keys, or parses Project entities for posting validation. There is no Accounting-to-Project command or mutation, Project budget counter, duplicated financial aggregate, public DTO/API change, ProductAccess/RBAC change, table/index/key/schema change, migration, backfill, Scan, event, HTTP boundary, CDK change, or OHADA/SYSCOHADA/SYCEBNL treatment change.

Post-Phase 5B2 bilateral inventory is: Project Accounting → Accounting Core `SUPPORTED_REPORTING_BOUNDARY`: `AccountingProjectReportingService`, `PERSISTENCE_LEAK`: none; Accounting Core → Project Accounting `SUPPORTED_REFERENCE_BOUNDARY`: `ProjectAccountingReferenceService`, `PERSISTENCE_LEAK`: none; `COMMAND_DEPENDENCY`: none; cross-module mutation: none. `ProjectService` and `BudgetService` remain Project Accounting-owned services in the historical shared folder; `LedgerService` remains Accounting-owned in that folder; `TreasuryService` remains Treasury-owned there. Their physical relocation is structural debt, not a remaining persistence-boundary violation.

### Phase 5C1 — Project Accounting service ownership relocation

The canonical `ProjectService` and `BudgetService` implementations now reside under `lambda/domains/projects/services`. Every Project handler imports `ProjectService` from that owner path, and the Project-owned `ProjectAccountingReferenceService` imports the local `BudgetService`. The historical `lambda/shared/services/project-service.ts` and `budget-service.ts` paths were removed rather than retained as compatibility re-exports because every repository consumer is versioned and migrated atomically in this monorepo.

This is a source-ownership move only. Project and donor creation, funding sources, budget lines, Project reports/summaries, budget realization, donor cash validation, errors, request/response contracts, and the existing DynamoDB Get/Query/BatchGet/transaction access patterns are unchanged. No table, GSI, key, item, migration, backfill, Scan, ProductAccess annotation, RBAC metadata, frontend contract, infrastructure, or Accounting treatment changed.

The bilateral boundaries remain unchanged and acyclic: Project Accounting continues consuming Accounting facts exclusively through `AccountingProjectReportingService`; Accounting Core continues validating Project analytical references exclusively through `ProjectAccountingReferenceService`. The moved services do not import the reverse Project reference boundary, and neither owner-controlled boundary imports the other. Deterministic architecture guards enforce the canonical service locations, reject the removed shared imports, preserve the reporting persistence boundary, and preserve the Accounting-to-Project reference boundary.

Remaining obvious physical ownership debt under `lambda/shared/services` includes Accounting-owned `LedgerService` and Treasury-owned `TreasuryService`. Other historical domain and Platform Core services in that folder require separate owner-by-owner review; Phase 5C1 deliberately performs no broad shared-layer reorganization.

### Phase 5C2a — Treasury service ownership relocation

The canonical `TreasuryService` implementation now resides at `lambda/domains/treasury/services/treasury-service.ts`, and all ten Treasury handlers import that owner path. The historical `lambda/shared/services/treasury-service.ts` file was removed without a compatibility re-export because every repository consumer is versioned and migrated atomically in this monorepo.

The relocation changes source ownership only. Treasury accounts, movements, statements/import, reconciliation, cancellation, summaries, posting orchestration, errors, cursor handling, request/response contracts, and all DynamoDB access patterns are unchanged. Treasury continues constructing only its own account, statement-line, and reconciliation keys. No table, GSI, entity, key, migration, backfill, Scan, ProductAccess annotation, RBAC metadata, frontend contract, infrastructure, or Accounting treatment changed.

The three Accounting-owned application boundaries remain the only Treasury-to-Accounting dependencies: `AccountingAccountReferenceService`, `AccountingReconciliationService`, and `AccountingTreasuryPostingService`. None imports `TreasuryService`, so the relocation introduces no implementation cycle. Posting idempotency/source metadata and the six-operation Accounting transaction remain unchanged; reconciliation apply/cancel integrity and their three-operation transactions remain unchanged. Source-level guards enforce the canonical location, removed shared path, supported boundaries, and absence of direct Ledger, Accounting schema/key, reconciliation-expression, or GSI1 access.

`LedgerService` remains the largest obvious Accounting-owned service under `lambda/shared/services` and is intentionally deferred because its posting, reporting, period, auxiliary, Project reference, and Treasury idempotency blast radius is materially larger. Other Accounting and Identity/Cabinet business services remain candidates for separate owner-by-owner review rather than broad relocation.

### Phase 5D0 — stabilization and ACCOUNTING ProductAccess rollout readiness

The cumulative Platform V2 repository checkpoint is **STABLE_WITH_BLOCKERS**. Shared/backend compilation, the complete backend and frontend test suites, CDK synthesis, nested-template resource limits, and source-level architecture guards pass. The blockers are operational evidence rather than an identified code defect: the repository does not prove that the current V2 state is deployed in every relevant environment, that every existing organization has an explicit canonical `ACCOUNTING` row, or that the two current ProductAccess pilots have passed deployed smoke tests. ProductAccess enforcement is therefore not broadened in Phase 5D0.

The verified runtime hierarchy remains one top-level `ACCOUNTING` product containing Accounting Core, Treasury, and Project Accounting. RBAC remains independently module-granular through `ACCOUNTING_*`, `TREASURY_*`, and `PROJECTS_*`. Production-source audits find only the supported boundaries:

```text
Treasury
→ AccountingAccountReferenceService
→ AccountingReconciliationService
→ AccountingTreasuryPostingService

Project Accounting
→ AccountingProjectReportingService

Accounting Core
→ ProjectAccountingReferenceService
```

No unsupported Treasury-to-Accounting persistence access, Project-to-Accounting persistence access, Accounting-to-Project persistence access, or cross-module aggregate mutation was found. `ProjectService` and `BudgetService` remain canonically under `lambda/domains/projects/services`; `TreasuryService` remains under `lambda/domains/treasury/services`; the three former `lambda/shared/services` implementation files are absent.

#### Current ProductAccess state and route coverage

The public shared `ProductCode` contains only `ACCOUNTING`. The backend persistence parser continues accepting `PROJECTS` and `TREASURY` solely so legacy rows remain readable for controlled cleanup; `ProductAccessService.listProductAccess` filters them from `GET /me/product-access`, and `requireActiveProductAccess` accepts only the canonical public type. New COMPANY, ACCOUNTING_FIRM, and cabinet-created client organizations all compose the same baseline write and create only `PRODUCT_ACCESS#ACCOUNTING`.

The route inventory is 71 Accounting-product routes:

| Module | Routes | Read RBAC | Write RBAC | ACCOUNTING ProductAccess |
|---|---:|---:|---:|---:|
| Accounting Core | 50 | 25 `ACCOUNTING_READ` | 25 `ACCOUNTING_WRITE` | 0/50 |
| Project Accounting | 11 | 7 `PROJECTS_READ` | 4 `PROJECTS_WRITE` | 1/11: `GET /donors` |
| Treasury | 10 | 5 `TREASURY_READ` | 5 `TREASURY_WRITE` | 1/10: `GET /treasury/summary` |

The 50 Accounting routes include two compatibility aliases that have their own API routes/Lambdas: `PUT` and `PATCH /third-parties/{thirdPartyId}` share one handler, and `GET /reports/summary` plus deprecated `GET /reports/simplified` share one handler. Every route still has one exact RBAC requirement. The two ProductAccess pilots both require `ACCOUNTING` before their module-specific read permission; no annotation changed in Phase 5D0.

Platform Core remains deliberately outside ProductAccess enforcement. The exclusion set is all Identity/Cabinet routes: `GET|POST /me/workspaces`, `GET /me/product-access`, `POST /me/cabinet-invitations/accept`, all `/cabinet/team/**`, `/cabinet/settings`, `/cabinet/dashboard`, `/cabinet/works/**`, `/cabinet/deadlines/**`, and `GET|POST /cabinet/dossiers` including dossier-member administration. Cognito authentication/profile handling and public/authentication frontend routes also remain pre-product concerns. These routes preserve workspace discovery, onboarding, entitlement observation, and recovery/admin access when an Accounting entitlement is missing or inactive.

The frontend remains staged. `effectiveOrgId` is the organization-scoped ProductAccess query key and tenant context. Project Accounting and Treasury navigation both observe `ACCOUNTING`; Accounting Core navigation remains legacy/unannotated. A successful response maps canonical ACTIVE to AVAILABLE and INACTIVE or missing to UNAVAILABLE; query failure maps to UNKNOWN and preserves legacy usability.

#### Operational tooling and rollout gates

Both operational tools remain explicit-ID and dry-run-first. `backfill:product-access` has no discovery/Scan path, reports canonical ACCOUNTING coverage, preserves existing ACTIVE and INACTIVE rows, and creates only a missing ACCOUNTING row when `--apply` is explicit. `cleanup:legacy-product-access` directly reads ACCOUNTING/PROJECTS/TREASURY, blocks if canonical ACCOUNTING is missing or mismatched, conditionally deletes only valid PROJECTS/TREASURY rows when `--apply` is explicit, and never accepts ACCOUNTING as a deletion target.

Phase 4H2B is **NOT READY**. Repository tests cannot substitute for deployed evidence. Its gate remains closed until every relevant environment records: Phase 4H1 deployment, explicit ACCOUNTING coverage, legacy-cleanup dry-run results, approved cleanup application, a repeat CLEAN dry run, and explicit zero-legacy-row verification for the targeted organizations. Backend legacy-code parsing remains required until then.

Phase 5D1 readiness is classified as:

- **CODE_READY: YES** — canonical schemas, middleware order, provisioning, pilots, frontend tenant isolation, backfill/cleanup tools, and test coverage exist.
- **DEPLOYMENT_READY: CONDITIONAL** — synth/diff are coherent, but the cumulative uncommitted checkpoint must be reviewed and deployed to non-production before production approval.
- **DATA_READY: NO EVIDENCE** — no approved deployed ACCOUNTING coverage report is stored in the repository.
- **ENFORCEMENT_READY: NO** — deployed tenant, public endpoint, frontend, pilot, and data gates have not all been evidenced.

Required enforcement gates are: canonical provisioning deployed; every target organization has an explicit ACCOUNTING row; direct-company and cabinet/dossier `effectiveOrgId` behavior smoke-tested; `GET /me/product-access` verified; frontend query/cache isolation verified; and both current pilots verified in the deployed environment. Future enforcement means ACCOUNTING ACTIVE allows Accounting Core, Treasury, and Project Accounting subject to independent module RBAC, while ACCOUNTING INACTIVE or missing denies every Accounting-product business route. It does not create PROJECTS/TREASURY ProductAccess or ModuleAccess.

The recommended Phase 5D1 rollout is module-complete staging rather than read/write staging: first annotate the 19 remaining Treasury and Project Accounting routes, whose frontend navigation and pilots already observe ACCOUNTING; then, after deployed observation, annotate all 50 Accounting Core routes and make its navigation ProductAccess-aware in the same slice. This avoids a period where reads are denied while writes remain accessible, while limiting the initial blast radius compared with an atomic 71-route change.

#### Validation and infrastructure checkpoint

On 2026-08-09, sequential validation produced:

- shared build: passed;
- backend build: passed;
- backend Jest: 101 suites and 612 tests passed;
- frontend contracts: 10 tests passed;
- frontend Vitest/Angular test builder: 84 files and 619 tests passed, including successful application compilation;
- `git diff --check`: passed;
- standalone development Angular build: reproduced the pre-existing exit 134 without diagnostics;
- production Angular build: not attempted because no validated generated production configuration or `LIASS_*` inputs exist; no placeholder values were created.

CDK synthesis passed. Resource counts are: root 1, DataStack 2, API stack 275, Identity nested 81, Accounting nested 51, Project nested 12, and Treasury nested 11; all seven templates remain below the 350-resource guard. Synthesized Project/Treasury Lambda environments contain no `ACCOUNTING_PERMISSION`; all 50 Accounting compatibility Lambdas retain it.

The credentialed cumulative CDK diff reports five stacks with differences. DataStack and the root stack have no differences. Expected/older undeployed V2 changes are four new Identity resources for `GET /me/product-access` (Lambda, integration, permission, route), Lambda code-asset updates, and removal of `ACCOUNTING_PERMISSION` from the existing 11 Project and 10 Treasury Lambda configurations. No resource deletion or replacement, DynamoDB table/index change, Cognito change, or unexpected resource was reported. This diff represents the complete current repository relative to the deployed environment, not Phase 5D0 alone. No stack deployment was run.

#### Persistence and remaining debt

The additive Platform V2 persistence concepts at this checkpoint are:

| Entity | Key | Owner | Existing-data action |
|---|---|---|---|
| `PRODUCT_ACCESS` | `PK = ORG#{orgId}`, `SK = PRODUCT_ACCESS#{code}` | Platform Core | explicit-ID ACCOUNTING coverage/backfill for existing organizations; legacy PROJECTS/TREASURY cleanup remains separate |
| `ACCOUNTING_SETTINGS` | `PK = ORG#{orgId}`, `SK = SETTINGS#ACCOUNTING` | Accounting Core | explicit-ID additive backfill; legacy Organization fallback retained |
| `TREASURY_POSTING_IDEMPOTENCY` | `PK = ORG#{orgId}`, `SK = IDEMPOTENCY#TREASURY_POSTING#{sha256(clientRequestId)}` | Accounting Core posting boundary | prospective only; no historical backfill |

No table, GSI, or existing key format is changed by these concepts. Posting-idempotency retention remains `NO_AUTOMATIC_EXPIRY`: expiration would permit reuse of an old `clientRequestId` and reopen duplicate financial effects. This is `OPERATIONAL_POLICY_DEBT`, not a Phase 5D1 blocker unless measured storage growth becomes material.

Remaining physical-location debt is backlog only. Platform Core services in `shared/services` include effective access, domain authorization, ProductAccess, and tenant access. `AccountingAuthorizationService` is a compatibility surface. Accounting-owned services—most notably `LedgerService`, plus balance, fiscal/closing/period, journal/book, lettering, third-party, auxiliary, and reporting helpers—and Identity/Cabinet business services remain historically misplaced or need owner-by-owner review. No additional relocation belongs in this checkpoint; `LedgerService` should move only after ProductAccess rollout because its financial posting blast radius is larger and unrelated to entitlement readiness.

#### Deployment and data runbook (not executed)

1. Review and establish a clean, traceable repository checkpoint for the cumulative V2 diff.
2. Deploy that exact checkpoint to non-production.
3. Smoke-test identity, company onboarding, Accounting-firm onboarding, cabinet/dossier switching, Accounting Core, Treasury, and Project Accounting.
4. Verify `effectiveOrgId`, tenant headers, `GET /me/product-access`, frontend ProductAccess caching, and both ACCOUNTING pilots.
5. Run the canonical ACCOUNTING coverage tool in dry-run mode for an explicit approved non-production organization list.
6. Resolve mismatches and explicitly approve/apply only missing ACCOUNTING rows; repeat coverage verification.
7. Deploy the reviewed checkpoint to production through the normal approval process; do not combine deployment with data mutation.
8. Repeat production smoke tests and explicit-ID ACCOUNTING coverage verification.
9. Resolve and explicitly approve any missing canonical backfill, apply it separately, then retain the repeat coverage evidence.
10. Run legacy ProductAccess cleanup in dry-run mode for the explicit production organization list.
11. Resolve missing/mismatched canonical coverage and legacy identity mismatches.
12. Apply legacy PROJECTS/TREASURY cleanup only under separate approval, repeat the dry run, and retain CLEAN/zero-legacy evidence.
13. Evaluate Phase 4H2B only after equivalent evidence exists for every relevant environment.
14. Implement Phase 5D1 module-complete staging; redeploy and observe Treasury/Project Accounting before the Accounting Core slice.

Platform foundations needed to introduce a future second top-level product now exist—Organization, effective access, ProductAccess, RBAC, owner-controlled boundaries, and frontend entitlement state—so Restaurants is **FOUNDATION_READY**, not approved for implementation. Operational ACCOUNTING rollout gates should be closed before beginning that domain foundation.

### Phase 5D0-OPS / 5D0-OPS2 — dev evidence closure and immutable checkpoint

The exact cumulative Platform V2 source state assessed in Phase 5D0 was deployed to the confirmed non-production `dev` environment in AWS account `570197775998`, region `eu-west-3`. Before the immutable checkpoint was created, repository equivalence to that deployed source was proven against `main` parent `441e19cc442ce4df4147d4e3aca242f63d417807`: the tracked binary diff hash remained `88812bdb88d319dc1cf2d2cf70fb89742a443c0fceb97042f3c8bdb71dd64bf2`, and the untracked content-manifest hash remained `60b7a84a3af295d420c57de2cb7ea4f690dcd1867ff1b8bf10b532b3f23c933c`. Every repository change was reviewed as intended cumulative Platform V2 source or test/documentation content; no generated environment output, temporary smoke artifact, credential, token, or environment secret belongs to the checkpoint. The resulting Git commit is the immutable reviewed source checkpoint; its SHA is recorded in the operational handoff rather than self-referenced here.

The accessible dev organization population was inventoried without Scan. The Cognito user pool contained four enabled identities, and the canonical `GSI6PK = USER#{userId}` active-workspace Query was executed for each identity. Deduplication yielded 11 active organizations: two direct COMPANY workspaces, two ACCOUNTING_FIRM workspaces, and seven cabinet-client COMPANY workspaces. Direct BatchGet of the 11 ORGANIZATION keys confirmed active organization identity and Accounting framework. This is classified `AUTHORITATIVE` for organizations currently capable of accessing the dev application: Cognito is the dev authentication registry and every active workspace of every enabled identity was included. It does not claim discovery of inaccessible/orphan organization records.

The expanded explicit-ID ACCOUNTING coverage dry run initially reported four ACTIVE and seven MISSING rows. All seven missing organizations were active, reachable through the authoritative workspace inventory, and explicitly approved for the Accounting product. The existing dry-run-first backfill utility was applied to only those seven IDs, creating only `PRODUCT_ACCESS#ACCOUNTING`; no existing ACTIVE/INACTIVE row was overwritten and no PROJECTS/TREASURY row was created. The repeat explicit-ID verification reports 11 ACTIVE, zero INACTIVE, zero MISSING, and zero errors. Direct BatchGet of the known ACCOUNTING/PROJECTS/TREASURY keys independently returned exactly the 11 canonical ACCOUNTING rows and no legacy rows. The legacy-cleanup assessment is therefore 11 CLEAN with zero planned or applied deletions; no cleanup `--apply` was run and backend legacy parsing remains required.

Effective-tenant evidence now covers both workspace forms. For an existing direct COMPANY identity, the deployed `GET /me/workspaces` handler returned one active direct COMPANY organization; deployed `GET /me/product-access` and an Accounting business read both succeeded when `x-org-id` was that same organization. Thus the direct workspace organization and effective tenant organization are identical. For an existing cabinet identity, the deployed Project Accounting and Treasury pilot handlers both succeeded with `x-org-id` equal to the selected client organization and `x-workspace-org-id` equal to the cabinet organization. The frontend interceptor regression suite proves the same emitted-header relationship, and the Phase 5D0-OPS live dossier switch from ECOBANK to DONA SHOP proved the ProductAccess query key, Project Accounting data, Treasury data, and navigation state follow `effectiveOrgId` without cross-client cache reuse.

The deployed ProductAccess observation endpoint exposes canonical ACCOUNTING only. `GET /donors` continues enforcing ACCOUNTING then `PROJECTS_READ`; `GET /treasury/summary` continues enforcing ACCOUNTING then `TREASURY_READ`. No additional route annotation was added. With the immutable checkpoint, authoritative dev inventory, 11/11 canonical coverage, direct-company and cabinet effective-tenant evidence, public endpoint evidence, both pilot results, and frontend tenant-switch evidence, the **dev Phase 5D1a enforcement gate is READY**. The next code slice is limited to ACCOUNTING ProductAccess on the remaining 10 Project Accounting routes and remaining 9 Treasury routes. Production remains separately gated by its own deployment, effective-tenant verification, explicit organization inventory, ACCOUNTING coverage, frontend observation, and pilot evidence.

### Phase 5D1a — ACCOUNTING ProductAccess enforcement for Project Accounting and Treasury

Phase 5D1a applies the already-proven central authorization metadata to every Project Accounting and Treasury business route. The canonical authorization sequence remains JWT authentication, effective organization access, canonical `ACCOUNTING` ProductAccess, exact module RBAC, then handler/service execution. No handler performs a local entitlement lookup, and the wrapper, ProductAccess service, effective-tenant resolution, business services, persistence, public DTOs, and frontend behavior are unchanged.

Route coverage is now:

| Module | Routes | ACCOUNTING ProductAccess | RBAC |
|---|---:|---:|---|
| Accounting Core | 50 | 0/50 | `ACCOUNTING_READ` / `ACCOUNTING_WRITE` |
| Project Accounting | 11 | 11/11 | 7 `PROJECTS_READ`, 4 `PROJECTS_WRITE` |
| Treasury | 10 | 10/10 | 5 `TREASURY_READ`, 5 `TREASURY_WRITE` |
| **Total** | **71** | **21/71** | module-specific |

The 19 newly protected route mappings are implemented by 18 handler metadata changes because `GET /projects` and `GET /projects/{projectId}` intentionally share `get-projects.ts`; both routes therefore pass through the same ACCOUNTING-enforcing handler. The existing `GET /donors` and `GET /treasury/summary` pilot metadata is unchanged. A deterministic source guard reads the three CDK endpoint registries, asserts the exact 50/11/10 inventory, requires ACCOUNTING metadata for every Project Accounting and Treasury handler, and asserts zero Accounting Core handler annotations so Phase 5D1b cannot be introduced accidentally.

An unavailable ACCOUNTING entitlement now stops Project Accounting and Treasury reads and writes before module RBAC and before business side effects. An ACTIVE entitlement does not grant a module permission: `PROJECTS_*` and `TREASURY_*` remain independently required. Entitlement evaluation continues to use the effective client organization resolved from `x-org-id`, including cabinet/dossier operation; cabinet ProductAccess cannot substitute for a missing client entitlement. Backend storage compatibility for legacy PROJECTS/TREASURY rows remains read/cleanup-only and those rows never satisfy authorization.

This is an authorization metadata rollout, not a data or infrastructure model change: no table, GSI, entity, key, migration, backfill, Scan, API route, Lambda, frontend executable, ProductAccess provisioning, cleanup tool, or legacy parser changed. Accounting Core and its frontend navigation remain deliberately staged for Phase 5D1b. Phase 5D1a is not deployed by this code slice; the next operational step is a dev deployment of the reviewed diff followed by entitlement-denial, RBAC-independence, effective-tenant, write-side-effect, and existing business-flow smoke evidence before any production rollout or Accounting Core enforcement.

Sequential validation passes: shared and backend builds; 101 backend Jest suites with 618 tests; frontend contract tests (10) and Angular/Vitest tests (84 files, 619 tests); and `git diff --check`. CDK synthesis and the seven-template resource guard pass with unchanged counts: root 1, Data 2, API 275, Identity 81, Accounting 51, Project 12, and Treasury 11. The credentialed dev diff reports only expected Project/Treasury Lambda code-asset updates through the two nested stacks and their parent API stack. It contains no route, Lambda-count, environment, IAM, DynamoDB, Cognito, stateful replacement, or deletion change. No deployment was run.

### Phase 5D1b — full ACCOUNTING ProductAccess enforcement

Phase 5D1b applies the existing typed authorization metadata to all 50 Accounting Core routes. The two compatibility aliases remain part of that authoritative inventory: PUT/PATCH third-party update share one protected handler, and `/reports/summary` plus deprecated `/reports/simplified` share one protected handler. No handler performs a manual entitlement lookup. The central wrapper continues enforcing JWT identity, effective organization access, canonical `ACCOUNTING` ProductAccess, exact `ACCOUNTING_READ` or `ACCOUNTING_WRITE`, then business logic.

Final code coverage is:

| Module | Routes | ACCOUNTING ProductAccess | RBAC |
|---|---:|---:|---|
| Accounting Core | 50 | 50/50 | `ACCOUNTING_READ` / `ACCOUNTING_WRITE` |
| Project Accounting | 11 | 11/11 | `PROJECTS_READ` / `PROJECTS_WRITE` |
| Treasury | 10 | 10/10 | `TREASURY_READ` / `TREASURY_WRITE` |
| **ACCOUNTING product** | **71** | **71/71** | module-specific |

The deterministic guard reads the actual Accounting, Project, and Treasury CDK endpoint registries, verifies the 50/11/10 route counts, resolves the Accounting permission registry, and requires `productCode: "ACCOUNTING"` on every mapped business handler. Platform Core handlers remain outside this inventory and the wrapper's unannotated/Platform-handler test preserves identity, workspace discovery, ProductAccess observation, onboarding, and cabinet recovery access.

Accounting Core navigation now uses the same optional `productCode: 'ACCOUNTING'` item metadata as Project Accounting and Treasury. Availability remains organization-scoped by `['product-access', effectiveOrgId]`: ACTIVE is available, INACTIVE or a canonical row missing after a successful response is unavailable, and a technical query failure remains UNKNOWN with the established usable fallback. Direct-company and cabinet/dossier tenant resolution, routes, icons, labels, and shell structure do not change.

Authorization tests cover ProductAccess-before-RBAC ordering, direct-company access, selected-client entitlement isolation in cabinet context, ACTIVE/INACTIVE/missing canonical states, legacy-row exclusion, and write-side-effect prevention for Accounting entry posting, fiscal-year close, and lettering. Existing Project/Treasury ProductAccess, Treasury idempotency/reconciliation, and bilateral Accounting/Project boundary suites remain regression coverage. ProductAccess continues to be independent from module RBAC.

This phase changes only Lambda handler metadata, frontend navigation metadata, tests, and documentation. It adds no route, Lambda, table, GSI, entity, key, migration, backfill, Scan, queue, Cognito resource, or ProductAccess data mutation. Backend parsing for legacy persisted PROJECTS/TREASURY rows remains intact, and those rows remain unable to authorize any Accounting-product route.

Sequential local validation passes: shared and backend builds; 101 backend Jest suites with 623 tests; frontend contracts (10) and the complete Angular/Vitest suite (84 files, 620 tests); focused Accounting navigation, ProductAccess wrapper/service, route inventory, entry posting, fiscal close, lettering, Project, and Treasury suites; and `git diff --check`. Two earlier unchanged frontend runs exposed transient timeout/request-cleanup flakes in unrelated page suites; the isolated affected suite and final unchanged full run passed. The supported development Angular build still exits 134 without diagnostics, matching the recorded environment condition. The default production build remains correctly blocked because `environment.production.generated.ts` has not been generated; no placeholder deployment configuration was created.

CDK synthesis and the seven-template resource guard pass with unchanged counts: root 1, Data 2, API 275, Identity 81, Accounting 51, Project 12, and Treasury 11. No CDK source changed. The standard credentialed dev diff could not complete because the CDK process did not load the available SSO credentials; its explicit credential-export retry was blocked by the execution approval boundary. The read-only diff therefore remains a Phase 5D1b-OPS prerequisite. Based on source and synthesis, only Accounting Lambda code assets and their parent nested-template asset reference are expected; no stateful or resource-count change is present locally.

Phase 5D1b is an implementation checkpoint only. Deployment is intentionally deferred to **Phase 5D1b-OPS**, which must deploy an immutable reviewed checkpoint to dev and repeat the 11-organization coverage, direct-company and cabinet/client Accounting access, frontend availability, representative read/write authorization, Project/Treasury regression, effective-tenant switching, and post-deployment zero-diff evidence. Platform V2 architecture completion must not be declared until that operational gate passes.

### Phase 5D1b-OPS — dev enforcement verification and architecture closure

On 2026-08-12, immutable Phase 5D1b commit `0fc9f3618b9bebc959b53b428a4a620be31261b6` was verified against stage `dev`, AWS account `570197775998`, and region `eu-west-3`. Sequential validation passed: shared and backend builds; 101 backend suites with 623 tests; frontend contracts (10) and 84 Angular/Vitest files with 620 tests; the focused authorization, financial-integrity, and bilateral-boundary set (10 suites, 99 tests); the focused frontend entitlement/effective-tenant set (6 files, 74 tests); the 71-route coverage guard; and `git diff --check`. The standalone development Angular build continued to exit 134 without diagnostics, while the Angular test builder compiled the same source successfully. No production configuration placeholder was created.

Dev synthesis and the resource-count guard remained unchanged: root 1, Data 2, API 275, Identity 81, Accounting 51, Project 12, and Treasury 11. Credentialed pre-deployment diff reported zero differing stacks and no route, Lambda, IAM, DynamoDB, Cognito, or stateful-resource change. The canonical deploy command completed successfully with Data, API, and root stacks all reporting no changes, proving the deployed dev state was already source-equivalent to the immutable checkpoint. Credentialed post-deployment diff again reported zero differing stacks.

The explicit authoritative 11-organization inventory was rechecked through the existing dry-run coverage utility: 11 ACCOUNTING ACTIVE, zero INACTIVE, zero MISSING, and zero errors. No backfill or legacy cleanup apply operation ran. Fresh read-only dev invocations verified direct COMPANY workspace discovery, canonical ACCOUNTING-only ProductAccess observation, and Accounting accounts, journals, entries, fiscal-year details, summary reporting, and third parties. The direct workspace organization equalled the request `x-org-id`. A cabinet identity's existing GSI6 workspace projection was queried by its exact user key (no Scan), showing one direct cabinet and three client dossiers. Two selected clients were then exercised with the cabinet fixed in `x-workspace-org-id` and each client in `x-org-id`; both returned ACCOUNTING ACTIVE and successful Accounting, Project Accounting, and Treasury reads, with Accounting and Treasury results changing between clients.

No authenticated browser tab was available for a fresh live frontend session, and the backend CDK deployment does not publish the Angular application. Frontend closure evidence is therefore the freshly passing source compilation/test suite rather than a claimed live browser observation: Accounting Core, Project Accounting, and Treasury all use `['product-access', effectiveOrgId]`; ACTIVE is available, INACTIVE/missing is unavailable, technical failure remains UNKNOWN/usable, and dossier changes isolate ProductAccess and business query keys. This evidence limitation is not a detected runtime regression and does not weaken backend authorization, which is the security boundary.

All current Accounting-product business routes are now protected: Accounting Core 50/50, Project Accounting 11/11, and Treasury 10/10, for ACCOUNTING 71/71. Module RBAC remains independently required. Platform Core workspace discovery, ProductAccess observation, onboarding, authentication/profile, and cabinet recovery remain outside entitlement enforcement. Treasury posting idempotency/source traceability and reconciliation ownership/atomicity tests pass; Accounting Core and Project Accounting retain their supported bilateral boundaries with no persistence leak. No table, GSI, entity, key, migration, Scan, or production data operation changed.

**PLATFORM V2 ARCHITECTURE COMPLETE. PRODUCTION ROLLOUT REMAINS SEPARATELY GATED. STOP ARCHITECTURE WORK.** Remaining service-location/name compatibility work, production ACCOUNTING inventory/backfill, legacy ProductAccess cleanup/parser retirement, and idempotency retention are backlog or operational items, not additional Platform V2 architecture phases. The next planning category is product development.

### Product-roadmap candidate — Restaurants foundation

If selected through product-roadmap planning, classify Restaurants as a vertical solution, define its real access patterns and domain model, reuse the single app/Cognito/org/table architecture, and integrate through owned contracts. This is product development, not another Platform V2 architecture phase.

## Smallest safe Phase 1 slice

The safest first review is additive and non-enforcing:

1. Historical Phase 1 defined codes for the three implemented surfaces. Phase 4H1 supersedes that taxonomy: canonical ProductAccess now contains only `ACCOUNTING`, while PROJECTS/TREASURY survive solely as backend storage compatibility until Phase 4H2.
2. Define ProductAccess DTO and backend persistence schemas separately.
3. Add organization-scoped KeyFactory helpers and direct-get/list access-pattern tests; add no GSI.
4. Add a Platform Core ProductAccess repository/service that can list and resolve entitlements.
5. Create ACTIVE baseline records for new organizations and provide an idempotent backfill for existing organizations.
6. Expose the result for observation, but keep authorization and navigation behavior unchanged until Phase 3/4.

This slice is reversible because existing membership, workspace, route, and permission behavior remains authoritative while entitlement coverage is measured.

## Risks and repository inconsistencies discovered

- `SPEC.md` previously said all keys start with `ORG#{orgId}` while also documenting cabinet and user-discovery prefixes. Platform V2 now distinguishes tenant-owned organization data from explicit KeyFactory-defined global/discovery/supervision/lock/index patterns; no keys change.
- `AGENTS.md` listed only Identity, Accounting, and Projects as active frontend domains, while `packages/frontend/src/app/domains/treasury` and `/treasury` routes exist. The instructions now include Treasury.
- The DataStack/table construct and several properties still use accounting-centered names (`accountingTable`) although the physical table already stores multiple domains. Renaming stateful constructs or logical IDs is unsafe and is deferred; names do not change in Phase 0.
- Many business services and repositories are under `lambda/shared`, which does not express Platform V2 logical ownership. A broad move would be risky, so future phases must relocate or wrap only the touched owner slice.
- `TreasuryService` uses only the supported `AccountingReconciliationService`, `AccountingAccountReferenceService`, and `AccountingTreasuryPostingService` module contracts. Its previous direct Accounting entry-line/account schema/key and `LedgerService` dependencies are removed. Phase 5C2a moves its canonical implementation to `lambda/domains/treasury/services` without compatibility wrappers or behavior changes; Phase 5A3a/5A3b retry and reconciliation integrity guarantees remain intact.
- `ProjectService` and `BudgetService` consume the Accounting-owned `AccountingProjectReportingService`, while Accounting posting consumes the Project-owned `ProjectAccountingReferenceService`. Phases 5B1/5B2 remove both persistence leaks, and Phase 5C1 moves the two Project Accounting implementations from `lambda/shared/services` to `lambda/domains/projects/services` without compatibility wrappers or behavior changes.
- Several `@liass-ohada/shared` domain exports expose persistence schemas with `PK`, `SK`, and `GSI*` fields even though the canonical boundary calls for frontend-safe DTOs and backend-only persistence shapes. New Phase 1 schemas must follow the target rule; existing exports need a separate compatibility migration rather than abrupt removal.
- The CDK architecture guide previously allowed domains to share services at code level, which could be read as permission for direct cross-domain mutation. It now requires explicit APIs/events and forbids repository/key/aggregate access across domains.
- The workspace contains empty, untracked backend domain directories for several anticipated domains. They are not repository implementation and must not be treated as active domains or used to justify speculative scaffolding.
- ProductAccess participates in backend authorization only for explicitly annotated handlers. All 71 current Accounting-product business routes are annotated, while Platform Core and other unannotated routes remain non-enforcing. All three Accounting-module navigation surfaces consume the effective-organization ProductAccess state; workspace selection itself remains independent. EventBridge remains absent and deferred.
- Accounting authorization and workspace context still transport the legacy `accountingFramework`. Phase 2 deliberately avoids adding an AccountingSettings read to every authorized request; only real Accounting consumers that need current configuration use the resolver.
- The cabinet client-organization ProductAccess provisioning gap is closed in Phase 3 through the centralized baseline transaction writes.
- No direct Projects or Treasury runtime read of `accountingFramework` was found. Their previously recorded direct Accounting persistence dependencies remain separate architecture debt and were not broadened into AccountingSettings dependencies.
- `SPEC.md` previously lagged the implemented Phase 1 state. It now distinguishes the implemented opt-in backend authorization pilot from deferred global and frontend enforcement.
- Phase 4G removes the frontend effective-organization signal's Accounting-specific name. The underlying snapshot repository still has the historical `AccountingAuthorizationRepository` name, while `AccountingAccessMode`, `HandlerContext.accountingAccessMode`, and `AuthStore.activeAccountingAccessMode` remain compatibility terminology debt and are intentionally outside this phase.
- Existing organizations still require explicit canonical ACCOUNTING coverage verification/backfill before additional routes are annotated. Historical PROJECTS/TREASURY rows are ignored and never substitute for ACCOUNTING.
- The frontend shell still physically resides under `shared/layout`, while ProductAccess orchestration is correctly Platform Core-owned under `core/product-access`. Phase 4 avoids a broad directory move; that structural cleanup remains a separately reviewable refactor.
- Phase 5D1b ends the temporary asymmetric frontend rollout: Accounting Core, Treasury, and Project Accounting all observe canonical ACCOUNTING availability. Direct routes remain unchanged, UNKNOWN retains the established usable fallback, and backend authorization remains the security authority.

No material architectural contradiction was found among `SPEC.md`, `AGENTS.md`, ADR-001, repository skills, and the CDK placement guide. The runtime divergences listed above remain intentional compatibility debt and are mapped rather than silently refactored.
