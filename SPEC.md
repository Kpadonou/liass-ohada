# Codex Specification: liass-ohada ERP

## 1. Project Goal & Infrastructure Strategy

**Project Name**: liass-ohada
**Primary Goal**: Build a complete, AWS Cloud-Native Serverless ERP compliant with the OHADA accounting framework, supporting both SYSCOHADA General (Commercial) and SYCEBNL (Non-Profit/Associations/NGOs) standards.
**Multi-tenancy**: Native support for Accounting Firms (Cabinets), SMEs (PMEs), and NGOs. A Cabinet is a parent supervision tenant that can manage multiple organization dossiers, while each organization's accounting data remains isolated by `orgId`.

**Naming Convention**: All AWS resources must follow the pattern: `liass-ohada-{stage}-{resource-name}`.

- {stage}: dev, test, prod.
- Example: `liass-ohada-dev-accounting-table`.
- Stage resolution for CDK deployments must be deterministic: CDK context (`-c stage=...`) takes precedence over `STAGE`, and defaults to `dev`.
- DynamoDB tables must set an explicit `tableName`, for example `liass-ohada-dev-accounting-table`.
- Lambda functions must set an explicit `functionName` using the pattern `liass-ohada-{stage}-{domain}-{action}`, for example `liass-ohada-dev-ledger-post-entry` or `liass-ohada-dev-projects-create-project`.
- **Mandatory**: Resource names must be generated from centralized CDK deployment configuration and environment variables. Business logic must not hard-code AWS resource names; Lambdas must receive resource names through environment variables such as `TABLE_NAME`.

### ☁️ Technical Stack (AWS Serverless)

- **IaC**: AWS CDK (TypeScript).
- **Architecture**: Slim Architecture (Logic-less Handlers + Static Service Layer + Domain-Driven Design).
- **Database**: Amazon DynamoDB (Single Table Design with Fiscal Year Sharding).
- **Auth**: Amazon Cognito (Multi-tenancy and RBAC).
- **Validation**: Zod for strict schema enforcement.
- **Storage**: Amazon S3 for documents and reports.

---

## 2. Partitioning & Key Strategy (CRITICAL)

### A. The KeyFactory Utility

All Partition Keys (PK) and Sort Keys (SK) must be generated using the centralized **`KeyFactory`** located in `src/utils/key-builder.ts`.
**DO NOT** manually concatenate strings for keys in repository logic. Always reference the factory methods to ensure consistency.

### B. Partitioning Overview

Refer to `key-builder.ts` for the definitive implementation logic. The general strategy is:

- **Tenant Isolation**: All keys must start with `ORG#{orgId}`.
- **Master Data (Permanent)**:
  - `PK = ORG#{orgId}`
  - `SK` depends on entity (e.g., `USER#{userId}`, `ACC#{accountCode}`).
- **Transactional Data (Fiscal Sharding)**:
  - High-volume data (Entries, Lines) use `PK = ORG#{orgId}#FY#{year}` to prevent hot partitions and facilitate archiving.
- **Cabinet Supervision (Management Context)**:
  - Cabinet-to-organization linkage items use `PK = CABINET#{cabinetId}` and `SK = DOSSIER#{orgId}`.
  - Cabinet listing indexes use `GSI PK = CABINET#{cabinetId}` and `GSI SK = DOSSIER#{orgId}` to query all organizations supervised by an Accounting Firm.
  - This management context is additive and must not change the existing `ORG#{orgId}` accounting partitions.
- **Global Secondary Indexes (GSI)**:
  - `GSI1PK = ORG#{orgId}`.
  - `GSI1SK` follows a searchable pattern (e.g., `TYPE#{entityType}#STATUS#{status}`).

---

## 3. OHADA Functional Domains

1. **Core Accounting**: General Ledger, Multi-Standard Chart of Accounts (8-digit strings, e.g., "52100000").
2. **SYCEBNL Specifics**: Donor/Grant management, Fund accounting, Project-based tracking for NGOs.
3. **Commercial**: Invoicing (Quotes/Bills), Product Catalog, CRM/SRM.
4. **Fixed Assets**: Lifecycle (Acquisition, Depreciation/Amortissement, Disposal).
5. **Treasury**: Cash Flow, Bank Reconciliation (Rapprochement).
6. **Payroll (Paie)**: Local OHADA zone calculations (CNSS, ITS), Accounting integration.
7. **Reporting**: Bilan, Compte de Résultat (Commercial vs SYCEBNL CROD), TAFIRE.

---

## 4. Coding Standards (STRICT)

### A. Naming & Type Safety

- **Typescript**: Use `lowerCamelCase` for properties and `PascalCase` for Classes/Interfaces.
- **DynamoDB Attributes**: Use **UPPERCASE** for technical keys (`PK`, `SK`, `GSI1PK`, `GSI1SK`).
- **Entity Identification**: Every item must include an `entityType` attribute in **UPPERCASE** (e.g., `ACCOUNT`, `ENTRY`).
- **Language**:
  - Code and variables: **English**.
  - Comments: **English**.
  - Test scripts: Comments in **French** are permitted.

### B. Security & Integrity

- **Auth Context**: Extract `orgId` and `userId` from JWT claims (requestContext), never from body/params.
- **Atomicity**: Use `TransactWriteItems` for multi-item updates (e.g., Entry + Lines).
- **Validation**: Every service method must validate its input DTO using Zod.

### C. Internationalization (i18n)

- Resolution order: `Accept-Language` header -> User Preference -> Default (`fr`).
- **No hard-coded strings**: Use error codes and translation keys.

---

## 5. Generation Rules for AI

1. **No Scans**: Always use `Query` operations.
2. **Lean Handlers**: Lambda handlers should only parse input, call a service, and return a formatted response.
3. **Compliance**: Ensure all reports follow the layouts defined by **SYSCOHADA** or **SYCEBNL**.
4. **Efficiency**: Use `BatchGetItem` where possible and optimize for the lowest RCU/WCU usage.

**FINAL OBJECTIVE**: Deliver scalable, multi-tenant, and production-ready code that respects the legal and accounting rigor of the OHADA region.
