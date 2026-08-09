import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { handler } from "@/lambda/domains/identity/get-product-access";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";

const dynamoMock = mockClient(DynamoDBClient);

const createEvent = ({
  body,
  claims = { sub: "user-123" },
  orgId = "org-123",
}: {
  body?: Record<string, unknown>;
  claims?: Record<string, string>;
  orgId?: string;
} = {}) => ({
  version: "2.0",
  routeKey: "GET /me/product-access",
  rawPath: "/me/product-access",
  rawQueryString: "",
  headers: {
    "accept-language": "en",
    ...(orgId ? { "x-org-id": orgId } : {}),
  },
  requestContext: {
    authorizer: { jwt: { claims, scopes: [] } },
  },
  body: body ? JSON.stringify(body) : undefined,
  isBase64Encoded: false,
});

const activeAccess = (
  orgId: string,
  workspaceType: "COMPANY" | "ACCOUNTING_FIRM" = "COMPANY",
) =>
  marshall({
    PK: `ORG#${orgId}`,
    SK: "USER#user-123",
    entityType: "USER_ORG_ACCESS",
    orgId,
    userId: "user-123",
    role: "OWNER",
    status: "ACTIVE",
    accessSource: "DIRECT",
    workspaceType,
  });

describe("GET /me/product-access", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    dynamoMock.reset();
  });

  test("rejects an unauthenticated request", async () => {
    const response = await handler(createEvent({ claims: {} }) as any);
    expect(response.statusCode).toBe(401);
  });

  test("rejects a missing active organization", async () => {
    const response = await handler(createEvent({ orgId: "" }) as any);
    expect(response.statusCode).toBe(400);
  });

  test("rejects an organization without verified membership", async () => {
    dynamoMock.on(GetItemCommand).resolves({});
    const response = await handler(createEvent() as any);
    expect(response.statusCode).toBe(403);
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("returns only frontend-safe ProductAccess for the active organization", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: activeAccess("org-123") });
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        marshall({
          PK: "ORG#org-123",
          SK: "PRODUCT_ACCESS#ACCOUNTING",
          entityType: "PRODUCT_ACCESS",
          orgId: "org-123",
          productCode: "ACCOUNTING",
          status: "ACTIVE",
          createdAt: "2026-08-07T10:00:00.000Z",
          updatedAt: "2026-08-07T10:00:00.000Z",
        }),
        marshall({
          PK: "ORG#org-123",
          SK: "PRODUCT_ACCESS#PROJECTS",
          entityType: "PRODUCT_ACCESS",
          orgId: "org-123",
          productCode: "PROJECTS",
          status: "ACTIVE",
          createdAt: "2026-08-07T10:00:00.000Z",
          updatedAt: "2026-08-07T10:00:00.000Z",
        }),
        marshall({
          PK: "ORG#org-123",
          SK: "PRODUCT_ACCESS#TREASURY",
          entityType: "PRODUCT_ACCESS",
          orgId: "org-123",
          productCode: "TREASURY",
          status: "INACTIVE",
          createdAt: "2026-08-07T10:00:00.000Z",
          updatedAt: "2026-08-07T10:00:00.000Z",
        }),
      ],
    });

    const response = await handler(
      createEvent({ body: { orgId: "org-attacker" } }) as any,
    );
    const body = JSON.parse(response.body);
    const query = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(response.statusCode).toBe(200);
    expect(body.productAccess).toHaveLength(1);
    expect(query.ExpressionAttributeValues?.[":pk"]).toEqual({ S: "ORG#org-123" });
    expect(body.productAccess[0]).toEqual({
      orgId: "org-123",
      productCode: "ACCOUNTING",
      status: "ACTIVE",
      createdAt: "2026-08-07T10:00:00.000Z",
      updatedAt: "2026-08-07T10:00:00.000Z",
    });
    expect(body.productAccess[0]).not.toHaveProperty("PK");
    expect(body.productAccess[0]).not.toHaveProperty("SK");
  });

  test("returns an empty list when the organization has not been backfilled", async () => {
    const requireAccess = jest.spyOn(
      ProductAccessService,
      "requireActiveProductAccess",
    );
    dynamoMock.on(GetItemCommand).resolves({ Item: activeAccess("org-123") });
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    const response = await handler(createEvent() as any);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ productAccess: [] });
    expect(requireAccess).not.toHaveBeenCalled();
  });

  test("uses the same membership-only read path for accounting-firm workspaces", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: activeAccess("org-cabinet", "ACCOUNTING_FIRM"),
    });
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    const response = await handler(createEvent({ orgId: "org-cabinet" }) as any);
    expect(response.statusCode).toBe(200);
  });
});
