import { createHash } from "crypto";
import {
  GuestContextResponse,
  GuestResolveRequestSchema,
} from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";
import { AppError } from "@/lambda/shared/app-error";
import type { RestaurantSnapshot } from "./restaurant-repository";
import { RestaurantsRepository as Config } from "./restaurant-repository";
import { RestaurantTransactionsRepository as R } from "./transaction-repository";
import {
  GuestPrincipal,
  openGuest,
  sealGuest,
  newGuestHandle,
  GuestCapabilityExpired,
} from "./guest-capability";
import { publicVisitReference } from "./guest-references";

const fingerprint = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export type BoundGuestOrder = {
  orgId: string;
  outletId: string;
  areaId?: string;
  tableId: string;
  sessionId?: string;
  guestHandle: string;
  qrFingerprint?: string;
  expiresAt: string;
};
/** Bounded to one resolve/verify call. Never survives a request or caches authorization. */
class GuestReads {
  private readonly tables = new Map<
    string,
    Promise<RestaurantSnapshot<"table"> | undefined>
  >();
  private readonly sessions = new Map<string, ReturnType<typeof R.get>>();
  table(
    orgId: string,
    outletId: string,
    serviceAreaId: string,
    tableId: string,
  ) {
    const key = JSON.stringify([orgId, outletId, serviceAreaId, tableId]);
    let value = this.tables.get(key);
    if (!value) {
      value = Config.get(orgId, "table", { outletId, serviceAreaId }, tableId);
      this.tables.set(key, value);
    }
    return value;
  }
  session(orgId: string, outletId: string, sessionId: string) {
    const key = JSON.stringify([orgId, outletId, sessionId]);
    let value = this.sessions.get(key);
    if (!value) {
      value = R.get(
        { orgId, outletId },
        {
          PK: K.restaurantSessionPK(orgId, outletId, sessionId),
          SK: K.restaurantTransactionMetaSK(),
        },
        "SESSION",
      );
      this.sessions.set(key, value);
    }
    return value;
  }
}
export class GuestService {
  private static async context(token: string, reads = new GuestReads()) {
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
      reads.table(orgId, outletId, serviceAreaId, tableId),
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
      const session = await reads.session(
        orgId,
        outletId,
        occupancy.data.guestSessionId,
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
      c.root.guestOrderingPolicy !== "DISABLED",
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
    const common = {
      restaurantName: c.root.name,
      outletName: c.outlet.name,
      tableName: c.table.name.trim() || c.table.code,
      policy: c.root.guestOrderingPolicy,
      orderingPermitted,
      waiterCallAvailable: true as const,
      guestHandle,
      capability: await sealGuest(claims),
      expiresAt: new Date(expires * 1000).toISOString(),
    };
    const visitRef = await publicVisitReference(claims);
    return sessionId && visitRef
      ? { state: "OCCUPIED", visitRef, ...common }
      : { state: "FREE", visitRef: null, ...common };
  }
  static async resolve(input: unknown): Promise<GuestContextResponse> {
    const parsed = GuestResolveRequestSchema.safeParse(input);
    if (!parsed.success) return { state: "UNAVAILABLE" };
    const c = await this.context(parsed.data.token);
    if (!c) return { state: "UNAVAILABLE" };
    if (parsed.data.previousCapability) {
      let old: GuestPrincipal;
      try {
        old = await openGuest(parsed.data.previousCapability, true);
      } catch {
        return { state: "UNAVAILABLE" };
      }
      if (
        old.qrFingerprint !== fingerprint(parsed.data.token) ||
        old.orgId !== c.lookup.orgId ||
        old.tableId !== c.table.id ||
        old.outletId !== c.outlet.id ||
        old.areaId !== c.lookup.serviceAreaId ||
        old.restaurantId !== c.root.id
      )
        return { state: "UNAVAILABLE" };
      if (old.sessionId && old.sessionId !== c.sessionId)
        return { state: "VISIT_ENDED" };
      return this.response(c, {
        ...old,
        sessionId: c.sessionId,
        enteredAt: old.sessionId
          ? old.enteredAt
          : Math.floor(Date.now() / 1000),
      });
    }
    return this.response(c);
  }
  /** Canonical staff continuation uses the bound request, not a Guest secret. */
  static async verifyBound(row: BoundGuestOrder) {
    if (Date.parse(row.expiresAt) <= Date.now())
      return { state: "EXPIRED" as const };
    if (!row.areaId || !row.sessionId || !row.qrFingerprint)
      return { state: "UNAVAILABLE" as const };
    const table = await Config.get(
      row.orgId,
      "table",
      { outletId: row.outletId, serviceAreaId: row.areaId },
      row.tableId,
    );
    if (
      !table?.qrToken ||
      table.qrRevoked ||
      fingerprint(table.qrToken) !== row.qrFingerprint
    )
      return { state: "UNAVAILABLE" as const };
    let context: Awaited<ReturnType<typeof GuestService.context>>;
    try {
      context = await this.context(table.qrToken);
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 403)
        return { state: "UNAVAILABLE" as const };
      throw error;
    }
    if (
      !context ||
      context.lookup.orgId !== row.orgId ||
      context.outlet.id !== row.outletId ||
      context.lookup.serviceAreaId !== row.areaId ||
      context.table.id !== row.tableId ||
      context.sessionId !== row.sessionId
    )
      return { state: "UNAVAILABLE" as const };
    return {
      principal: {
        orgId: row.orgId,
        outletId: row.outletId,
        areaId: row.areaId,
        tableId: row.tableId,
        sessionId: row.sessionId,
        guestHandle: row.guestHandle,
        rights: ["ORDER_SUBMIT" as const],
        exp: Math.ceil(Date.parse(row.expiresAt) / 1000),
      },
      context,
    };
  }
  static async verify(token: string): Promise<
    | {
        principal: GuestPrincipal;
        context: NonNullable<Awaited<ReturnType<typeof GuestService.context>>>;
      }
    | { state: "UNAVAILABLE" | "EXPIRED" | "VISIT_ENDED" }
  > {
    let old: GuestPrincipal;
    try {
      old = await openGuest(token);
    } catch (error) {
      return {
        state:
          error instanceof GuestCapabilityExpired ? "EXPIRED" : "UNAVAILABLE",
      };
    }
    const reads = new GuestReads();
    const table = await reads.table(
      old.orgId,
      old.outletId,
      old.areaId,
      old.tableId,
    );
    if (
      !table?.qrToken ||
      table.qrRevoked ||
      fingerprint(table.qrToken) !== old.qrFingerprint
    )
      return { state: "UNAVAILABLE" };
    if (old.sessionId) {
      const bound = await reads.session(old.orgId, old.outletId, old.sessionId);
      if (
        bound?.entityType === "RESTAURANT_GUEST_SESSION" &&
        bound.data.status === "CLOSED"
      )
        return { state: "VISIT_ENDED" };
    }
    const c = await this.context(table.qrToken, reads);
    if (!c || c.root.id !== old.restaurantId) return { state: "UNAVAILABLE" };
    if (old.sessionId && c.sessionId !== old.sessionId)
      return { state: "VISIT_ENDED" };
    // FREE never upgrades or rebinds. A fresh resolve is required even when a visit opens.
    if (!old.sessionId && c.sessionId) return { state: "EXPIRED" };
    return { principal: old, context: c };
  }
  static async renew(token: string): Promise<GuestContextResponse> {
    const verified = await this.verify(token);
    return "principal" in verified
      ? this.response(verified.context, verified.principal)
      : (verified as GuestContextResponse);
  }
}
