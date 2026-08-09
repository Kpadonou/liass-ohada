import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { padAccountId } from "@liass-ohada/shared/accounting";
import { GetEntriesRequestSchema } from "@liass-ohada/shared/accounting";

/**
 * Retrieves paginated ledger entries for a specific accounting account.
 *
 * This handler orchestrates two service calls:
 * 1. Verifies that the requested account exists within the organization's chart.
 * 2. Retrieves paginated entries from the account's ledger using GSI1.
 *
 * @param {Object} data - Validated request parameters
 * @param {string} data.accountId - The account ID to query (will be padded to 8 digits)
 * @param {string} data.fiscalYear - The fiscal year for entry lookup
 * @param {number} [data.limit=50] - Number of entries per page (1-1000)
 * @param {string} [data.cursor] - Base64-encoded cursor for pagination
 *
 * @param {Object} context - Handler context
 * @param {string} context.orgId - Active organization ID from verified request context
 * @param {Object} context.i18n - i18n resolver for localized messages
 *
 * @returns {Object} Paginated ledger entries
 * @returns {Object} .message - Success message via i18n
 * @returns {Array<Object>} .entries - Array of entry line items
 * @returns {string} [.nextCursor] - Cursor for fetching next page (if hasMore)
 * @returns {boolean} .hasMore - Flag indicating if more entries exist
 *
 * @throws {AppError} 400 if accountId or fiscalYear missing/invalid
 * @throws {AppError} 400 if limit is outside valid range
 * @throws {AppError} 404 if account does not exist
 * @throws {AppError} 400 if cursor format is invalid
 */
export const handler = createHandler(
  GetEntriesRequestSchema,
  async (data, { orgId, i18n }) => {
    const accountId = padAccountId(data.accountId);
    const fiscalYear = data.fiscalYear;
    const limit = data.limit || 50;
    const cursor = data.cursor;

    // Verify the account exists before querying entries
    await LedgerService.getAccount(orgId, accountId);

    // Retrieve paginated entries for the account
    const result = await LedgerService.getAccountEntries(
      orgId,
      fiscalYear,
      accountId,
      { limit, cursor },
    );

    return {
      message: i18n.getMessage("SUCCESS_ENTRIES_RETRIEVED"),
      entries: result.entries,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    };
  },
  {
    action: "GET /accounts/{accountId}/entries",
    permission: "ACCOUNTING_READ",
    productCode: "ACCOUNTING",
  },
);
