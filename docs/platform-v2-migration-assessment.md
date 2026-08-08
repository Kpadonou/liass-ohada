# Platform V2 Migration Assessment

## Purpose and scope

This assessment maps the current repository to the accepted Platform V2 model and records the incremental runtime foundations delivered after Phase 0. Phase 1 added ProductAccess, Phase 2 added Accounting-owned AccountingSettings, Phase 3 added explicit opt-in ProductAccess authorization, Phase 4 added the Treasury frontend pilot, Phase 4B added the Projects rollout, Phase 4C introduced domain-owned RBAC vocabulary, Phases 4D1/4D2 migrated every Projects and Treasury route, Phase 4E removed their obsolete Accounting-named Lambda authorization configuration, Phase 4F moved effective organization-access resolution into Platform Core, and Phase 4G gives the frontend effective tenant context a domain-neutral name.

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
| Frontend active-workspace state      | EVOLVE | `AuthStore` remains the canonical client/UI context. `activeOrgId` identifies the selected workspace, while `effectiveOrgId` is the direct company or selected active dossier organization used for tenant-scoped business requests and ProductAccess. ProductAccess stays in its organization-keyed TanStack Query cache. | Keep workspace/dossier context in Signal Store and organization-scoped ProductAccess in TanStack Query. Extend product awareness only through reviewed pilots. | High: guards, interceptor headers, navigation, and cached tenant data depend on it. | ProductAccess coverage; backend authorization; query-key policy. | No. | Phase 4G makes the existing effective tenant signal domain-neutral without changing its value or lifecycle. |
| Frontend shell/navigation            | MOVE   | Stateful shell components remain under `packages/frontend/src/app/shared/layout`. Platform Core ProductAccess orchestration lives under `packages/frontend/src/app/core/product-access`; optional typed `productCode` metadata is declared by Treasury and Projects. Accounting remains unannotated.                                  | Platform Core owns product-aware navigation orchestration. `shared/ui` remains reusable and presentation-only. Continue product-by-product rollout without making the frontend a security boundary.                                                                                              | Medium-high: imports, lazy routes, responsive behavior, cabinet context, and technical-failure degradation can regress.                            | ProductAccess coverage; design-system skill; route metadata; production pilot observation.                               | No.                                                                                                                                  | Phase 4 Treasury and Phase 4B Projects pilots implemented. Physical shell relocation and broader rollout remain deferred.                         |
| Dashboard                            | EVOLVE | `packages/frontend/src/app/core/feature/dashboard` is already platform-level but presents static cross-domain Accounting, Projects, Treasury, and Reporting data.                                                                                                                                                                        | Remain in Platform Core. Aggregate domain-provided KPIs only for enabled products and do not absorb domain calculations.                                                                                                                                                                       | Medium: accidental cross-domain service coupling or inconsistent loading/error states.                                                             | Product-aware shell context; domain query contracts; permission-filtered widgets.                                        | No.                                                                                                                                  | Phase 4 for visibility; real KPI integrations incrementally afterward.                                                                           |
| Shared schemas                       | EVOLVE | `packages/shared` exports workspace, cabinet, Accounting, Projects, and Treasury schemas. DTO variants omit persistence keys, but several domain subpaths also export persistence schemas containing `PK`, `SK`, `GSI*`, and `entityType`.                                                                                               | Add frontend-safe ProductAccess summaries and later AccountingSettings contracts in owning export boundaries. Move or isolate persistence schemas behind the backend-only export without breaking existing backend imports; keep frontend contracts free of physical keys.                     | High: frontend and backend consume the same domain subpaths, generated JS/declarations must stay synchronized, and export removal can be breaking. | Shared export map; backend import inventory; compatibility re-exports; frontend response validation.                     | No data rewrite, but a staged code/API migration is required.                                                                        | Phase 1 keeps new persistence schemas backend-only; existing schema cleanup is a separate incremental MOVE after consumers are inventoried.      |
| Domain service/repository placement  | MOVE   | Accounting, Projects, Treasury, onboarding, cabinet, and other business services/repositories are physically co-located under `packages/backend/lambda/shared/services` and `repositories`, while handlers are domain-organized.                                                                                                         | Business services and repositories move incrementally behind their owning domain boundary; only business-neutral infrastructure remains shared. Imports across domains use contracts, APIs, or events rather than internals.                                                                   | High: broad import/test churn and potential circular dependencies.                                                                                 | Stable owner map; adapters; focused domain tests; no key changes.                                                        | No.                                                                                                                                  | Do not perform as a broad refactor. Move only the files touched by reviewed Phases 1–5, one owner at a time.                                     |
| CDK stacks                           | KEEP   | `api-domain-stacks.ts` composes Identity, Accounting, Projects, and Treasury nested stacks; API core owns shared API/Cognito/role; DataStack owns the table.                                                                                                                                                                             | Preserve names, ownership, and nested-stack architecture. Add future business resources only to the coherent owning stack; Platform Core only for genuinely shared resources.                                                                                                                  | High if stateful resources move or logical IDs change.                                                                                             | CDK placement guide; synth/resource counts/diff for future runtime phases.                                               | No.                                                                                                                                  | No Phase 0 change; Phase 1 should prefer existing Identity/Platform Core ownership without stack rename.                                         |
| API Gateway                          | KEEP   | One shared HTTP API and authorizer are passed into domain nested stacks.                                                                                                                                                                                                                                                                 | Remain the principal platform API boundary. Cross-domain contracts do not require a new API Gateway or premature microservices.                                                                                                                                                                | Low if reused; high if duplicated.                                                                                                                 | Existing authorizer and route composition.                                                                               | No.                                                                                                                                  | Keep.                                                                                                                                            |
| Cognito                              | KEEP   | One User Pool, client, authorizer, hosted UI domain, and social providers are owned by API core auth constructs.                                                                                                                                                                                                                         | Remain the shared Liass-OHADA identity provider for every product and vertical.                                                                                                                                                                                                                | High if replaced or duplicated.                                                                                                                    | Existing OAuth domains and frontend Amplify configuration.                                                               | No.                                                                                                                                  | Keep.                                                                                                                                            |
| Accounting                           | KEEP   | Mature handlers under `lambda/domains/accounting`, Accounting nested stack, and shared Accounting DTOs remain. Phase 2 adds the Accounting-owned `settings` repository/service. Fiscal-year creation and lettering now use its centralized settings-first resolver; fiscal-year snapshots and other established flows remain compatible. | Remain an ERP domain with unchanged SYSCOHADA/SYCEBNL authority, fiscal sharding, transactions, and audit requirements. Accounting owns its settings and accepts cross-domain integrations only through owned contracts.                                                                       | High for any rule or persistence change.                                                                                                           | Backfill coverage; legacy projection retirement; ProductAccess authorization.                                            | AccountingSettings rows are additive; Accounting transactions are not migrated.                                                      | Phase 2 foundation implemented; remaining compatibility consumers migrate only when justified.                                                   |
| Projects / SYCEBNL                   | EVOLVE | Backend and frontend Projects domains, Project nested stack, and shared Projects schemas exist. All seven read routes require `PROJECTS_READ`; all four writes require `PROJECTS_WRITE`. Only `GET /donors` additionally enforces Projects ProductAccess. Projects Lambdas no longer receive `ACCOUNTING_PERMISSION`. Reporting paths still query Accounting entry-line GSI4 projections through `ProjectService`. | Remain an ERP domain with SYCEBNL authority. Replace direct Accounting persistence reads through a reviewed integration boundary. | High: reporting totals, historical queries, existing GSI4 behavior, and staged authorization coverage must remain identical. | ProductAccess coverage; domain RBAC inventory; OHADA/SYCEBNL references; explicit Accounting-to-Projects reporting contract. | No permission or item migration for Phase 4E. A future Projects read model would require an additive backfill. | All 11 routes use Projects RBAC and typed metadata only. |
| Treasury                             | EVOLVE | Backend/frontend Treasury domains and Treasury nested stack exist. All five read routes require `TREASURY_READ`; all five writes require `TREASURY_WRITE`. Only `GET /treasury/summary` additionally enforces Treasury ProductAccess. Treasury Lambdas no longer receive `ACCOUNTING_PERMISSION`; existing service coupling to Accounting remains unchanged. | Remain an ERP domain. Accounting entry creation and line transitions must later move behind explicit Accounting contracts. | Very high: posting, reconciliation, transaction atomicity, access, and audit behavior are production-sensitive. | ProductAccess; domain RBAC inventory; Accounting posting/reconciliation contracts; idempotency and parity tests. | No permission or item migration for Phase 4E. A future integration read model may require additive state. | All 10 routes use Treasury RBAC and typed metadata only. |
| Events / EventBridge                 | DEFER  | No application EventBridge producer/consumer implementation was found; only a CDK feature flag references events behavior.                                                                                                                                                                                                               | Introduce versioned event contracts and transport only when a real producer and consumer require asynchronous integration, with idempotency, retries, observability, and ownership.                                                                                                            | High if introduced speculatively: operational complexity, duplicate delivery, ordering, and audit concerns.                                        | Concrete use case; contract owner; consumer idempotency; CDK placement and resource budget.                              | No.                                                                                                                                  | Phase 5, per real integration. EventBridge is an option, not a mandated transport.                                                               |
| ProductAccess                        | ADD    | The strict DTO and `PRODUCT_ACCESS` persistence remain unchanged. Backend authorization is opt-in on one Treasury and one Projects read route. The tenant-keyed frontend query now drives known Treasury and Projects navigation availability; Accounting remains legacy.                                                            | Platform Core organization entitlement remains separate from membership, workspace type, permissions, AccountingSettings, and frontend presentation. Missing and INACTIVE deny annotated backend routes and render annotated navigation unavailable only after a successful observation response. | High during rollout because existing organizations require verified backfill coverage. Technical failures must not masquerade as inactive access.  | Production coverage verification; backend/frontend pilot telemetry; route inventory.                                     | Existing organizations may need additive rows through the conditional explicit-ID backfill. No existing rows are overwritten.        | Phase 4B second controlled pilot implemented; broad backend/frontend rollout deferred.                                                           |
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

