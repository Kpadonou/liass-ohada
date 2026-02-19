import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import {
  toLambdaResponse,
  created,
  badRequest,
} from "@/models/shared/api-response";

/**
 * Zod schema for donor creation request.
 */
const CreateDonorRequestSchema = z.object({
  code: z.string().min(2).max(10).toUpperCase(),
  name: z.string().min(3).max(100),
  email: z.string().email().optional(),
  associatedAccountId: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
});

/**
 * Handles the creation of a new Donor.
 * Uses a transaction to ensure unique business codes per organization.
 * * @param event - APIGatewayProxyEvent
 * @returns APIGatewayProxyResult
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const orgId = event.requestContext.authorizer?.claims?.orgId || "test-org";
    const body = event.body ? JSON.parse(event.body) : {};

    const validation = CreateDonorRequestSchema.safeParse(body);
    if (!validation.success) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT")),
      );
    }

    const { code, name, email, associatedAccountId } = validation.data;
    const donorId = `DONOR-${Date.now()}`; // K-Sortable technical ID
    const now = new Date().toISOString();

    const donorItem = {
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.thirdPartySK("DONOR", donorId),
      orgId,
      donorId,
      code,
      name,
      email,
      associatedAccountId,
      entityType: "DONOR",
      createdAt: now,
      updatedAt: now,
    };

    const lockItem = {
      PK: KeyFactory.orgKey(orgId),
      SK: `DONORCODE#${code}`,
      donorId,
      entityType: "DONOR_CODE_LOCK",
    };

    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            {
              Put: {
                TableName: config.TABLE_NAME,
                Item: marshall(donorItem),
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Put: {
                TableName: config.TABLE_NAME,
                Item: marshall(lockItem),
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
          ],
        }),
      );
    } catch (err: any) {
      if (err.name === "TransactionCanceledException") {
        return toLambdaResponse(
          badRequest(i18n.getMessage("ERROR_DONOR_EXISTS")),
        );
      }
      throw err;
    }

    return toLambdaResponse(
      created(donorItem, i18n.getMessage("SUCCESS_DONOR_CREATED")),
    );
  } catch (error) {
    console.error("CreateDonor Error:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
