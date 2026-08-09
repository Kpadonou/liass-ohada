import { AppError } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { TreasuryTransactionDirection } from "@liass-ohada/shared/treasury";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AccountingTreasuryPostingIdempotencyRepository,
  type TreasuryPostingIdempotencyIdentity,
  type TreasuryPostingIdempotencyRecord,
} from "./accounting-treasury-posting-idempotency-repository";

const AccountingTreasuryPostingIntentSchema = z
  .object({
    orgId: z.string().min(1),
    userId: z.string().min(1),
    clientRequestId: z.string().uuid(),
    treasuryAccountId: z.string().min(1),
    treasuryAccountingAccountId: z.string().regex(/^5\d{7}$/),
    counterpartyAccountId: z.string().regex(/^\d{8}$/),
    year: z.number().int(),
    transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    journalCode: z.string().min(1).max(10),
    direction: TreasuryTransactionDirection,
    amount: z.number().int().nonnegative(),
    description: z.string().min(3).max(255),
    reference: z.string().optional(),
    currency: z.string().length(3),
    thirdPartyId: z.string().optional(),
    projectId: z.string().optional(),
    budgetLineId: z.string().optional(),
    donorId: z.string().optional(),
  })
  .strict();

export type AccountingTreasuryPostingIntent = z.infer<
  typeof AccountingTreasuryPostingIntentSchema
>;

export interface AccountingTreasuryPostingResult {
  entryId: string;
}

/**
 * Accounting-owned application boundary that translates Treasury intent into
 * the existing journal-entry contract. Ledger validation and persistence stay
 * behind this boundary.
 */
export class AccountingTreasuryPostingService {
  static async postTreasuryTransaction(
    input: AccountingTreasuryPostingIntent,
  ): Promise<AccountingTreasuryPostingResult> {
    const intent = AccountingTreasuryPostingIntentSchema.parse(input);
    const journalCode = intent.journalCode.toUpperCase();

    if (!["BANK", "MISC"].includes(journalCode)) {
      throw new AppError(400, "ERROR_TREASURY_JOURNAL_INVALID");
    }

    const identity = AccountingTreasuryPostingService.buildIdentity(
      intent,
      journalCode,
    );
    const existing =
      await AccountingTreasuryPostingIdempotencyRepository.getCompleted(
        intent.orgId,
        identity.clientRequestIdHash,
      );

    if (existing) {
      return AccountingTreasuryPostingService.resolveReplay(
        intent.orgId,
        identity,
        existing,
      );
    }

    const treasuryLine =
      intent.direction === "INFLOW"
        ? {
            accountId: intent.treasuryAccountingAccountId,
            debit: intent.amount,
            credit: 0,
            label: intent.description,
          }
        : {
            accountId: intent.treasuryAccountingAccountId,
            debit: 0,
            credit: intent.amount,
            label: intent.description,
          };
    const counterpartyLine =
      intent.direction === "INFLOW"
        ? {
            accountId: intent.counterpartyAccountId,
            debit: 0,
            credit: intent.amount,
            label: intent.description,
            thirdPartyId: intent.thirdPartyId,
            projectId: intent.projectId,
            budgetLineId: intent.budgetLineId,
            donorId: intent.donorId,
          }
        : {
            accountId: intent.counterpartyAccountId,
            debit: intent.amount,
            credit: 0,
            label: intent.description,
            thirdPartyId: intent.thirdPartyId,
            projectId: intent.projectId,
            budgetLineId: intent.budgetLineId,
            donorId: intent.donorId,
          };

    try {
      const result = await LedgerService.postEntry({
        orgId: intent.orgId,
        userId: intent.userId,
        treasuryPostingIdempotency: identity,
        data: {
          year: intent.year,
          entryDate: intent.transactionDate,
          journalCode,
          voucherNumber: intent.reference,
          entryType: "STANDARD",
          label: intent.description,
          currency: intent.currency,
          lines: [treasuryLine, counterpartyLine],
        },
      });

      AccountingTreasuryPostingService.logOutcome(
        "IDEMPOTENCY_FIRST_EXECUTION",
        intent.orgId,
        identity.clientRequestIdHash,
        result.entryId,
      );
      return { entryId: result.entryId };
    } catch (error) {
      // A concurrent request may have won the conditional transaction.
      if (
        error instanceof AppError &&
        error.messageCode === "ERROR_ENTRY_ALREADY_EXISTS"
      ) {
        const raced =
          await AccountingTreasuryPostingIdempotencyRepository.getCompleted(
            intent.orgId,
            identity.clientRequestIdHash,
          );
        if (raced) {
          return AccountingTreasuryPostingService.resolveReplay(
            intent.orgId,
            identity,
            raced,
          );
        }
      }

      console.error("[TREASURY_POSTING_IDEMPOTENCY]", {
        event: "IDEMPOTENCY_FAILURE",
        operation: "TREASURY_POSTING",
        orgId: intent.orgId,
        idempotencyKeyHash: identity.clientRequestIdHash.slice(0, 16),
        errorCode:
          error instanceof AppError ? error.messageCode : "UNEXPECTED_ERROR",
      });
      throw error;
    }
  }

