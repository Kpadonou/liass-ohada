import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory } from "../../../shared/key-builder";
import { dynamoClient } from "../../../shared/dynamo-client";
import { config } from "../../../shared/config";
import { I18nResolver } from "../../../shared/i18n";
import {
  toLambdaResponse,
  ok,
  badRequest,
} from "../../../../models/shared/api-response";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const { orgId, year, lines, letteringCode } = JSON.parse(
      event.body || "{}"
    );

    if (!lines || lines.length < 2) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_LETTERING_INSUFFICIENT_LINES"))
      );
    }

    // 1. Validation de la cohérence (Même compte et même Tiers)
    const firstLine = lines[0];
    const isConsistent = lines.every(
      (l: any) =>
        l.accountId === firstLine.accountId &&
        l.thirdPartyId === firstLine.thirdPartyId
    );

    if (!isConsistent) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_LETTERING_INCONSISTENT_LINES"))
      );
    }

    // 2. Calcul du solde pour déterminer si c'est partiel ou complet
    const balance = lines.reduce(
      (acc: number, l: any) =>
        acc + (Number(l.debit) || 0) - (Number(l.credit) || 0),
      0
    );

    // Règle : Si solde = 0 => MAJUSCULES, sinon => minuscules
    const finalCode =
      balance === 0 ? letteringCode.toUpperCase() : letteringCode.toLowerCase();
    const letteringStatus = balance === 0 ? "COMPLETE" : "PARTIAL";

    // 3. Transaction Update
    const transactItems = lines.map((l: any) => ({
      Update: {
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.partitionKey(orgId, year),
          SK: KeyFactory.entryLineSK(l.lineId),
        }),
        UpdateExpression:
          "SET letteringCode = :code, letteringStatus = :status, updatedAt = :now",
        ExpressionAttributeValues: marshall({
          ":code": finalCode,
          ":status": letteringStatus,
          ":now": new Date().toISOString(),
        }),
      },
    }));

    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: transactItems })
    );

    return toLambdaResponse(
      ok(
        {
          letteringCode: finalCode,
          letteringStatus,
          remainingBalance: Math.abs(balance),
        },
        letteringStatus === "COMPLETE"
          ? i18n.getMessage("SUCCESS_LETTERING_COMPLETED")
          : i18n.getMessage("SUCCESS_LETTERING_PARTIAL")
      )
    );
  } catch (error) {
    console.error("Lettering Error:", error);
    return toLambdaResponse(
      badRequest(i18n.getMessage("ERROR_LETTERING_TECHNICAL"))
    );
  }
};
