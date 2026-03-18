# 📁 Domain: Project Management (SYCEBNL)

## 1. Context & Purpose

This domain handles the **Analytical Accounting layer** specifically designed for Non-Profit Entities (SYCEBNL framework). It bridges the gap between the General Ledger (OHADA) and Donor requirements. It ensures that every expense is justified by both a **Budget Plan** and **Available Cash**.

## 2. Data Models (DynamoDB Schema)

### A. Project (`PROJECT`)

The root entity representing a specific social mission or contract.

- **PK**: `ORG#<orgId>`
- **SK**: `PRJ#<projectId>`
- **Attributes**: `projectCode`, `name`, `startDate`, `endDate`, `status` (OPEN/CLOSED).

### B. Funding Source (`FUNDING_SOURCE`)

Represents the financial commitment (the "Promise") from a specific donor.

- **PK**: `ORG#<orgId>`
- **SK**: `PRJ#<projectId>#FS#<donorId>`
- **Attributes**: `label`, `amount` (Contracted total), `currency`.

### C. Budget Line (`BUDGET_LINE`)

The tactical breakdown of the project by activity or category for a specific year.

- **PK**: `ORG#<orgId>`
- **SK**: `PRJ#<projectId>#FY#<year>#L#<code>`
- **Attributes**: `label`, `amount` (Planned allocation).

## 3. Business Invariants & Validation Rules

### 🚨 The "Anti-Deficit" Validation (Critical)

Every `ENTRY_LINE` (Expenditure) must pass a two-tier check in the `BudgetService` before persistence:

1. **Theoretical Budget Check**:
   - `Total_Spent_on_Line + New_Debit <= BudgetLine.amount`
   - _Prevents overspending the approved activity budget._

2. **Real Cash Check (Treasury)**:
   - `Total_Spent_by_Donor + New_Debit <= Total_Cash_Received_from_Donor`
   - _Calculated via Account 751 (Revenue) vs Account 6x (Expenses) for that specific `donorId`._
   - _Prevents spending funds not yet received in the bank._

### 🏷️ Mandatory Analytical Tagging

Any accounting line linked to this domain **MUST** contain:

- `projectId`: Cross-reference to the project.
- `budgetLineId`: Link to the specific activity.
- `donorId`: Identification of the funding partner.

## 4. Technical Implementation Details

### GSI4: Project Analytical Index

To allow high-performance reporting without scanning the whole table:

- **GSI4PK**: `ORG#<orgId>#PROJECTS_ALL`
- **GSI4SK**: `PRJ#<projectId>#FY#<year>#DT#<date>#L#<lineId>`

### Reporting Logic

The `get-project-report` handler performs a **Multi-dimensional Pivot**:

- **Rows**: Budget Lines (`BUDGET_LINE`).
- **Columns**: Donors (`FUNDING_SOURCE`).
- **Values**: Aggregated debits from `ENTRY_LINE` filtered by GSI4.

## 5. Security & Multi-tenancy

- **Isolation**: Every query must include `orgId` extracted from the Cognito JWT (`custom:orgId`).
- **Integrity**: Project data is read-only if the corresponding `FISCAL_YEAR` is `LOCKED`.