  private static buildIdentity(
    intent: AccountingTreasuryPostingIntent,
    normalizedJournalCode: string,
  ): TreasuryPostingIdempotencyIdentity {
    const clientRequestIdHash = createHash("sha256")
      .update(intent.clientRequestId)
      .digest("hex");
    const materialIntent = {
      treasuryAccountId: intent.treasuryAccountId,
      treasuryAccountingAccountId: intent.treasuryAccountingAccountId,
      counterpartyAccountId: intent.counterpartyAccountId,
      year: intent.year,
      transactionDate: intent.transactionDate,
      journalCode: normalizedJournalCode,
      direction: intent.direction,
      amount: intent.amount,
      description: intent.description,
      reference: intent.reference,
      currency: intent.currency,
      thirdPartyId: intent.thirdPartyId,
      projectId: intent.projectId,
      budgetLineId: intent.budgetLineId,
      donorId: intent.donorId,
    };
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify(materialIntent))
      .digest("hex");

    return {
      clientRequestId: intent.clientRequestId,
      clientRequestIdHash,
      requestFingerprint,
    };
  }

  private static resolveReplay(
    orgId: string,
    identity: TreasuryPostingIdempotencyIdentity,
    existing: TreasuryPostingIdempotencyRecord,
  ): AccountingTreasuryPostingResult {
    if (
      existing.orgId !== orgId ||
      existing.clientRequestIdHash !== identity.clientRequestIdHash ||
      existing.clientRequestId !== identity.clientRequestId ||
      existing.requestFingerprint !== identity.requestFingerprint
    ) {
      AccountingTreasuryPostingService.logOutcome(
        "IDEMPOTENCY_CONFLICT",
        orgId,
        identity.clientRequestIdHash,
      );
      throw new AppError(
        409,
        "ERROR_TREASURY_POSTING_IDEMPOTENCY_CONFLICT",
      );
    }

    AccountingTreasuryPostingService.logOutcome(
      "IDEMPOTENCY_REPLAY",
      orgId,
      identity.clientRequestIdHash,
      existing.entryId,
    );
    return { entryId: existing.entryId };
  }

  private static logOutcome(
    event:
      | "IDEMPOTENCY_FIRST_EXECUTION"
      | "IDEMPOTENCY_REPLAY"
      | "IDEMPOTENCY_CONFLICT",
    orgId: string,
    clientRequestIdHash: string,
    entryId?: string,
  ): void {
    const payload = {
      event,
      operation: "TREASURY_POSTING",
      orgId,
      idempotencyKeyHash: clientRequestIdHash.slice(0, 16),
      entryId,
    };

    if (event === "IDEMPOTENCY_CONFLICT") {
      console.warn("[TREASURY_POSTING_IDEMPOTENCY]", payload);
      return;
    }
    console.info("[TREASURY_POSTING_IDEMPOTENCY]", payload);
  }
}
