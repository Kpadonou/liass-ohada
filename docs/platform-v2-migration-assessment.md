# Platform V2 Migration Assessment

## Purpose and scope

This assessment maps the current repository to the accepted Platform V2 model and records the incremental runtime foundations delivered after Phase 0. Phase 1 added ProductAccess without enforcement. Phase 2 adds Accounting-owned AccountingSettings while retaining legacy Organization and onboarding contracts.

The assessment is based on the current shared schemas, Identity/Cabinet onboarding and authorization paths, centralized `KeyFactory`, domain handlers/services, Angular shell/state/routes, and CDK stack composition.

## Classification

- **KEEP**: retain the implementation and responsibility.
- **EVOLVE**: extend the current owner or contract through a compatible change.
- **MOVE**: transfer responsibility or code to the correct logical owner through a staged migration.
- **ADD**: introduce a missing Platform V2 concept.
- **DEFER**: make no implementation change until a concrete prerequisite or use case exists.

## Current-to-target migration map

| Area | Class | Current implementation/location | Target responsibility | Risk | Dependencies | Data migration | Recommended phase |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Organization DTO/schema | EVOLVE | `packages/shared/src/shared/workspace.ts` still defines `OrganizationSchema` with `orgId`, identity fields, `accountingFramework`, and `workspaceType`; organization creation continues to persist the legacy field. | Platform Core Organization contains global identity, country, status, and lifecycle fields. AccountingSettings is now the preferred Accounting runtime source; the Organization copy remains a compatibility projection. | High: used by onboarding, workspace discovery, cabinet authorization, Accounting, and tests. | Backfill coverage; compatibility-consumer inventory; versioned DTO plan. | A future cleanup may remove the legacy field only after compatibility coverage is proven; Phase 2 does not mutate Organization rows. | Phase 2 foundation implemented; physical field removal deferred. |
| Onboarding DTOs and workflow | EVOLVE | `CreateInitialWorkspaceRequestSchema` remains unchanged. `OnboardingService` now asks the Accounting-owned settings service for a transaction write, and onboarding atomically creates the legacy Organization projection, ProductAccess baseline, and AccountingSettings. | Preserve the public request/response while Platform Core coordinates domain initialization through an Accounting-owned contract. | High: first-user flow, idempotency lock, transaction size, and public API compatibility. | Backfill execution and monitoring; future contract-version plan. | Existing organizations need only an additive AccountingSettings backfill; existing Organization rows remain untouched. | Phase 2 dual-write implemented. COMPANY uses 7 transaction operations and ACCOUNTING_FIRM uses 10. |
| `accountingFramework` | MOVE | Still required in Organization, onboarding, workspace/access projections, cabinet defaults/settings, and public frontend contracts. Accounting runtime resolution is centralized in `AccountingSettingsService`: settings first, legacy Organization fallback. | Accounting owns `AccountingSettings.accountingFramework`. Legacy copies remain compatibility projections until a later reviewed cleanup. | Very high: Accounting validation and authorization context depend on it; removing early breaks contracts and existing items. | Backfill coverage; mismatch reporting; consumer migration; versioned contract removal. | Additive AccountingSettings rows are required. Existing Organization values are neither deleted nor overwritten. | Phase 2 foundation implemented; legacy projections and final removal deferred. |
| Workspace types | KEEP | `WorkspaceTypeSchema` supports `COMPANY` and `ACCOUNTING_FIRM`; frontend guards, state, and cabinet flows branch on it. | Keep workspace context and cabinet supervision semantics. Do not add product codes or interpret workspace type as entitlement. | Medium if overloaded by future navigation/authorization work. | ProductAccess and platform permission context. | No. | Preserve through all phases; stop new entitlement coupling in Phase 1 onward. |
| `USER_ORG_ACCESS` | EVOLVE | Organization-partition item plus GSI6 discovery projection in `onboarding-repository.ts`; verified by `TenantAccessService`; contains role, workspace, country, and duplicated `accountingFramework`. | Platform Core membership/access record. Keep direct organization access and user discovery; entitlement remains a separate organization-level concern. Retire accounting-specific projection only after Phase 2 compatibility work. | High: security-critical direct lookup and pre-tenant discovery path. | ProductAccess resolution; workspace response composition; backfill compatibility. | Not for ProductAccess. Yes only if obsolete duplicated attributes are later removed or rewritten. | Phase 1 preserves shape; Phase 2/3 evolve composition and authorization. |
| Cabinet model | KEEP | Identity/Cabinet handlers and repositories own cabinet metadata, dossiers, members, assignments, settings, work, and deadlines; `ACCOUNTING_FIRM` drives supervision UX. | Preserve the accounting-firm/cabinet supervision model and effective organization access. Cabinet access does not grant products by itself; the dossier organization still needs ProductAccess for domain actions. | Medium: entitlement checks must not break supervised dossier access or reader access modes. | ProductAccess for dossier org; cabinet membership/assignment decision; Accounting permission mapping. | No for the cabinet model. | Phase 3 adds entitlement to the existing decision chain. |
| `KeyFactory` | EVOLVE | `packages/backend/lambda/shared/key-builder.ts` centralizes organization, fiscal-year, cabinet, discovery, and domain keys. Phase 1 added ProductAccess helpers; Phase 2 adds `accountingSettingsSK()` returning `SETTINGS#ACCOUNTING`. | Remain the concrete key authority. Domains use their own internal helpers plus shared Platform Core helpers; formats are not assembled at call sites. | High if key formats or call sites are renamed; low for additive helpers. | Domain repository boundaries and access-pattern tests. | No for additive keys; any format replacement would require a separate migration. | ProductAccess and AccountingSettings helpers implemented additively. |
| DynamoDB persistence | EVOLVE | One table in `DataStack`/`LiassOhadaAccountingTable`, accessed with Get/Query/BatchGet and transactions; Accounting uses fiscal-year partitions. | Keep one table and organization isolation. Add domain-owned item types using documented access patterns, Query/direct reads, conditional writes, and transactions. No domain may mutate another domain's items. | High for authorization consistency, hot partitions, transaction limits, and backfills. | KeyFactory; repository ownership; access-pattern tests; migration metrics. | Additive ProductAccess needs no rewrite; AccountingSettings requires a backfill. | Phases 1–3; no new table. |
| Identity service/repository boundary | EVOLVE | Identity handlers call services/repositories under `lambda/shared`; onboarding, membership, workspace discovery, cabinet, and profile concerns are mixed in the shared layer. | Platform Core Identity/Organization/Access owns membership and discovery. Product entitlement is resolved through a separate Platform Core contract. Cabinet-specific behavior remains explicit. | High: many handlers/tests import current static services directly. | Stable interfaces; incremental adapters; handler compatibility. | No. | Phase 1 introduce entitlement owner; Phase 3 compose authorization. |
| Authorization wrapper/middleware | EVOLVE | `handler-wrapper.ts` verifies JWT and tenant context, then branches between Accounting authorization for `COMPANY`, tenant access for `ACCOUNTING_FIRM`, and a membership-only `PLATFORM` path used by the observational ProductAccess endpoint. No path enforces ProductAccess. | Compose reusable platform authorization in order: identity, organization membership, product access, role/permission, domain action. Domain-specific permission evaluators remain owned by domains. | Very high: every protected handler may be affected; current wrapper is Accounting-oriented. | ProductAccess resolver; route/handler product metadata; domain permission contracts; denial telemetry. | No. | Phase 3, initially on a narrow opt-in path with existing behavior as the default. |
| Frontend active-workspace state | EVOLVE | `AuthStore` stores active `orgId`, workspace summaries, cabinet/dossier context, and clears Accounting/Projects/Treasury query roots on tenant changes. | Platform shell context includes active organization, membership/permissions, and enabled products while retaining cabinet/dossier state. Server state remains in TanStack Query; UI context remains in Signal Store. | High: guards, interceptor headers, navigation, and cached tenant data depend on it. | ProductAccess response/read model; authorization API; query-key policy. | No. | Phase 4 after backend entitlement checks are available. |
| Frontend shell/navigation | MOVE | Stateful shell components live under `packages/frontend/src/app/shared/layout`; sidebar items are static and branch mainly on cabinet context. | Platform Core owns the stateful authenticated shell and product-aware navigation. `shared/ui` remains stateless. Menus filter by ProductAccess plus permissions without changing current Accounting routes. | Medium-high: imports, lazy routes, responsive behavior, and cabinet navigation can regress. | Phase 3 authorization context; design-system skill; route metadata; compatibility defaults. | No. | Phase 4, with a move only when imports can be changed atomically and tested. |
| Dashboard | EVOLVE | `packages/frontend/src/app/core/feature/dashboard` is already platform-level but presents static cross-domain Accounting, Projects, Treasury, and Reporting data. | Remain in Platform Core. Aggregate domain-provided KPIs only for enabled products and do not absorb domain calculations. | Medium: accidental cross-domain service coupling or inconsistent loading/error states. | Product-aware shell context; domain query contracts; permission-filtered widgets. | No. | Phase 4 for visibility; real KPI integrations incrementally afterward. |
| Shared schemas | EVOLVE | `packages/shared` exports workspace, cabinet, Accounting, Projects, and Treasury schemas. DTO variants omit persistence keys, but several domain subpaths also export persistence schemas containing `PK`, `SK`, `GSI*`, and `entityType`. | Add frontend-safe ProductAccess summaries and later AccountingSettings contracts in owning export boundaries. Move or isolate persistence schemas behind the backend-only export without breaking existing backend imports; keep frontend contracts free of physical keys. | High: frontend and backend consume the same domain subpaths, generated JS/declarations must stay synchronized, and export removal can be breaking. | Shared export map; backend import inventory; compatibility re-exports; frontend response validation. | No data rewrite, but a staged code/API migration is required. | Phase 1 keeps new persistence schemas backend-only; existing schema cleanup is a separate incremental MOVE after consumers are inventoried. |
| Domain service/repository placement | MOVE | Accounting, Projects, Treasury, onboarding, cabinet, and other business services/repositories are physically co-located under `packages/backend/lambda/shared/services` and `repositories`, while handlers are domain-organized. | Business services and repositories move incrementally behind their owning domain boundary; only business-neutral infrastructure remains shared. Imports across domains use contracts, APIs, or events rather than internals. | High: broad import/test churn and potential circular dependencies. | Stable owner map; adapters; focused domain tests; no key changes. | No. | Do not perform as a broad refactor. Move only the files touched by reviewed Phases 1–5, one owner at a time. |
| CDK stacks | KEEP | `api-domain-stacks.ts` composes Identity, Accounting, Projects, and Treasury nested stacks; API core owns shared API/Cognito/role; DataStack owns the table. | Preserve names, ownership, and nested-stack architecture. Add future business resources only to the coherent owning stack; Platform Core only for genuinely shared resources. | High if stateful resources move or logical IDs change. | CDK placement guide; synth/resource counts/diff for future runtime phases. | No. | No Phase 0 change; Phase 1 should prefer existing Identity/Platform Core ownership without stack rename. |
| API Gateway | KEEP | One shared HTTP API and authorizer are passed into domain nested stacks. | Remain the principal platform API boundary. Cross-domain contracts do not require a new API Gateway or premature microservices. | Low if reused; high if duplicated. | Existing authorizer and route composition. | No. | Keep. |
| Cognito | KEEP | One User Pool, client, authorizer, hosted UI domain, and social providers are owned by API core auth constructs. | Remain the shared Liass-OHADA identity provider for every product and vertical. | High if replaced or duplicated. | Existing OAuth domains and frontend Amplify configuration. | No. | Keep. |
| Accounting | KEEP | Mature handlers under `lambda/domains/accounting`, Accounting nested stack, and shared Accounting DTOs remain. Phase 2 adds the Accounting-owned `settings` repository/service. Fiscal-year creation and lettering now use its centralized settings-first resolver; fiscal-year snapshots and other established flows remain compatible. | Remain an ERP domain with unchanged SYSCOHADA/SYCEBNL authority, fiscal sharding, transactions, and audit requirements. Accounting owns its settings and accepts cross-domain integrations only through owned contracts. | High for any rule or persistence change. | Backfill coverage; legacy projection retirement; ProductAccess authorization. | AccountingSettings rows are additive; Accounting transactions are not migrated. | Phase 2 foundation implemented; remaining compatibility consumers migrate only when justified. |
| Projects / SYCEBNL | EVOLVE | Backend and frontend Projects domains, Project nested stack, and shared Projects schemas exist. `ProjectService` and `BudgetService` currently query Accounting entry-line projections through GSI4 and Accounting-oriented KeyFactory helpers for analytical reports. | Remain an ERP domain with SYCEBNL authority. Replace direct Accounting persistence reads with an Accounting-owned query contract or a Projects-owned read model fed by a versioned integration event. | High: reporting totals, historical queries, and existing GSI4 behavior must remain identical. | ProductAccess; OHADA/SYCEBNL references; explicit Accounting-to-Projects reporting contract; parity tests. | No item rewrite if a synchronous Accounting query contract is used; a Projects read model would require an additive backfill. | Entitlement in Phases 1/3; treat the existing report path as a concrete Phase 5 integration candidate. |
| Treasury | EVOLVE | Backend/frontend Treasury domains and Treasury nested stack exist. `TreasuryService` imports Accounting schemas and `LedgerService`, posts Accounting entries, reads Accounting accounts/lines, and directly updates Accounting entry-line reconciliation fields using Accounting KeyFactory helpers. | Remain an ERP domain. Accounting owns entry creation and Accounting-line state transitions; Treasury calls explicit Accounting application APIs/contracts. Cross-domain orchestration must preserve posting and reconciliation atomicity/idempotency. | Very high: posting, bank reconciliation, transaction atomicity, and audit behavior are production-sensitive. | ProductAccess; Accounting posting/reconciliation contracts; transaction boundary decision; idempotency and parity tests. | No existing item rewrite is required for a synchronous contract; an event/read-model alternative could require additive state. | Entitlement in Phases 1/3; use Treasury-to-Accounting posting/reconciliation as a concrete Phase 5 boundary migration, likely synchronous first. |
| Events / EventBridge | DEFER | No application EventBridge producer/consumer implementation was found; only a CDK feature flag references events behavior. | Introduce versioned event contracts and transport only when a real producer and consumer require asynchronous integration, with idempotency, retries, observability, and ownership. | High if introduced speculatively: operational complexity, duplicate delivery, ordering, and audit concerns. | Concrete use case; contract owner; consumer idempotency; CDK placement and resource budget. | No. | Phase 5, per real integration. EventBridge is an option, not a mandated transport. |
| ProductAccess | ADD | Phase 1 implements strict frontend-safe schemas under `packages/shared/src/shared`, backend-only `PRODUCT_ACCESS` persistence plus repository/service under `lambda/shared`, onboarding baseline writes, an explicit-ID dry-run backfill tool, and authenticated `GET /me/product-access` in the Identity nested stack. | Platform Core organization entitlement with explicit product code, status, and lifecycle timestamps. It remains separate from membership, workspace type, permissions, and domain settings. | High when enforcement begins because denial defaults could hide or block all current products; Phase 1 is non-enforcing. | Backfill execution/coverage evidence; route/handler product metadata; authorization and frontend read models. | Additive baseline rows are required for existing organizations; the tool uses conditional writes and explicit `--org-id`/`--org-ids-file` inputs, and is not run automatically. | Phase 1 foundation implemented; enforcement remains Phase 3 after coverage is verified. |
| Restaurants | DEFER | No tracked Restaurants backend/frontend/shared/CDK implementation exists. | First planned `VERTICAL_SOLUTION`, inside the same application, identity, organization boundary, and table strategy, with its own domain ownership. | High if started before entitlement and integration boundaries stabilize. | Phases 1–5; reviewed domain model and real access patterns. | None until implemented. | Phase 6 only. |

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

