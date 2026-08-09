import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/middleware/handler-wrapper";
import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { AccountSchema } from "@liass-ohada/shared/accounting";
import { z } from "zod";

const TreasuryAccountReferenceInputSchema = z
  .object({
    orgId: z.string().min(1),
    accountId: z.string().min(1),
  })
  .strict();

/**
 * Accounting-owned validation boundary for Treasury's stable account reference.
 * Persistence keys and the Accounting account entity remain internal here.
 */
export class AccountingAccountReferenceService {
  static async assertTreasuryAccountReference(input: {
    orgId: string;
    accountId: string;
  }): Promise<void> {
    const parsed = TreasuryAccountReferenceInputSchema.parse(input);

    if (!parsed.accountId.startsWith("5")) {
      throw new AppError(400, "ERROR_ACCOUNT_NOT_TREASURY_CLASS");
    }

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
    if (account.classCode !== 5) {
      throw new AppError(400, "ERROR_ACCOUNT_NOT_TREASURY_CLASS");
    }
  }
}
