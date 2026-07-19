## 1. Project Goal & Full Stack Strategy

**Project Name**: liass-ohada
**Primary Goal**: Build a complete, AWS Cloud-Native Serverless ERP compliant with the OHADA accounting framework, supporting both SYSCOHADA General (Commercial) and SYCEBNL (Non-Profit/Associations/NGOs) standards.
**Naming Convention**: All AWS resources (DynamoDB tables, Cognito Pools, S3 Buckets) must follow the pattern: liass-ohada-{stage}-{resource-name}.

- {stage}: The deployment environment (e.g., dev, test, prod).
- Example: liass-ohada-dev-accounting-table.
- Mandatory: Resources must never be hard-coded in business logic. Always use the centralized config.ts utility and reference names via environment variables (e.g., process.env.TABLE_NAME).

### ☁️ Technical Stack (AWS Serverless)

- Infrastructure as Code: AWS CDK (TypeScript).
- Database: Amazon DynamoDB (Single Table Design with Fiscal Year Sharding).
- Compute: AWS Lambda (Node.js / TypeScript).
- API: Amazon API Gateway (HTTP API v2).
- Authentication: Amazon Cognito for Multi-tenancy and RBAC.
- Event Bus: Amazon EventBridge for async domain events (e.g., "Grant Received" -> "Project Entry").
- Input Validation: Zod for strict schema enforcement.
- Architecture Pattern: Domain-Driven Design (DDD) with a focus on Multi-Standard accounting logic.

### Mandatory CDK Nested-Stack Placement

Before generating backend infrastructure, inspect `packages/backend/lib/stacks/api-domain-stacks.ts` and follow `packages/backend/docs/cdk-nested-stack-architecture.md`.

- Domain endpoints and their Lambdas, integrations, permissions, and Log Groups **MUST** be added to the correct existing nested stack, never to the API core by default.
- The API core is reserved for shared or foundational infrastructure. Convenience does not make a resource shared.
- The shared API, DynamoDB table, Cognito resources, authorizer, and current shared dependencies **MUST** be reused through typed construct properties and **MUST NOT** be duplicated.
- Stateful resources **MUST NOT** move without an explicit migration plan and an inspected `cdk diff`.
- A new nested stack **REQUIRES** a coherent new business domain and justified growth; do not split by endpoint, feature, or lot.
- Every application template **MUST** remain at or below 350 resources. CDK work **REQUIRES** synthesis, the existing resource-count npm script, `cdk diff` when credentials are available, and a final report naming the affected stack and template counts. A TypeScript build alone is insufficient.

### 📚 Functional Domains (Scope)

1.  **Core Accounting**: General Ledger, Journalizing, Multi-Standard Chart of Accounts (SYSCOHADA & SYCEBNL).
2.  **SYCEBNL Specifics**: Donor/Grant management, Fund accounting, and Project-based financial tracking.
3.  **Commercial & Invoicing**: Sales (Quotes/Invoices), Purchases (Orders/Bills), Product Catalog.
4.  **Third-Party Management**: Clients (CRM), Suppliers (SRM), Employees, Donors (Bailleurs), and Members (Adhérents).
5.  **Fixed Assets**: Asset Lifecycle (Acquisition, Depreciation/Amortissement, Disposal).
6.  **Inventory**: Stock Management, Warehousing, Valuation (CUMP/FIFO).
7.  **Treasury & Banking**: Cash Flow, Bank Reconciliation (Rapprochement), Payment Processing.
8.  **Payroll (Paie)**: Employee Management, Salary Slips, Social Declarations (CNSS), Accounting Integration.
9.  **Tax & Fiscality**: VAT Management (TVA), Withholding Taxes (AIB), Fiscal Declarations.
10. **Budgeting**: Budget Planning, Project Budget Tracking (Donors), Variance Analysis.
11. **Reporting**: Bilan, Compte de Résultat (Commercial), Compte de Résultat par Origine et Destination (SYCEBNL), TAFIRE.
12. **Audit & Security**: Immutable Logs, User Action Tracking, Role-Based Access Control (RBAC).

