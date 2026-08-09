import { handler as createBudgetLineHandler } from "@/lambda/domains/projects/create-budget-line";
import { handler as createDonorHandler } from "@/lambda/domains/projects/create-donor";
import { handler as getProjectReportHandler } from "@/lambda/domains/projects/get-project-report";
import { handler as getProjectsHandler } from "@/lambda/domains/projects/get-projects";
import { handler as listBudgetLinesHandler } from "@/lambda/domains/projects/list-budget-lines";
import { handler as listDonorsHandler } from "@/lambda/domains/projects/get-donors";
import { handler as listProjectsSummaryHandler } from "@/lambda/domains/projects/list-projects-summary";
import { AccountingProjectReportingService } from "@/lambda/domains/accounting/reporting/accounting-project-reporting-service";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

jest.mock(
  "@/lambda/domains/accounting/reporting/accounting-project-reporting-service",
  () => ({
    AccountingProjectReportingService: {
      listProjectFacts: jest.fn(),
      listOrganizationProjectFacts: jest.fn(),
    },
  }),
);

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    assertUserCanAccessOrg: jest.fn(),
  },
}));

const createEvent = (
  routeKey: string,
  body = {},
  pathParameters?: Record<string, string>,
  queryStringParameters?: Record<string, string>,
) => ({
  version: "2.0",
  routeKey,
  rawPath: routeKey.replace(/^[A-Z]+ /, ""),
  rawQueryString: "",
  headers: { "accept-language": "en", "x-org-id": "test-org" },
  requestContext: {
    authorizer: {
      jwt: {
        claims: { sub: "user-123" },
        scopes: [],
      },
    },
  },
  body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
  pathParameters,
  queryStringParameters,
  isBase64Encoded: false,
});

const parseResponse = (response: any) => JSON.parse(response.body ?? "{}");

const projectItem = {
  PK: { S: "ORG#test-org" },
  SK: { S: "PRJ#PRJ-1" },
  orgId: { S: "test-org" },
  projectId: { S: "PRJ-1" },
  projectCode: { S: "EDU-1" },
  name: { S: "Education project" },
  donorId: { S: "UNICEF" },
  managerId: { S: "manager-1" },
  startDate: { S: "2026-01-01" },
  totalBudget: { N: "1000000" },
  annualBudgets: { M: { "2026": { N: "1000000" } } },
  currency: { S: "XOF" },
  currentSpending: { N: "0" },
  status: { S: "ACTIVE" },
  entityType: { S: "PROJECT" },
  createdAt: { S: "2026-01-01T00:00:00Z" },
  updatedAt: { S: "2026-01-01T00:00:00Z" },
};

