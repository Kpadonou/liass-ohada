import { createHash } from "crypto";
import {
  GuestContextResponse,
  GuestResolveRequestSchema,
} from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";
import { RestaurantsRepository as Config } from "./restaurant-repository";
import { RestaurantTransactionsRepository as R } from "./transaction-repository";
import {
  GuestPrincipal,
  openGuest,
  sealGuest,
  newGuestHandle,
  GuestCapabilityExpired,
} from "./guest-capability";

const fingerprint = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export class GuestService {
  private static async context(token: string) {
    const lookup = await Config.getQrLookup(token);
    if (!lookup) return undefined;
    const { orgId, outletId, serviceAreaId, tableId } = lookup;
    await ProductAccessService.requireActiveProductAccess({
      orgId,
      productCode: "RESTAURANTS",
      action: "GUEST_RESOLVE",
    });
    const [root, outlet, area, table] = await Promise.all([
      Config.get(orgId, "restaurant", {}),
      Config.get(orgId, "outlet", {}, outletId),
      Config.get(orgId, "serviceArea", { outletId }, serviceAreaId),
      Config.get(orgId, "table", { outletId, serviceAreaId }, tableId),
    ]);
    if (
      !root?.data.isActive ||
      !outlet?.data.isActive ||
      !area?.data.isActive ||
      !table?.data.isActive ||
      root.data.id !== lookup.restaurantId ||
      outlet.data.restaurantId !== root.data.id ||
      area.data.outletId !== outletId ||
      table.data.outletId !== outletId ||
      table.data.serviceAreaId !== serviceAreaId ||
      table.qrRevoked ||
      table.qrToken !== token
    )
      return undefined;
    const scope = { orgId, outletId };
    const occupancy = await R.get(
      scope,
      {
        PK: K.restaurantOccupancyPK(orgId, outletId, tableId),
        SK: K.restaurantOccupancySK(),
      },
      "OCCUPANCY",
    );
    let sessionId: string | undefined;
    if (occupancy) {
      if (
        occupancy.entityType !== "RESTAURANT_TABLE_OCCUPANCY" ||
        occupancy.data.tableId !== tableId ||
        occupancy.data.areaId !== serviceAreaId
      )
        return undefined;
      const session = await R.get(
        scope,
        {
          PK: K.restaurantSessionPK(
            orgId,
            outletId,
            occupancy.data.guestSessionId,
          ),
          SK: K.restaurantTransactionMetaSK(),
        },
        "SESSION",
      );
      if (
        session?.entityType !== "RESTAURANT_GUEST_SESSION" ||
        session.data.status !== "OPEN" ||
        session.data.tableId !== tableId ||
        session.data.areaId !== serviceAreaId
      )
        return undefined;
      sessionId = session.data.guestSessionId;
    }
    return {
      lookup,
      root: root.data,
      outlet: outlet.data,
      table: table.data,
      sessionId,
      tableToken: token,
    };
  }
  private static async response(
    c: NonNullable<Awaited<ReturnType<typeof GuestService.context>>>,
    old?: GuestPrincipal,
  ): Promise<GuestContextResponse> {
    const now = Math.floor(Date.now() / 1000),
      sessionId = old ? old.sessionId : c.sessionId;
    const enteredAt = old?.enteredAt ?? now;
    const expires = Math.min(
      now + (sessionId ? 1800 : 600),
      enteredAt + (sessionId ? 28800 : 600),
    );
    if (expires <= now) return { state: "EXPIRED" };
    const orderingPermitted = Boolean(
      sessionId && c.root.guestOrderingPolicy !== "DISABLED",
    );
    const guestHandle = old?.guestHandle ?? newGuestHandle();
    const claims: GuestPrincipal = {
      kind: "GUEST",
      v: 1,
      environment: process.env.STAGE ?? "",
      aud: "restaurants-guest",
      usage: "guest-capability",
      guestHandle,
      orgId: c.lookup.orgId,
      restaurantId: c.root.id,
      outletId: c.outlet.id,
      areaId: c.lookup.serviceAreaId,
      tableId: c.table.id,
      qrFingerprint: fingerprint(c.tableToken!),
      ...(sessionId ? { sessionId } : {}),
      rights: orderingPermitted
        ? ["CARTE_READ", "CALL_WAITER", "ORDER_SUBMIT"]
        : ["CARTE_READ", "CALL_WAITER"],
      enteredAt,
      iat: now,
      exp: expires,
    };
    return {
      state: sessionId ? "OCCUPIED" : "FREE",
      restaurantName: c.root.name,
      outletName: c.outlet.name,
      tableName: c.table.name.trim() || c.table.code,
      policy: c.root.guestOrderingPolicy,
      orderingPermitted,
      waiterCallAvailable: true,
      guestHandle,
      capability: await sealGuest(claims),
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }
  static async resolve(input: unknown): Promise<GuestContextResponse> {
    const parsed = GuestResolveRequestSchema.safeParse(input);
    if (!parsed.success) return { state: "UNAVAILABLE" };
    const c = await this.context(parsed.data.token);
    return c ? this.response(c) : { state: "UNAVAILABLE" };
  }
  static async renew(token: string): Promise<GuestContextResponse> {
    let old: GuestPrincipal;
    try {
      old = await openGuest(token);
    } catch (error) {
      return {
        state:
          error instanceof GuestCapabilityExpired ? "EXPIRED" : "UNAVAILABLE",
      };
    }
    const table = await Config.get(
      old.orgId,
      "table",
      { outletId: old.outletId, serviceAreaId: old.areaId },
      old.tableId,
    );
    if (
      !table?.qrToken ||
      table.qrRevoked ||
      fingerprint(table.qrToken) !== old.qrFingerprint
    )
      return { state: "UNAVAILABLE" };
    if (old.sessionId) {
      const bound = await R.get(
        { orgId: old.orgId, outletId: old.outletId },
        {
          PK: K.restaurantSessionPK(old.orgId, old.outletId, old.sessionId),
          SK: K.restaurantTransactionMetaSK(),
        },
        "SESSION",
      );
      if (
        bound?.entityType === "RESTAURANT_GUEST_SESSION" &&
        bound.data.status === "CLOSED"
      )
        return { state: "VISIT_ENDED" };
    }
    const c = await this.context(table.qrToken);
    if (!c || c.root.id !== old.restaurantId) return { state: "UNAVAILABLE" };
    if (old.sessionId && c.sessionId !== old.sessionId)
      return { state: "VISIT_ENDED" };
    // FREE never upgrades or rebinds. A fresh resolve is required even when a visit opens.
    if (!old.sessionId && c.sessionId) return { state: "EXPIRED" };
    return this.response(c, old);
  }
}
