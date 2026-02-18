import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { ok, notFound, toLambdaResponse } from "@/models/shared/api-response";

/**
 * Retrieves the full state of a fiscal year, including its general status
 * (OPEN/CLOSED) and the individual lock status for each of its 12 months.
 * This provides the frontend with a consolidated view of the fiscal calendar.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);
  const orgId = event.requestContext?.authorizer?.claims?.orgId;
  const year = event.queryStringParameters?.year;

  if (!year) {
    return toLambdaResponse(
      notFound(i18n.getMessage("ERROR_MISSING_PARAMETERS")),
    );
  }

  try {
    // 1. Fetch Global Year Status (stored at the Organization level)
    const fyRes = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.fiscalYearSK(year),
        }),
      }),
    );

    if (!fyRes.Item) {
      return toLambdaResponse(
        notFound(i18n.getMessage("ERROR_FISCAL_YEAR_NOT_FOUND")),
      );
    }

    // 2. Fetch all Monthly Period Locks for this year
    // Querying the specific year partition for all items starting with 'LOCK#PERIOD#'
    const locksRes = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.partitionKey(orgId, parseInt(year)),
          ":sk": "LOCK#PERIOD#",
        }),
      }),
    );

    const locks = (locksRes.Items || []).map((i) => unmarshall(i));

    // 3. Aggregate response for a simplified UI consumption
    const response = {
      ...unmarshall(fyRes.Item),
      periodLocks: locks.reduce(
        (acc, lock) => {
          // Safe extraction: using 'month' attribute or parsing the SK suffix
          const monthKey = lock.month || lock.SK.split("#").pop();
          acc[monthKey] = lock.status;
          return acc;
        },
        {} as Record<string, string>,
      ),
    };

    return toLambdaResponse(
      ok(response, i18n.getMessage("SUCCESS_FISCAL_YEAR_DETAILS_RETRIEVED")),
    );
  } catch (error) {
    console.error("GetFiscalYearDetails Error:", error);
    return toLambdaResponse(notFound(i18n.getMessage("ERROR_INTERNAL")));
  }
};
