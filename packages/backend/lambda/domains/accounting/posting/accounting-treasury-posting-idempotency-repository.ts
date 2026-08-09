import {
  GetItemCommand,
  type TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";

const TreasuryPostingIdempotencyRecordSchema = z
  .object({
    orgId: z.string().min(1),
    operation: z.literal("TREASURY_POSTING"),
    clientRequestId: z.string().uuid(),
    clientRequestIdHash: z.string().regex(/^[a-f0-9]{64}$/),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    entryId: z.string().min(1),
    status: z.literal("COMPLETED"),
    entityType: z.literal("TREASURY_POSTING_IDEMPOTENCY"),
    PK: z.string(),
    SK: z.string(),
    createdBy: z.string().min(1),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export type TreasuryPostingIdempotencyRecord = z.infer<
  typeof TreasuryPostingIdempotencyRecordSchema
>;

export interface TreasuryPostingIdempotencyIdentity {
  clientRequestId: string;
  clientRequestIdHash: string;
  requestFingerprint: string;
}

/** Accounting-owned persistence for one Treasury-originated posting identity. */
export class AccountingTreasuryPostingIdempotencyRepository {
  static async getCompleted(
    orgId: string,
    clientRequestIdHash: string,
  ): Promise<TreasuryPostingIdempotencyRecord | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.treasuryPostingIdempotencySK(clientRequestIdHash),
        }),
        ConsistentRead: true,
      }),
    );

    return result.Item
      ? TreasuryPostingIdempotencyRecordSchema.parse(unmarshall(result.Item))
      : undefined;
  }

  static buildCompletedPut(input: {
    orgId: string;
    userId: string;
    identity: TreasuryPostingIdempotencyIdentity;
    entryId: string;
    now: string;
  }): TransactWriteItem {
    const record = TreasuryPostingIdempotencyRecordSchema.parse({
      orgId: input.orgId,
      operation: "TREASURY_POSTING",
      clientRequestId: input.identity.clientRequestId,
      clientRequestIdHash: input.identity.clientRequestIdHash,
      requestFingerprint: input.identity.requestFingerprint,
      entryId: input.entryId,
      status: "COMPLETED",
      entityType: "TREASURY_POSTING_IDEMPOTENCY",
      PK: KeyFactory.orgKey(input.orgId),
      SK: KeyFactory.treasuryPostingIdempotencySK(
        input.identity.clientRequestIdHash,
      ),
      createdBy: input.userId,
      createdAt: input.now,
      updatedAt: input.now,
    });

    return {
      Put: {
        TableName: config.TABLE_NAME,
        Item: marshall(record),
        ConditionExpression:
          "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      },
    };
  }
}
