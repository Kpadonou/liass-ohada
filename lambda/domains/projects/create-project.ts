import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  TransactWriteItemsCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { ProjectSchema } from "@/models/projects/project"; // Utilisation du schéma central
import {
  toLambdaResponse,
  created,
  badRequest,
} from "@/models/shared/api-response";

/**
 * @async
 * @function createProjectHandler
 * @description
 * Orchestrates the creation of a new Project within the SYCEBNL framework.
 * * This handler performs a high-integrity creation process:
 * 1. Validates the input against the centralized `ProjectSchema`.
 * 2. Integrity Check: Ensures the referenced `donorId` exists for the current organization.
 * 3. Business Uniqueness: Uses a DynamoDB Transaction to atomically create the Project
 * record and a unique Project Code Lock (PRJCODE#CODE) to prevent duplicate codes.
 * 4. Initialization: Sets `currentSpending` to 0 to support the TER (Tableau des Emplois et Ressources) reporting.
 *
 * @param {APIGatewayProxyEvent} event - The Lambda event containing:
 * - body: JSON string with project details (projectCode, name, donorId, budget, etc.).
 * - requestContext.authorizer.claims.orgId: Extracted from JWT for security.
 * * @returns {Promise<APIGatewayProxyResult>}
 * - 201 (Created): Project successfully persisted.
 * - 400 (Bad Request): Validation failed, Donor not found, or Project Code already exists.
 * - 500 (Internal Error): Unexpected system failure.
 * * @throws {TransactionCanceledException} Handled internally for code uniqueness conflicts.
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

    const body = event.body ? JSON.parse(event.body) : {};

    // Génération des IDs techniques
    const projectId = `PRJ-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    // 1. Validation avec le schéma ProjectSchema (qui contient 'budget')
    const validation = ProjectSchema.safeParse({
      ...body,
      orgId,
      projectId,
      createdAt: now,
      updatedAt: now,
    });

    if (!validation.success) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT")),
      );
    }

    const projectData = validation.data;

    // 2. VÉRIFICATION : Est-ce que le donateur existe ?
    const donorCheck = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.thirdPartySK("DONOR", projectData.donorId),
        }),
      }),
    );

    if (!donorCheck.Item) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_DONOR_NOT_FOUND")),
      );
    }

    // 3. Préparation des items pour la transaction
    const projectItem = {
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.projectSK(projectId),
      ...projectData,
      currentSpending: 0, // Initialisation pour le TER
    };

    const projectCodeLock = {
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.projectCodeSK(projectData.projectCode),
      projectId,
      entityType: "PROJECT_CODE_LOCK",
      createdAt: now,
    };

    // 4. Transaction Atomique
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
                ConditionExpression: "attribute_not_exists(PK)",
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