## AccountingSettings access patterns implemented in Phase 2

Accounting owns the backend persistence model and service under `packages/backend/lambda/domains/accounting/settings`. The public, strict DTO is exported from the shared Accounting boundary without persistence metadata.

```text
PK = ORG#{orgId}
SK = SETTINGS#ACCOUNTING
entityType = ACCOUNTING_SETTINGS
```

Implemented and tested patterns:

1. Resolve one organization's AccountingSettings through a consistent direct `GetItem`.
2. Provision settings in the existing atomic onboarding transaction through an Accounting-owned write contract. COMPANY onboarding now contains 7 operations and ACCOUNTING_FIRM onboarding contains 10, safely below the 100-operation DynamoDB transaction limit.
3. Provision settings when an accounting firm creates a client organization; that transaction contains 4 operations.
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
  productCode: "TREASURY",
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

The original Phase 3 pilot is read-only `GET /treasury/summary` with `TREASURY`. Phase 4B adds exactly one Projects pilot, read-only `GET /donors` with `PROJECTS`. Repository route inventory found 50 Accounting, 11 Projects, and 10 Treasury routes. The rollout is therefore Accounting 0/50, Projects 1/11, and Treasury 1/10, leaving 69 of 71 business route mappings unannotated. Identity, onboarding, workspace discovery, `GET /me/product-access`, cabinet recovery/administration, and all pre-tenant flows remain non-enforcing.

