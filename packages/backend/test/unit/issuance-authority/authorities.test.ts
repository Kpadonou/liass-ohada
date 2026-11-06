import { dynamoClient } from "@/lambda/shared/dynamo-client";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { OrganizationLegalIdentityService as Legal } from "@/lambda/shared/services/organization-legal-identity-service";
import {
  SalesTimezoneService as Timezone,
  validateTimezone,
} from "@/lambda/domains/sales/authority/sales-timezone-service";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { legal, timezone, id } from "./fixtures";
import {
  canonical,
  hash,
  admission,
} from "@/lambda/shared/authority/integrity";
const mock = mockClient(DynamoDBClient);
const records = new Map<string, Record<string, unknown>>();
const key = (o: Record<string, unknown>) => `${o.PK}|${o.SK}`;
beforeEach(() => {
  jest.restoreAllMocks();
  mock.reset();
  records.clear();
  jest.spyOn(TenantAccessService, "assertUserCanAccessOrg").mockResolvedValue({
    role: "OWNER",
    workspaceType: "COMPANY",
    accessSource: "DIRECT",
  } as Awaited<ReturnType<typeof TenantAccessService.assertUserCanAccessOrg>>);
  mock.on(GetItemCommand).callsFake((input) => ({
    Item: records.has(key(unmarshall(input.Key)))
      ? marshall(records.get(key(unmarshall(input.Key)))!)
      : undefined,
  }));
  mock.on(PutItemCommand).callsFake((input) => {
    const item = unmarshall(input.Item);
    if (records.has(key(item)))
      throw Object.assign(Error(), { name: "ConditionalCheckFailedException" });
    records.set(key(item), item);
    return {};
  });
  mock.on(TransactWriteItemsCommand).callsFake((input) => {
    const ops = input.TransactItems as Array<{
      ConditionCheck?: Record<string, any>;
      Put?: Record<string, any>;
    }>;
    const failed = ops.map((op) => {
      const v = op.ConditionCheck ?? op.Put!;
      const candidate = v.Item ? unmarshall(v.Item) : unmarshall(v.Key);
      const old = records.get(key(candidate));
      if (v.ConditionExpression.startsWith("attribute_not_exists"))
        return !!old;
      const values = v.ExpressionAttributeValues
        ? unmarshall(v.ExpressionAttributeValues)
        : {};
      return v.ConditionExpression.split(" AND ").some((clause: string) => {
        const [l, r] = clause.split(" = ");
        const field = v.ExpressionAttributeNames?.[l] ?? l;
        return !old || old[field] !== values[r];
      });
    });
    if (failed.some(Boolean))
      throw Object.assign(Error("simulated conditional failure"), {
        name: "TransactionCanceledException",
        CancellationReasons: failed.map((f) => ({
          Code: f ? "ConditionalCheckFailed" : "None",
        })),
      });
    for (const op of ops)
      if (op.Put) {
        const item = unmarshall(op.Put.Item);
        records.set(key(item), item);
      }
    return {};
  });
});
async function setupLegal() {
  await Legal.createRevision("org-123", "reviewer", legal());
  await Legal.activate("org-123", "reviewer", id, 0);
}
async function setupTimezone() {
  await Timezone.createRevision("org-123", "reviewer", timezone());
  await Timezone.activate("org-123", "reviewer", id, 0);
}
test("Platform creates append-only accepted revision, selects it with CAS, returns owner-built current check", async () => {
  await setupLegal();
  const r = await Legal.readSellerIssuanceAuthority("org-123");
  expect(r.sellerAuthority.seller.name).toBe("Synthetic seller");
  expect(r.check.ConditionCheck!.ConditionExpression).toContain("#f");
  expect(
    mock.commandCalls(TransactWriteItemsCommand)[0].args[0].input.TransactItems,
  ).toHaveLength(3);
  expect(
    mock
      .commandCalls(GetItemCommand)
      .every((c) => c.args[0].input.ConsistentRead),
  ).toBe(true);
  await Legal.createRevision("org-123", "reviewer", legal());
  const changed = legal();
  changed.seller.name = "Changed";
  await expect(
    Legal.createRevision("org-123", "reviewer", changed),
  ).rejects.toThrow();
  await expect(
    Legal.activate("org-123", "reviewer", id, 0),
  ).rejects.toMatchObject({ messageCode: "AUTHORITY_SELECTION_CONFLICT" });
});
test("revocation invalidates captured commit predicate and old approval cannot reactivate", async () => {
  await setupLegal();
  const r = await Legal.readSellerIssuanceAuthority("org-123");
  await Legal.disable("org-123", "reviewer", id, 1);
  await expect(Legal.readSellerIssuanceAuthority("org-123")).rejects.toThrow();
  await expect(
    Legal.activate("org-123", "reviewer", id, 2),
  ).rejects.toMatchObject({ messageCode: "AUTHORITY_NEW_ACCEPTANCE_REQUIRED" });
  await expect(
    dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: [r.check] }),
    ),
  ).rejects.toThrow();
});
test("missing authority, cross-org evidence and insufficient name/subject verification fail closed", async () => {
  await expect(Legal.readSellerIssuanceAuthority("org-123")).rejects.toThrow();
  await expect(
    Legal.createRevision("different-org", "reviewer", legal()),
  ).rejects.toThrow();
  const present = legal();
  present.factStates[0].state = "PRESENT" as never;
  await expect(
    Legal.createRevision("org-123", "reviewer", present),
  ).rejects.toThrow();
  await expect(
    Legal.createRevision("org-123", "reviewer", {
      ...legal(),
      subjectBindingState: "PRESENT",
    }),
  ).rejects.toThrow();
  const bad = legal();
  bad.evidenceArtifacts[0].bytes += "tampered";
  await expect(
    Legal.createRevision("org-123", "reviewer", bad),
  ).rejects.toThrow();
  expect(mock.commandCalls(PutItemCommand)).toHaveLength(0);
});
test("wrong stored org and unapproved selection never resolve via Organization.name", async () => {
  await setupLegal();
  const pk = KeyFactory.orgKey("org-123");
  const pointer = records.get(
    `${pk}|${KeyFactory.organizationLegalIdentityCurrentSK()}`,
  )!;
  pointer.orgId = "different-org";
  await expect(Legal.readSellerIssuanceAuthority("org-123")).rejects.toThrow();
  expect(
    mock
      .commandCalls(GetItemCommand)
      .every(
        (c) =>
          unmarshall(c.args[0].input.Key!).SK !== KeyFactory.organizationSK(),
      ),
  ).toBe(true);
});
test("only an authenticated owning review boundary may create evidence", async () => {
  jest
    .mocked(TenantAccessService.assertUserCanAccessOrg)
    .mockResolvedValue({ role: "MEMBER", workspaceType: "COMPANY" } as never);
  await expect(
    Legal.createRevision("org-123", "reviewer", legal()),
  ).rejects.toMatchObject({ messageCode: "AUTHORITY_REVIEW_NOT_AUTHORIZED" });
});
test("SALES timezone revision and pointer are immutable/versioned and commit checked", async () => {
  await setupTimezone();
  const before = await Timezone.readIssuanceAuthority("org-123");
  expect(before.timezoneAuthority.timezone).toBe("Africa/Porto-Novo");
  await Timezone.disable("org-123", "reviewer", id, 1);
  await expect(Timezone.readIssuanceAuthority("org-123")).rejects.toThrow();
  await expect(
    dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: [before.check] }),
    ),
  ).rejects.toThrow();
  expect(before.timezoneAuthority.timezone).toBe("Africa/Porto-Novo");
});
test.each([undefined, "Invalid/Timezone", "", "UTC-fallback"])(
  "timezone %s is rejected without inference",
  (zone) => {
    expect(() =>
      validateTimezone({ ...timezone(), timezone: zone }, "org-123"),
    ).toThrow();
  },
);
test("timezone missing, unapproved/tampered evidence, wrong registry/tenant reject", async () => {
  await expect(Timezone.readIssuanceAuthority("org-123")).rejects.toThrow();
  for (const input of [
    { ...timezone(), tzdbArtifactDigest: "a".repeat(64) },
    { ...timezone(), orgId: "other" },
    { ...timezone(), evidenceArtifacts: [] },
  ])
    expect(() => validateTimezone(input, "org-123")).toThrow();
});
test.each([4096, 16384, 131072, 135168, 358400])(
  "serialized cap %i is inclusive and one unit over rejects",
  (cap) => {
    // For an ASCII value the marshalled JSON representation is known independently.
    const overhead = Buffer.byteLength(JSON.stringify(marshall({ value: "" })));
    const at = { value: "x".repeat(cap - overhead) };
    expect(() => admission(at, cap)).not.toThrow();
    expect(() => admission({ value: at.value + "x" }, cap)).toThrow();
  },
);
