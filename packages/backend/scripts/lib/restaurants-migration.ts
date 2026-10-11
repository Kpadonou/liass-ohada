import { createHash } from "node:crypto";
import {
  RestaurantIdSchema,
  RestaurantTableQrResponseSchema,
} from "@liass-ohada/shared/restaurants";
import { AttributeValue } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory } from "../../lambda/shared/key-builder";
import {
  entitySchemas,
  entityTypes,
  entitySK,
  RestaurantKind,
} from "../../lambda/domains/restaurants/restaurant-model";

export type Item = Record<string, AttributeValue>;
const keyId = (item: Item) => JSON.stringify([item.PK?.S, item.SK?.S]);
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
export const fingerprint = (item: Item) =>
  createHash("sha256").update(stable(item)).digest("hex");
const legacyPrefixes: Record<RestaurantKind, string> = {
  restaurant: "RESTAURANTS#ROOT",
  outlet: "RESTAURANTS#OUTLET#",
  serviceArea: "RESTAURANTS#AREA#",
  table: "RESTAURANTS#TABLE#",
  station: "RESTAURANTS#STATION#",
  menu: "RESTAURANTS#MENU#",
  category: "RESTAURANTS#CATEGORY#",
  item: "RESTAURANTS#ITEM#",
};
export class MigrationValidationError extends Error {
  constructor(
    public readonly category: "unknown" | "validation",
    message: string,
  ) {
    super(message);
  }
}
/** Legacy parsing is isolated here. Payload AttributeValues are preserved exactly. */
export function transformLegacy(item: Item): Item | undefined {
  const raw = unmarshall(item);
  const pk = item.PK?.S ?? "",
    sk = item.SK?.S ?? "";
  const candidate =
    sk.startsWith("RESTAURANTS") ||
    pk.startsWith("RESTAURANTS") ||
    String(raw.entityType).startsWith("RESTAURANT");
  if (!candidate) return undefined;
  const fail = (): never => {
    throw new MigrationValidationError(
      "validation",
      "Malformed Restaurants source record",
    );
  };
  let targetPK = pk,
    targetSK: string;
  if (raw.entityType === "RESTAURANT_TABLE_QR") {
    if (!/^RESTAURANTS_QR#[a-f0-9]{64}$/.test(pk) || sk !== "LOOKUP") fail();
    for (const name of [
      "orgId",
      "restaurantId",
      "outletId",
      "serviceAreaId",
      "tableId",
    ])
      if (typeof raw[name] !== "string" || !raw[name]) fail();
    for (const name of ["restaurantId", "outletId", "serviceAreaId", "tableId"])
      if (!RestaurantIdSchema.safeParse(raw[name]).success) fail();
    targetPK = KeyFactory.restaurantQrPK(pk.slice("RESTAURANTS_QR#".length));
    targetSK = KeyFactory.restaurantQrSK();
  } else {
    if (
      typeof raw.orgId !== "string" ||
      !raw.orgId ||
      pk !== KeyFactory.orgKey(raw.orgId)
    )
      fail();
    if (raw.entityType === "RESTAURANT_TABLE_CODE") {
      if (typeof raw.outletId !== "string" || typeof raw.tableId !== "string")
        fail();
      if (
        !RestaurantIdSchema.safeParse(raw.outletId).success ||
        !RestaurantIdSchema.safeParse(raw.tableId).success
      )
        fail();
      const prefix = `RESTAURANTS#TABLE_CODE#${raw.outletId}#`;
      const code = sk.slice(prefix.length);
      if (!sk.startsWith(prefix) || !code || code.includes("#")) fail();
      targetSK = KeyFactory.restaurantTableCodeSK(raw.outletId, code);
    } else {
      const kind = (Object.keys(entityTypes) as RestaurantKind[]).find(
        (k) => entityTypes[k] === raw.entityType,
      );
      if (!kind)
        throw new MigrationValidationError(
          "unknown",
          "Unknown Restaurants entity family",
        );
      const result = entitySchemas[kind].safeParse(raw.data);
      if (
        !result.success ||
        !/^[a-f0-9]{64}$/.test(String(raw.createFingerprint))
      )
        fail();
      if (
        raw.qrToken !== undefined &&
        !RestaurantTableQrResponseSchema.shape.token.safeParse(raw.qrToken)
          .success
      )
        fail();
      const data = result.data as unknown as Record<string, string>;
      const parents = {
        outletId: data.outletId,
        serviceAreaId: data.serviceAreaId,
        categoryId: data.categoryId,
      };
      targetSK = entitySK(kind, parents, data.id);
      const suffix =
        kind === "restaurant" ? "" : targetSK.slice(targetSK.indexOf("#") + 1);
      if (sk !== legacyPrefixes[kind] + suffix) fail();
    }
  }
  return { ...item, PK: { S: targetPK }, SK: { S: targetSK } };
}

/** Validate complete graph, reservation correspondence and token-hash lookups before any writes. */
export function validateGraph(items: Item[]): void {
  const map = new Map(items.map((item) => [keyId(item), item]));
  const get = (org: string, sk: string) =>
    map.get(JSON.stringify([KeyFactory.orgKey(org), sk]));
  const require = (item: Item | undefined) => {
    if (!item)
      throw new MigrationValidationError(
        "validation",
        "Incomplete Restaurants hierarchy or lookup",
      );
    return unmarshall(item);
  };
  for (const item of items) {
    const raw = unmarshall(item),
      org = raw.orgId as string;
    const data = raw.data as Record<string, string> | undefined;
    if (data && raw.entityType !== "RESTAURANT") {
      const root = require(get(org, KeyFactory.restaurantSK()));
      if (
        raw.entityType === "RESTAURANT_OUTLET" &&
        data.restaurantId !== (root.data as Record<string, string>).id
      )
        throw new MigrationValidationError(
          "validation",
          "Outlet root mismatch",
        );
      if (data.outletId)
        require(get(org, KeyFactory.restaurantOutletSK(data.outletId)));
      if (data.serviceAreaId)
        require(
          get(
            org,
            KeyFactory.restaurantServiceAreaSK(
              data.outletId,
              data.serviceAreaId,
            ),
          ),
        );
      if (data.categoryId)
        require(
          get(
            org,
            KeyFactory.restaurantCategorySK(data.outletId, data.categoryId),
          ),
        );
      if (data.menuId) {
        const menu = require(
          get(org, KeyFactory.restaurantMenuSK(data.outletId)),
        );
        if ((menu.data as Record<string, string>).id !== data.menuId)
          throw new MigrationValidationError(
            "validation",
            "Menu reference mismatch",
          );
      }
      if (data.preparationStationId)
        require(
          get(
            org,
            KeyFactory.restaurantStationSK(
              data.outletId,
              data.preparationStationId,
            ),
          ),
        );
      if (raw.entityType === "RESTAURANT_TABLE") {
        const code = require(
          get(org, KeyFactory.restaurantTableCodeSK(data.outletId, data.code)),
        );
        if (code.tableId !== data.id)
          throw new MigrationValidationError(
            "validation",
            "Reservation mismatch",
          );
        if (typeof raw.qrToken !== "string")
          throw new MigrationValidationError(
            "validation",
            "Missing table QR token",
          );
        const hash = createHash("sha256").update(raw.qrToken).digest("hex");
        const qr = require(
          map.get(JSON.stringify([KeyFactory.restaurantQrPK(hash), "LOOKUP"])),
        );
        if (
          qr.orgId !== org ||
          qr.tableId !== data.id ||
          qr.outletId !== data.outletId ||
          qr.serviceAreaId !== data.serviceAreaId ||
          qr.restaurantId !== (root.data as Record<string, string>).id
        )
          throw new MigrationValidationError(
            "validation",
            "QR reference mismatch",
          );
      }
    }
    if (raw.entityType === "RESTAURANT_TABLE_QR") {
      const table = require(
        get(
          org,
          KeyFactory.restaurantTableSK(
            raw.outletId,
            raw.serviceAreaId,
            raw.tableId,
          ),
        ),
      );
      const token = table.qrToken;
      if (
        typeof token !== "string" ||
        item.PK.S !==
          KeyFactory.restaurantQrPK(
            createHash("sha256").update(token).digest("hex"),
          )
      )
        throw new MigrationValidationError("validation", "Orphan QR mapping");
    }
    if (raw.entityType === "RESTAURANT_TABLE_CODE") {
      const table = items
        .map((item) => unmarshall(item))
        .find(
          (row) =>
            row.orgId === org &&
            row.entityType === "RESTAURANT_TABLE" &&
            row.data.id === raw.tableId &&
            row.data.outletId === raw.outletId,
        );
      if (
        !table ||
        item.SK.S !==
          KeyFactory.restaurantTableCodeSK(raw.outletId, table.data.code)
      )
        throw new MigrationValidationError(
          "validation",
          "Orphan code reservation",
        );
    }
  }
}
export interface MigrationStore {
  inventory(table: string): Promise<Item[]>;
  get(table: string, item: Item): Promise<Item | undefined>;
  putAbsent(table: string, item: Item): Promise<void>;
}
export interface MigrationOptions {
  stage: "dev" | "test" | "prod";
  source: string;
  target: string;
  apply: boolean;
  confirmProduction: boolean;
}
export function validateOptions(options: MigrationOptions): void {
  if (
    !["dev", "test", "prod"].includes(options.stage) ||
    options.source !== `liass-ohada-${options.stage}-accounting-table` ||
    options.target !== `liass-ohada-${options.stage}-restaurants-table`
  )
    throw new Error(
      "Explicit stage and canonical, distinct table identities required",
    );
  if (options.apply && options.stage === "prod" && !options.confirmProduction)
    throw new Error("Production writes require --confirm-production");
}
export async function migrateRestaurants(
  store: MigrationStore,
  options: MigrationOptions,
) {
  validateOptions(options);
  const report = {
    mode: options.apply ? "APPLY" : "DRY_RUN",
    sourceCount: 0,
    targetCount: 0,
    mappingCount: 0,
    qrCount: 0,
    conflictCount: 0,
    unknownKeyCount: 0,
    validationErrorCount: 0,
    missingCount: 0,
    createdCount: 0,
    identicalCount: 0,
    families: {} as Record<string, number>,
    sourceFingerprint: "",
    targetFingerprint: "",
    verified: false,
  };
  const planned: Item[] = [];
  for (const item of await store.inventory(options.source)) {
    try {
      const target = transformLegacy(item);
      if (target) {
        report.sourceCount++;
        planned.push(target);
      }
    } catch (error) {
      report.sourceCount++;
      if (
        error instanceof MigrationValidationError &&
        error.category === "unknown"
      )
        report.unknownKeyCount++;
      else report.validationErrorCount++;
    }
  }
  report.mappingCount = planned.length;
  const keys = new Set<string>();
  for (const item of planned) {
    if (keys.has(keyId(item))) report.validationErrorCount++;
    keys.add(keyId(item));
    const type = item.entityType.S!;
    report.families[type] = (report.families[type] ?? 0) + 1;
  }
  report.qrCount = report.families.RESTAURANT_TABLE_QR ?? 0;
  try {
    validateGraph(planned);
  } catch {
    report.validationErrorCount++;
  }
  const destination = await store.inventory(options.target);
  report.targetCount = destination.length;
  for (const item of destination) {
    if (!keys.has(keyId(item))) report.conflictCount++;
  }
  // Preflight every destination conflict before performing any mutation.
  for (const item of planned) {
    const existing = await store.get(options.target, item);
    if (existing) {
      if (fingerprint(existing) === fingerprint(item)) report.identicalCount++;
      else report.conflictCount++;
    } else report.missingCount++;
  }
  report.sourceFingerprint = fingerprint({
    manifest: {
      S: planned
        .map((item) => `${keyId(item)}:${fingerprint(item)}`)
        .sort()
        .join("\n"),
    },
  });
  if (
    report.unknownKeyCount ||
    report.validationErrorCount ||
    report.conflictCount
  )
    return report;
  if (options.apply)
    for (const item of planned) {
      const existing = await store.get(options.target, item);
      if (existing) {
        if (fingerprint(existing) !== fingerprint(item)) {
          report.conflictCount++;
          return report;
        }
        continue;
      }
      try {
        await store.putAbsent(options.target, item);
        report.createdCount++;
      } catch (error) {
        if ((error as Error).name !== "ConditionalCheckFailedException")
          throw error;
        const raced = await store.get(options.target, item);
        if (!raced || fingerprint(raced) !== fingerprint(item)) {
          report.conflictCount++;
          return report;
        }
      }
    }
  const final = await store.inventory(options.target);
  report.targetCount = final.length;
  report.targetFingerprint = fingerprint({
    manifest: {
      S: final
        .map((item) => `${keyId(item)}:${fingerprint(item)}`)
        .sort()
        .join("\n"),
    },
  });
  report.verified = report.sourceFingerprint === report.targetFingerprint;
  return report;
}
