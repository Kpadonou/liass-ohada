import { handler as createDraftHandler } from "@/lambda/domains/accounting/entries/create-draft";
import { handler as deleteDraftHandler } from "@/lambda/domains/accounting/entries/delete-draft";
import { handler as postDraftHandler } from "@/lambda/domains/accounting/entries/post-draft";
import { handler as updateDraftHandler } from "@/lambda/domains/accounting/entries/update-draft";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";

jest.mock("@/lambda/shared/services/ledger-service", () => ({
  LedgerService: {
    createDraftEntry: jest.fn(),
    updateDraftEntry: jest.fn(),
    deleteDraftEntry: jest.fn(),
    postDraftEntry: jest.fn(),
  },
}));

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    assertUserCanAccessOrg: jest.fn(),
  },
}));

const draftDetail = {
  entryId: "E-draft",
  year: 2026,
  entryDate: "2026-01-15",
  journalCode: "OD",
  entryType: "STANDARD" as const,
  totalDebit: 1000,
  totalCredit: 1000,
  status: "DRAFT" as const,
  lines: [],
};

const createEvent = (
  method: string,
  path: string,
  body: Record<string, unknown> = {},
  pathParameters: Record<string, string> = {},
) => ({
  version: "2.0",
  routeKey: `${method} ${path}`,
  rawPath: path,
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
  pathParameters,
  body: JSON.stringify(body),
  isBase64Encoded: false,
});

describe("entry draft handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({ role: "ACCOUNTANT" });
  });

  test("returns safe backend messages for draft mutations", async () => {
    jest.mocked(LedgerService.createDraftEntry).mockResolvedValue(draftDetail);
    jest.mocked(LedgerService.updateDraftEntry).mockResolvedValue(draftDetail);
    jest.mocked(LedgerService.deleteDraftEntry).mockResolvedValue({ entryId: "E-draft" });
    jest.mocked(LedgerService.postDraftEntry).mockResolvedValue({ entryId: "E-draft" });

    const createResponse = await createDraftHandler(
      createEvent("POST", "/entries/drafts", {
        year: 2026,
        entryDate: "2026-01-15",
        journalCode: "OD",
        lines: [],
      }) as any,
    );
    const updateResponse = await updateDraftHandler(
      createEvent(
        "PUT",
        "/entries/E-draft/draft",
        {
          year: 2026,
          entryDate: "2026-01-15",
          journalCode: "OD",
          lines: [],
        },
        { entryId: "E-draft" },
      ) as any,
    );
    const deleteResponse = await deleteDraftHandler(
      createEvent(
        "DELETE",
        "/entries/E-draft/draft",
        { year: 2026 },
        { entryId: "E-draft" },
      ) as any,
    );
    const postResponse = await postDraftHandler(
      createEvent(
        "POST",
        "/entries/E-draft/post",
        { year: 2026 },
        { entryId: "E-draft" },
      ) as any,
    );

    expect(JSON.parse(createResponse.body).message.message).toBe("Entry draft created successfully.");
    expect(JSON.parse(updateResponse.body).message.message).toBe("Entry draft updated successfully.");
    expect(JSON.parse(deleteResponse.body).message.message).toBe("Entry draft deleted successfully.");
    expect(JSON.parse(postResponse.body).message.message).toBe("Entry posted successfully.");
  });
});
