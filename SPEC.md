# Codex Specification: Liass-OHADA Platform V2

## 1. Project Goal & Infrastructure Strategy

**Project Name**: Liass-OHADA
**Primary Goal**: Build a cloud-native, modular, multi-tenant ERP platform designed for organizations operating in the OHADA environment. OHADA, SYSCOHADA, and SYCEBNL rigor remains essential within Accounting and the financial ERP domains to which those rules apply; it does not make every platform capability an accounting feature.

**Platform experience**:

- `liassohada.com` is the public platform website.
- `app.liassohada.com` is the single authenticated Liass-OHADA application.
- Amazon Cognito is the shared identity provider for the platform. A user belongs to Liass-OHADA, not to an individual product, and the platform must not create a User Pool per domain or vertical.
- Separate product applications or product-specific domains require a future reviewed architecture decision.

**Multi-tenancy**: `organizationId` (represented as `orgId` in current contracts and code) is the canonical global tenant identity. It must identify the same organization across Platform Core, ERP domains, and vertical solutions. Accounting Firms (Cabinets), SMEs (PMEs), and NGOs remain supported. A Cabinet is an accounting-firm supervision context that can manage multiple organization dossiers, while each organization's tenant-owned data remains isolated by `orgId`.

The target authorization and configuration model separates four concerns:

```text
Organization
    -> UserOrgAccess
    -> ProductAccess
    -> DomainSettings
```

- `Organization` owns platform-wide identity and status attributes.
- `UserOrgAccess` represents a user's verified access to an organization.
- `ProductAccess` is the platform-level entitlement for enabled products or capabilities. Its additive persistence and read foundation is implemented; authorization and frontend enforcement remain future migration phases.
- `DomainSettings` belongs to the owning business domain. In particular, `accountingFramework` conceptually belongs to `AccountingSettings`, not to universal Organization metadata.

Current onboarding, Organization, workspace, access-projection, and response contracts may still carry `accountingFramework`. This is an explicit compatibility state. It must remain supported until a reviewed, backward-compatible runtime and data migration moves ownership to Accounting.

`COMPANY` and `ACCOUNTING_FIRM` workspace types remain compatible. `ACCOUNTING_FIRM` continues to model cabinet supervision, but `workspaceType` must not become the universal product-entitlement mechanism. Future product availability is governed by `ProductAccess`.

**Naming Convention**: All AWS resources must follow the pattern: `liass-ohada-{stage}-{resource-name}`.

- `{stage}`: `dev`, `test`, or `prod`.
- Example: `liass-ohada-dev-accounting-table`.
- Stage resolution for CDK deployments must be deterministic: CDK context (`-c stage=...`) takes precedence over `STAGE`, and defaults to `dev`.
- DynamoDB tables must set an explicit `tableName`, for example `liass-ohada-dev-accounting-table`.
- Lambda functions must set an explicit `functionName` using the pattern `liass-ohada-{stage}-{domain}-{action}`, for example `liass-ohada-dev-accounting-post-entry` or `liass-ohada-dev-projects-create-project`.
- Resource names must be generated from centralized CDK deployment configuration and environment variables. Business logic must not hard-code AWS resource names; Lambdas must receive resource names through environment variables such as `TABLE_NAME`.

### Technical Stack

