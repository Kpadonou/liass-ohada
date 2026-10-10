import {
  DynamoDBClient,
  QueryCommand,
  BatchGetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { OnboardingRepository } from "@/lambda/shared/repositories/onboarding-repository";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { WorkspaceSummarySchema } from "@liass-ohada/shared";
import { restaurantsPermissionsForRole } from "@liass-ohada/shared/shared";
const db = mockClient(DynamoDBClient);
beforeEach(() => db.reset());
afterAll(() => db.restore());
test.each(["OWNER", "MANAGER", "WAITER", "CASHIER", "KITCHEN"])(
  "projects explicit RESTAURANTS %s without granting from global OWNER",
  async (role) => {
    db.on(QueryCommand).resolves({
      Items: [
        marshall({
          entityType: "USER_ORG_ACCESS",
          userId: "user",
          orgId: "org",
          status: "ACTIVE",
          role: "OWNER",
          workspaceType: "COMPANY",
          accessSource: "DIRECT",
          productRoles: { RESTAURANTS: role },
        }),
      ],
    });
    db.on(BatchGetItemCommand).resolves({
      Responses: {
        [config.TABLE_NAME]: [
          marshall({
            entityType: "ORGANIZATION",
            orgId: "org",
            name: "Demo",
            status: "ACTIVE",
            workspaceType: "COMPANY",
          }),
        ],
      },
    });
    const rows = await OnboardingRepository.listActiveUserWorkspaces("user");
    expect(rows[0].productRoles).toEqual({ RESTAURANTS: role });
    expect(WorkspaceSummarySchema.parse(rows[0])).not.toHaveProperty("PK");
    expect(db.commandCalls(QueryCommand)[0].args[0].input.IndexName).toBe(
      config.GSI6,
    );
    expect(
      db.commandCalls(BatchGetItemCommand)[0].args[0].input.RequestItems?.[
        config.TABLE_NAME
      ].Keys?.[0],
    ).toEqual({
      PK: { S: KeyFactory.orgKey("org") },
      SK: { S: KeyFactory.organizationSK() },
    });
    expect(
      restaurantsPermissionsForRole(role).includes("RESTAURANTS_SETUP_MANAGE"),
    ).toBe(["OWNER", "MANAGER"].includes(role));
  },
);
test.each([undefined, { RESTAURANTS: "ADMIN" }, { SALES: "OWNER" }])(
  "invalid or absent restaurant role preserves workspace without granting",
  async (productRoles) => {
    db.on(QueryCommand).resolves({
      Items: [
        marshall(
          {
            entityType: "USER_ORG_ACCESS",
            userId: "user",
            orgId: "org",
            status: "ACTIVE",
            role: "OWNER",
            workspaceType: "COMPANY",
            productRoles,
          },
          { removeUndefinedValues: true },
        ),
      ],
    });
    db.on(BatchGetItemCommand).resolves({});
    const rows = await OnboardingRepository.listActiveUserWorkspaces("user");
    expect(rows).toHaveLength(1);
    expect(rows[0].productRoles).toBeUndefined();
    expect(
      restaurantsPermissionsForRole(rows[0].productRoles?.RESTAURANTS),
    ).toEqual([]);
  },
);