Compose ProductAccess checks alongside existing membership, cabinet/dossier access, and domain RBAC. Opt endpoints in by reviewed product/domain metadata, emit safe denial telemetry, and preserve compatibility defaults until backfill completeness is verified.

### Phase 4 — Platform shell/navigation

Add enabled products and permission context to the active organization state, make existing menu groups product-aware, and preserve current routes and Accounting-first behavior. Move stateful shell components into Platform Core only as an atomic, tested refactor.

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
- ProductAccess now exists at runtime as an additive, observational Platform Core model. It is not consumed by existing authorization, frontend navigation, workspace selection, or domain behavior. EventBridge remains absent and deferred.
- Accounting authorization and workspace context still transport the legacy `accountingFramework`. Phase 2 deliberately avoids adding an AccountingSettings read to every authorized request; only real Accounting consumers that need current configuration use the resolver.
- Accounting-firm client-organization creation now provisions AccountingSettings, but the pre-existing Phase 1 implementation does not provision the ProductAccess baseline on that path. Phase 2 leaves ProductAccess unchanged as required; this is a concrete compatibility/backfill concern to address separately before entitlement enforcement.
- No direct Projects or Treasury runtime read of `accountingFramework` was found. Their previously recorded direct Accounting persistence dependencies remain separate architecture debt and were not broadened into AccountingSettings dependencies.
- `SPEC.md` lagged the implemented Phase 1 state by saying ProductAccess was not implemented. It now records the actual additive read/persistence foundation while continuing to state that enforcement is future work.

No material architectural contradiction was found among `SPEC.md`, `AGENTS.md`, ADR-001, repository skills, and the CDK placement guide. The runtime divergences listed above remain intentional compatibility debt and are mapped rather than silently refactored.