- **Repository**: npm workspaces monorepo with `packages/backend`, `packages/shared`, and `packages/frontend`.
- **Backend IaC**: AWS CDK (TypeScript).
- **Backend Architecture**: slim, logic-less Lambda handlers, an explicit service layer, Zod validation, and DDD-inspired domain organization behind the existing API Gateway.
- **Database**: Amazon DynamoDB Single Table Design with fiscal-year sharding for high-volume Accounting transactions.
- **Auth**: one shared Amazon Cognito identity system, with organization membership and RBAC.
- **Validation and DTOs**: Zod schemas and TypeScript DTOs in `@liass-ohada/shared`; backend-only persistence schemas must not leak DynamoDB storage keys into frontend contracts.
- **Storage**: Amazon S3 for documents and reports.
- **Frontend**: one Angular standalone application with Angular Signals, TanStack Query for server state, NgRx Signal Store for client/UI state, Angular Material 3, Tailwind CSS, and Transloco.
  - `core/` owns global application plumbing and platform-level surfaces such as routing, guards, global state, the platform shell context, and dashboard.
  - `domains/` contains backend-aligned business domains. Active frontend domain directories must match backend domain directory names; current active domains are `identity`, `accounting`, `projects`, and `treasury`.
  - Domain folders use `feature/`, `ui/`, `data-access/`, and `utils/`.
  - `shared/ui/` contains stateless reusable design-system components and must not inject stores, domain services, API clients, or application state.

The platform shell owns active organization, connected user, global navigation, search or command palette, notifications, preferences, global permission context, and future product availability. Business domains own routed experiences and domain rules. The dashboard is a platform-level surface that may aggregate KPIs exposed by enabled domains without absorbing their business logic. Navigation will eventually be filtered by `ProductAccess` plus user permissions; that behavior is not yet implemented.

The single application may progressively expose routes such as `/dashboard`, `/accounting/...`, `/treasury/...`, `/projects/...`, and `/administration/...`. A future `/restaurants/...` route remains deferred until the Restaurants implementation phase.

### Mandatory CDK Stack Boundaries

The authoritative CDK resource-placement and validation rules are defined in [`packages/backend/docs/cdk-nested-stack-architecture.md`](packages/backend/docs/cdk-nested-stack-architecture.md).

- The API core owns only shared, foundational, or genuinely cross-domain infrastructure. Business endpoints and their stateless resources belong to the appropriate business-domain nested stack.
- A new nested stack requires a coherent durable domain boundary and justified resource growth. Do not split infrastructure per endpoint, implementation lot, or small feature.
- Existing nested stacks must not be renamed or reorganized during ordinary migration work.
- Existing stateful resources, including the shared DynamoDB table and Cognito resources, retain their ownership unless an explicit reviewed migration plan requires otherwise. Nested stacks consume typed references and must not duplicate the shared API, table, User Pool, or authorizer.
- Every synthesized application template must remain at or below 350 CloudFormation resources. CDK resource changes require synthesis, the repository resource-count guard, and `cdk diff` when credentials are available.
- Domain separation does not require premature microservices. The existing API Gateway may remain the principal API boundary.

---

## 2. Platform Capability Model

### A. Platform Core

Platform-wide capabilities include identity and authentication, organizations, user-to-organization access, future product entitlement, permissions/RBAC, notifications, documents, audit/traceability, shared integrations/events, and the shared application shell and navigation.

### B. ERP Business Domains

The target ERP domain map is:

- **Accounting**: chart of accounts, journals, entries, general ledger, closing, and compliant financial processing; account identifiers remain normalized 8-digit strings where the current Accounting contracts require them.
- **Projects / SYCEBNL**: donor/grant, fund, budget, and project tracking for nonprofit and donor-funded organizations.
- **Treasury**: cash movements, bank statements, cash-flow visibility, and reconciliation.
- **Commercial**: invoicing, quotes, bills, product catalog, and customer/supplier relationships.
- **Fixed Assets**: acquisition, depreciation/amortization, impairment, and disposal lifecycle.
- **Payroll**: payroll and its Accounting integration under applicable local rules.
- **Reporting**: domain-owned and cross-domain read models, including applicable SYSCOHADA/SYCEBNL financial statements.

A domain is implemented only when corresponding runtime code and infrastructure exist; this target map is not permission to scaffold speculative packages.

### C. Vertical Solutions

Restaurants is the first planned vertical solution. It is not an implemented domain and must not receive routes, packages, persistence, infrastructure, or a separate application until a reviewed implementation phase authorizes them. Other verticals such as Retail remain possible future decisions, not current scaffolding requirements.

---

## 3. Domain Ownership & Integration