describe("projects workspace handlers", () => {
  const originalPermission = process.env.ACCOUNTING_PERMISSION;

  beforeEach(() => {
    jest.restoreAllMocks();
    dynamoMock.reset();
    jest.clearAllMocks();
    delete process.env.ACCOUNTING_PERMISSION;
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({ role: "ACCOUNTANT", workspaceType: "COMPANY" });
    jest
      .spyOn(ProductAccessService, "requireActiveProductAccess")
      .mockResolvedValue({
        orgId: "test-org",
        productCode: "ACCOUNTING",
        status: "ACTIVE",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    jest
      .mocked(AccountingProjectReportingService.listProjectFacts)
      .mockResolvedValue([]);
    jest
      .mocked(AccountingProjectReportingService.listOrganizationProjectFacts)
      .mockResolvedValue([]);
  });

  afterAll(() => {
    process.env.ACCOUNTING_PERMISSION = originalPermission;
  });

  test("GET /donors queries donor third-party records and returns frontend-safe DTOs", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        PK: { S: "ORG#test-org" },
        SK: { S: "PRODUCT_ACCESS#ACCOUNTING" },
        entityType: { S: "PRODUCT_ACCESS" },
        orgId: { S: "test-org" },
        productCode: { S: "ACCOUNTING" },
        status: { S: "ACTIVE" },
        createdAt: { S: "2026-01-01T00:00:00Z" },
        updatedAt: { S: "2026-01-01T00:00:00Z" },
      },
    });
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: { S: "ORG#test-org" },
          SK: { S: "TP#DONOR#UNICEF" },
          orgId: { S: "test-org" },
          donorId: { S: "UNICEF" },
          code: { S: "UNICEF" },
          name: { S: "UNICEF" },
          type: { S: "PUBLIC" },
          currency: { S: "XOF" },
          entityType: { S: "DONOR" },
          createdAt: { S: "2026-01-01T00:00:00Z" },
          updatedAt: { S: "2026-01-01T00:00:00Z" },
        },
      ],
    });

    const response = await listDonorsHandler(createEvent("GET /donors"));
    const body = parseResponse(response);
    const queryInput = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(response.statusCode).toBe(200);
    expect(queryInput.KeyConditionExpression).toBe(
      "PK = :pk AND begins_with(SK, :sk)",
    );
    expect(body.data.donors[0]).toMatchObject({
      donorId: "UNICEF",
      code: "UNICEF",
      name: "UNICEF",
    });
    expect(body.data.donors[0].PK).toBeUndefined();
    expect(body.data.donors[0].SK).toBeUndefined();
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("POST /donors writes a unique donor third-party item", async () => {
    dynamoMock.on(PutItemCommand).resolves({});

    const response = await createDonorHandler(
      createEvent("POST /donors", {
        code: "afd",
        name: "Agence Française de Développement",
        type: "PUBLIC",
        currency: "XOF",
      }),
    );
    const body = parseResponse(response);
    const putInput = dynamoMock.commandCalls(PutItemCommand)[0].args[0].input;

    expect(response.statusCode).toBe(200);
    expect(putInput.ConditionExpression).toBe(
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    );
    expect(putInput.Item?.SK).toEqual({ S: "TP#DONOR#AFD" });
    expect(body.data).toMatchObject({
      donorId: "AFD",
      code: "AFD",
      name: "Agence Française de Développement",
    });
    expect(body.data.PK).toBeUndefined();
  });

  test("GET /projects returns projects in data envelope without storage keys", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        projectItem,
        {
          PK: { S: "ORG#test-org" },
          SK: { S: "PRJCODE#EDU-1" },
          entityType: { S: "PROJECT_CODE_LOCK" },
        },
      ],
    });

    const response = await getProjectsHandler(createEvent("GET /projects"));
    const body = parseResponse(response);

    expect(response.statusCode).toBe(200);
    expect(body.data.projects).toHaveLength(1);
    expect(body.data.projects[0].projectId).toBe("PRJ-1");
    expect(body.data.projects[0].PK).toBeUndefined();
    expect(body.data.projects[0].entityType).toBeUndefined();
  });

  test("GET /projects/{projectId}/budget-lines uses the project budget prefix", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({ Item: projectItem });
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: { S: "ORG#test-org" },
          SK: { S: "PRJ#PRJ-1#BDG#2026#L#ACT-1" },
          entityType: { S: "BUDGET_LINE" },
          projectId: { S: "PRJ-1" },
          fiscalYear: { S: "2026" },
          code: { S: "ACT-1" },
          label: { S: "Activity" },
          amount: { N: "500000" },
          category: { S: "ACTIVITY" },
        },
      ],
    });

    const response = await listBudgetLinesHandler(
      createEvent(
        "GET /projects/{projectId}/budget-lines",
        {},
        { projectId: "PRJ-1" },
        { year: "2026" },
      ),
    );
    const body = parseResponse(response);
    const queryInput = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(response.statusCode).toBe(200);
    expect(queryInput.KeyConditionExpression).toBe(
      "PK = :pk AND begins_with(SK, :sk)",
    );
    expect(body.data.budgetLines[0]).toEqual({
      projectId: "PRJ-1",
      fiscalYear: "2026",
      code: "ACT-1",
      label: "Activity",
      amount: 500000,
      category: "ACTIVITY",
    });
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("POST /projects/{projectId}/budget-lines conditionally creates a budget line", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({ Item: projectItem });
    dynamoMock.on(PutItemCommand).resolves({});

    const response = await createBudgetLineHandler(
      createEvent(
        "POST /projects/{projectId}/budget-lines",
        {
          fiscalYear: "2026",
          code: "act-1",
          label: "Activity",
          amount: 500000,
          category: "ACTIVITY",
        },
        { projectId: "PRJ-1" },
      ),
    );
    const body = parseResponse(response);
    const putInput = dynamoMock.commandCalls(PutItemCommand)[0].args[0].input;

    expect(response.statusCode).toBe(200);
    expect(putInput.ConditionExpression).toBe(
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    );
    expect(putInput.Item?.SK).toEqual({ S: "PRJ#PRJ-1#BDG#2026#L#ACT-1" });
    expect(body.data).toMatchObject({
      projectId: "PRJ-1",
      fiscalYear: "2026",
      code: "ACT-1",
    });
    expect(body.data.SK).toBeUndefined();
  });

  test("GET /projects/{projectId}/report preserves Project Accounting calculations over key-free Accounting facts", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: projectItem });
    dynamoMock.on(QueryCommand).callsFake((input) => {
      const prefix = input.ExpressionAttributeValues?.[":sk"]?.S;
      if (prefix === "PRJ#PRJ-1#BDG#2026#L#") {
        return {
          Items: [
            {
              PK: { S: "ORG#test-org" },
              SK: { S: "PRJ#PRJ-1#BDG#2026#L#ACT-1" },
              entityType: { S: "BUDGET_LINE" },
              projectId: { S: "PRJ-1" },
              fiscalYear: { S: "2026" },
              code: { S: "ACT-1" },
              label: { S: "Activity" },
              amount: { N: "800" },
              category: { S: "ACTIVITY" },
            },
          ],
        };
      }
      if (prefix === "PRJ#PRJ-1#FS#") {
        return {
          Items: [
            {
              PK: { S: "ORG#test-org" },
              SK: { S: "PRJ#PRJ-1#FS#UNICEF" },
              entityType: { S: "FUNDING_SOURCE" },
              projectId: { S: "PRJ-1" },
              donorId: { S: "UNICEF" },
              label: { S: "UNICEF grant" },
              amount: { N: "2000" },
              currency: { S: "XOF" },
              createdAt: { S: "2026-01-01T00:00:00Z" },
              updatedAt: { S: "2026-01-01T00:00:00Z" },
            },
          ],
        };
      }
      return { Items: [] };
    });
    jest.mocked(AccountingProjectReportingService.listProjectFacts).mockResolvedValue([
      {
        entryId: "entry-1",
        entryLineId: "line-1",
        date: "2026-03-01",
        year: 2026,
        accountId: "60100000",
        debit: 400,
        credit: 0,
        projectId: "PRJ-1",
        donorId: "UNICEF",
        budgetLineId: "ACT-1",
      },
      {
        entryId: "entry-2",
        entryLineId: "line-2",
        date: "2026-03-02",
        year: 2026,
        accountId: "71800000",
        debit: 0,
        credit: 1000,
        projectId: "PRJ-1",
        donorId: "UNICEF",
      },
      {
        entryId: "entry-3",
        entryLineId: "line-3",
        date: "2026-03-03",
        year: 2026,
        accountId: "60200000",
        debit: 100,
        credit: 0,
        projectId: "PRJ-1",
        budgetLineId: "ACT-1",
      },
    ]);

    const response = await getProjectReportHandler(
      createEvent(
        "GET /projects/{projectId}/report",
        {},
        { projectId: "PRJ-1" },
        { year: "2026" },
      ),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(200);
    expect(AccountingProjectReportingService.listProjectFacts).toHaveBeenCalledWith({
      orgId: "test-org",
      projectId: "PRJ-1",
      year: "2026",
    });
    expect(body.data.financialPosition).toEqual({
      totalResources: 1000,
      totalExpenses: 500,
      netCash: 500,
    });
    expect(body.data.fundingFollowUp).toEqual([
      {
        donorId: "UNICEF",
        label: "UNICEF grant",
        promised: 2000,
        received: 1000,
        spent: 400,
        availableCash: 600,
        remainingToReceive: 1000,
        disbursementRate: 50,
      },
    ]);
    expect(body.data.budgetVsActual).toEqual([
      {
        code: "ACT-1",
        label: "Activity",
        allocated: 800,
        donors: { UNICEF: 400 },
        unallocated: 100,
        spent: 500,
        remaining: 300,
        executionRate: 62.5,
      },
    ]);
    expect(body.data.accountDetails.map(({ accountId }: { accountId: string }) => accountId)).toEqual([
      "60100000",
      "60200000",
      "71800000",
    ]);
  });

  test("GET /projects/summary preserves global and fiscal-year calculations", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        {
          ...projectItem,
          totalBudget: { N: "1000" },
          annualBudgets: { M: { "2026": { N: "800" } } },
        },
      ],
    });
    jest
      .mocked(AccountingProjectReportingService.listOrganizationProjectFacts)
      .mockResolvedValue([
        {
          entryId: "entry-1",
          entryLineId: "line-1",
          date: "2026-03-01",
          year: 2026,
          accountId: "60100000",
          debit: 500,
          credit: 0,
          projectId: "PRJ-1",
        },
        {
          entryId: "entry-2",
          entryLineId: "line-2",
          date: "2025-12-31",
          year: 2025,
          accountId: "71800000",
          debit: 0,
          credit: 1000,
          projectId: "PRJ-1",
        },
      ]);

    const response = await listProjectsSummaryHandler(
      createEvent("GET /projects/summary", {}, undefined, { year: "2026" }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(200);
    expect(
      AccountingProjectReportingService.listOrganizationProjectFacts,
    ).toHaveBeenCalledWith({ orgId: "test-org" });
    expect(body.data).toEqual([
      {
        projectInfo: {
          id: "PRJ-1",
          code: "EDU-1",
          name: "Education project",
          donor: "UNICEF",
          status: "ACTIVE",
        },
        financials: {
          netPosition: 500,
          globalExecutionRate: 50,
          annualExecutionRate: 62.5,
        },
        alerts: {
          isOverSpentGlobal: false,
          isOverSpentAnnual: false,
          isCashNegative: false,
        },
      },
    ]);
  });
});
