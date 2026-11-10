import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { AppError } from "../app-error";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";

const key = (orgId: string) =>
  marshall({ PK: KeyFactory.orgKey(orgId), SK: KeyFactory.organizationSK() });

export async function assertFiscalOrganization(orgId: string) {
  const { Item } = await dynamoClient.send(new GetItemCommand({
    TableName: config.PLATFORM_TABLE_NAME, Key: key(orgId), ConsistentRead: true,
  }));
  const org = Item && unmarshall(Item);
  if (org?.entityType !== "ORGANIZATION" || org.orgId !== orgId ||
      org.status !== "ACTIVE" || org.workspaceType !== "COMPANY" || org.country !== "BJ")
    throw new AppError(403, "PLATFORM_FISCAL_FORBIDDEN");
}

export function fiscalOrganizationCheck(orgId: string) {
  return { ConditionCheck: {
    TableName: config.PLATFORM_TABLE_NAME,
    Key: key(orgId),
    ConditionExpression: "entityType = :type AND orgId = :org AND #status = :active AND workspaceType = :company AND country = :country",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: marshall({
      ":type": "ORGANIZATION", ":org": orgId, ":active": "ACTIVE", ":company": "COMPANY", ":country": "BJ",
    }),
  } };
}
