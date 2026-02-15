import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "../../../shared/dynamo-client";
import { config } from "../../../shared/config";
import { KeyFactory } from "../../../shared/key-builder";
import { I18nResolver } from "../../../shared/i18n";
import {
  ok,
  notFound,
  toLambdaResponse,
} from "../../../../models/shared/api-response";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);
  const orgId = event.requestContext?.authorizer?.claims?.orgId;
  const year = event.queryStringParameters?.year;

  if (!year)
    return toLambdaResponse(
      notFound(i18n.getMessage("ERROR_MISSING_PARAMETERS"))
    );

  // 1. Récupérer l'état de l'année (OPEN/CLOSED)
  const fyRes = await dynamoClient.send(
    new GetItemCommand({
      TableName: config.TABLE_NAME,
      Key: marshall({
        PK: KeyFactory.orgKey(orgId),
        SK: KeyFactory.fiscalYearSK(year),
      }),
    })
  );

  if (!fyRes.Item)
    return toLambdaResponse(
      notFound(i18n.getMessage("ERROR_FISCAL_YEAR_NOT_FOUND"))
    );

  // 2. Récupérer tous les verrous de période pour cette année
  const locksRes = await dynamoClient.send(
    new QueryCommand({
      TableName: config.TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: marshall({
        ":pk": KeyFactory.partitionKey(orgId, parseInt(year)),
        ":sk": "LOCK#PERIOD#",
      }),
    })
  );

  const locks = (locksRes.Items || []).map((i) => unmarshall(i));

  // On formate une réponse simple pour le Frontend
  const response = {
    ...unmarshall(fyRes.Item),
    periodLocks: locks.reduce((acc, lock) => {
      // Extraction sécurisée : soit l'attribut month,
      // soit les deux derniers caractères de la SK (LOCK#PERIOD#02 -> 02)
      const monthKey = lock.month || lock.SK.split("#").pop();
      acc[monthKey] = lock.status;
      return acc;
    }, {} as Record<string, string>),
  };

  return toLambdaResponse(
    ok(response, i18n.getMessage("SUCCESS_FISCAL_YEAR_DETAILS_RETRIEVED"))
  );
};
