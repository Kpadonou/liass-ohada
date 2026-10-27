# CDK API Nested-Stack Architecture

This document is the authoritative reference for placing Liass-OHADA AWS CDK resources. It complements the product and data rules in [`SPEC.md`](../../../SPEC.md); it does not replace the single-table, tenant-isolation, `KeyFactory`, OHADA, frontend, or validation requirements defined there and in [`AGENTS.md`](../../../AGENTS.md).

The architecture is coordinated by [`lib/stacks/api-domain-stacks.ts`](../lib/stacks/api-domain-stacks.ts). The API core declares the domain nested stacks and passes their shared dependencies. Domain endpoint constructs remain under `lib/constructs/domains/`, while Lambda business logic remains under `lambda/domains/`.

LP-2 reviewed exception: DataStack also owns the dedicated Restaurants business table. Restaurants consumes both tables through typed references and owns its execution role. No other product receives Restaurants access. The shared table remains authoritative for Platform/Accounting/Sales. See [cutover runbook](restaurants-storage-cutover.md).

## Mandatory placement rule

- Future domain-specific stateless AWS resources **MUST NOT** be added directly to the API core by default.
- Every new domain endpoint, Lambda function, API Gateway route or integration, Lambda permission, and domain-specific Log Group **MUST** be created in the appropriate domain nested stack.
- The API core **MUST** remain limited to shared, foundational, or genuinely cross-domain infrastructure. Convenience is not a valid reason to place a resource in the core.
- Existing stateful resources **MUST** remain in their current owning stacks during ordinary feature work. Nested stacks consume typed references to them.
- A new nested stack **MAY** be introduced only for a coherent new business domain that does not fit an existing stack and whose expected resource growth justifies a separate template.
- The application **MUST NOT** be fragmented into one nested stack per endpoint, implementation lot, or small feature. Stack boundaries **SHOULD** preserve stable business-domain cohesion.
- Every synthesized application CloudFormation template **MUST** contain no more than **350 resources**.
- Any CDK resource change **REQUIRES** CDK synthesis followed by the repository resource-count guard.

The purpose of nesting is not necessarily to reduce the application's total number of resources. It is to keep each independently synthesized CloudFormation template safely below its per-template limit while retaining coherent ownership.

## Current composition and ownership

The following counts reflect the RESTO-1A/B local synthesis (2026-10-10); the synthesized templates and the resource-count command are the source of truth after every infrastructure change.

| Owner                                                       | Current template size | Owns                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------- | --------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API core                                                    |                   278 | The single shared HTTP API, shared authorizers, Cognito User Pool and related shared identity infrastructure, the currently shared Lambda execution role, shared API configuration and outputs, shared environment references, the existing DynamoDB table reference, nested-stack declarations, and genuinely shared cross-domain resources. It is not the default destination for new domain endpoints. |
| Accounting nested stack (`AccountingApiStack`)              |                    51 | Chart of accounts, journals, accounting entries and movements, general ledger, journal book, third parties, auxiliary ledger, lettering, fiscal years, accounting periods, closing, accounting reports and summaries, and future accounting-domain APIs.                                                                                                                                                  |
| Identity/Cabinet nested stack (`IdentityApiStack`)          |                    81 | Authentication-adjacent application endpoints, workspace discovery, user profiles, onboarding, cabinet dossiers, members, roles, invitations, dossier assignments, pre-tenant invitation acceptance, and future Cabinet administration APIs.                                                                                                                                                              |
| Sales nested stack (`SalesApiStack`)                        |                   161 | Thirty-seven SALES Customer, Catalog, Invoice, Payment, Receivable, Credit Note and private commercial-document Lambdas; future SALES-owned endpoints.                                                                                                                                                                                                                                                    |
| Restaurants nested stack (`RestaurantsApiStack`)            |                   153 | Thirty-eight RESTAURANTS setup/menu configuration Lambdas, JWT routes, integrations and permissions; future restaurant operational APIs. No restaurant stateful infrastructure is duplicated.                                                                                                                                                                                                             |
| Projects nested stack (`ProjectApiStack`)                   |                    12 | Projects, SYCEBNL analytical dimensions, budgets, budget lines, funding sources, donors, project reporting, and future project-domain APIs.                                                                                                                                                                                                                                                               |
| Treasury nested stack (`TreasuryApiStack`)                  |                    11 | Treasury accounts and transactions, bank statement imports and lines, reconciliation and its history, treasury summaries, and future treasury-domain APIs.                                                                                                                                                                                                                                                |
| Fiscal Compliance nested stack (`FiscalComplianceApiStack`) |                    41 | Ten local fiscal profile, connection, readiness and certification-preparation endpoints. Durable growth includes jurisdiction adapters, provider evidence and safe recovery; no provider calls or secret resources in S4B.                                                                                                                                                                                |
| Data stack                                                  |                     4 | Existing stateful data infrastructure: the shared DynamoDB table and the retained private application document bucket with its TLS-only bucket policy.                                                                                                                                                                                                                                                    |
| Root stack                                                  |                    ~1 | Top-level stack composition.                                                                                                                                                                                                                                                                                                                                                                              |

