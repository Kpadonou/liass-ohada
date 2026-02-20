import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  TransactWriteItemsCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { DonorSchema } from "@/models/projects/donor"; // Utilisation du schéma complet
import {
  toLambdaResponse,
  created,
  badRequest,
} from "@/models/shared/api-response";

/**
 * Handles the creation of a new Donor.
 * Ensures business code uniqueness and existence of associated accounting accounts.
 * @param event - APIGatewayProxyEvent
 * @returns APIGatewayProxyResult
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const orgId = event.requestContext.authorizer?.claims?.orgId;
    if (!orgId)
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_ORG_ID")),
      );

    const body = JSON.parse(event.body || "{}");
    const donorId = `DONOR-${Date.now()}`; // K-Sortable technical ID
    const now = new Date().toISOString();

    // 1. Validation avec le schéma complet (type, currency, address, etc.)
    const validation = DonorSchema.safeParse({
      ...body,
      orgId,
      donorId,
      createdAt: now,
      updatedAt: now,
    });

    if (!validation.success) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT")),
      );
    }

    const donor = validation.data;

    // 2. Vérification d'existence du compte comptable associé (si fourni)
    if (donor.associatedAccountId) {
      const accountCheck = await dynamoClient.send(
        new GetItemCommand({
          TableName: config.TABLE_NAME,
          Key: marshall({
            PK: KeyFactory.orgKey(orgId), // On cherche dans les données de l'org
            SK: `ACC#${donor.associatedAccountId}`,
          }),
        }),
      );

      if (!accountCheck.Item) {
        return toLambdaResponse(
          badRequest(i18n.getMessage("ERROR_ACCOUNT_NOT_FOUND")),
        );
      }
    }

    // 3. Exécution de la transaction (Donateur + Verrou de Code)
    const donorItem = {
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.thirdPartySK("DONOR", donorId),
      ...donor,
    };

    const lockItem = {
      PK: KeyFactory.orgKey(orgId),
      SK: `DONORCODE#${donor.code}`,
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
  } catch (error: any) {
    console.error("CreateDonor Error:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
