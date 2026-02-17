import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  TransactWriteItemsCommand,
  GetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import {
  badRequest,
  created,
  toLambdaResponse,
  notFound,
} from "@/models/shared/api-response";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const orgId = event.requestContext.authorizer?.claims?.orgId;
    const userId = event.requestContext.authorizer?.claims?.userId;
    const year = parseInt(
      event.queryStringParameters?.year || new Date().getFullYear().toString()
    );

    // 1. Validation de l'exercice via KeyFactory
    const fyResult = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.fiscalYearSK(year),
        }),
      })
    );

    if (!fyResult.Item)
      return toLambdaResponse(
        notFound(i18n.getMessage("ERROR_FISCAL_YEAR_NOT_FOUND"))
      );

    const fiscalYear = unmarshall(fyResult.Item);
    if (fiscalYear.status !== "OPEN")
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_FISCAL_YEAR_LOCKED"))
      );

    // 2. Récupération des mouvements via GSI optimisé
    // On filtre directement par Année dans la SK du GSI pour éviter de scanner les autres années
    let rawMovements: any[] = [];
    let lastKey: any = undefined;
    do {
      const output = await dynamoClient.send(
        new QueryCommand({
          TableName: config.TABLE_NAME,
          IndexName: "GSI_ACCOUNT",
          KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
          ExpressionAttributeValues: marshall({
            ":pk": KeyFactory.gsi1PK(orgId),
            ":sk": `ACC#`, // On peut affiner ici si on veut, mais le filtre filter() ci-dessous assure la sécurité
          }),
          ExclusiveStartKey: lastKey,
        })
      );
      if (output.Items)
        rawMovements.push(...output.Items.map((i) => unmarshall(i)));
      lastKey = output.LastEvaluatedKey;
    } while (lastKey);

    // Filtrage strict sur l'année et les comptes de gestion (Classes 6 & 7)
    const movementsToClose = rawMovements.filter(
      (l) =>
        Number(l.year) === year &&
        (l.accountId.startsWith("6") || l.accountId.startsWith("7"))
    );

    // 3. Agrégat des soldes
    const accountBalances: Record<string, number> = {};
    movementsToClose.forEach((m) => {
      accountBalances[m.accountId] =
        (accountBalances[m.accountId] || 0) +
        (Number(m.debit) || 0) -
        (Number(m.credit) || 0);
    });

    // 4. Préparation des lignes de clôture
    const closingLines: any[] = [];
    let netResult = 0;

    for (const [accountId, balance] of Object.entries(accountBalances)) {
      if (balance === 0) continue;
      closingLines.push({
        accountId,
        debit: balance < 0 ? Math.abs(balance) : 0,
        credit: balance > 0 ? balance : 0,
      });
      netResult += balance;
    }

    if (closingLines.length === 0) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_NO_MOVEMENTS_FOUND"))
      );
    }

    // Détermination du compte de résultat OHADA (131 ou 139)
    const isProfit = netResult < 0;
    const resultAccountId = isProfit ? "13100000" : "13900000";

    closingLines.push({
      accountId: resultAccountId,
      debit: isProfit ? Math.abs(netResult) : 0,
      credit: isProfit ? 0 : Math.abs(netResult),
    });

    const totalEntryDebit = closingLines.reduce((sum, l) => sum + l.debit, 0);

    // 5. Exécution de la transaction de clôture
    const entryId = `YEC-${year}`;
    const entryDate = `${year}-12-31`;
    const transactItems: any[] = [];

    // Header de l'écriture de clôture
    transactItems.push({
      Put: {
        TableName: config.TABLE_NAME,
        Item: marshall({
          PK: KeyFactory.partitionKey(orgId, year),
          SK: KeyFactory.entrySK(entryId),
          entityType: "ENTRY",
          entryId,
          entryDate,
          year,
          journalCode: "OD",
          description: `Year-end closing ${year}`,
          status: "POSTED",
          totalDebit: totalEntryDebit,
          totalCredit: totalEntryDebit,
          createdBy: userId,
          createdAt: new Date().toISOString(),
        }),
      },
    });

    // Lignes de l'écriture
    closingLines.forEach((l, idx) => {
      const lineId = `${entryId}-L${idx}`;
      transactItems.push({
        Put: {
          TableName: config.TABLE_NAME,
          Item: marshall({
            PK: KeyFactory.partitionKey(orgId, year),
            SK: KeyFactory.entryLineSK(lineId),
            GSI1PK: KeyFactory.gsi1PK(orgId),
            GSI1SK: KeyFactory.gsi1SK(l.accountId, year, entryDate, lineId),
            entityType: "ENTRY_LINE",
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            year,
            entryDate,
            entryId,
            orgId,
          }),
        },
      });
    });

    // Verrouillage définitif de l'exercice
    transactItems.push({
      Update: {
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.fiscalYearSK(year),
        }),
        UpdateExpression: "SET #st = :s, updatedAt = :now",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: marshall({
          ":s": "CLOSED",
          ":now": new Date().toISOString(),
        }),
      },
    });

    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: transactItems })
    );

    return toLambdaResponse(
      created(
        {
          entryId,
          netResult: Math.abs(netResult),
          totalDebit: totalEntryDebit,
          isProfit,
        },
        i18n.getMessage("SUCCESS_YEAR_END_CLOSED")
      )
    );
  } catch (error) {
    console.error("Closing Error:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
