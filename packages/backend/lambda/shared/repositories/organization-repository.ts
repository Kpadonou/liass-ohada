import { GetItemCommand, TransactWriteItem } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { Organization, OrganizationSchema } from "@liass-ohada/shared";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";

export class OrganizationRepository {
  static async getOrganization(orgId: string): Promise<Organization | null> {
    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(orgId) },
          SK: { S: KeyFactory.organizationSK() },
        },
        ConsistentRead: true,
      }),
    );

    if (!response.Item) {
      return null;
    }

    const item = unmarshall(response.Item);
    if (item.entityType !== "ORGANIZATION" || item.orgId !== orgId) {
      return null;
    }

    const organization = OrganizationSchema.safeParse({
      orgId: item.orgId,
      name: item.name,
      country: item.country,
      accountingFramework: item.accountingFramework,
      workspaceType: item.workspaceType,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
    return organization.success ? organization.data : null;
  }

  static buildActiveCompanyCondition(orgId: string): TransactWriteItem {
    return {
      ConditionCheck: {
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(orgId) },
          SK: { S: KeyFactory.organizationSK() },
        },
        ConditionExpression:
          "entityType = :entityType AND orgId = :orgId AND workspaceType = :workspaceType AND #status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":entityType": { S: "ORGANIZATION" },
          ":orgId": { S: orgId },
          ":workspaceType": { S: "COMPANY" },
          ":status": { S: "ACTIVE" },
        },
      },
    };
  }
}
