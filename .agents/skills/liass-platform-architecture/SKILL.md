---
name: liass-platform-architecture
description: Use this skill for Liass-OHADA architecture, new domains or verticals, domain/data ownership, organization and ProductAccess modeling, integrations, domain events, cross-domain APIs, significant DynamoDB access patterns, platform authorization, and platform-level frontend shell or navigation changes.
---

# Liass Platform Architecture Skill

## Purpose

Apply the Liass-OHADA Platform V2 boundaries consistently while preserving working behavior during incremental migrations.

`SPEC.md` is canonical. This skill cannot override it. If this skill, another instruction, or the codebase conflicts with `SPEC.md`, stop and report the conflict before implementing.

## Mandatory classification

Before implementation, classify the feature as exactly one of:

- `PLATFORM_CORE`: cross-domain identity, organizations, access, entitlement, permissions, notifications, documents, audit, integrations, or shell capabilities.
- `ERP_DOMAIN`: Accounting, Treasury, Commercial, Fixed Assets, Payroll, Projects/SYCEBNL, Reporting, or another reviewed ERP domain.
- `VERTICAL_SOLUTION`: an industry solution such as the planned Liass-Resto vertical.
- `SHARED_TECHNICAL`: business-neutral utilities or infrastructure used by multiple owners.

Name the owning domain or platform capability. Classification does not authorize speculative scaffolding.

## Architecture checklist

Before changing code or infrastructure, check and record:

1. **Tenant boundary**: preserve global `orgId`/`organizationId`; derive tenant context from verified identity and membership, never untrusted request data.
2. **Product entitlement**: separate Organization, UserOrgAccess, ProductAccess, and DomainSettings; do not use `workspaceType` as universal entitlement.
3. **Domain ownership**: the owner controls its entities, invariants, persistence, services, and internal KeyFactory helpers.
4. **Dependency direction**: prevent imports of another domain's repositories, services, aggregates, or persistence internals.
5. **DynamoDB access pattern**: list reads/writes, keys, indexes, pagination, consistency, atomicity, and migration impact; preserve Single Table, KeyFactory, Query/BatchGet, and no business-path Scan.
6. **Cross-domain boundary**: use an explicit API or versioned domain/integration event for a real producer and consumer; never mutate another domain's persistence directly.
7. **Security/RBAC**: evaluate identity -> membership -> product access -> role/permission -> domain action, while distinguishing future entitlement work from implemented checks.
8. **Frontend boundary**: keep global context and navigation in the platform shell; keep routed business workflows and rules in the owning frontend domain.
9. **Observability/audit**: identify logs, metrics, trace correlation, audit records, idempotency, retries, and sensitive-data handling appropriate to the change.
10. **Backward-compatible migration**: preserve current APIs, data, routes, authentication, cabinet workflows, and AWS resources unless an explicit reviewed migration changes them.

## Read-model simplification review

Before adding backend indexes, projections, search infrastructure or specialized read models, evaluate bounded frontend/server-state caching, prefetch, reuse and local derived computation first. Compare real DTO/cardinality, network/database cost, memory/rendering, freshness, pagination, concurrency, cancellation and tenant safety; do not assume loading an unbounded collection is acceptable. Preserve backend command authority. Where established, TanStack Query owns fetched server collections; do not duplicate them in Signal Store or another store merely for local search. UI signals may own search/selection and derived views. Record the simpler option and its limits before approving extra backend infrastructure.

## Invariants

- Keep one platform brand, one authenticated application, one Cognito identity system, and one global organization identity.
- Keep the current DynamoDB Single Table strategy and centralized `KeyFactory` unless a future reviewed migration explicitly changes them.
- Domain separation is logical before physical. Do not introduce microservices solely to satisfy domain separation.
- Do not create speculative packages, services, tables, indexes, events, routes, stacks, or future verticals.
- Existing working behavior must be preserved during migrations.
- Keep `accountingFramework` compatibility until a reviewed AccountingSettings migration is implemented.
- Keep `COMPANY` and `ACCOUNTING_FIRM` compatibility; cabinet supervision is not product entitlement.
- Preserve existing stateful-resource ownership and the nested-stack placement rules in `packages/backend/docs/cdk-nested-stack-architecture.md`.

## Specialized skills

- Use `dynamodb-data-modeling` for persistence, access patterns, keys, indexes, transactions, or data migrations.
- Use `ohada-legal-reference` for Accounting, SYSCOHADA, SYCEBNL, legal, or compliance rules. Do not copy legal knowledge into this skill.
- Use `liass-design-system` for frontend UX, shell, navigation, components, responsive behavior, Material/Tailwind, Transloco, and visual states. Do not copy UI rules into this skill.

## Implementation workflow

1. Read `SPEC.md`, `AGENTS.md`, and the relevant runtime and infrastructure owners.
2. State the classification, owner, access patterns, dependencies, and compatibility constraints.
3. Apply the checklist and use every specialized skill triggered by the change.
4. Propose the smallest coherent change; reject cross-domain persistence writes and speculative infrastructure.
5. Validate affected contracts, tests, CDK templates, migrations, and rollback considerations in proportion to the change.

## Final response requirements

Summarize the feature classification, owner, tenant and entitlement decisions, domain boundaries, access patterns, cross-domain contract, security/audit impact, migration compatibility, files changed, validation, and unresolved risks.