Domain nested stacks primarily contain stateless or safely replaceable resources: Lambda functions, API routes and integrations, Lambda permissions, domain Log Groups, stateless IAM policies, and event rules when replacement is safe.

## Restaurants Guest V1 headroom gate

RESTO-GUEST-INFRA-0B retains Guest infrastructure in `RestaurantsApiStack`.
The accepted GUEST-1A checkpoint synthesizes 336 resources. Reusing its two
integrations, explicitly bounding invocation permissions by API, account, default
stage and route family, and embedding the public read policy in its role reduce
that deployment template to 332 resources. The capability secret keeps its
existing construct path, name and RETAIN policy.

The frozen nine remaining routes add nine Route resources and two further staff
invocation permissions, for a synthesized projection of **343 resources**. This
is the reviewed 341–344 exception: seven resources remain below 350 and two
before the 345 pressure threshold. Reaching 340 would require widening invocation
scope, changing the explicit route contract, or optimizing unrelated resources;
none is justified by this gate. No dedicated Guest stack is required now.

The projection assumes the same two grouped handlers/integrations and existing
IAM policies. Future Guest business permissions can extend those policies but
must not add handlers, integrations, queues, indexes or other resources without
rerunning the headroom gate. Projection-only routes belong in infrastructure
tests, never in the deployment app before their implementation lot.

`HttpLambdaIntegration.completeBind` normally adds a permission per route. The
Guest-specific integration overrides only that hook; it does not use the
API-wide `scopePermissionToRoute: false` permission. Deployed permissions cover
`/public/restaurants/guest/*` on the public handler and
`/restaurants/outlets/*/service-areas/*/tables/*/qr/*` on the staff handler.
Future staff permission families are `/restaurants/outlets/*/guest-*` and
`POST /restaurants/outlets/*/waiter-calls/*/acknowledge`. IAM wildcards match
slashes, so the former covers both outlet guest activity and session guest
requests. Tests must verify those patterns against all existing and frozen
routes. Shared GET/POST families use a method wildcard in the invocation ARN;
HTTP API routes remain explicit, method-restricted, and JWT-protected for staff.
Lambda invocation permission never replaces Cognito, membership, entitlement or
per-command RBAC. No table, GSI, key, persistence access pattern or frontend changes
are part of this optimization.

## Inventory Lite management reuse

RESTO-INV-1B keeps Restaurants at **344 resources** and API core at **278**.
The existing `get-outlet` Lambda and its integration now own the five unchanged
Outlet routes plus six explicit Inventory management routes. The four other
Outlet Lambdas/integrations are removed; no new Lambda, execution role, table or
index is introduced. Restaurants therefore has 77 Lambdas, 77 integrations,
99 routes and 86 invocation permissions.