All two production Organization-creation workflows now use `ProductAccessService.buildCompatibilityBaselineWrites`, the single baseline definition:

- first-workspace COMPANY and ACCOUNTING_FIRM onboarding retain 7 and 10 transaction operations respectively;
- cabinet-created client organizations now contain Organization, UserOrgAccess, cabinet dossier, three ProductAccess rows, and AccountingSettings: 7 transaction operations.

The explicit-ID ProductAccess backfill remains dry-run by default. It now queries and reports `COMPLETE`, `PARTIAL`, or `MISSING` coverage plus active, inactive, and missing products. `--apply` still uses conditional writes and never overwrites an existing row. No `Scan`, GSI, or automatic production migration was introduced.

## Product-aware frontend shell pilot implemented in Phase 4

Platform Core owns the frontend ProductAccess client, TanStack Query options, query state, and pure availability semantics under `packages/frontend/src/app/core/product-access`. The client treats `GET /me/product-access` as `unknown`, validates it with the strict shared `ProductAccessListResponseSchema`, rejects persistence fields and responses containing a different organization, and relies on the existing authenticated interceptor for `x-org-id`.

The query is enabled only after authentication, workspace discovery, and an effective organization context exist. Its key is:

```text
["product-access", effectiveOrgId]
```

For a direct company, the effective organization is the active workspace organization. For an accounting firm operating a client dossier, it is the selected client organization, matching the tenant used by existing business requests. Query keys isolate organization caches, and no previous-organization placeholder data is used. ProductAccess has a five-minute `staleTime` and no polling.