## 2. Project Structure (Strict Domain-Driven)

The codebase is organized by Functional Domains (Bounded Contexts) and follows a strict separation between infrastructure, business logic, and internationalized resources.

```text

root/
├── .github/
│   ├── copilot-instructions.md      # Master Context File
│   └── instructions/                # Domain-Specific Context Modules
│       ├── commercial.md            # Rules for Invoicing & Catalog
│       ├── payroll.md               # Rules for Payslips & CNSS
│       └── ...
├── bin/                             # CDK Entry point
├── lib/
│   ├── constructs/                  # Shared L2 CDK Constructs
│   │   ├── storage/                 # DynamoDB Tables (AccountingTable)
│   │   ├── auth/                    # Cognito User & Identity Pools
│   │   └── api/                     # API Gateway & Authorizers
│   └── stacks/                      # Deployment Stacks (CoreStack, etc.)
├── lambda/
│   ├── shared/                      # Utilities shared across ALL domains
│   │   ├── i18n/                    # i18n Manager & Language Resolver
│   │   ├── middleware/              # API Response & Error Handlers
│   │   └── key-builder.ts           # DynamoDB Composite Key Utilities
│   └── domains/                     # Business Logic by Bounded Context
│       ├── accounting/             # Accounting domain (SYSCOHADA/SYCEBNL)
│       │   ├── accounts/            # Handlers for Chart of Accounts
│       │   ├── entries/             # Handlers for Journal Entries
│       │   └── projects/            # Handlers for SYCEBNL Project tracking
│       │   └── ...
│       ├── commercial/              # Sales, Purchases, Quotes, Invoices
│       ├── third-party/             # CRM/SRM (Clients, Suppliers, Donors, Members)
│       ├── assets/                  # Fixed Assets & Amortization (Immobilisations)
│       ├── inventory/               # Stock movements & Warehouse management
│       ├── treasury/                # Banking, Cash flow & Reconciliation
│       ├── payroll/                 # Employees, Payslips & Social Declarations
│       ├── fiscality/               # VAT (TVA), Withholding tax (AIB) & Declarations
│       └── budgeting/               # Budget Planning & Project Budget Tracking
│       └── ...
├── models/                          # TypeScript Interfaces & Zod Schemas
│   ├── shared/                      # API Response & Error Schemas
│   ├── accounting/                 # Account.ts, Entry.ts, Project.ts
│   └── ...
├── locales/                         # Internationalization (i18n) Resources
│   ├── en.json                      # English translations (Error codes, labels)
│   ├── fr.json                      # French translations
│   └── index.ts                     # i18n Loader & Type Definitions
└── package.json

```

🌍 Key i18n & Structural Rules :

- Centralized Locales: All user-facing strings, error messages, and business labels must reside in locales/{lang}.json.
- i18n Resolver: The lambda/shared/i18n utility must resolve the language from the Accept-Language header or user preferences before generating an ApiResponse.
- Domain Isolation: Business logic in lambda/domains/ must never contain hardcoded strings. It must only reference translation keys (e.g., ERROR_ACCOUNT_NOT_FOUND).
- Shared Models: The models/shared/ directory must contain the ApiResponse and ApiMessage interfaces to ensure a consistent data contract across the entire ERP.

## 3. Critical Coding Standards (STRICT)

### A. Naming & Mapping

- **Naming Convention:** Use `lowerCamelCase` for internal TypeScript properties.
- **Database Schema:** Use **UPPERCASE** for DynamoDB technical keys (`PK`, `SK`, `GSI1PK`, `GSI1SK`).
- **Mapping Policy:** Explicitly map camelCase properties to Uppercase database keys during persistence.
- **CRITICAL ATTRIBUTE:** Every item must include an **`entityType`** attribute in **UPPERCASE** (e.g., `ACCOUNT`, `ENTRY`).