The grouped entry point selects an exact route before applying that operation's
original authorization. Inventory requires `RESTAURANTS_SETUP_MANAGE`, allowing
only OWNER/MANAGER under the existing product-role projection. All management
routes retain JWT authorization and RESTAURANTS ProductAccess enforcement.
Five exact-method Outlet invocation grants and two Inventory path-family grants
are restricted to the existing API, account and default stage. The Inventory
families are `/restaurants/outlets/*/inventory/items` and
`/restaurants/outlets/*/inventory/items/*`; unsupported methods/paths have no
registered route or handler operation. No API-wide invocation grant is used.
The retained Lambda keeps its logical identity; stateful resources do not move.

RESTO-INV-1D-A retains **344 Restaurants / 278 API core** resources. The six
logical Inventory operations now use two JWT route groups (`ANY` collection and
`ANY` member proxy, both bounded to `/inventory/items`). The dispatcher resolves
an exact method/path allowlist and rejects unsupported operations. Three exact
tracking routes (`GET`, `PUT`, `DELETE` under `/inventory/menu-items/{menuItemId}/tracking`)
reuse the same Lambda/integration with one additional bounded invocation grant.
The route count changes 99 → 98 and invocation permissions 86 → 87; Lambdas and
integrations remain 77 each. Outlet/Guest authorization and stateful resources
remain unchanged. The inventory tracking resource requires the canonical
`categoryId` (query for GET, body for writes) because MenuItem identity is
category-scoped in the existing KeyFactory.

Tracking uses existing `MAP#` stock collection keys with optimistic versions.
Removal retains a versioned tombstone, preserving stale-write detection without
deleting StockItems or history. Existing unversioned mappings read as version 1.
Automatic stock creation, link, MenuItem version check and durable command receipt
commit together (four transaction operations). Linking existing stock substitutes
a target version check; removal needs three operations. Receipts use existing
Restaurants command keys and do not depend on TTL. A MenuItem station assignment
also checks that no live direct link exists in the same configuration transaction.

## Stateful-resource safeguards

Ordinary feature work **MUST NOT** move resources whose replacement could destroy data or disconnect production integrations. Protected resources include:

- DynamoDB tables;
- Cognito User Pools and User Pool Clients;
- persistent S3 buckets;
- Route 53 hosted zones and ACM certificates;
- secrets;
- persistent queues or event stores;
- any other resource with durable production state or a stable external identity.

Future changes **MUST** preserve current logical ownership, pass existing resources into nested stacks, and avoid recreating equivalent stateful resources. A domain **MUST NOT** create a second API Gateway, User Pool, authorizer, or DynamoDB table. A new physical GSI also **REQUIRES** explicit approval and review under the DynamoDB modeling rules; it is not an endpoint-placement shortcut.

Before any proposed stateful-resource move, the implementer **MUST** inspect `cdk diff`. If a change may replace, orphan, rename, or disconnect a production resource, work **MUST STOP** and the risk must be reported with an explicit migration plan instead of proceeding.

## Cross-stack dependencies

- Shared constructs **MUST** be passed through typed constructor properties, following `ApiDomainStackProps` in `api-domain-stacks.ts`.
- Domain stacks **MUST** reuse the single shared API, existing DynamoDB table, existing authorizer and identity resources, shared Lambda environment configuration, and shared roles where the current architecture still uses them.
- Direct construct references **SHOULD** be used instead of global lookups when available.
- Circular dependencies are forbidden. One domain nested stack **SHOULD NOT** depend directly on another domain stack; both should depend on shared resources owned by the core unless a reviewed exception is necessary.
- Physical co-location in the shared DynamoDB table does not grant cross-domain ownership. A domain **MUST NOT** import another domain's repository internals, construct its persistence keys, or mutate its aggregates directly.
- When domains exchange data, use explicit APIs or versioned domain/integration events with shared contracts. **MUST NOT** duplicate infrastructure, move unrelated resources merely to eliminate a typed reference, create cross-domain DynamoDB tables, or use shared code as a backdoor for cross-domain persistence writes.
- Logical domain separation comes before physical separation. A new service, API, event bus, queue, or table **MUST NOT** be introduced solely to demonstrate domain separation.

## Adding an endpoint or domain resource

Before creating any backend endpoint, the implementer **MUST**:

1. Identify the business domain and owning nested stack.
2. Inspect `lib/stacks/api-domain-stacks.ts` and locate the existing domain endpoint construct under `lib/constructs/domains/`.
3. Add the Lambda function and API route or integration inside that nested stack.
4. Reuse the shared API, table, authorizer, role, and environment configuration through typed properties.
5. Preserve existing route, handler, and stage-aware naming conventions.
6. Run the shared build, backend build, and relevant tests in proportion to the change.
7. Run CDK synthesis.
8. Run the repository resource-count script through the existing npm script.
9. Inspect the affected synthesized nested-stack template and the API core template.
10. Verify that no domain resource was accidentally added to the API core.
11. Verify that no physical table, User Pool, API, authorizer, or GSI was introduced unintentionally.
12. Run `cdk diff` when credentials are available and inspect replacements and cross-stack changes.
13. Run `git diff --check`.

Infrastructure work is incomplete until its final report identifies the owning stack, resources added or replaced, resource count before and after for every affected template, whether any stateful resource changed, synthesis result, resource-count result, diff result when available, and whether a deployment was performed.

The current package scripts are the command source of truth. At the time of this document, the relevant backend commands are:

```bash
npm run build -w @liass-ohada/shared
npm run build -w @liass-ohada/backend
npm test -w @liass-ohada/backend
npm run aws:synth -w @liass-ohada/backend
npm run cdk:resource-count -w @liass-ohada/backend
npm run aws:diff -w @liass-ohada/backend
git diff --check
```

The guard is implemented by [`scripts/count-cdk-resources.cjs`](../scripts/count-cdk-resources.cjs). Commands **MUST** be confirmed against `packages/backend/package.json` before use because script names may evolve.

If a domain template approaches 350 resources, do not silently continue. Audit the domain boundary and decide whether coherent, stable subdomains justify subdivision. Do not split arbitrarily by endpoint count or resource count alone.

## New business domains

For Sales, Purchases, Invoicing, Inventory, Fixed Assets, Payroll, Tax, or another new domain:

1. Classify the capability using the Platform V2 rules in `SPEC.md`, then determine whether it belongs to Platform Core, Accounting, Identity/Cabinet, Projects, or Treasury. Genuinely cross-domain documents, notifications, audit, entitlement, or integration infrastructure belongs to Platform Core; domain-specific behavior stays with its business owner.
2. If it does not fit, estimate the number and types of CloudFormation resources and define a coherent, durable domain boundary.
3. Create one domain-oriented nested stack only when its expected growth justifies it.
4. Register it through the existing API domain-stack composition mechanism.
5. Pass shared resources through typed construct properties.
6. Add its ownership and baseline count to this document.

A new business domain **MUST NOT** be placed in the API core. Names **MUST** describe stable domains and follow existing stage-aware conventions. Avoid temporary names such as `LotC32Stack`, `NewEndpointsStack`, `MiscStack`, and `ExtraFunctionsStack`. Names such as `SalesApiNestedStack`, `PurchasesApiNestedStack`, or `FixedAssetsApiNestedStack` are acceptable only when those domains genuinely require their own stack.

Nested stacks and resources **MUST** avoid physical-name collisions. Prefer generated physical names unless the project requires an explicit stable name for migration compatibility. Keep endpoint registration grouped by domain, handler source in the existing domain organization, and CDK construct code separate from Lambda business logic.

## Required framing for future infrastructure prompts

Implementation prompts that may add or change CDK resources **MUST** include these sections:

### Architecture

- owning nested stack;
- shared API, table, authorizer, role, identity, and environment resources reused;
- stateful resources preserved.

### Constraints

- no new API Gateway;
- no new DynamoDB table;
- no new Cognito User Pool;
- no new physical GSI unless explicitly approved;
- no domain resource in the API core by default.

### Validation

- shared build;
- backend build;
- relevant tests;
- CDK synthesis;
- resource-count command;
- `cdk diff` when credentials are available;
- `git diff --check`.

### Final report

- stack modified;
- resource count before and after for affected templates;
- stateless resources added or replaced;
- stateful resources affected;
- synthesis and diff results;
- deployment performed or not performed.

Passing a TypeScript build alone does not establish deployment safety.
