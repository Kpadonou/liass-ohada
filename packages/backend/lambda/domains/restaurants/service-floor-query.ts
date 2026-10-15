import { ResponsibleStaff } from "./responsible-staff";
import * as contracts from "@liass-ohada/shared/restaurants";
import { AppError } from "@/lambda/shared/app-error";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { RestaurantsRepository as Config } from "./restaurant-repository";
import { RestaurantTransactionsRepository as R } from "./transaction-repository";
import { TransactionScope } from "./transaction-model";

export class RestaurantServiceFloor {
  static async read(scope: TransactionScope, request: unknown) {
    const input = contracts.RestaurantServiceFloorRequestSchema.parse(request);
    const page = await Config.floorTables(scope.orgId, scope.outletId, input);
    if (new Set(page.items.map((t) => t.id)).size !== page.items.length)
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    const occupancy = await R.batch(
      scope,
      page.items.map((t) => ({
        PK: K.restaurantOccupancyPK(scope.orgId, scope.outletId, t.id),
        SK: K.restaurantOccupancySK(),
      })),
      "OCCUPANCY",
    );
    const pointers = occupancy.map((row, index) => {
      if (!row) return undefined;
      const table = page.items[index];
      if (
        !("guestSessionId" in row.data) ||
        !("areaId" in row.data) ||
        row.data.tableId !== table.id ||
        row.data.areaId !== table.serviceAreaId
      )
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
      return row.data;
    });
    const ids = pointers.flatMap((p) => (p ? [p.guestSessionId] : []));
    if (new Set(ids).size !== ids.length)
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    const sessions = await R.batch(
      scope,
      ids.map((id) => ({
        PK: K.restaurantSessionPK(scope.orgId, scope.outletId, id),
        SK: K.restaurantTransactionMetaSK(),
      })),
      "SESSION",
    );
    const sessionById = new Map(ids.map((id, i) => [id, sessions[i]]));
    const people = await ResponsibleStaff.read(
      scope,
      sessions.flatMap((row) => {
        if (!row) return [];
        const session = contracts.GuestSessionSchema.parse(row.data);
        return session.responsibleStaffId ? [session.responsibleStaffId] : [];
      }),
    );
    const areas = await Config.floorAreas(
      scope.orgId,
      scope.outletId,
      page.items.map((t) => t.serviceAreaId),
    );
    const items = page.items.map((table, index) => {
      const base = {
        tableId: table.id,
        code: table.code,
        name: table.name,
        areaId: table.serviceAreaId,
        areaName: areas.get(table.serviceAreaId),
        ...(table.capacity === undefined ? {} : { capacity: table.capacity }),
      };
      const pointer = pointers[index];
      if (!pointer) return { ...base, state: "FREE" as const };
      const row = sessionById.get(pointer.guestSessionId);
      if (!row || !("guestSessionId" in row.data) || !("status" in row.data))
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
      const session = contracts.GuestSessionSchema.parse(row.data);
      if (
        session.status !== "OPEN" ||
        session.tableId !== table.id ||
        session.areaId !== table.serviceAreaId
      )
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
      return {
        ...base,
        state: "OCCUPIED" as const,
        guestSessionId: session.guestSessionId,
        openedAt: session.openedAt,
        openedBy: session.openedBy,
        ...(session.responsibleStaffId
          ? { responsibleStaff: people.get(session.responsibleStaffId) }
          : {}),
        currentAmountMinor: session.dueMinor,
        orderCount: session.orderCount,
        currency: session.currency,
      };
    });
    return contracts.RestaurantServiceFloorResponseSchema.parse({
      outletId: scope.outletId,
      items,
      nextCursor: page.nextCursor,
    });
  }
}
