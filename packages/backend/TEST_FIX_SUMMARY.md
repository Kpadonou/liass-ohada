# Unit Test Fix Summary

## Problem Identified

The unit tests in `test/unit/core-ledger/post-entry.test.ts` were failing with 13 failures out of 15 tests. The error was:

```
ZodError: [
  {
    "expected": "string",
    "code": "invalid_type",
    "path": ["orgId"],
    "message": "Invalid input: expected string, received undefined"
  }
]
```

## Root Cause

The `createMockFiscalYear()` helper function was creating mock DynamoDB items using `marshall()`, but the mock object was missing the `orgId` field.

The test was marshalling:

```typescript
marshall({
  pk: "ORG#test-org",
  sk: "FY#2026",
  year: 2026,
  fiscalYearId: "FY-2026-001",
  // ... other fields
});
```

When the handler unmarshalled this Item, it correctly restored all fields except `orgId`. The handler then attempted to parse the result with `FiscalYearSchema.parse()`, which requires `orgId` as a mandatory field:

```typescript
export const FiscalYearSchema = z.object({
  orgId: z.string(), // <-- Required field
  year: z.number(),
  fiscalYearId: z.string(),
  // ... other fields
});
```

## Solution

Updated the `createMockFiscalYear()` function to include `orgId` in the mock object before marshalling:

```typescript
const createMockFiscalYear = (status: "OPEN" | "LOCKED" | "CLOSED") =>
  marshall({
    orgId: "test-org", // <-- Added this line
    pk: "ORG#test-org",
    sk: "FY#2026",
    year: 2026,
    fiscalYearId: "FY-2026-001",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    status,
    accountingFramework: "SYSCOHADA_REVISED",
    entityType: "FISCAL_YEAR",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
```

## Test Results

After the fix:

- ✅ **Unit Tests**: 15/15 passing
- ✅ **Domain Integration Tests**: 14/14 passing
- ✅ **Total**: 29/29 tests passing

## Changed File

- `test/unit/core-ledger/post-entry.test.ts` - Added `orgId: "test-org"` to the mock FiscalYear object

## Key Learning

When mocking DynamoDB items for Zod schema validation:

1. Ensure all mandatory schema fields are included in the mock object
2. Remember that `marshalling` and `unmarshalling` preserve field names but require the fields to exist before marshalling
3. Test with actual schema validation to catch missing fields early
