import { SalesCustomerService } from "@/lambda/domains/sales/customers/sales-customer-service";
import {
  SalesCustomerRepository,
  SalesCustomerWriteConflictError,
} from "@/lambda/domains/sales/customers/sales-customer-repository";

const timestamp = "2026-08-28T10:00:00.000Z";
const customer = {
  id: "SC-1",
  customerType: "BUSINESS" as const,
  name: "Client Demo",
  email: "client@example.com",
  isActive: true,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe("SalesCustomerService", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(console, "info").mockImplementation(() => undefined);
  });

  test("creates an active version-one aggregate with normalized input", async () => {
    const create = jest
      .spyOn(SalesCustomerRepository, "create")
      .mockResolvedValue();
    const result = await SalesCustomerService.create("org-123", "user-1", {
      customerType: "BUSINESS",
      name: "  Client Demo ",
      email: " client@example.com ",
    });

    expect(result).toMatchObject({
      customerType: "BUSINESS",
      name: "Client Demo",
      email: "client@example.com",
      isActive: true,
      version: 1,
    });
    expect(create).toHaveBeenCalledWith("org-123", result);
  });

  test("returns canonical not-found for missing get and update", async () => {
    jest.spyOn(SalesCustomerRepository, "get").mockResolvedValue(undefined);
    await expect(SalesCustomerService.get("org-123", "SC-1")).rejects.toMatchObject({
      statusCode: 404,
      messageCode: "SALES_CUSTOMER_NOT_FOUND",
    });
    await expect(
      SalesCustomerService.update("org-123", "user-1", "SC-1", {
        expectedVersion: 1,
        name: "Changed",
      }),
    ).rejects.toMatchObject({ messageCode: "SALES_CUSTOMER_NOT_FOUND" });
  });

  test("increments version on update and clears blank optional fields", async () => {
    jest.spyOn(SalesCustomerRepository, "get").mockResolvedValue(customer);
    const update = jest
      .spyOn(SalesCustomerRepository, "update")
      .mockResolvedValue();
    const result = await SalesCustomerService.update(
      "org-123",
      "user-1",
      "SC-1",
      { expectedVersion: 1, name: " Changed ", email: " " },
    );
    expect(result).toMatchObject({ name: "Changed", version: 2 });
    expect(result).not.toHaveProperty("email");
    expect(update).toHaveBeenCalledWith("org-123", result, 1);
  });

  test("maps stale reads and conditional races to the same version conflict", async () => {
    jest.spyOn(SalesCustomerRepository, "get").mockResolvedValue(customer);
    await expect(
      SalesCustomerService.update("org-123", "user-1", "SC-1", {
        expectedVersion: 2,
        name: "Changed",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      messageCode: "SALES_CUSTOMER_VERSION_CONFLICT",
    });

    jest
      .spyOn(SalesCustomerRepository, "update")
      .mockRejectedValue(new SalesCustomerWriteConflictError());
    await expect(
      SalesCustomerService.update("org-123", "user-1", "SC-1", {
        expectedVersion: 1,
        name: "Changed",
      }),
    ).rejects.toMatchObject({ messageCode: "SALES_CUSTOMER_VERSION_CONFLICT" });
  });

  test("deactivates and activates with conditional version increments", async () => {
    const get = jest.spyOn(SalesCustomerRepository, "get");
    const update = jest
      .spyOn(SalesCustomerRepository, "update")
      .mockResolvedValue();
    get.mockResolvedValueOnce(customer).mockResolvedValueOnce({
      ...customer,
      isActive: false,
      version: 2,
    });

    const inactive = await SalesCustomerService.deactivate(
      "org-123",
      "user-1",
      { customerId: "SC-1", expectedVersion: 1 },
    );
    const active = await SalesCustomerService.activate("org-123", "user-1", {
      customerId: "SC-1",
      expectedVersion: 2,
    });
    expect(inactive).toMatchObject({ isActive: false, version: 2 });
    expect(active).toMatchObject({ isActive: true, version: 3 });
    expect(update).toHaveBeenNthCalledWith(1, "org-123", inactive, 1);
    expect(update).toHaveBeenNthCalledWith(2, "org-123", active, 2);
  });

  test("treats repeated lifecycle commands as version-aware no-ops", async () => {
    jest.spyOn(SalesCustomerRepository, "get").mockResolvedValue(customer);
    const update = jest.spyOn(SalesCustomerRepository, "update");
    await expect(
      SalesCustomerService.activate("org-123", "user-1", {
        customerId: "SC-1",
        expectedVersion: 1,
      }),
    ).resolves.toEqual(customer);
    expect(update).not.toHaveBeenCalled();

    await expect(
      SalesCustomerService.activate("org-123", "user-1", {
        customerId: "SC-1",
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ messageCode: "SALES_CUSTOMER_VERSION_CONFLICT" });
  });
});