Every business domain owns its entities, invariants, persistence operations, and domain logic. Physical co-location in one DynamoDB table does not imply logical ownership.

- A domain must not construct another domain's persistence keys, import another domain's repository internals, or mutate another domain's aggregates.
- KeyFactory helpers and repositories must respect domain ownership even though concrete keys remain centralized.
- Cross-domain collaboration must use explicit APIs or versioned domain/integration events.
- A producer may publish a business fact such as `SaleClosed`; the consuming domain translates it into its own consequences. A Restaurants component, for example, must never create an Accounting `ENTRY` directly.
- Shared technical code may provide infrastructure-neutral utilities and contract transport, but it must not become a backdoor for cross-domain business mutation.
- Logical domain separation comes before physical separation. Separate services or tables may be considered later only when scale, security, deployment isolation, or operational requirements justify them.

---

## 4. Partitioning & Key Strategy (CRITICAL)

### A. The KeyFactory Utility

All Partition Keys (PK), Sort Keys (SK), and index keys must be generated using the centralized `KeyFactory` in `packages/backend/lambda/shared/key-builder.ts`.

Do not manually concatenate persistence keys in repository logic. `key-builder.ts` is the implementation authority for concrete names, prefixes, formats, and helpers. Do not rename key formats as part of an unrelated domain migration.

### B. Partitioning Overview

- **Tenant-owned organization data**: uses the canonical organization boundary and prefixes defined by `KeyFactory`, normally `ORG#{orgId}`.
- **Explicit exceptions**: documented global discovery, cabinet-supervision, invitation/token lookup, user-profile, lock, and index access patterns may use their own `KeyFactory`-defined prefixes. These exceptions do not weaken organization isolation.
- **Master Data (Permanent)**:
  - `PK = ORG#{orgId}`
  - `SK` depends on the entity, for example `USER#{userId}` or `ACC#{accountCode}`.
- **Transactional Data (Fiscal Sharding)**:
  - High-volume Accounting data uses `PK = ORG#{orgId}#FY#{year}` where defined by `KeyFactory`, preventing hot partitions and supporting archiving.
- **Cabinet Supervision (Management Context)**:
  - Cabinet-to-organization links use `PK = CABINET#{cabinetId}` and `SK = DOSSIER#{orgId}`.
  - Cabinet listing indexes use their `KeyFactory`-defined cabinet prefixes.
  - This additive management context does not change the organization's tenant-owned partitions.
- **User Workspace Discovery (Pre-Tenant Selection)**:
  - Effective user-to-organization access is materialized as `USER_ORG_ACCESS` under the organization partition.
  - Access rows project to the user discovery index using the `KeyFactory` user-workspace helpers.
  - `GET /me/workspaces` queries active rows and must never use `Scan`.
  - Cabinet-to-PME permissions are materialized into effective access rows so discovery and authorization remain direct lookups or queries.
- **Indexes**: every GSI requires a concrete access pattern. Use `Query`, `GetItem`, or `BatchGetItem`; no business-path `Scan`.
- **Atomicity**: use `TransactWriteItems` where multi-item invariants must succeed or fail together.

The Single Table strategy remains authoritative. Do not add a platform table, a Restaurants table, or speculative tables. A future physical split requires an explicit migration decision.

---

## 5. Coding Standards (STRICT)

### A. Naming & Type Safety

- **TypeScript**: use `lowerCamelCase` for properties and `PascalCase` for classes/interfaces, with strict null checks and no implicit `any`.
- **DynamoDB Attributes**: use UPPERCASE technical keys such as `PK`, `SK`, `GSI1PK`, and `GSI1SK`.
- **Entity Identification**: every persisted item includes an uppercase `entityType`, for example `ACCOUNT` or `ENTRY`.
- **Language**: code, variables, and comments are English; French comments are permitted in test scripts.

### B. Security & Integrity

Tenant-scoped authorization evolves toward this mandatory sequence:

