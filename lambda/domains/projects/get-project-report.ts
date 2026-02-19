import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { ProjectSchema } from "@/models/projects/project";
import {
  toLambdaResponse,
  ok,
  badRequest,
  notFound,
} from "@/models/shared/api-response";

/**
 * @async
 * @function handler
 * @description Generates a SYCEBNL Analytical Financial Report (TER - Tableau des Emplois et Ressources) for a specific project.
 * * Orchestrates the following steps:
 * 1. Retrieves project metadata (budget, identity) from the main table.
 * 2. Queries the GSI_PROJECT (GSI4) to fetch all accounting lines tagged with the projectId.
 * 3. Aggregates financial data: Debits as 'Emplois' (Uses) and Credits as 'Ressources' (Resources).
 * 4. Calculates budget execution metrics and account-level breakdown.
 * * @param {APIGatewayProxyEvent} event - AWS Lambda event containing:
 * - pathParameters.projectId: The unique identifier of the project.
 * - requestContext.authorizer.claims.orgId: The organization context.
 * * @returns {Promise<APIGatewayProxyResult>}
 * - 200: Analytical report with budget overview and account breakdown.
 * - 404: Project not found.
 * - 400: Missing parameters or internal error.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const orgId = event.requestContext.authorizer?.claims?.orgId || "test-org";
    const projectId = event.pathParameters?.projectId;

    if (!projectId) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PROJECT_ID")),
      );
    }

    // 1. Récupération des Master Data du Projet
    const projectResult = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.projectSK(projectId),
        }),
      }),
    );

    if (!projectResult.Item) {
      return toLambdaResponse(
        notFound(i18n.getMessage("ERROR_PROJECT_NOT_FOUND")),
      );
    }

    const project = ProjectSchema.parse(unmarshall(projectResult.Item));

    // 2. Query via GSI_PROJECT (Utilisation des clés GSI4PK validées)
    const linesResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: "GSI_PROJECT",
        KeyConditionExpression: "GSI4PK = :pk",
        ExpressionAttributeValues: {
          ":pk": { S: KeyFactory.gsi4PK(orgId, projectId) },
        },
      }),
    );

    const lines = (linesResult.Items || []).map((item) => unmarshall(item));

    // 3. Agrégation par compte (Emplois et Ressources)
    // Dans le TER SYCEBNL : Ressources = Crédit, Emplois = Débit
    let totalEmplois = 0; // Débit
    let totalRessources = 0; // Crédit

    const accountMap = new Map<
      string,
      { accountId: string; debit: number; credit: number; balance: number }
    >();

    for (const line of lines) {
      const debit = line.debit || 0;
      const credit = line.credit || 0;

      totalEmplois += debit;
      totalRessources += credit;

      const existing = accountMap.get(line.accountId) || {
        accountId: line.accountId,
        debit: 0,
        credit: 0,
        balance: 0,
      };

      existing.debit += debit;
      existing.credit += credit;
      existing.balance = existing.debit - existing.credit;
      accountMap.set(line.accountId, existing);
    }

    // 4. Construction du rapport final
    const report = {
      projectInfo: {
        id: project.projectId,
        code: project.projectCode,
        name: project.name,
        donor: project.donorId,
        currency: project.currency,
      },
      terSummary: {
        totalEmplois, // Ce qui a été dépensé/investi
        totalRessources, // Ce qui a été reçu/financé
        netPosition: totalRessources - totalEmplois, // Solde du projet
      },
      budgetExecution: {
        allocated: project.budget,
        consumed: totalEmplois,
        remaining: project.budget - totalEmplois,
        percentage:
          project.budget > 0 ? (totalEmplois / project.budget) * 100 : 0,
      },
      details: Array.from(accountMap.values()).sort((a, b) =>
        a.accountId.localeCompare(b.accountId),
      ),
      metadata: {
        linesProcessed: lines.length,
        generatedAt: new Date().toISOString(),
      },
    };

    return toLambdaResponse(
      ok(report, i18n.getMessage("SUCCESS_PROJECT_REPORT_RETRIEVED")),
    );
  } catch (error) {
    console.error("GetProjectReport Error:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