### B. Partitioning & Key Strategy (Hybrid Approach)

- **Tenant Prefix:** All keys must start with **`ORG#`** for strict multi-tenancy.
- **Master Data (Permanent):** Entities like Organization, Users, Accounts, Journals, ThirdParties, Projects use `PK = ORG#{orgId}`.
- **Transactional Data (Fiscal Sharding):** High-volume data (Entries, Lines) use `PK = ORG#{orgId}#FY#{year}`.
- **GSI Global Vision:** All GSIs must use **`GSI_PK = ORG#{orgId}`**. This allows cross-year queries while using the `SK` for specific fiscal filtering (`ACC#...#FY#{year}`).
- **Account Normalization:** All `accountId` values must be stored as **8-digit strings** (padded with zeros, e.g., "52100000").

### C. Security & Data Integrity

- **Auth Context:** Derive `orgId` and `userId` from JWT claims, never from client input.
- **Fiscal Validation:** Verify that the linked `FiscalYear` status is `OPEN` before any write on transactional data.
- **Atomicity:** Use TransactWriteItems when creating related entities (e.g., ENTRY with its LINE items) to ensure "all-or-nothing" persistence.

### D. Performance & DevOps

- **No Scans:** Always use `Query`.
- **Testing:** Mandatory unit tests (Jest, >80% coverage) and integration tests.

## 4. DynamoDB Single Table Schema (Accounting Matrix)

This section defines the schema for the Accounting domain. Other domains will share the table or use separate structures as defined later.
A. Primary Keys (PK/SK) Definitions

| Entity       | Abbr | PK (Partition Key)    | SK (Sort Key)            | Note                                                              |
| ------------ | ---- | --------------------- | ------------------------ | ----------------------------------------------------------------- |
| Organization | ORG  | ORG#{orgId}           | ORG#{orgId}              | Metadata                                                          |
| FiscalYear   | FY   | ORG#{orgId}           | FY#{year}                | Period Status                                                     |
| User         | USER | ORG#{orgId}           | USER#{userId}            | User                                                              |
| Account      | ACC  | ORG#{orgId}           | ACC#{accountId}          | See Special Rule below                                            |
| ThirdParty   | TP   | ORG#{orgId}           | TP#{type}#{thirdPartyId} | {type} represents the category (e.g., CUSTOMER, SUPPLIER, DONOR). |
| Journal      | JNL  | ORG#{orgId}           | JNL#{journalCode}        | Metadata about the journal for a specific year.                   |
| Entry (Head) | E    | ORG#{orgId}#FY#{year} | E#{entryId}              | Transaction Header                                                |
| EntryLine    | L    | ORG#{orgId}#FY#{year} | L#{lineId}               | Transaction Line                                                  |
| Project      | PRJ  | ORG#{orgId}           | PRJ#{projectId}          | Project                                                           |

B. Global Secondary Indexes (GSIs)

The CDK Construct must define these exact indexes.

| Index Name | GSI_PK (Partition Key) | GSI_SK (Sort Key)                   | Purpose                 |
| :--------- | :--------------------- | :---------------------------------- | :---------------------- |
| GSI1       | ORG#{orgId}            | ACC#{accountId}#FY#{year}#DT#{date} | Ledger & Trial Balance. |

## 5. Entity Models & Attributes (Accounting Reference)

Use lowerCamelCase in TypeScript interfaces.

A. Organization (ORG)

