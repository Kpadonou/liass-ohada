import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import {
  ChangeMenuItemAvailabilityRequestSchema,
  RestaurantIdSchema,
  RestaurantsLifecycleRequestSchema,
  RestaurantsListRequestSchema,
  RestaurantTableQrResponseSchema,
} from "@liass-ohada/shared/restaurants";
import { AppError } from "@/lambda/shared/app-error";
import {
  createSchemas,
  entitySchemas,
  RestaurantEntities,
  RestaurantKind,
  RestaurantParents,
  updateSchemas,
} from "./restaurant-model";
import {
  ParentCheck,
  RestaurantsRepository,
  RestaurantSnapshot,
} from "./restaurant-repository";

const TenantIdSchema = z.string().min(1);
const ParentsSchema = z
  .object({
    outletId: RestaurantIdSchema.optional(),
    serviceAreaId: RestaurantIdSchema.optional(),
    categoryId: RestaurantIdSchema.optional(),
  })
  .strict();
const audit = (kind: RestaurantKind, action: string, version: number) =>
  console.info("[RESTAURANTS_CONFIGURATION]", {
    kind,
    action,
    version,
    timestamp: new Date().toISOString(),
  });

export class RestaurantsService {
  private static async load<K extends RestaurantKind>(
    orgId: string,
    kind: K,
    parents: RestaurantParents,
    id?: string,
  ): Promise<RestaurantSnapshot<K>> {
    const snapshot = await RestaurantsRepository.get(orgId, kind, parents, id);
    if (!snapshot) throw new AppError(404, "RESTAURANTS_NOT_FOUND");
    return snapshot;
  }

  private static async parents(
    orgId: string,
    kind: RestaurantKind,
    context: RestaurantParents,
    requireActive: boolean,
  ): Promise<ParentCheck[]> {
    const checks: ParentCheck[] = [];
    const add = (snapshot: RestaurantSnapshot) => {
      if (requireActive && !snapshot.data.isActive)
        throw new AppError(409, "RESTAURANTS_PARENT_INACTIVE");
      checks.push({ snapshot, requireActive });
    };
    if (kind === "restaurant") return checks;
    const root = await this.load(orgId, "restaurant", {});
    add(root);
    if (kind === "outlet") return checks;
    const outlet = await this.load(
      orgId,
      "outlet",
      {},
      RestaurantIdSchema.parse(context.outletId),
    );
    if (outlet.data.restaurantId !== root.data.id)
      throw new AppError(404, "RESTAURANTS_NOT_FOUND");
    add(outlet);
    if (kind === "table")
      add(
        await this.load(
          orgId,
          "serviceArea",
          { outletId: context.outletId },
          RestaurantIdSchema.parse(context.serviceAreaId),
        ),
      );
    if (kind === "category" || kind === "item") {
      const menu = await this.load(orgId, "menu", {
        outletId: context.outletId,
      });
      add(menu);
      if (kind === "item") {
        const category = await this.load(
          orgId,
          "category",
          { outletId: context.outletId },
          RestaurantIdSchema.parse(context.categoryId),
        );
        if (category.data.menuId !== menu.data.id)
          throw new AppError(404, "RESTAURANTS_NOT_FOUND");
        add(category);
      }
    }
    return checks;
  }

  private static assertOwner(
    snapshot: RestaurantSnapshot,
    checks: ParentCheck[],
  ): void {
    const root = checks.find((check) => check.snapshot.kind === "restaurant");
    if (
      snapshot.kind === "outlet" &&
      entitySchemas.outlet.parse(snapshot.data).restaurantId !==
        root?.snapshot.data.id
    )
      throw new AppError(404, "RESTAURANTS_NOT_FOUND");
    const menu = checks.find((check) => check.snapshot.kind === "menu");
    if (
      snapshot.kind === "category" &&
      entitySchemas.category.parse(snapshot.data).menuId !==
        menu?.snapshot.data.id
    )
      throw new AppError(404, "RESTAURANTS_NOT_FOUND");
    if (
      snapshot.kind === "item" &&
      entitySchemas.item.parse(snapshot.data).menuId !== menu?.snapshot.data.id
    )
      throw new AppError(404, "RESTAURANTS_NOT_FOUND");
  }