The existing navigation model supports optional typed `productCode?: ProductCode` metadata. Phase 4 annotated only Treasury with `TREASURY`. After a successful query, ACTIVE keeps the existing interaction while INACTIVE or a missing row keeps the annotated item visible with a localized, accessible unavailable state and prevents the normal sidebar action. Loading and technical query failures remain `UNKNOWN` and preserve legacy navigation; they are never presented as inactive access. No Angular entitlement guard, redirect, administration workflow, or frontend security boundary was added. Backend authorization remains authoritative.

Operational prerequisite: verify or backfill ProductAccess coverage for existing production organizations before broad use of product-aware navigation. A successful response with a missing Treasury or Projects row intentionally means unavailable for that product; the frontend does not introduce a missing-means-ACTIVE fallback.

## Projects ProductAccess rollout implemented in Phase 4B

Projects is the second controlled rollout. The backend annotates only `GET /donors` with `PROJECTS`. It was selected because it is a tenant-scoped, read-only Projects operation using the donor repository path and does not traverse the Projects reporting paths that directly query Accounting-owned GSI4 projections. Phase 4C replaced its legacy Accounting-named RBAC decision with `PROJECTS_READ`; Phase 4D1 applies that owning-domain read permission to the remaining Projects read routes without adding ProductAccess annotations.

The frontend adds `productCode: "PROJECTS"` to the existing Projects navigation item and reuses the Platform Core ProductAccess query, pure `AVAILABLE`/`UNAVAILABLE`/`UNKNOWN` semantics, localized unavailable copy, tooltip, badge, and disabled interaction already used by Treasury. Treasury remains unchanged. Accounting deliberately declares no product metadata and remains visually and behaviorally unaffected even when an ACCOUNTING row is inactive.

The organization-keyed query continues to isolate direct-company and selected-dossier contexts. A successful response with a missing or INACTIVE Projects row renders Projects unavailable; loading or a technical/validation failure remains UNKNOWN and preserves legacy navigation. Direct Projects URLs remain unchanged because no Angular entitlement guard or redirect exists. Existing production organizations intended to use Projects require ProductAccess coverage verification or the explicit-ID backfill before broad rollout; no production backfill is automatic.

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

### Phase 5 — Domain integration contracts/events

