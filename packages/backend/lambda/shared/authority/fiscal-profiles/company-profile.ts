import { randomUUID } from "node:crypto";
import {
  GetItemCommand,
  TransactWriteItemsCommand,
  type TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { AppError } from "../../app-error";
import { config, dynamoClient } from "../../dynamo-client";
import { KeyFactory } from "../../key-builder";
import { resolveFiscalProfile } from "./profile";

const selection = z.object({ regime: z.string(), revision: z.uuid() }).strict();

function organizationKey(orgId: string) {
  return marshall({
    PK: KeyFactory.orgKey(orgId),
    SK: KeyFactory.organizationSK(),
  });
}

export async function readCompanyFiscalProfile(orgId: string) {
  const { Item } = await dynamoClient.send(
    new GetItemCommand({
      TableName: config.PLATFORM_TABLE_NAME,
      Key: organizationKey(orgId),
      ConsistentRead: true,
    }),
  );
  if (!Item) return undefined;
  const row = unmarshall(Item);
  if (
    row.entityType !== "ORGANIZATION" ||
    row.orgId !== orgId ||
    row.status !== "ACTIVE" ||
    row.workspaceType !== "COMPANY"
  )
    return undefined;
  const selected =
    row.fiscalRegime === undefined
      ? undefined
      : selection.parse(row.fiscalRegime);
  const condition = {
    TableName: config.PLATFORM_TABLE_NAME,
    Key: organizationKey(orgId),
    ConditionExpression:
      "entityType = :type AND orgId = :org AND #status = :active AND workspaceType = :company AND " +
      (row.country === undefined
        ? "attribute_not_exists(country)"
        : "country = :country") +
      (selected
        ? " AND fiscalRegime.revision = :revision AND fiscalRegime.regime = :regime"
        : " AND attribute_not_exists(fiscalRegime)"),
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: marshall({
      ":type": "ORGANIZATION",
      ":org": orgId,
      ":active": "ACTIVE",
      ":company": "COMPANY",
      ...(row.country === undefined ? {} : { ":country": row.country }),
      ...(selected
        ? { ":revision": selected.revision, ":regime": selected.regime }
        : {}),
    }),
  };
  const profile =
    selected && resolveFiscalProfile(row.country, { regime: selected.regime });
  return {
    country: row.country as string | undefined,
    selected,
    profile,
    condition,
  };
}

export async function selectCompanyFiscalRegime(
  orgId: string,
  input: unknown,
  membership: TransactWriteItem,
) {
  const current = await readCompanyFiscalProfile(orgId);
  if (!current?.country) throw new AppError(400, "ERROR_INVALID_INPUT");
  let profile: ReturnType<typeof resolveFiscalProfile>;
  try {
    profile = resolveFiscalProfile(current.country, input);
  } catch {
    throw new AppError(400, "ERROR_INVALID_INPUT");
  }
  const selected = { regime: profile.rule.id, revision: randomUUID() };
  try {
    await dynamoClient.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          membership,
          {
            Update: {
              ...current.condition,
              UpdateExpression: "SET fiscalRegime = :selected",
              ExpressionAttributeValues: {
                ...current.condition.ExpressionAttributeValues,
                ...marshall({ ":selected": selected }),
              },
            },
          },
        ],
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.name === "TransactionCanceledException")
      throw new AppError(409, "PLATFORM_FISCAL_CONFLICT");
    throw error;
  }
  return { ...profile, revision: selected.revision };
}