| Property            | Type    | Notes                                                                    |
| :------------------ | :------ | :----------------------------------------------------------------------- |
| orgId               | string  | Unique identifier for the organization.                                  |
| pk                  | string  | DynamoDB Partition Key.                                                  |
| sk                  | string  | DynamoDB Sort Key.                                                       |
| entityType          | string  | ORGANIZATION (Used for querying/GSI).                                    |
| name                | string  | Legal name (e.g., SARL LiassOhada).                                      |
| accountingFramework | ENUM    | SYSCOHADA_REVISED or SYCEBNL. Determines the chart of accounts.          |
| legalForm           | string  | Legal form (e.g., "SARL", "Association Loi 1901", "Fondation").          |
| taxId               | string  | Local Tax Identifier (e.g., IFU in Benin)..                              |
| address             | object  | Legal address (to be defined as a Value Object).                         |
| defaultLanguageCode | string  | ISO 639-1 code (e.g., "fr", "en").                                       |
| currencyCode        | string  | Accounting base currency (e.g., XOF, EUR).                               |
| fiscalCountryCode   | string  | ISO 3166-1 alpha-2 (e.g., "BJ", "CI").                                   |
| registrationNumber  | string  | Trade register (RCCM) or NGO registration number (Récépissé).            |
| status              | ENUM    | Status (SETUP, ACTIVE, INACTIVE).                                        |
| isProjectBased      | boolean | If true, enables project tracking and mandatory project tags on entries. |
| timezone            | string  | IANA Time Zone (e.g., "Africa/Porto-Novo").                              |
| createdBy           | string  | ID of the user who created the record.                                   |
| createdAt           | string  | Creation date (ISO Date format).                                         |
| updatedAt           | string  | Last updated date.                                                       |

B. FiscalYear (FY)

| Property            | Type   | Notes                                                                  |
| :------------------ | :----- | :--------------------------------------------------------------------- |
| orgId               | string | PK                                                                     |
| year                | number | SK (Example: 2024.)                                                    |
| fiscalYearId        | string | fiscalYear Id                                                          |
| startDate           | string | YYYY-MM-DD format                                                      |
| endDate             | string | YYYY-MM-DD format                                                      |
| status              | ENUM   | "OPEN, CLOSED, ARCHIVED"                                               |
| accountingFramework | ENUM   | Snapshot of the standard (SYSCOHADA_REVISED or SYCEBNL) at year start. |
| ranEntryId          | string | Link to RAN                                                            |
| createdAt           | string | Audit                                                                  |
| updatedAt           | string | Audit                                                                  |

C. Account (ACC)

Special Rule: accountId is the account number right-padded with zeros to 8 digits (e.g., '411' -> '41100000').

| Property               | Type    | Notes                               |
| :--------------------- | :------ | :---------------------------------- |
| orgId                  | string  | PK                                  |
| accountId              | string  | Account number padded to 8-digit ID |
| accountName            | string  |                                     |
| accountNature          | ENUM    | BALANCE / INCOME                    |
| accountUsage           | ENUM    | DEBIT_ONLY / CREDIT_ONLY / BOTH     |
| isThirdPartyAccount    | boolean |                                     |
| classCode              | number  | 1-8                                 |
| financialStatementCode | string  | e.g., "B01"                         |
| allowReconciliation    | boolean |                                     |
| createdAt              | string  | Audit                               |
| updatedAt              | string  | Audit                               |

D. ThirdParty (TP)

| Property            | Type    | Notes                                                                                |
| :------------------ | :------ | :----------------------------------------------------------------------------------- |
| orgId               | string  | PK                                                                                   |
| thirdPartyId        | string  | SK Component                                                                         |
| entityType          | string  | Mandatory: THIRD_PARTY.                                                              |
| code                | string  | Unique short code (e.g., "C001", "BAIL-UNICEF").                                     |
| fullName            | string  | Full name or Business name.                                                          |
| type                | ENUM    | CLIENT, SUPPLIER, EMPLOYEE, DONOR (SYCEBNL), MEMBER (SYCEBNL).                       |
| category            | ENUM    | INDIVIDUAL or CORPORATE.                                                             |
| collectiveAccountId | string  | Link to the GL account (e.g., 41110000 for clients, 44100000 for donors).            |
| email               | string  | Contact email.                                                                       |
| phone               | string  | Contact phone number.                                                                |
| languageCode        | string  | Language used for external documents (Invoices, etc.).(ISO 639-1, e.g., "fr", "en"). |
| isArchived          | boolean | Soft delete flag.                                                                    |
| taxIdNumber         | string  | OHADA Tax ID                                                                         |
| createdAt           | string  | Audit                                                                                |
| updatedAt           | string  | Audit                                                                                |

