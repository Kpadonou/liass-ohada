import { randomUUID } from "crypto";
import {
  CreateSalesCustomerRequest,
  CreateSalesCustomerRequestSchema,
  ListSalesCustomersRequest,
  ListSalesCustomersRequestSchema,
  SalesCustomer,
  SalesCustomerLifecycleRequest,
  SalesCustomerLifecycleRequestSchema,
  SalesCustomerListResponse,
  SalesCustomerListResponseSchema,
  SalesCustomerSchema,
  UpdateSalesCustomerRequest,
  UpdateSalesCustomerRequestSchema,
} from "@liass-ohada/shared/sales";
import { z } from "zod";
import { AppError } from "@/lambda/shared/app-error";
import {
  SalesCustomerRepository,
  SalesCustomerWriteConflictError,
} from "./sales-customer-repository";

const OrganizationIdSchema = z.string().min(1);
const CustomerIdSchema = z.string().trim().min(1).max(200);

const audit = (input: {
  action:
    | "SALES_CUSTOMER_CREATED"
    | "SALES_CUSTOMER_UPDATED"
    | "SALES_CUSTOMER_ACTIVATED"
    | "SALES_CUSTOMER_DEACTIVATED";
  actorUserId: string;
  orgId: string;
  customerId: string;
  previousVersion?: number;
  newVersion: number;
  timestamp: string;
}) => console.info("[SALES_CUSTOMER_AUDIT]", input);

export class SalesCustomerService {
  static async create(
    orgId: string,
    actorUserId: string,
    input: CreateSalesCustomerRequest,
  ): Promise<SalesCustomer> {
    const tenantId = OrganizationIdSchema.parse(orgId);
    const request = CreateSalesCustomerRequestSchema.parse(input);
    const now = new Date().toISOString();
    const customer = SalesCustomerSchema.parse({
      ...request,
      id: `SC-${randomUUID()}`,
      isActive: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await SalesCustomerRepository.create(tenantId, customer);
    } catch (error) {
      if (error instanceof SalesCustomerWriteConflictError) {
        throw new AppError(409, "SALES_CUSTOMER_CREATE_CONFLICT");
      }
      throw error;
    }

    audit({
      action: "SALES_CUSTOMER_CREATED",
      actorUserId,
      orgId: tenantId,
      customerId: customer.id,
      newVersion: customer.version,
      timestamp: now,
    });
    return customer;
  }

  static async get(orgId: string, customerId: string): Promise<SalesCustomer> {
    const customer = await SalesCustomerRepository.get(
      OrganizationIdSchema.parse(orgId),
      CustomerIdSchema.parse(customerId),
    );
    if (!customer) throw new AppError(404, "SALES_CUSTOMER_NOT_FOUND");
    return customer;
  }

  static async list(
    orgId: string,
    input: ListSalesCustomersRequest,
  ): Promise<SalesCustomerListResponse> {
    const request = ListSalesCustomersRequestSchema.parse(input);
    return SalesCustomerListResponseSchema.parse(
      await SalesCustomerRepository.list(
        OrganizationIdSchema.parse(orgId),
        request,
      ),
    );
  }

  static async update(
    orgId: string,
    actorUserId: string,
    customerId: string,
    input: UpdateSalesCustomerRequest,
  ): Promise<SalesCustomer> {
    const tenantId = OrganizationIdSchema.parse(orgId);
    const id = CustomerIdSchema.parse(customerId);
    const request = UpdateSalesCustomerRequestSchema.parse(input);
    const current = await this.get(tenantId, id);
    this.assertVersion(current, request.expectedVersion);

    const mutable = { ...current } as Record<string, unknown>;
    for (const field of [
      "customerType",
      "name",
      "email",
      "phone",
      "taxIdentifier",
      "billingAddress",
    ] as const) {
      if (!Object.prototype.hasOwnProperty.call(request, field)) continue;
      const value = request[field];
      if (value === undefined) delete mutable[field];
      else mutable[field] = value;
    }

    const now = new Date().toISOString();
    const next = SalesCustomerSchema.parse({
      ...mutable,
      version: current.version + 1,
      updatedAt: now,
    });
    await this.persistMutation(tenantId, next, request.expectedVersion);
    audit({
      action: "SALES_CUSTOMER_UPDATED",
      actorUserId,
      orgId: tenantId,
      customerId: id,
      previousVersion: current.version,
      newVersion: next.version,
      timestamp: now,
    });
    return next;
  }

  static async activate(
    orgId: string,
    actorUserId: string,
    input: SalesCustomerLifecycleRequest,
  ): Promise<SalesCustomer> {
    return this.changeActiveState(orgId, actorUserId, input, true);
  }

  static async deactivate(
    orgId: string,
    actorUserId: string,
    input: SalesCustomerLifecycleRequest,
  ): Promise<SalesCustomer> {
    return this.changeActiveState(orgId, actorUserId, input, false);
  }

  private static async changeActiveState(
    orgId: string,
    actorUserId: string,
    input: SalesCustomerLifecycleRequest,
    isActive: boolean,
  ): Promise<SalesCustomer> {
    const tenantId = OrganizationIdSchema.parse(orgId);
    const request = SalesCustomerLifecycleRequestSchema.parse(input);
    const current = await this.get(tenantId, request.customerId);
    this.assertVersion(current, request.expectedVersion);

    // Repeated lifecycle commands are version-aware idempotent no-ops.
    if (current.isActive === isActive) return current;

    const now = new Date().toISOString();
    const next = SalesCustomerSchema.parse({
      ...current,
      isActive,
      version: current.version + 1,
      updatedAt: now,
    });
    await this.persistMutation(tenantId, next, request.expectedVersion);
    audit({
      action: isActive
        ? "SALES_CUSTOMER_ACTIVATED"
        : "SALES_CUSTOMER_DEACTIVATED",
      actorUserId,
      orgId: tenantId,
      customerId: request.customerId,
      previousVersion: current.version,
      newVersion: next.version,
      timestamp: now,
    });
    return next;
  }

  private static assertVersion(
    customer: SalesCustomer,
    expectedVersion: number,
  ): void {
    if (customer.version !== expectedVersion) {
      throw new AppError(409, "SALES_CUSTOMER_VERSION_CONFLICT");
    }
  }

  private static async persistMutation(
    orgId: string,
    customer: SalesCustomer,
    expectedVersion: number,
  ): Promise<void> {
    try {
      await SalesCustomerRepository.update(orgId, customer, expectedVersion);
    } catch (error) {
      if (error instanceof SalesCustomerWriteConflictError) {
        throw new AppError(409, "SALES_CUSTOMER_VERSION_CONFLICT");
      }
      throw error;
    }
  }
}
