import { handler } from "@/lambda/domains/identity/accept-cabinet-invitation";
import { CabinetInvitationService } from "@/lambda/shared/services/cabinet-invitation-service";

jest.mock("@/lambda/shared/services/cabinet-invitation-service", () => ({
  CabinetInvitationService: {
    acceptInvitation: jest.fn(),
  },
}));

describe("accept Cabinet invitation handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(CabinetInvitationService.acceptInvitation)
      .mockResolvedValue({ member: {}, assignments: [] } as never);
  });

  test("accepts an authenticated pre-tenant request without x-org-id", async () => {
    const response = await handler({
      version: "2.0",
      headers: { "accept-language": "en" },
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              sub: "user-1",
              email: "member@example.com",
              email_verified: "true",
              given_name: "Ada",
              family_name: "Mensah",
            },
            scopes: [],
          },
        },
      },
      body: JSON.stringify({
        token: "valid-token-value-with-more-than-thirty-two-characters",
      }),
    } as never);

    expect(response.statusCode).toBe(200);
    expect(CabinetInvitationService.acceptInvitation).toHaveBeenCalledWith(
      "valid-token-value-with-more-than-thirty-two-characters",
      expect.objectContaining({
        userId: "user-1",
        email: "member@example.com",
        emailVerified: "true",
      }),
    );
  });
});
