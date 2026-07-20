import {
  AttributeValue,
  BatchGetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";

export interface AccountingAuthorizationSnapshot {
  assignmentExists: boolean;
  dossier?: {
    cabinetId: string;
    orgId: string;
    relationship: string;
    status: string;
  };
  organization?: {
    accountingFramework?: string;
    orgId: string;
    status: string;
    workspaceType: string;
  };
}

function itemKey(item: Record<string, AttributeValue>): string | undefined {
  const PK = item.PK?.S;
  const SK = item.SK?.S;
  return PK && SK ? `${PK}|${SK}` : undefined;
}

export class AccountingAuthorizationRepository {
  static async getSnapshot(input: {
    cabinetId: string;
    cabinetOrgId: string;
    dossierOrgId: string;
    includeAssignment: boolean;
    userId: string;
  }): Promise<AccountingAuthorizationSnapshot> {
    const dossierKey = {
      PK: { S: KeyFactory.cabinetPK(input.cabinetId) },
      SK: { S: KeyFactory.cabinetDossierSK(input.dossierOrgId) },
    };
    const organizationKey = {
      PK: { S: KeyFactory.orgKey(input.dossierOrgId) },
      SK: { S: KeyFactory.organizationSK() },
    };
    const assignmentKey = {
      PK: { S: KeyFactory.cabinetPK(input.cabinetOrgId) },
      SK: {
        S: KeyFactory.cabinetMemberDossierAssignmentSK(
          input.userId,
          input.dossierOrgId,
        ),
      },
    };
    const keys = input.includeAssignment
      ? [dossierKey, organizationKey, assignmentKey]
      : [dossierKey, organizationKey];
    const response = await dynamoClient.send(
      new BatchGetItemCommand({
        RequestItems: {
          [config.TABLE_NAME]: {
            Keys: keys,
            ConsistentRead: true,
          },
        },
      }),
    );
    const items = new Map(
      (response.Responses?.[config.TABLE_NAME] ?? [])
        .map((item) => [itemKey(item), unmarshall(item)] as const)
        .filter(
          (entry): entry is [string, Record<string, unknown>] =>
            typeof entry[0] === "string",
        ),
    );
    const dossierValue = items.get(
      `${dossierKey.PK.S}|${dossierKey.SK.S}`,
    );
    const organizationValue = items.get(
      `${organizationKey.PK.S}|${organizationKey.SK.S}`,
    );
    const assignmentValue = items.get(
      `${assignmentKey.PK.S}|${assignmentKey.SK.S}`,
    );

    return {
      assignmentExists:
        assignmentValue?.entityType === "CABINET_DOSSIER_ASSIGNMENT" &&
        assignmentValue.cabinetOrgId === input.cabinetOrgId &&
        assignmentValue.userId === input.userId &&
        assignmentValue.dossierOrgId === input.dossierOrgId,
      dossier:
        dossierValue?.entityType === "CABINET_DOSSIER" &&
        typeof dossierValue.cabinetId === "string" &&
        typeof dossierValue.orgId === "string" &&
        typeof dossierValue.relationship === "string" &&
        typeof dossierValue.status === "string"
          ? {
              cabinetId: dossierValue.cabinetId,
              orgId: dossierValue.orgId,
              relationship: dossierValue.relationship,
              status: dossierValue.status,
            }
          : undefined,
      organization:
        organizationValue?.entityType === "ORGANIZATION" &&
        typeof organizationValue.orgId === "string" &&
        typeof organizationValue.status === "string" &&
        typeof organizationValue.workspaceType === "string"
          ? {
              accountingFramework:
                typeof organizationValue.accountingFramework === "string"
                  ? organizationValue.accountingFramework
                  : undefined,
              orgId: organizationValue.orgId,
              status: organizationValue.status,
              workspaceType: organizationValue.workspaceType,
            }
          : undefined,
    };
  }
}