Select a real existing producer/consumer workflow, define a versioned business contract, and implement the smallest API or event integration. Add transport infrastructure only if asynchronous delivery is justified; include idempotency, retry, audit, and observability requirements.

### Phase 6 — Restaurants foundation

Classify Restaurants as a vertical solution, define its real access patterns and domain model, reuse the single app/Cognito/org/table architecture, and integrate through owned contracts. Do not begin until entitlement, authorization, shell, and integration boundaries are stable.

## Smallest safe Phase 1 slice

The safest first review is additive and non-enforcing:

1. Define product codes only for currently implemented product surfaces (`ACCOUNTING`, `PROJECTS`, and `TREASURY`) and an `ACTIVE`/`INACTIVE` lifecycle without future vertical codes.
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
- `TreasuryService` currently crosses the target domain boundary by calling `LedgerService` and directly reading/updating Accounting accounts and entry lines with Accounting key helpers. This remains untouched in Phase 0 and requires an explicit Accounting posting/reconciliation API in Phase 5.
- `ProjectService` and `BudgetService` currently read Accounting entry-line GSI4 projections directly for project/SYCEBNL reporting. This remains untouched in Phase 0 and requires an Accounting-owned query contract or a deliberately owned Projects read model in Phase 5.
- Several `@liass-ohada/shared` domain exports expose persistence schemas with `PK`, `SK`, and `GSI*` fields even though the canonical boundary calls for frontend-safe DTOs and backend-only persistence shapes. New Phase 1 schemas must follow the target rule; existing exports need a separate compatibility migration rather than abrupt removal.
- The CDK architecture guide previously allowed domains to share services at code level, which could be read as permission for direct cross-domain mutation. It now requires explicit APIs/events and forbids repository/key/aggregate access across domains.
- The workspace contains empty, untracked backend domain directories for several anticipated domains. They are not repository implementation and must not be treated as active domains or used to justify speculative scaffolding.
- ProductAccess now participates in backend authorization only for explicitly annotated handlers. It is not consumed by frontend navigation, workspace selection, or unannotated routes. EventBridge remains absent and deferred.
- Accounting authorization and workspace context still transport the legacy `accountingFramework`. Phase 2 deliberately avoids adding an AccountingSettings read to every authorized request; only real Accounting consumers that need current configuration use the resolver.
- The cabinet client-organization ProductAccess provisioning gap is closed in Phase 3 through the centralized baseline transaction writes.
- No direct Projects or Treasury runtime read of `accountingFramework` was found. Their previously recorded direct Accounting persistence dependencies remain separate architecture debt and were not broadened into AccountingSettings dependencies.
- `SPEC.md` previously lagged the implemented Phase 1 state. It now distinguishes the implemented opt-in backend authorization pilot from deferred global and frontend enforcement.
- Phase 4G removes the frontend effective-organization signal's Accounting-specific name. The underlying snapshot repository still has the historical `AccountingAuthorizationRepository` name, while `AccountingAccessMode`, `HandlerContext.accountingAccessMode`, and `AuthStore.activeAccountingAccessMode` remain compatibility terminology debt and are intentionally outside this phase.
- Existing organizations still require explicit coverage verification/backfill before additional routes are annotated. Missing access intentionally denies the Treasury and Projects pilots; it is never treated as ACTIVE.
- The frontend shell still physically resides under `shared/layout`, while ProductAccess orchestration is correctly Platform Core-owned under `core/product-access`. Phase 4 avoids a broad directory move; that structural cleanup remains a separately reviewable refactor.
- Phase 4B intentionally retains an asymmetric frontend rollout: Treasury and Projects are ProductAccess-aware, while Accounting ignores its entitlement row. Direct Treasury and Projects URLs remain unchanged, and backend authorization is still the security authority.

No material architectural contradiction was found among `SPEC.md`, `AGENTS.md`, ADR-001, repository skills, and the CDK placement guide. The runtime divergences listed above remain intentional compatibility debt and are mapped rather than silently refactored.