E. Journal (JNL)

| Property    | Type   | Notes                        |
| :---------- | :----- | :--------------------------- |
| orgId       | string | PK                           |
| year        | number | SK                           |
| journalCode | string | SK                           |
| journalName | string |                              |
| type        | ENUM   | "PURCHASE, SALE, BANK, MISC" |
| createdAt   | string | Audit                        |
| updatedAt   | string | Audit                        |

F. Entry (E)

| Property      | Type   | Notes                      |
| :------------ | :----- | :------------------------- |
| orgId         | string | PK                         |
| year          | number | PK                         |
| entryId       | string | SK                         |
| voucherNumber | string |                            |
| journalCode   | string |                            |
| entryDate     | string | YYYY-MM-DD format          |
| totalDebit    | number |                            |
| totalCredit   | number |                            |
| status        | ENUM   | "DRAFT, POSTED, CANCELLED" |
| createdBy     | string |                            |
| createdAt     | string | Audit                      |
| updatedAt     | string | Audit                      |

G. EntryLine (L)

| Property      | Type   | Notes                                             |
| :------------ | :----- | :------------------------------------------------ |
| orgId         | string | PK                                                |
| year          | number | PK                                                |
| lineId        | string | SK                                                |
| entryId       | string | FK                                                |
| accountId     | string | 8-digit ID                                        |
| projectId     | string | Optional (SYCEBNL). Link to a specific project.   |
| debit         | number | Debit amount.                                     |
| credit        | number | Credit amount.                                    |
| description   | string | Line-specific label (Libellé).                    |
| entryDate     | string | Sort Key for GSIs                                 |
| thirdPartyId  | string | Optional                                          |
| voucherNumber | string |                                                   |
| journalCode   | string |                                                   |
| letteringCode | string | Lettrage (Matching) reference for reconciliation. |
| createdBy     | string |                                                   |
| createdAt     | string | Audit                                             |
| updatedAt     | string | Audit                                             |

H. USER (USER) - Cognito User Pool will manage users.

| Property     | Type     | Notes                                                |
| :----------- | :------- | :--------------------------------------------------- |
| orgId        | string   | Tenant ID.                                           |
| userId       | string   | Unique identifier (Cognito 'sub' ID).                |
| pk           | string   | DynamoDB Partition Key.                              |
| sk           | string   | DynamoDB Sort Key.                                   |
| entityType   | string   | Mandatory: Must be USER.                             |
| email        | string   | User's email (will be used in GSI-Email).            |
| firstName    | string   | First name.                                          |
| lastName     | string   | Last name.                                           |
| phoneNumber  | string   | Phone number.                                        |
| languageCode | string   | Preferred language (ISO 639-1, e.g., "fr", "en").    |
| roles        | string[] | Roles for Access Control, e.g., [ACCOUNTANT, ADMIN]. |
| status       | ENUM     | Cognito status (CONFIRMED, DISABLED, etc.).          |
| lastLoginAt  | string   | Date and time of last login (UTC ISO Date).          |
| createdAt    | string   | Creation date (Audit).                               |
| updatedAt    | string   | Last updated date.                                   |

I. Project (PROJECT)

| Property    | Type   | Notes                                                       |
| :---------- | :----- | :---------------------------------------------------------- |
| orgId       | string | Tenant ID.                                                  |
| projectId   | string | Unique UUID for the project.                                |
| projectCode | string | Human-readable code (e.g., "PAM-2024-001"). Unique per Org. |
| name        | string | Full title of the project.                                  |
| description | string | Optional long description of objectives.                    |
| donorId     | string | Link to a ThirdParty entity of type DONOR (Bailleur).       |
| startDate   | string | Official start date (YYYY-MM-DD format).                    |
| endDate     | string | Projected or actual end date (YYYY-MM-DD format).           |
| status      | ENUM   | "ACTIVE, CLOSED, SUSPENDED, PROPOSED."                      |
| totalBudget | number | Total funding amount for this project.                      |
| currency    | string | ISO Currency code (e.g., "XOF", "EUR").                     |
| managerId   | string | Link to a User entity responsible for the project.          |
| createdAt   | string | Audit: Creation timestamp.                                  |
| updatedAt   | string | Audit: Last update timestamp.                               |

