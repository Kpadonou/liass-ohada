import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory } from "../lambda/shared/key-builder";

interface CabinetAdminRepairEntry {
  cabinetOrgId: string;
  cabinetId: string;
  ownerUserId: string;
}

const tableName = process.env.TABLE_NAME;
const region = process.env.AWS_REGION || "eu-west-3";
const manifestJson = process.env.CABINET_ADMIN_REPAIR_MANIFEST;
const dryRun = process.env.DRY_RUN !== "false";

if (!tableName) throw new Error("TABLE_NAME is required.");
if (!manifestJson) {
  throw new Error(
    "CABINET_ADMIN_REPAIR_MANIFEST is required. Provide explicit cabinetOrgId, cabinetId, and ownerUserId entries.",
  );
}

const manifest = JSON.parse(manifestJson) as CabinetAdminRepairEntry[];
const client = new DynamoDBClient({ region });

async function getItem(PK: string, SK: string) {
  const result = await client.send(
    new GetItemCommand({
      TableName: tableName,
      Key: { PK: { S: PK }, SK: { S: SK } },
      ConsistentRead: true,
    }),
  );
  return result.Item ? unmarshall(result.Item) : undefined;
}

async function run(): Promise<void> {
  for (const entry of manifest) {
    const organization = await getItem(
      KeyFactory.orgKey(entry.cabinetOrgId),
      KeyFactory.organizationSK(),
    );
    const cabinet = await getItem(
      KeyFactory.cabinetPK(entry.cabinetId),
      KeyFactory.cabinetMetadataSK(),
    );
    const access = await getItem(
      KeyFactory.orgKey(entry.cabinetOrgId),
      KeyFactory.orgUserAccessSK(entry.ownerUserId),
    );

    if (
      organization?.workspaceType !== "ACCOUNTING_FIRM" ||
      organization?.orgId !== entry.cabinetOrgId ||
      cabinet?.orgId !== entry.cabinetOrgId ||
      cabinet?.cabinetId !== entry.cabinetId ||
      cabinet?.ownerUserId !== entry.ownerUserId ||
      access?.entityType !== "USER_ORG_ACCESS" ||
      access?.userId !== entry.ownerUserId ||
      access?.orgId !== entry.cabinetOrgId
    ) {
      console.warn(
        `Skipped ambiguous Cabinet ${entry.cabinetOrgId}; manifest ownership could not be verified.`,
      );
      continue;
    }
    if (access.cabinetRole) {
      console.info(
        `Skipped ${entry.cabinetOrgId}; role is already ${access.cabinetRole}.`,
      );
      continue;
    }
    if (dryRun) {
      console.info(
        `Dry run: would assign CABINET_ADMIN to ${entry.ownerUserId} for ${entry.cabinetOrgId}.`,
      );
      continue;
    }

    const now = new Date().toISOString();
    await client.send(
      new UpdateItemCommand({
        TableName: tableName,
        Key: {
          PK: { S: KeyFactory.orgKey(entry.cabinetOrgId) },
          SK: { S: KeyFactory.orgUserAccessSK(entry.ownerUserId) },
        },
        ConditionExpression:
          "entityType = :entityType AND orgId = :orgId AND userId = :userId AND attribute_not_exists(cabinetRole)",
        UpdateExpression:
          "SET cabinetRole = :role, updatedAt = :now, updatedBy = :userId",
        ExpressionAttributeValues: {
          ":entityType": { S: "USER_ORG_ACCESS" },
          ":orgId": { S: entry.cabinetOrgId },
          ":userId": { S: entry.ownerUserId },
          ":role": { S: "CABINET_ADMIN" },
          ":now": { S: now },
        },
      }),
    );
    console.info(
      `Assigned CABINET_ADMIN to ${entry.ownerUserId} for ${entry.cabinetOrgId}.`,
    );
  }
}

run().catch((error) => {
  console.error("Cabinet administrator repair failed.", error);
  process.exitCode = 1;
});
