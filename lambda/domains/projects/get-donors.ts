/**
 * @async
 * @function handler
 * @description Retrieves the list of all donors for the authenticated organization.
 * * Uses a Query on the Partition Key (orgId) with a prefix filter on the Sort Key.
 * * @param {APIGatewayProxyEvent} event - AWS Lambda event.
 * @returns {Promise<APIGatewayProxyResult>} 200 with the list of donors.
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { DonorSchema } from "@/models/projects/donor";
import { toLambdaResponse, ok, badRequest } from "@/models/shared/api-response";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const orgId = event.requestContext.authorizer?.claims?.orgId;

    if (!orgId) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_ORG_ID")),
      );
    }

    // 1. Query DynamoDB using the donor prefix in SK
    // We use the KeyFactory to stay consistent with the 'thirdPartySK' pattern
    // Utilisation de la KeyFactory pour le préfixe
    const donorPrefix = KeyFactory.thirdPartyPrefix("DONOR");

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: {
          ":pk": { S: KeyFactory.orgKey(orgId) },
          ":prefix": { S: donorPrefix },
        },
      }),
    );

    // 2. Parse and validate results with Zod
    const donors = (result.Items || []).map((item) => {
      const unmarshalled = unmarshall(item);
      return DonorSchema.parse(unmarshalled);
    });

    return toLambdaResponse(
      ok(
        {
          count: donors.length,
          donors: donors,
        },
        i18n.getMessage("SUCCESS_DONORS_RETRIEVED"),
      ),
    );
  } catch (error: any) {
    console.error("GetDonors Error:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