## 6. API Response & Internationalization Contract

You are generating backend / API code (AWS Lambda / REST APIs) for a multilingual, production-grade SaaS application.
You must strictly follow the API response contract and internationalization rules below.

### 6.1. Shared API Response Model (MANDATORY)

All API responses must conform to the following model:

export interface ApiMessage {
code: string; // Stable, language-independent message code
message: string; // Localized, human-readable message
}

export interface ApiResponse<T = any> {
statusCode: number;
success: boolean;
message?: ApiMessage;
data?: T;
error?: ApiMessage;
}

### 6.2. Forbidden Patterns (STRICT)

❌ Do NOT use raw strings for message or error
❌ Do NOT hardcode user-facing text
❌ Do NOT return framework or exception messages directly
❌ Do NOT mix multiple response formats
Any response containing a raw string for message or error is invalid.

### 6.3. Response Helpers (MANDATORY USAGE)

All responses must be created using these helpers:

export const ok = <T>(
data: T,
message: ApiMessage
): ApiResponse<T> => ({
statusCode: 200,
success: true,
message,
data,
});

export const created = <T>(
data: T,
message: ApiMessage
): ApiResponse<T> => ({
statusCode: 201,
success: true,
message,
data,
});

export const badRequest = (
error: ApiMessage
): ApiResponse => ({
statusCode: 400,
success: false,
error,
});

export const unauthorized = (): ApiResponse => ({
statusCode: 401,
success: false,
error: {
code: 'UNAUTHORIZED',
message: 'Unauthorized',
},
});

export const notFound = (
error: ApiMessage
): ApiResponse => ({
statusCode: 404,
success: false,
error,
});

### 6.4. Internationalization Rules (i18n)

Language must be resolved in this order:

- Accept-Language HTTP header
- User language preference
- Default language (en)

All messages must be retrieved from an i18n service or locale files (e.g. /locales/en.json, /locales/fr.json).
Message codes must never change across languages.
A fallback language must exist for missing translations.
Example:
badRequest({
code: 'ERROR_INVALID_PASSWORD',
message: i18n.t('ERROR_INVALID_PASSWORD'),
});

### 6.5. Error Handling Rules

Every error response must include:

- a stable error code
- a localized message

Error codes must be:

- deterministic
- testable
- loggable
  Messages must be safe for end users (no sensitive details).

### 6.6. Business & Domain Messages

Business labels must be language-agnostic.
Prefer message keys or codes over hardcoded labels.
Never embed UI text in domain logic.

### 6.7. Logging & Testing Expectations

Logs must rely on code, not message.
Automated tests must assert on code, never on localized text.
Message text may change without breaking API contracts.

### 6.8. Architectural Constraints

Centralize i18n logic (middleware, service, interceptor).
Adding a new language must not require refactoring business logic.
All generated code must be clean, scalable, and maintainable.

### 6.9. Templates & Generated Documents (Emails, PDFs, Reports)

All backend-generated documents must strictly follow the i18n rules defined in the API contract.

#### 6.9.1 📂 Template Organization

Templates must be isolated by locale and type to ensure maintainability:

- `/templates/{locale}/email/` : HTML/Text templates for SES/Mail notifications.
- `/templates/{locale}/pdf/` : HTML/Handlebars/React templates for invoices, balance sheets, and reports.

#### 6.9.2 ⚙️ Generation Rules

