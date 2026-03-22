import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { JournalSchema } from "@/models/core-ledger/journal";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import {
  badRequest,
  created,
  toLambdaResponse,
} from "@/models/shared/api-response";

/**
 * Creates a new journal for the organization.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const body = JSON.parse(event.body || "{}");
    const orgId = event.requestContext.authorizer?.claims?.orgId || "test-org";
    const { year, journalCode, journalName, type } = body;

    const journalData = {
      orgId,
      year,
      journalCode,
      journalName,
      type,
      entityType: "JOURNAL",
      PK: KeyFactory.orgKey(orgId),
      SK: `JNL#${journalCode}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const validation = JournalSchema.safeParse(journalData);
    if (!validation.success) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT")),
      );
    }

    await dynamoClient.send(
      new PutItemCommand({
        TableName: config.TABLE_NAME,
        Item: marshall(journalData, { removeUndefinedValues: true }),
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );

    return toLambdaResponse(
      created(journalData, i18n.getMessage("JOURNAL_CREATED")),
    );
  } catch (error) {
    console.error("Error creating journal:", error);
    return toLambdaResponse(
      badRequest(i18n.getMessage("ERROR_INTERNAL")),
    );
  }
};