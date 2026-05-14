import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { JournalSchema } from "@/models/core-ledger/journal";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import {
  badRequest,
  ok,
  toLambdaResponse,
  unauthorized,
} from "@/models/shared/api-response";

/**
 * Updates an existing journal.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const body = JSON.parse(event.body || "{}");
    const orgId = event.requestContext.authorizer?.claims?.orgId;
    if (!orgId) {
      return toLambdaResponse(unauthorized());
    }
    const journalCode = event.pathParameters?.journalCode;

    if (!journalCode) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT")),
      );
    }

    const updateData = {
      ...body,
      updatedAt: new Date().toISOString(),
    };

    // Note: In a real implementation, you'd merge with existing data
    const journalData = {
      orgId,
      year: body.year,
      journalCode,
      journalName: body.journalName,
      type: body.type,
      entityType: "JOURNAL",
      PK: KeyFactory.orgKey(orgId),
      SK: `JNL#${journalCode}`,
      ...updateData,
    };

    const validation = JournalSchema.safeParse(journalData);
    if (!validation.success) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT")),
      );
    }

    await dynamoClient.send(
      new UpdateItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(orgId) },
          SK: { S: `JNL#${journalCode}` },
        },
        UpdateExpression:
          "SET journalName = :name, #type = :type, updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#type": "type",
        },
        ExpressionAttributeValues: marshall({
          ":name": body.journalName,
          ":type": body.type,
          ":updatedAt": new Date().toISOString(),
        }),
        ReturnValues: "ALL_NEW",
      }),
    );

    return toLambdaResponse(
      ok(journalData, i18n.getMessage("JOURNAL_UPDATED")),
    );
  } catch (error) {
    console.error("Error updating journal:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
