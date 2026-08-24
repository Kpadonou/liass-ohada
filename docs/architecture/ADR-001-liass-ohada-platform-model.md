# ADR-001 — Liass-OHADA Platform Model

- **Status**: Accepted
- **Date**: 2026-08-07
- **Scope**: Product, tenant, domain, integration, frontend, and deployment boundaries

## Context

Liass-OHADA began with an accounting-centered product definition and now contains working Identity/Cabinet, Accounting, Projects, and Treasury capabilities. Continuing to describe the whole product as Accounting would make organization identity, authorization, configuration ownership, and future vertical integration ambiguous.

The migration must preserve current production-oriented behavior, the shared AWS architecture, existing tenant isolation, OHADA/SYSCOHADA/SYCEBNL rigor, and the current single-table data model.

## Decision

Liass-OHADA is the platform brand and product: a cloud-native, modular, multi-tenant ERP platform for organizations operating in the OHADA environment. Accounting is an ERP business domain within the platform, not the identity of the entire platform.

The platform uses:

- `liassohada.com` for the public website and `app.liassohada.com` for one authenticated application experience;
- one shared Amazon Cognito identity system, where users belong to Liass-OHADA rather than a particular product;
- `organizationId`/`orgId` as the canonical global tenant identity across every domain and vertical;
- a conceptual separation between Organization, UserOrgAccess, future ProductAccess, and domain-owned settings;
- `ProductAccess` as the future source of organization product entitlement, distinct from `workspaceType` and user permissions;
- domain ownership of entities, invariants, domain logic, repositories, persistence operations, and internal key helpers;
- explicit APIs or versioned domain/integration events for cross-domain collaboration;
- logical domain separation before physical separation.

The shared API Gateway, Cognito resources, DynamoDB Single Table, S3 resources, and existing CDK stack ownership remain in place. Platform V2 does not require premature microservices, per-domain databases, per-product applications, or per-product authentication.

Liass-Resto is the first planned vertical solution within the Liass-OHADA master platform, but it is not implemented or scaffolded by this decision. Its business name is `Liass-Resto`; its intended future technical domain identifier and ProductCode remain `restaurants` and `RESTAURANTS` respectively.

`ProductAccess` represents top-level products or verticals, not every internal module. The only currently implemented top-level entitlement is `ACCOUNTING`, whose current module hierarchy is Accounting Core, Treasury, and Project Accounting. The existing `projects` technical domain and `PROJECTS_*` permissions remain compatibility identifiers for Project Accounting; Treasury and Project Accounting retain module-granular RBAC without separate top-level ProductAccess codes. Persisted historical `PROJECTS` and `TREASURY` ProductAccess rows are migration data, not current entitlement authority.

## Consequences

- Platform Core owns cross-domain identity, organizations, access, entitlement, permissions, shared audit/integration capabilities, and the authenticated shell.
- ERP domains and vertical solutions own their business rules and persistence boundaries even when items share one physical DynamoDB table.
- A domain cannot create or mutate another domain's aggregates. A producer publishes a contract or event; the consumer determines its own domain consequences.
- Accounting-specific configuration, including `accountingFramework`, moves toward AccountingSettings through a backward-compatible future migration. Existing contracts and data remain valid until that migration is complete.
- `COMPANY` and `ACCOUNTING_FIRM` remain compatible workspace types. Cabinet supervision remains an accounting-firm access model, not a universal product-entitlement model.
- New physical services, tables, User Pools, APIs, or event infrastructure require concrete scale, security, deployment-isolation, or operational justification.

## Migration approach

Adopt the model progressively:

1. canonicalize architecture documentation and Codex instructions;
2. add ProductAccess without changing visible product behavior;
3. separate AccountingSettings with compatibility reads/writes and an explicit data migration;
4. add entitlement verification alongside membership and RBAC;
5. make the platform shell and navigation product-aware;
6. add integration APIs or events only for real producer/consumer workflows;
7. begin Liass-Resto only after the platform boundaries are stable.

Each phase must preserve existing APIs, routes, authentication, workspace selection, cabinet behavior, accounting behavior, DynamoDB items, and stateful AWS resources unless its reviewed migration plan explicitly changes them.
