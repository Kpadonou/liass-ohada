import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/middleware/handler-wrapper";
import { BalanceService } from "@/lambda/shared/services/balance-service";
import {
  GetItemCommand,
  QueryCommand,
  TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { AccountSchema } from "@liass-ohada/shared/accounting";
import { z } from "zod";

const ReconciliationScopeSchema = z
  .object({
    orgId: z.string().min(1),
    year: z.string().min(1),
  })
  .strict();

const AccountingReconciliationLinePersistenceSchema = z
  .object({
    PK: z.string().min(1),
    SK: z.string().min(1),
    entityType: z.literal("ENTRY_LINE"),
    orgId: z.string().min(1),
    year: z.union([z.string(), z.number()]).optional(),
    fiscalYear: z.union([z.string(), z.number()]).optional(),
    entryId: z.string().min(1),
    lineId: z.string().min(1),
    entryDate: z.string().min(1),
    journalCode: z.string().min(1),
    accountId: z.string().min(1),
    label: z.string().optional(),
    description: z.string().optional(),
    voucherNumber: z.string().optional(),
    debit: z.number(),
    credit: z.number(),
    status: z.string().optional(),
    entryStatus: z.string().optional(),
    statementLineId: z.string().optional(),
    statementDate: z.string().optional(),
    reconciledAt: z.string().optional(),
    reconciliationMatchId: z.string().optional(),
    reconciliationStatus: z.string().optional(),
  })
  .passthrough();

export const AccountingReconciliationLineSchema = z
  .object({
    entryLineId: z.string().min(1),
    entryId: z.string().min(1),
    date: z.string().min(1),
    journalCode: z.string().min(1),
    accountId: z.string().min(1),
    label: z.string().min(1),
    reference: z.string().min(1),
    debit: z.number(),
    credit: z.number(),
    statementLineId: z.string().optional(),
    reconciliationMatchId: z.string().optional(),
    reconciliationStatus: z.enum(["MATCHED", "UNMATCHED"]),
  })
  .strict();

export type AccountingReconciliationLine = z.infer<
  typeof AccountingReconciliationLineSchema
>;

export interface AccountingReconciliationCandidates {
  lines: AccountingReconciliationLine[];
  openingBalance: number;
}

export interface AccountingReconciliationTransactionOperation {
  readonly owner: "ACCOUNTING_CORE";
  readonly purpose: "APPLY_RECONCILIATION" | "CANCEL_RECONCILIATION";
  readonly transactWriteItem: TransactWriteItem;
}

const toReconciliationLine = (
  line: z.infer<typeof AccountingReconciliationLinePersistenceSchema>,
): AccountingReconciliationLine =>
  AccountingReconciliationLineSchema.parse({
    entryLineId: line.lineId,
    entryId: line.entryId,
    date: line.entryDate,
    journalCode: line.journalCode,
    accountId: line.accountId,
    label: line.label || line.description || "-",
    reference: line.voucherNumber || line.entryId || "N/A",
    debit: Number(line.debit) || 0,
    credit: Number(line.credit) || 0,
    statementLineId: line.statementLineId,
    reconciliationMatchId: line.reconciliationMatchId,
    reconciliationStatus:
      line.reconciliationStatus === "MATCHED" ? "MATCHED" : "UNMATCHED",
  });

export class AccountingReconciliationService {
  static async listReconciliationCandidates(input: {
    orgId: string;
    year: string;
    accountId: string;
  }): Promise<AccountingReconciliationCandidates> {
    const parsed = ReconciliationScopeSchema.extend({
      accountId: z.string().min(1),
    })
      .strict()
      .parse(input);
    const [balance, result] = await Promise.all([
      BalanceService.getAccountBalance(
        parsed.orgId,
        parsed.year,
        parsed.accountId,
      ),
      dynamoClient.send(
        new QueryCommand({
          TableName: config.TABLE_NAME,
          IndexName: config.GSI1,
          KeyConditionExpression:
            "GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
          ExpressionAttributeValues: marshall({
            ":pk": KeyFactory.gsi1PK(parsed.orgId),
            ":sk": KeyFactory.gsi1SKPrefix(
              parsed.accountId,
              parsed.year,
            ),
          }),
          ScanIndexForward: true,
        }),
      ),
    ]);

    const lines = (result.Items ?? [])
      .map((item) =>
        AccountingReconciliationLinePersistenceSchema.parse(unmarshall(item)),
      )
      .filter((line) => line.journalCode !== "RAN")
      .map(toReconciliationLine);

    return {
      lines,
      openingBalance: balance.openingDebit - balance.openingCredit,
    };
  }

  static async getReconciliationLine(input: {
    orgId: string;
    year: string;
    entryLineId: string;
    expectedEntryId?: string;
  }): Promise<AccountingReconciliationLine> {
    const parsed = ReconciliationScopeSchema.extend({
      entryLineId: z.string().min(1),
      expectedEntryId: z.string().min(1).optional(),
    })
      .strict()
      .parse(input);
    const expectedPK = KeyFactory.partitionKey(parsed.orgId, parsed.year);
    const expectedSK = KeyFactory.entryLineSK(parsed.entryLineId);
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({ PK: expectedPK, SK: expectedSK }),
      }),
    );

    if (!result.Item) {
      throw new AppError(404, "ERROR_ACCOUNTING_MOVEMENT_NOT_FOUND");
    }

    const line = AccountingReconciliationLinePersistenceSchema.parse(
      unmarshall(result.Item),
    );
    if (
      line.PK !== expectedPK ||
      line.SK !== expectedSK ||
      line.orgId !== parsed.orgId ||
      (line.year && String(line.year) !== parsed.year) ||
      (line.fiscalYear && String(line.fiscalYear) !== parsed.year) ||
      line.status === "DRAFT" ||
      line.entryStatus === "DRAFT"
    ) {
      throw new AppError(404, "ERROR_ACCOUNTING_MOVEMENT_NOT_FOUND");
    }
    if (parsed.expectedEntryId && line.entryId !== parsed.expectedEntryId) {
      throw new AppError(409, "ERROR_RECONCILIATION_ENTRY_OWNERSHIP_MISMATCH");
    }
    if (
      line.reconciliationStatus === "MATCHED" ||
      line.reconciliationMatchId ||
      line.statementLineId
    ) {
      throw new AppError(400, "ERROR_ACCOUNTING_MOVEMENT_ALREADY_RECONCILED");
    }

    return toReconciliationLine(line);
  }

  static async assertAccountAllowsReconciliation(input: {
    orgId: string;
    accountId: string;
  }): Promise<void> {
    const parsed = z
      .object({
        orgId: z.string().min(1),
        accountId: z.string().min(1),
      })
      .strict()
      .parse(input);
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(parsed.orgId),
          SK: KeyFactory.accountSK(parsed.accountId),
        }),
      }),
    );

    if (!result.Item) {
      throw new AppError(404, "ERROR_ACCOUNT_NOT_FOUND");
    }

    const account = AccountSchema.parse(unmarshall(result.Item));
    if (account.orgId !== parsed.orgId) {
      throw new AppError(404, "ERROR_ACCOUNT_NOT_FOUND");
    }
    if (!account.isActive) {
      throw new AppError(400, "ERROR_ACCOUNT_NOT_ACTIVE");
    }
    if (!account.allowReconciliation) {
      throw new AppError(
        400,
        "ERROR_TREASURY_ACCOUNT_RECONCILIATION_DISABLED",
      );
    }
  }

  static buildApplyReconciliationOperation(input: {
    orgId: string;
    year: string;
    entryLineId: string;
    statementLineId: string;
    statementDate: string;
    reconciliationMatchId: string;
    reconciledAt: string;
  }): AccountingReconciliationTransactionOperation {
    const parsed = ReconciliationScopeSchema.extend({
      entryLineId: z.string().min(1),
      statementLineId: z.string().min(1),
      statementDate: z.string().min(1),
      reconciliationMatchId: z.string().min(1),
      reconciledAt: z.string().min(1),
    })
      .strict()
      .parse(input);

    return {
      owner: "ACCOUNTING_CORE",
      purpose: "APPLY_RECONCILIATION",
      transactWriteItem: {
        Update: {
          TableName: config.TABLE_NAME,
          Key: marshall({
            PK: KeyFactory.partitionKey(parsed.orgId, parsed.year),
            SK: KeyFactory.entryLineSK(parsed.entryLineId),
          }),
          UpdateExpression:
            "SET reconciliationStatus = :matched, statementLineId = :statementLineId, statementDate = :statementDate, reconciledAt = :now, reconciliationMatchId = :matchId",
          ConditionExpression:
            "attribute_exists(PK) AND attribute_exists(SK) AND attribute_not_exists(reconciliationMatchId)",
          ExpressionAttributeValues: marshall({
            ":matched": "MATCHED",
            ":statementLineId": parsed.statementLineId,
            ":statementDate": parsed.statementDate,
            ":now": parsed.reconciledAt,
            ":matchId": parsed.reconciliationMatchId,
          }),
        },
      },
    };
  }

  static buildCancelReconciliationOperation(input: {
    orgId: string;
    year: string;
    entryLineId: string;
    reconciliationMatchId: string;
  }): AccountingReconciliationTransactionOperation {
    const parsed = ReconciliationScopeSchema.extend({
      entryLineId: z.string().min(1),
      reconciliationMatchId: z.string().min(1),
    })
      .strict()
      .parse(input);

    return {
      owner: "ACCOUNTING_CORE",
      purpose: "CANCEL_RECONCILIATION",
      transactWriteItem: {
        Update: {
          TableName: config.TABLE_NAME,
          Key: marshall({
            PK: KeyFactory.partitionKey(parsed.orgId, parsed.year),
            SK: KeyFactory.entryLineSK(parsed.entryLineId),
          }),
          UpdateExpression:
            "SET reconciliationStatus = :unmatched REMOVE statementLineId, statementDate, reconciledAt, reconciliationMatchId",
          ConditionExpression:
            "attribute_exists(PK) AND attribute_exists(SK) AND reconciliationMatchId = :expectedMatchId",
          ExpressionAttributeValues: marshall({
            ":unmatched": "UNMATCHED",
            ":expectedMatchId": parsed.reconciliationMatchId,
          }),
        },
      },
    };
  }
}
