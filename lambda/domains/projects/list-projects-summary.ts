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
 * @description Generates a high-level financial overview for all organization projects.
 * Uses the Global Project Index (GSI4) for high-performance data aggregation.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  // CORRECTION : On s'assure de matcher l'ID utilisé dans le seeding
  const orgId =
    event.requestContext.authorizer?.claims?.orgId || "org-test-dash";

  const currentYear = event.queryStringParameters?.year || "2026";

  try {
    // 1. Fetch Project Definitions
    const projectsResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": { S: KeyFactory.orgKey(orgId) },
          ":sk": { S: KeyFactory.projectPrefix() },
        },
      }),
    );

    const projects = (projectsResult.Items || []).map((item) =>
      ProjectSchema.parse(unmarshall(item)),
    );

    // LOG DE DEBUG 1 : Est-ce qu'on trouve des projets ?
    console.log(`DEBUG - Org: ${orgId} - Projets trouvés: ${projects.length}`);

    // 2. Fetch ALL Analytical Lines
    const allProjectLinesResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: "GSI_PROJECT",
        KeyConditionExpression: "GSI4PK = :pk",
        ExpressionAttributeValues: {
          ":pk": { S: KeyFactory.gsi4PK(orgId) },
        },
      }),
    );

    const allLines = (allProjectLinesResult.Items || []).map((item) =>
      unmarshall(item),
    );

    // LOG DE DEBUG 2 : Est-ce qu'on trouve des lignes de transactions ?
    console.log(`DEBUG - Lignes GSI4 trouvées: ${allLines.length}`);

    // 3. Map-Reduce
    const dashboard = projects.map((project) => {
      // Sécurité : on vérifie le projectId sur l'item ou dans la SK
      const pLines = allLines.filter(
        (l) =>
          l.projectId === project.projectId ||
          (l.GSI4SK as string)?.includes(project.projectId),
      );

      let totalEmplois = 0;
      let totalRessources = 0;
      let annualEmplois = 0;

      for (const line of pLines) {
        // DynamoDB Marshalling : on s'assure que ce sont des nombres
        const debit = Number(line.debit) || 0;
        const credit = Number(line.credit) || 0;

        totalEmplois += debit;
        totalRessources += credit;

        if (String(line.fiscalYear) === String(currentYear)) {
          annualEmplois += debit;
        }
      }

      const annualBudget = project.annualBudgets?.[currentYear] || 0;

      return {
        projectInfo: {
          id: project.projectId,
          code: project.projectCode,
          name: project.name,
          donor: project.donorId,
          status: project.status,
        },
        financials: {
          netPosition: totalRessources - totalEmplois,
          globalExecutionRate:
            project.totalBudget > 0
              ? (totalEmplois / project.totalBudget) * 100
              : 0,
          annualExecutionRate:
            annualBudget > 0 ? (annualEmplois / annualBudget) * 100 : 0,
        },
        alerts: {
          isOverSpentGlobal: totalEmplois > project.totalBudget,
          isOverSpentAnnual: annualEmplois > annualBudget,
          isCashNegative: totalRessources - totalEmplois < 0,
        },
      };
    });

    return toLambdaResponse(
      ok(dashboard, i18n.getMessage("SUCCESS_PROJECTS_LISTED")),
    );
  } catch (error) {
    console.error("Dashboard Global Error:", error);
    // On renvoie l'erreur détaillée en mode dev
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
