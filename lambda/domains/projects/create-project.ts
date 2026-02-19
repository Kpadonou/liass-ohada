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
 * Validation schema for project creation (Input)
 */
const CreateProjectRequestSchema = z.object({
  projectCode: z
    .string()
    .min(2)
    .max(20)
    .toUpperCase()
    .regex(/^[A-Z0-9_-]+$/),
  name: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  donorId: z.string().min(1),
  managerId: z.string().min(1),
  contractRef: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  budget: z.number().int().nonnegative(),
  currency: z.string().length(3).default("XOF"),
});

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const orgId = event.requestContext.authorizer?.claims?.orgId || "test-org";
    const body = event.body ? JSON.parse(event.body) : {};

    const validation = CreateProjectRequestSchema.safeParse(body);
    if (!validation.success) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT")),
      );
    }

    const data = validation.data;
    const projectId = `PRJ-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    // 1. Prepare the Main Project Item
    const projectItem = {
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.projectSK(projectId),
      ...data,
      projectId,
      orgId,
      entityType: "PROJECT",
      currentSpending: 0,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };

    // 2. Prepare the Uniqueness Lock Item for Project Code
    const projectCodeLock = {
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.projectCodeSK(data.projectCode),
      projectId, // Link to the technical ID
      entityType: "PROJECT_CODE_LOCK",
      createdAt: now,
    };

    // 3. Atomic Transaction: Create both items only if they don't exist
    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            {
              Put: {
                TableName: config.TABLE_NAME,
                Item: marshall(projectItem),
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Put: {
                TableName: config.TABLE_NAME,
                Item: marshall(projectCodeLock),
                ConditionExpression: "attribute_not_exists(PK)", // Ensures projectCode uniqueness
              },
            },
          ],
        }),
      );
    } catch (err: any) {
      if (err.name === "TransactionCanceledException") {
        return toLambdaResponse(
          badRequest(i18n.getMessage("ERROR_PROJECT_CODE_EXISTS")),
        );
      }
      throw err;
    }

    return toLambdaResponse(
      created(projectItem, i18n.getMessage("SUCCESS_PROJECT_CREATED")),
    );
  } catch (error) {
    console.error("CreateProject Error:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
