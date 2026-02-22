import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { ProjectSchema } from "@/models/projects/project";
import { toLambdaResponse, ok, badRequest } from "@/models/shared/api-response";

/**
 * @async
 * @function handler
 * @description Retrieves all projects associated with the authenticated organization.
 * * * Execution Logic:
 * 1. Extracts `orgId` from the request context authorizer.
 * 2. Uses `KeyFactory` to generate the Partition Key and the Project Sort Key prefix.
 * 3. Performs a DynamoDB Query using `begins_with(SK, 'PRJ#')` for optimal performance.
 * 4. Validates each retrieved item against the `ProjectSchema`.
 * * @param {APIGatewayProxyEvent} event - AWS Lambda event.
 * @returns {Promise<APIGatewayProxyResult>}
 * - 200: A JSON object containing the count and the array of projects.
 * - 400: Missing organization context or internal error.
 */
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

    // Use KeyFactory to get the prefix (e.g., "PRJ#") without hardcoding
    const projectPrefix = KeyFactory.projectPrefix();

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: {
          ":pk": { S: KeyFactory.orgKey(orgId) },
          ":prefix": { S: projectPrefix },
        },
      }),
    );

    // Map and validate results
    const projects = (result.Items || []).map((item) => {
      const data = unmarshall(item);
      return ProjectSchema.parse(data);
    });

    return toLambdaResponse(
      ok(
        {
          count: projects.length,
          projects,
        },
        i18n.getMessage("SUCCESS_PROJECTS_RETRIEVED"),
      ),
    );
  } catch (error: any) {
    console.error("GetProjects Error:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
