import {
  GetThirdPartyRequestSchema,
  ListThirdPartiesResponseSchema,
  ListThirdPartiesRequestSchema,
  ThirdPartyDtoSchema,
  UpdateThirdPartyRequestSchema,
} from "@liass-ohada/shared/accounting";

describe("Lot 5.3A third-party shared contracts", () => {
  test("third-party DTO strips persistence and uniqueness internals", () => {
    const parsed = ThirdPartyDtoSchema.parse({
      PK: "ORG#technical",
      SK: "TP#CUSTOMER#TP-1",
      GSI1PK: "technical",
      entityType: "THIRD_PARTY",
      thirdPartyId: "TP-1",
      code: "CUST-ALPHA",
      displayName: "Client Alpha",
      type: "CUSTOMER",
      status: "ACTIVE",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      thirdPartyType: "CUSTOMER",
    });

    expect(parsed).not.toHaveProperty("PK");
    expect(parsed).not.toHaveProperty("SK");
    expect(parsed).not.toHaveProperty("GSI1PK");
    expect(parsed).not.toHaveProperty("entityType");
    expect(parsed).not.toHaveProperty("thirdPartyType");
  });

  test("list request validates type, status, pagination and code prefix", () => {
    const parsed = ListThirdPartiesRequestSchema.parse({
      type: "CUSTOMER",
      status: "ACTIVE",
      codePrefix: " cust ",
      limit: "25",
      cursor: "cursor",
    });

    expect(parsed).toEqual({
      type: "CUSTOMER",
      status: "ACTIVE",
      codePrefix: "cust",
      limit: 25,
      cursor: "cursor",
    });
  });

  test("unsupported third-party types are rejected", () => {
    expect(() =>
      ListThirdPartiesRequestSchema.parse({ type: "EMPLOYEE" }),
    ).toThrow();
  });

  test("direct get request requires type because storage identity includes it", () => {
    expect(() =>
      GetThirdPartyRequestSchema.parse({ thirdPartyId: "TP-1" }),
    ).toThrow();
  });

  test("list response requires explicit hasMore pagination state", () => {
    expect(() =>
      ListThirdPartiesResponseSchema.parse({
        data: {
          items: [],
        },
      }),
    ).toThrow();
  });

  test("update request rejects code and type changes", () => {
    expect(() =>
      UpdateThirdPartyRequestSchema.parse({
        displayName: "Client Alpha",
        code: "NEW-CODE",
      }),
    ).toThrow();
    expect(() =>
      UpdateThirdPartyRequestSchema.parse({
        displayName: "Client Alpha",
        type: "SUPPLIER",
      }),
    ).toThrow();
  });
});