  static async get<K extends RestaurantKind>(
    orgId: string,
    kind: K,
    parents: RestaurantParents,
    id?: string,
  ): Promise<RestaurantEntities[K]> {
    TenantIdSchema.parse(orgId);
    const context = ParentsSchema.parse(parents);
    const checks = await this.parents(orgId, kind, context, false);
    const current = await this.load(orgId, kind, context, id);
    this.assertOwner(current, checks);
    return current.data;
  }

  static async list<K extends RestaurantKind>(
    orgId: string,
    kind: K,
    parents: RestaurantParents,
    input: unknown,
  ) {
    TenantIdSchema.parse(orgId);
    const context = ParentsSchema.parse(parents);
    const request = RestaurantsListRequestSchema.parse(input);
    const checks = await this.parents(orgId, kind, context, false);
    const page = await RestaurantsRepository.list(
      orgId,
      kind,
      context,
      request,
    );
    for (const data of page.items)
      this.assertOwner(
        { kind, parents: context, data, createFingerprint: "" },
        checks,
      );
    return page;
  }

  static async create<K extends RestaurantKind>(
    orgId: string,
    actorUserId: string,
    kind: K,
    parents: RestaurantParents,
    input: unknown,
  ): Promise<RestaurantEntities[K]> {
    TenantIdSchema.parse(orgId);
    TenantIdSchema.parse(actorUserId);
    const context = ParentsSchema.parse(parents);
    const request = createSchemas[kind].parse(input);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ kind, context, request }))
      .digest("hex");
    // Custom UUIDv8 request identity prevents duplicate configuration on network retries.
    const identity = createHash("sha256")
      .update(JSON.stringify([orgId, kind, context, request.clientRequestId]))
      .digest("hex");
    const id = `${identity.slice(0, 8)}-${identity.slice(8, 12)}-8${identity.slice(13, 16)}-8${identity.slice(17, 20)}-${identity.slice(20, 32)}`;
    const existing = await RestaurantsRepository.get(orgId, kind, context, id);
    if (existing) {
      if (existing.createFingerprint !== fingerprint)
        throw new AppError(409, "RESTAURANTS_WRITE_CONFLICT");
      await this.get(orgId, kind, context, id);
      return existing.data;
    }
    const checks = await this.parents(orgId, kind, context, true);
    const root = checks.find((check) => check.snapshot.kind === "restaurant");
    const menu = checks.find((check) => check.snapshot.kind === "menu");
    const { clientRequestId, ...fields } = request;
    const now = new Date().toISOString();
    const data = entitySchemas[kind].parse({
      ...fields,
      id,
      isActive: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...(kind === "outlet" ? { restaurantId: root?.snapshot.data.id } : {}),
      ...(kind !== "restaurant" && kind !== "outlet"
        ? { outletId: context.outletId }
        : {}),
      ...(kind === "table" ? { serviceAreaId: context.serviceAreaId } : {}),
      ...(kind === "category" || kind === "item"
        ? { menuId: menu?.snapshot.data.id }
        : {}),
      ...(kind === "item" ? { categoryId: context.categoryId } : {}),
    }) as RestaurantEntities[K];
    await this.checkMenuItem(orgId, kind, context, data, checks);
    const snapshot: RestaurantSnapshot<K> = {
      kind,
      parents: context,
      data,
      createFingerprint: fingerprint,
      ...(kind === "table"
        ? { qrToken: randomBytes(32).toString("base64url") }
        : {}),
    };
    try {
      await RestaurantsRepository.save(
        orgId,
        snapshot,
        checks,
        undefined,
        root?.snapshot.data.id,
      );
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 409) {
        const committed = await RestaurantsRepository.get(
          orgId,
          kind,
          context,
          id,
        );
        if (committed?.createFingerprint === fingerprint) return committed.data;
      }
      throw error;
    }
    audit(kind, "CREATED", 1);
    return data;
  }

  private static async checkMenuItem(
    orgId: string,
    kind: RestaurantKind,
    parents: RestaurantParents,
    data: RestaurantSnapshot["data"],
    checks: ParentCheck[],
  ): Promise<void> {
    if (kind !== "item") return;
    const item = entitySchemas.item.parse(data);
    const menuCheck = checks.find((check) => check.snapshot.kind === "menu");
    const menu = entitySchemas.menu.parse(menuCheck?.snapshot.data);
    if (item.price.currency !== menu.currency)
      throw new AppError(400, "RESTAURANTS_CURRENCY_MISMATCH");
    if (item.preparationStationId) {
      const station = await this.load(
        orgId,
        "station",
        { outletId: parents.outletId },
        item.preparationStationId,
      );
      if (!station.data.isActive)
        throw new AppError(409, "RESTAURANTS_PARENT_INACTIVE");
      checks.push({ snapshot: station, requireActive: true });
    }
  }

  static async update<K extends RestaurantKind>(
    orgId: string,
    actorUserId: string,
    kind: K,
    parents: RestaurantParents,
    id: string | undefined,
    input: unknown,
    operation: "update" | "deactivate" | "availability" = "update",
  ): Promise<RestaurantEntities[K]> {
    TenantIdSchema.parse(orgId);
    TenantIdSchema.parse(actorUserId);
    const context = ParentsSchema.parse(parents);
    const request =
      operation === "deactivate"
        ? RestaurantsLifecycleRequestSchema.parse(input)
        : operation === "availability"
          ? ChangeMenuItemAvailabilityRequestSchema.parse(input)
          : updateSchemas[kind].parse(input);
    if (operation === "availability" && kind !== "item")
      throw new AppError(400, "ERROR_INVALID_INPUT");
    const checks = await this.parents(
      orgId,
      kind,
      context,
      operation !== "deactivate",
    );
    const current = await this.load(orgId, kind, context, id);
    this.assertOwner(current, checks);
    if (current.data.version !== request.expectedVersion)
      throw new AppError(409, "RESTAURANTS_WRITE_CONFLICT");
    if (
      operation !== "deactivate" &&
      kind !== "restaurant" &&
      !current.data.isActive
    )
      throw new AppError(409, "RESTAURANTS_PARENT_INACTIVE");
    if (operation === "deactivate" && !current.data.isActive)
      return current.data;
    const { expectedVersion, ...changes } = request;
    const mutable: Record<string, unknown> = {
      ...current.data,
      ...changes,
      ...(operation === "deactivate" ? { isActive: false } : {}),
      version: current.data.version + 1,
      updatedAt: new Date().toISOString(),
    };
    for (const name of ["capacity", "preparationStationId"])
      if (mutable[name] === null) delete mutable[name];
    const data = entitySchemas[kind].parse(mutable) as RestaurantEntities[K];
    // Deactivation preserves historical references, including an inactive station.
    if (operation !== "deactivate")
      await this.checkMenuItem(orgId, kind, context, data, checks);
    await RestaurantsRepository.save(
      orgId,
      { ...current, data },
      checks,
      current,
    );
    audit(kind, operation.toUpperCase(), data.version);
    return data;
  }

  static async getTableQr(
    orgId: string,
    parents: RestaurantParents,
    tableId: string,
  ) {
    await this.get(orgId, "table", parents, tableId);
    const current = await this.load(orgId, "table", parents, tableId);
    const response = RestaurantTableQrResponseSchema.parse({
      token: current.qrToken,
    });
    const lookup = await RestaurantsRepository.getQrLookup(response.token);
    const root = await this.get(orgId, "restaurant", {});
    if (
      !lookup ||
      lookup.orgId !== orgId ||
      lookup.tableId !== tableId ||
      lookup.outletId !== parents.outletId ||
      lookup.serviceAreaId !== parents.serviceAreaId ||
      lookup.restaurantId !== root.id
    )
      throw new AppError(404, "RESTAURANTS_NOT_FOUND");
    return response;
  }

  /** Persistence proof for RESTO-4; intentionally has no public HTTP registration. */
  static async resolveTableQr(token: string) {
    const lookup = await RestaurantsRepository.getQrLookup(token);
    if (!lookup) throw new AppError(404, "RESTAURANTS_NOT_FOUND");
    const parents = {
      outletId: lookup.outletId,
      serviceAreaId: lookup.serviceAreaId,
    };
    const checks = await this.parents(lookup.orgId, "table", parents, true);
    const root = checks.find((check) => check.snapshot.kind === "restaurant");
    const table = await this.load(
      lookup.orgId,
      "table",
      parents,
      lookup.tableId,
    );
    if (
      root?.snapshot.data.id !== lookup.restaurantId ||
      table.qrToken !== token ||
      !table.data.isActive
    )
      throw new AppError(404, "RESTAURANTS_NOT_FOUND");
    return {
      orgId: lookup.orgId,
      restaurantId: lookup.restaurantId,
      table: table.data,
    };
  }
}