- **Language Resolution:** Documents must be generated based on the target entity's preference (e.g., an Invoice for a Client follows the Client's `languageCode`; a Payroll slip follows the Employee's preference).
- **Standard Compliance:** PDF reports (Balance Sheet, Income Statement) must strictly follow the layouts defined by **SYSCOHADA** or **SYCEBNL** based on the `FiscalYear` standard.
- **Storage:** Generated documents should be temporarily stored in AWS S3 with restricted access (Signed URLs).
- **Consistency:** Currency symbols, date formats (eg. DD/MM/YYYY), and number separators must be localized according to the Organization's `fiscalCountryCode`.

## 7. Cost Optimization & Sustainability

Every resource generated must be optimized to maintain the lowest possible AWS bill without sacrificing performance.

### 7.1 Compute (AWS Lambda)

- **Architecture:** Use `ARM_64` (AWS Graviton2/3) for all Lambda functions (typically 20% cheaper and better performance than x86).
- **Memory Sizing:** Start with the minimum required (128MB or 256MB) and only increase if CPU bottlenecks are detected.
- **Log Retention:** Set CloudWatch Logs retention to **14 days** (or 30 days maximum) for development/staging to avoid storage costs. Never use 'Forever'.

### 7.2 Database (DynamoDB)

- **Billing Mode:** Use `PAY_PER_REQUEST` (On-Demand) to ensure we only pay for actual transactions.
- **Sparse Indexes:** Design GSIs to be "sparse" (only include items that actually need to be indexed) to reduce storage and write costs.
- **TTL (Time To Live):** Enable TTL on temporary data (e.g., sessions, temporary export states) to automate deletion at no cost.

### 7.3 Observability (X-Ray & Tracing)

- **Active Tracing:** Enable X-Ray on all Lambda functions and API Gateway stages.
- **Trace Continuity:** Ensure API Gateway is configured to pass the trace header to backend services.
- **Aggressive Sampling:** Implement a custom X-Ray sampling rule:
  - **Fixed Rate:** 5% (0.05) for successful requests.
  - **Error Capture:** 100% for 4xx and 5xx errors (via Active Tracing).
  - **Reservoir Size:** 1 request/second to ensure baseline visibility.
- **SDK Instrumentation:** SDK Instrumentation: Always use the AWS X-Ray SDK to wrap DynamoDB clients and external HTTP calls.

### 7.4 Storage (S3)

- **Lifecycle Policies:** For the `templates/` and generated PDFs, implement lifecycle rules to move old reports to 'Intelligent-Tiering' or delete temporary exports after 7 days.

## 8. Accounting Integrity & Period Closing (OHADA)

To comply with OHADA/SYCEBNL legal requirements, the Core-Ledger must enforce the following:

- **Fiscal Year Status:** Every `FiscalYear` entity must have a `status` attribute (`OPEN`, `LOCKED`, `CLOSED`).
- **Immutability:** - No `JournalEntry` can be created, modified, or deleted if the linked `FiscalYear` is `LOCKED` or `CLOSED`.
  - Once a `JournalEntry` is validated (posted), it cannot be deleted. Corrections must be made via reversal entries (contre-passation).
- **Validation Rule:** The `KeyFactory` and Domain Services must verify the period status before any write operation on the Ledger.

## 9. Conflict Resolution & AI Autonomy

- **Critical Thinking:** If you detect a contradiction between two sections of these instructions, or between these instructions and AWS Well-Architected/OHADA best practices, **STOP** and ask for clarification before generating code.
- **Hierarchy of Truth:** In case of doubt, follow this priority order:
  - Security & Multi-tenancy isolation (Top Priority).
  - Internationalization (i18n) & Standard compliance (SYSCOHADA/SYCEBNL).
  - Scalability & Performance (DynamoDB Best Practices).
  - Code brevity.
- **Proactive Improvement:** If you identify a more efficient way to implement a feature while respecting the Domain-Driven Design (DDD) and the Single Table Design, you are encouraged to propose it and explain why.

## 10. FINAL OBJECTIVE

All generated backend code must be scalable, multilingual, and production-ready, suitable for international SaaS applications.