```text
authenticated identity
    -> organization membership
    -> product access
    -> role/permission
    -> domain action
```

Organization membership and current permission checks exist today. `ProductAccess` verification is a future required layer and must not be represented as already implemented.

- Extract `userId` from Cognito JWT claims and resolve active `orgId` from the verified `x-org-id` context after membership verification. Never trust tenant identifiers from body, query, or path.
- Authenticated `GET /me/workspaces` is the pre-tenant exception: it omits `x-org-id` and returns only the caller's active workspace summaries through the user discovery index.
- Preserve cabinet supervision checks and dossier assignment/access rules.
- Use `TransactWriteItems` for atomic multi-item updates such as Accounting entry plus lines.
- Every service method validates its input DTO using Zod.
- Frontend API clients treat responses as `unknown` and validate important payloads with `@liass-ohada/shared` schemas.
- Frontend business-domain directories mirror backend domain names. Platform-only surfaces such as dashboard and shell context belong under `core/`.
- Angular environment files contain public configuration only, never secrets, credentials, tenant identifiers, or privileged configuration.

### C. Internationalization (i18n)

- Resolution order: `Accept-Language` header -> User Preference -> default `fr`.
- Backend user-facing messages use error codes and translation keys.
- Frontend visible strings use Transloco. Code identifiers, translation keys, variables, and internal comments remain English.

### D. Frontend Resource Optimization

- Fetch remote server state through TanStack Query using shared domain `data-access` helpers.
- Query keys are stable, domain-specific, and include active organization/workspace or dossier context for tenant-scoped data.
- Reuse cached query helpers and avoid duplicate backend calls.
- Use longer `staleTime` for stable reference data and shorter, filter-specific keys for transactional data.
- Mutations update or invalidate only affected caches; imperative refetch is reserved for explicit refresh or cases targeted invalidation cannot express.
- Do not fetch the same data in multiple nested components when a parent or shared query can provide it.
- Do not call the backend for data already available in a fresh cache unless the user explicitly refreshes or a mutation invalidated that cache.
- NgRx Signal Store owns client/UI context such as active workspace/dossier, filters, permissions, and future entitlement state; it does not replace TanStack Query server-state caching.

---

## 6. Generation Rules for AI / Codex

Before implementing a significant feature, Codex must:

1. Read this canonical `SPEC.md` and applicable repository instructions.
2. Use `liass-platform-architecture` for architecture, new domains, ownership, organization/product modeling, integrations/events, significant access patterns, or platform shell/navigation work.
3. Classify the feature as `PLATFORM_CORE`, `ERP_DOMAIN`, `VERTICAL_SOLUTION`, or `SHARED_TECHNICAL`.
4. Identify the tenant boundary, product entitlement implications, owning domain, dependency direction, DynamoDB access patterns, authorization/RBAC, frontend shell/domain boundary, audit/observability impact, and backward-compatible migration path.
5. Use specialized repository skills such as `dynamodb-data-modeling`, `ohada-legal-reference`, and `liass-design-system` when their scopes apply.
6. Keep handlers lean: parse and validate input, call the owning service, and format the response.
7. Use `Query`, direct item operations, or `BatchGetItem`; do not introduce a business-path `Scan`.
8. Keep domain persistence private. Do not perform cross-domain writes or use another domain's internal key helpers/repositories.
9. Use explicit APIs or versioned events for real cross-domain producer/consumer collaboration.
10. Preserve existing behavior through additive, backward-compatible migrations with explicit data-migration and rollback plans where required.
11. Do not create speculative packages, services, tables, routes, stacks, indexes, events, or vertical scaffolding.
12. Do not introduce microservices solely to demonstrate domain separation; logical ownership comes first.

**FINAL OBJECTIVE**: Deliver a scalable, modular, multi-tenant, production-ready Liass-OHADA platform with one coherent user experience, secure organization and product boundaries, independently owned business domains, and uncompromised OHADA/SYSCOHADA/SYCEBNL rigor wherever those legal and accounting rules apply.
