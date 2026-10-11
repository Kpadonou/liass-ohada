import {
  AttributeValue,
  DynamoDBClient,
  DescribeTableCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { createHash, randomUUID } from "node:crypto";
import { KeyFactory as K } from "../../lambda/shared/key-builder";
import { DeploymentStage } from "../../lib/config/deployment";

type Item = Record<string, AttributeValue>;
export interface RelinkOptions {
  oldUserId: string;
  newUserId: string;
  email: string;
  stage: DeploymentStage;
  tableName: string;
  userPoolId: string;
  region: string;
  apply: boolean;
  maintenanceConfirmed: boolean;
  productionAcknowledgement?: string;
}
export interface RelinkClients {
  dynamo: Pick<DynamoDBClient, "send">;
  cognito: Pick<CognitoIdentityProviderClient, "send">;
}
function fail(code: string): never {
  throw new Error(code);
}
const normalize = (email: string) => email.trim().toLowerCase();
const key = (item: Item): Item => ({ PK: item.PK, SK: item.SK });
const identity = (item: Item) => JSON.stringify(key(item));
const changed = (item: Item, values: Record<string, string>): Item => ({
  ...item,
  ...marshall(values),
});
const str = (item: Item, name: string): string =>
  item[name]?.S ?? fail(`INVALID_${name}`);

// Every observed attribute is compared, including metadata, roles and timestamps.
// Maintenance is still required: conditions cannot lock rows not yet in the read set.
function snapshot(item: Item) {
  const entries = Object.entries(item);
  return {
    ConditionExpression: entries.map((_, i) => `#a${i} = :v${i}`).join(" AND "),
    ExpressionAttributeNames: Object.fromEntries(
      entries.map(([name], i) => [`#a${i}`, name]),
    ),
    ExpressionAttributeValues: Object.fromEntries(
      entries.map(([, value], i) => [`:v${i}`, value]),
    ),
  };
}

export async function verifyCognito(
  options: RelinkOptions,
  clients: RelinkClients,
): Promise<void> {
  // Federated users have provider-prefixed usernames; resolve by explicit sub,
  // then perform authoritative AdminGetUser and compare the returned sub again.
  const users: string[] = [];
  let token: string | undefined;
  do {
    const page = await clients.cognito.send(
      new ListUsersCommand({
        UserPoolId: options.userPoolId,
        Filter: `sub = "${options.newUserId}"`,
        PaginationToken: token,
      }),
    );
    for (const user of page.Users ?? [])
      if (user.Username) users.push(user.Username);
    token = page.PaginationToken;
  } while (token);
  if (users.length !== 1) fail("NEW_COGNITO_IDENTITY_NOT_UNIQUE_OR_MISSING");
  const user = await clients.cognito.send(
    new AdminGetUserCommand({
      UserPoolId: options.userPoolId,
      Username: users[0],
    }),
  );
  const attributes = Object.fromEntries(
    (user.UserAttributes ?? []).map((a) => [a.Name, a.Value]),
  );
  if (attributes.sub !== options.newUserId || user.Enabled !== true)
    fail("NEW_COGNITO_IDENTITY_INVALID");
  if (attributes.email_verified !== "true")
    fail("NEW_COGNITO_EMAIL_NOT_VERIFIED");
  if (
    !attributes.email ||
    normalize(attributes.email) !== normalize(options.email)
  )
    fail("NEW_COGNITO_EMAIL_MISMATCH");
}

export function planRelink(options: RelinkOptions, items: Item[]) {
  const { oldUserId: oldId, newUserId: newId } = options;
  if (oldId === newId) fail("IDENTITIES_MUST_DIFFER");
  const email = normalize(options.email);
  const find = (pk: string, sk: string) =>
    items.find((i) => i.PK?.S === pk && i.SK?.S === sk);
  const profile = find(K.userProfilePK(oldId), K.userProfileSK());
  if (
    !profile ||
    profile.entityType?.S !== "USER_PROFILE" ||
    profile.userId?.S !== oldId
  )
    fail("OLD_PROFILE_NOT_FOUND_OR_ALREADY_RELINKED");
  if (
    profile.normalizedEmail?.S !== email ||
    normalize(str(profile, "email")) !== email ||
    profile.emailVerified?.BOOL !== true
  )
    fail("OLD_PROFILE_EMAIL_MISMATCH");
  for (const field of [
    "displayName",
    "createdAt",
    "updatedAt",
    "lastSyncedFromIdentityAt",
  ])
    str(profile, field);
  const lookup = find(K.userEmailLookupPK(email), K.userEmailLookupSK());
  if (
    !lookup ||
    lookup.entityType?.S !== "USER_EMAIL_LOOKUP" ||
    lookup.userId?.S !== oldId ||
    lookup.normalizedEmail?.S !== email
  )
    fail("EMAIL_OWNERSHIP_CHANGED");
  // Reject any new active identity state, not just memberships visible in GSI6.
  for (const i of items) {
    if (
      i.PK?.S === K.userProfilePK(newId) ||
      i.SK?.S === K.orgUserAccessSK(newId) ||
      i.GSI6PK?.S === K.userWorkspacesPK(newId) ||
      Object.entries(i).some(
        ([name, value]) =>
          /^(PK|SK|GSI\d+(PK|SK))$/.test(name) && value.S?.includes(newId),
      ) ||
      ["userId", "ownerUserId", "responsibleUserId"].some(
        (f) => i[f]?.S === newId,
      )
    )
      fail("NEW_APPLICATION_IDENTITY_OCCUPIED");
  }
  const writes: TransactWriteItem[] = [];
  const entities: Record<string, number> = {};
  const memberships: Record<string, unknown>[] = [];
  const historicalReferencesPreserved: Record<string, number> = {};
  const domainHistoricalFields: Record<string, string[]> = {
    SALES_INVOICE: ["issuedByUserId"],
    SALES_CREDIT_NOTE: ["issuedByUserId"],
    SALES_PAYMENT: ["recordedByUserId"],
    SALES_INVOICE_DOCUMENT: ["generatedByUserId"],
    SALES_CREDIT_NOTE_DOCUMENT: ["generatedByUserId"],
  };
  let creates = 0,
    deletes = 0,
    updates = 0;
  const affectedImages: Item[] = [];
  const destinations = new Set<string>();
  const historicalFields = new Set([
    "createdBy",
    "updatedBy",
    "invitedBy",
    "assignedBy",
    "acceptedByUserId",
    "cancelledBy",
    "canceledBy",
    "createdByUserId",
    "updatedByUserId",
    "actorUserId",
    "issuedBy",
    "postedBy",
    "validatedBy",
    "closedBy",
    "reopenedBy",
  ]);
  for (const item of items) {
    const type = item.entityType?.S;
    let next = item;
    if (item === profile)
      next = changed(item, { PK: K.userProfilePK(newId), userId: newId });
    else if (item === lookup) next = changed(item, { userId: newId });
    else if (type === "USER_ORG_ACCESS" && item.userId?.S === oldId) {
      const orgId = str(item, "orgId"),
        status = str(item, "status");
      if (
        item.PK?.S !== K.orgKey(orgId) ||
        item.SK?.S !== K.orgUserAccessSK(oldId)
      )
        fail("INVALID_ACCESS_KEYS");
      next = changed(item, {
        SK: K.orgUserAccessSK(newId),
        userId: newId,
        GSI6PK: K.userWorkspacesPK(newId),
        GSI6SK: K.userWorkspaceSK(status, orgId),
      });
      const value = unmarshall(item);
      memberships.push({
        orgId,
        status,
        role: value.role,
        cabinetId: value.cabinetId,
        workspaceType: value.workspaceType,
        productRoles: value.productRoles,
      });
    } else if (type === "INITIAL_WORKSPACE_LOCK" && item.userId?.S === oldId) {
      if (
        item.PK?.S !== K.userWorkspacesPK(oldId) ||
        item.SK?.S !== K.initialWorkspaceLockSK()
      )
        fail("INVALID_ONBOARDING_LOCK_KEYS");
      next = changed(item, { PK: K.userWorkspacesPK(newId), userId: newId });
    } else if (
      type === "CABINET_DOSSIER_ASSIGNMENT" &&
      item.userId?.S === oldId
    ) {
      const cabinet = str(item, "cabinetOrgId"),
        dossier = str(item, "dossierOrgId");
      if (
        item.PK?.S !== K.cabinetPK(cabinet) ||
        item.SK?.S !== K.cabinetMemberDossierAssignmentSK(oldId, dossier)
      )
        fail("INVALID_ASSIGNMENT_KEYS");
      next = changed(item, {
        SK: K.cabinetMemberDossierAssignmentSK(newId, dossier),
        userId: newId,
        GSI1PK: K.cabinetDossierAssignmentsGSI_PK(cabinet, dossier),
        GSI1SK: K.cabinetDossierAssignmentsGSI_SK(newId),
      });
    } else if (
      ["ORGANIZATION", "CABINET"].includes(type ?? "") &&
      item.ownerUserId?.S === oldId
    ) {
      const pk =
        type === "ORGANIZATION"
          ? K.orgKey(str(item, "orgId"))
          : K.cabinetPK(str(item, "cabinetId"));
      const sk =
        type === "ORGANIZATION" ? K.organizationSK() : K.cabinetMetadataSK();
      if (item.PK?.S !== pk || item.SK?.S !== sk) fail("INVALID_OWNER_KEYS");
      next = changed(item, { ownerUserId: newId });
    } else if (
      ["ACCOUNTING_WORK", "CABINET_DEADLINE"].includes(type ?? "") &&
      item.responsibleUserId?.S === oldId
    ) {
      const cabinet = str(item, "cabinetOrgId");
      const sk =
        type === "ACCOUNTING_WORK"
          ? K.cabinetWorkSK(str(item, "workId"))
          : K.cabinetDeadlineSK(str(item, "deadlineId"));
      if (item.PK?.S !== K.cabinetPK(cabinet) || item.SK?.S !== sk)
        fail("INVALID_RESPONSIBILITY_KEYS");
      next = changed(item, {
        responsibleUserId: newId,
        GSI3PK:
          type === "ACCOUNTING_WORK"
            ? K.cabinetResponsibleWorksGSI_PK(cabinet, newId)
            : K.cabinetResponsibleDeadlinesGSI_PK(cabinet, newId),
        GSI3SK:
          type === "ACCOUNTING_WORK"
            ? K.cabinetWorkGSI_SK(item.dueDate?.S, str(item, "workId"))
            : K.cabinetDeadlineGSI_SK(
                str(item, "dueDate"),
                str(item, "deadlineId"),
              ),
      });
    }
    // Fail closed on unsupported identity key material or active references.
    // Historical actor attributes are deliberately left intact.
    for (const [name, value] of Object.entries(next)) {
      if (
        historicalFields.has(name) ||
        domainHistoricalFields[type ?? ""]?.includes(name)
      ) {
        if (value.S === oldId) {
          const reference = `${type}.${name}`;
          historicalReferencesPreserved[reference] =
            (historicalReferencesPreserved[reference] ?? 0) + 1;
        }
        continue;
      }
      if (
        value.S &&
        (value.S === oldId ||
          (/^(PK|SK|GSI\d+(PK|SK))$/.test(name) && value.S.includes(oldId)))
      )
        fail(`UNSUPPORTED_OLD_IDENTITY_REFERENCE:${type}:${name}`);
    }
    if (next === item) continue;
    affectedImages.push(item, next);
    entities[type!] = (entities[type!] ?? 0) + 1;
    const moved = identity(next) !== identity(item);
    if (destinations.has(identity(next))) fail("DUPLICATE_DESTINATION");
    destinations.add(identity(next));
    if (moved) {
      if (items.some((i) => identity(i) === identity(next)))
        fail("DESTINATION_OCCUPIED");
      writes.push({
        Put: {
          TableName: options.tableName,
          Item: next,
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        },
      });
      writes.push({
        Delete: {
          TableName: options.tableName,
          Key: key(item),
          ...snapshot(item),
        },
      });
      creates++;
      deletes++;
    } else {
      // Update only identity fields; avoid overwriting a newly added unrelated field.
      const changes = Object.entries(next).filter(
        ([name, value]) => value !== item[name],
      );
      const condition = snapshot(item);
      const names = { ...condition.ExpressionAttributeNames };
      const values = { ...condition.ExpressionAttributeValues };
      changes.forEach(([name, value], index) => {
        names[`#c${index}`] = name;
        values[`:c${index}`] = value;
      });
      writes.push({
        Update: {
          TableName: options.tableName,
          Key: key(item),
          ...condition,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          UpdateExpression:
            "SET " +
            changes.map((_, index) => `#c${index} = :c${index}`).join(", "),
        },
      });
      updates++;
    }
  }
  // Conservative serialized upper bounds (including both images and expressions).
  // Reject well below DynamoDB's 4 MiB transaction and 400 KiB item limits.
  if (
    writes.length > 100 ||
    Buffer.byteLength(JSON.stringify(writes)) > 3_500_000 ||
    affectedImages.some((i) => Buffer.byteLength(JSON.stringify(i)) > 300_000)
  )
    fail("TRANSACTION_LIMIT_EXCEEDED_NO_WRITES");
  return {
    writes,
    report: {
      operation: "USER_IDENTITY_RELINK",
      mode: options.apply ? "APPLY" : "DRY_RUN",
      oldUserId: oldId,
      newUserId: newId,
      normalizedEmail: email,
      stage: options.stage,
      region: options.region,
      tableName: options.tableName,
      userPoolId: options.userPoolId,
      entities,
      creates,
      deletes,
      updates,
      memberships,
      historicalReferencesPreserved,
      transactionActions: writes.length,
      validations: "PASSED",
      validationDetails: {
        targetEnvironment: true,
        newCognitoIdentity: true,
        oldProfileEmail: true,
        newIdentityUnoccupied: true,
        emailOwnership: true,
        supportedKeys: true,
        transactionLimits: true,
      },
      safeToApply: options.maintenanceConfirmed,
      maintenanceRequired: true,
    },
  };
}

export async function relinkUserIdentity(
  options: RelinkOptions,
  clients: RelinkClients,
  emit: (report: unknown) => void = console.info,
) {
  if (
    options.oldUserId === options.newUserId ||
    ![options.oldUserId, options.newUserId].every((id) =>
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        id,
      ),
    )
  )
    fail("EXPLICIT_DISTINCT_COGNITO_SUBS_REQUIRED");
  if (!normalize(options.email).includes("@")) fail("EXPECTED_EMAIL_REQUIRED");
  const prefix = `liass-ohada-${options.stage}`;
  if (
    options.tableName !== `${prefix}-accounting-table` ||
    !options.userPoolId.startsWith(`${options.region}_`)
  )
    fail("TARGET_ENVIRONMENT_MISMATCH");
  if (options.apply && !options.maintenanceConfirmed)
    fail("IDENTITY_WRITERS_MUST_BE_PAUSED");
  if (
    options.apply &&
    options.stage === "prod" &&
    options.productionAcknowledgement !== options.tableName
  )
    fail("PRODUCTION_ACKNOWLEDGEMENT_REQUIRED");
  const table = await clients.dynamo.send(
    new DescribeTableCommand({ TableName: options.tableName }),
  );
  const pool = await clients.cognito.send(
    new DescribeUserPoolCommand({ UserPoolId: options.userPoolId }),
  );
  const tableArn = table.Table?.TableArn?.split(":"),
    poolArn = pool.UserPool?.Arn?.split(":");
  if (
    !tableArn ||
    !poolArn ||
    tableArn[4] !== poolArn[4] ||
    tableArn[3] !== options.region ||
    poolArn[3] !== options.region ||
    pool.UserPool?.Name !== `${prefix}-users`
  )
    fail("TARGET_ENVIRONMENT_MISMATCH");
  await verifyCognito(options, clients);
  const items: Item[] = [];
  let cursor: Item | undefined;
  do {
    const page = await clients.dynamo.send(
      new ScanCommand({
        TableName: options.tableName,
        ConsistentRead: true,
        ExclusiveStartKey: cursor,
      }),
    );
    items.push(...(page.Items ?? []));
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  const plan = planRelink(options, items);
  emit(plan.report);
  if (options.apply) {
    await verifyCognito(options, clients);
    await clients.dynamo.send(
      new TransactWriteItemsCommand({
        TransactItems: plan.writes,
        ClientRequestToken: randomUUID(),
      }),
    );
    emit({
      operation: "USER_IDENTITY_RELINK",
      outcome: "APPLIED",
      oldUserId: options.oldUserId,
      newUserId: options.newUserId,
      emailSha256: createHash("sha256")
        .update(normalize(options.email))
        .digest("hex"),
      timestamp: new Date().toISOString(),
      stage: options.stage,
      region: options.region,
      tableName: options.tableName,
      userPoolId: options.userPoolId,
      accountId: tableArn[4],
    });
  }
  return plan.report;
}
