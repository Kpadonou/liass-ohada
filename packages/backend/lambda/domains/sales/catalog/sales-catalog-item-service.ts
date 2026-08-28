import { randomUUID } from "crypto";
import {
  CreateSalesCatalogItemRequest,
  CreateSalesCatalogItemRequestSchema,
  ListSalesCatalogItemsRequest,
  ListSalesCatalogItemsRequestSchema,
  SalesCatalogItem,
  SalesCatalogItemLifecycleRequest,
  SalesCatalogItemLifecycleRequestSchema,
  SalesCatalogItemListResponse,
  SalesCatalogItemListResponseSchema,
  SalesCatalogItemSchema,
  UpdateSalesCatalogItemRequest,
  UpdateSalesCatalogItemRequestSchema,
} from "@liass-ohada/shared/sales";
import { z } from "zod";
import { AppError } from "@/lambda/shared/app-error";
import {
  SalesCatalogItemRepository,
  SalesCatalogItemWriteConflictError,
} from "./sales-catalog-item-repository";

const OrganizationIdSchema = z.string().min(1);
const ItemIdSchema = z.string().trim().min(1).max(200);

const audit = (input: {
  action:
    | "SALES_ITEM_CREATED"
    | "SALES_ITEM_UPDATED"
    | "SALES_ITEM_ACTIVATED"
    | "SALES_ITEM_DEACTIVATED";
  actorUserId: string;
  orgId: string;
  itemId: string;
  previousVersion?: number;
  newVersion: number;
  timestamp: string;
}) => console.info("[SALES_ITEM_AUDIT]", input);

export class SalesCatalogItemService {
  static async create(
    orgId: string,
    actorUserId: string,
    input: CreateSalesCatalogItemRequest,
  ): Promise<SalesCatalogItem> {
    const tenantId = OrganizationIdSchema.parse(orgId);
    const request = CreateSalesCatalogItemRequestSchema.parse(input);
    const now = new Date().toISOString();
    const item = SalesCatalogItemSchema.parse({
      ...request,
      id: `SI-${randomUUID()}`,
      isActive: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await SalesCatalogItemRepository.create(tenantId, item);
    } catch (error) {
      if (error instanceof SalesCatalogItemWriteConflictError) {
        throw new AppError(409, "SALES_ITEM_CREATE_CONFLICT");
      }
      throw error;
    }

    audit({
      action: "SALES_ITEM_CREATED",
      actorUserId,
      orgId: tenantId,
      itemId: item.id,
      newVersion: item.version,
      timestamp: now,
    });
    return item;
  }

  static async get(orgId: string, itemId: string): Promise<SalesCatalogItem> {
    const item = await SalesCatalogItemRepository.get(
      OrganizationIdSchema.parse(orgId),
      ItemIdSchema.parse(itemId),
    );
    if (!item) throw new AppError(404, "SALES_ITEM_NOT_FOUND");
    return item;
  }

  static async list(
    orgId: string,
    input: ListSalesCatalogItemsRequest,
  ): Promise<SalesCatalogItemListResponse> {
    const request = ListSalesCatalogItemsRequestSchema.parse(input);
    return SalesCatalogItemListResponseSchema.parse(
      await SalesCatalogItemRepository.list(
        OrganizationIdSchema.parse(orgId),
        request,
      ),
    );
  }

  static async update(
    orgId: string,
    actorUserId: string,
    itemId: string,
    input: UpdateSalesCatalogItemRequest,
  ): Promise<SalesCatalogItem> {
    const tenantId = OrganizationIdSchema.parse(orgId);
    const id = ItemIdSchema.parse(itemId);
    const request = UpdateSalesCatalogItemRequestSchema.parse(input);
    const current = await this.get(tenantId, id);
    this.assertVersion(current, request.expectedVersion);

    const mutable = { ...current } as Record<string, unknown>;
    for (const field of ["itemType", "name", "description", "unit"] as const) {
      if (!Object.prototype.hasOwnProperty.call(request, field)) continue;
      const value = request[field];
      if (value === undefined) delete mutable[field];
      else mutable[field] = value;
    }

    const now = new Date().toISOString();
    const next = SalesCatalogItemSchema.parse({
      ...mutable,
      version: current.version + 1,
      updatedAt: now,
    });
    await this.persistMutation(tenantId, next, request.expectedVersion);
    audit({
      action: "SALES_ITEM_UPDATED",
      actorUserId,
      orgId: tenantId,
      itemId: id,
      previousVersion: current.version,
      newVersion: next.version,
      timestamp: now,
    });
    return next;
  }

  static async activate(
    orgId: string,
    actorUserId: string,
    input: SalesCatalogItemLifecycleRequest,
  ): Promise<SalesCatalogItem> {
    return this.changeActiveState(orgId, actorUserId, input, true);
  }

  static async deactivate(
    orgId: string,
    actorUserId: string,
    input: SalesCatalogItemLifecycleRequest,
  ): Promise<SalesCatalogItem> {
    return this.changeActiveState(orgId, actorUserId, input, false);
  }

  private static async changeActiveState(
    orgId: string,
    actorUserId: string,
    input: SalesCatalogItemLifecycleRequest,
    isActive: boolean,
  ): Promise<SalesCatalogItem> {
    const tenantId = OrganizationIdSchema.parse(orgId);
    const request = SalesCatalogItemLifecycleRequestSchema.parse(input);
    const current = await this.get(tenantId, request.itemId);
    this.assertVersion(current, request.expectedVersion);

    if (current.isActive === isActive) return current;

    const now = new Date().toISOString();
    const next = SalesCatalogItemSchema.parse({
      ...current,
      isActive,
      version: current.version + 1,
      updatedAt: now,
    });
    await this.persistMutation(tenantId, next, request.expectedVersion);
    audit({
      action: isActive ? "SALES_ITEM_ACTIVATED" : "SALES_ITEM_DEACTIVATED",
      actorUserId,
      orgId: tenantId,
      itemId: request.itemId,
      previousVersion: current.version,
      newVersion: next.version,
      timestamp: now,
    });
    return next;
  }

  private static assertVersion(
    item: SalesCatalogItem,
    expectedVersion: number,
  ): void {
    if (item.version !== expectedVersion) {
      throw new AppError(409, "SALES_ITEM_VERSION_CONFLICT");
    }
  }

  private static async persistMutation(
    orgId: string,
    item: SalesCatalogItem,
    expectedVersion: number,
  ): Promise<void> {
    try {
      await SalesCatalogItemRepository.update(orgId, item, expectedVersion);
    } catch (error) {
      if (error instanceof SalesCatalogItemWriteConflictError) {
        throw new AppError(409, "SALES_ITEM_VERSION_CONFLICT");
      }
      throw error;
    }
  }
}
