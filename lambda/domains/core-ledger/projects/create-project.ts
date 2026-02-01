import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { ProjectSchema } from "@/models/core-ledger/project";
import { KeyFactory } from "../../../shared/key-builder";
import { I18nResolver } from "../../../shared/i18n";
import {
  badRequest,
  created,
  toLambdaResponse,
} from "@/models/shared/api-response";

const dynamoClient = new DynamoDBClient({});

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || "{}");
    const orgId = event.requestContext.authorizer?.claims?.orgId || "test-org";
    const projectId = body.projectId || `PROJ-${Date.now()}`;

    const projectData = {
      ...body,
      orgId,
      projectId,
      entityType: "PROJECT",
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.projectSK(projectId),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const validation = ProjectSchema.safeParse(projectData);
    if (!validation.success) {
      const i18n = new I18nResolver(event.headers["Accept-Language"]);
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT"))
      );
    }

    await dynamoClient.send(
      new PutItemCommand({
        TableName: process.env.TABLE_NAME!,
        Item: marshall(validation.data),
      })
    );

    const i18n = new I18nResolver(event.headers["Accept-Language"]);
    return toLambdaResponse(
      created(validation.data, i18n.getMessage("SUCCESS_PROJECT_CREATED"))
    );
  } catch (error) {
    console.error(error);
    const i18n = new I18nResolver(event.headers["Accept-Language"]);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
