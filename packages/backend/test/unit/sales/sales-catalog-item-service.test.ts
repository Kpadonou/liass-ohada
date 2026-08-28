import { SalesCatalogItemService } from "@/lambda/domains/sales/catalog/sales-catalog-item-service";
import {
  SalesCatalogItemRepository,
  SalesCatalogItemWriteConflictError,
} from "@/lambda/domains/sales/catalog/sales-catalog-item-repository";

const timestamp = "2026-08-28T10:00:00.000Z";
const catalogItem = {
  id: "SI-1",
  itemType: "SERVICE" as const,
  name: "Conseil",
  description: "Conseil opérationnel",
  unit: "Heure",
  isActive: true,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe("SalesCatalogItemService", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(console, "info").mockImplementation(() => undefined);
  });

  test.each(["PRODUCT", "SERVICE"] as const)(
    "creates an active version-one %s aggregate with normalized input",
    async (itemType) => {
      const create = jest
        .spyOn(SalesCatalogItemRepository, "create")
        .mockResolvedValue();
      const result = await SalesCatalogItemService.create(
        "org-123",
        "user-1",
        {
          itemType,
          name: "  Conseil ",
          unit: " Heure ",
        },
      );
      expect(result).toMatchObject({
        itemType,
        name: "Conseil",
        unit: "Heure",
        isActive: true,
        version: 1,
      });
      expect(create).toHaveBeenCalledWith("org-123", result);
    },
  );

  test("returns canonical not-found for missing reads and mutations", async () => {
    jest.spyOn(SalesCatalogItemRepository, "get").mockResolvedValue(undefined);
    await expect(
      SalesCatalogItemService.get("org-123", "SI-1"),
    ).rejects.toMatchObject({
      statusCode: 404,
      messageCode: "SALES_ITEM_NOT_FOUND",
    });
    await expect(
      SalesCatalogItemService.update("org-123", "user-1", "SI-1", {
        expectedVersion: 1,
        name: "Changed",
      }),
    ).rejects.toMatchObject({ messageCode: "SALES_ITEM_NOT_FOUND" });
  });

  test("increments version, preserves immutable fields, and clears blank optional fields", async () => {
    jest.spyOn(SalesCatalogItemRepository, "get").mockResolvedValue(catalogItem);
    const update = jest
      .spyOn(SalesCatalogItemRepository, "update")
      .mockResolvedValue();
    const result = await SalesCatalogItemService.update(
      "org-123",
      "user-1",
      "SI-1",
      { expectedVersion: 1, name: " Changed ", description: " " },
    );
    expect(result).toMatchObject({
      id: "SI-1",
      name: "Changed",
      createdAt: timestamp,
      version: 2,
    });
    expect(result).not.toHaveProperty("description");
    expect(update).toHaveBeenCalledWith("org-123", result, 1);
  });

  test("maps stale reads and conditional races to deterministic conflicts", async () => {
    jest.spyOn(SalesCatalogItemRepository, "get").mockResolvedValue(catalogItem);
    await expect(
      SalesCatalogItemService.update("org-123", "user-1", "SI-1", {
        expectedVersion: 2,
        name: "Changed",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      messageCode: "SALES_ITEM_VERSION_CONFLICT",
    });

    jest
      .spyOn(SalesCatalogItemRepository, "update")
      .mockRejectedValue(new SalesCatalogItemWriteConflictError());
    await expect(
      SalesCatalogItemService.update("org-123", "user-1", "SI-1", {
        expectedVersion: 1,
        name: "Changed",
      }),
    ).rejects.toMatchObject({ messageCode: "SALES_ITEM_VERSION_CONFLICT" });
  });

  test("deactivates and activates with conditional version increments", async () => {
    const get = jest.spyOn(SalesCatalogItemRepository, "get");
    const update = jest
      .spyOn(SalesCatalogItemRepository, "update")
      .mockResolvedValue();
    get.mockResolvedValueOnce(catalogItem).mockResolvedValueOnce({
      ...catalogItem,
      isActive: false,
      version: 2,
    });
    const inactive = await SalesCatalogItemService.deactivate(
      "org-123",
      "user-1",
      { itemId: "SI-1", expectedVersion: 1 },
    );
    const active = await SalesCatalogItemService.activate(
      "org-123",
      "user-1",
      { itemId: "SI-1", expectedVersion: 2 },
    );
    expect(inactive).toMatchObject({ isActive: false, version: 2 });
    expect(active).toMatchObject({ isActive: true, version: 3 });
    expect(update).toHaveBeenNthCalledWith(1, "org-123", inactive, 1);
    expect(update).toHaveBeenNthCalledWith(2, "org-123", active, 2);
  });

  test("treats repeated current-version lifecycle commands as no-ops", async () => {
    jest.spyOn(SalesCatalogItemRepository, "get").mockResolvedValue(catalogItem);
    const update = jest.spyOn(SalesCatalogItemRepository, "update");
    await expect(
      SalesCatalogItemService.activate("org-123", "user-1", {
        itemId: "SI-1",
        expectedVersion: 1,
      }),
    ).resolves.toEqual(catalogItem);
    expect(update).not.toHaveBeenCalled();

    await expect(
      SalesCatalogItemService.activate("org-123", "user-1", {
        itemId: "SI-1",
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ messageCode: "SALES_ITEM_VERSION_CONFLICT" });

    jest.spyOn(SalesCatalogItemRepository, "get").mockResolvedValue({
      ...catalogItem,
      isActive: false,
    });
    await expect(
      SalesCatalogItemService.deactivate("org-123", "user-1", {
        itemId: "SI-1",
        expectedVersion: 1,
      }),
    ).resolves.toMatchObject({ isActive: false, version: 1 });
    expect(update).not.toHaveBeenCalled();
  });

  test("logs mutation metadata without catalog description", async () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.spyOn(SalesCatalogItemRepository, "create").mockResolvedValue();
    await SalesCatalogItemService.create("org-123", "user-1", {
      itemType: "SERVICE",
      name: "Conseil",
      description: "Confidential business text",
    });
    expect(info).toHaveBeenCalledWith(
      "[SALES_ITEM_AUDIT]",
      expect.not.objectContaining({ description: expect.anything() }),
    );
  });
});
