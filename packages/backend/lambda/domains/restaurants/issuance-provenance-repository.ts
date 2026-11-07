import { GetItemCommand, TransactWriteItem } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { OrganizationLegalIdentityService } from "@/lambda/shared/services/organization-legal-identity-service";
import { admission } from "@/lambda/shared/authority/integrity";
import { AppError } from "@/lambda/shared/app-error";
import { restaurantsTableName } from "./restaurant-storage";
import {
  bindRestaurantIssuanceProvenance,
  restaurantIssuanceProvenanceSchema,
  restaurantIssuanceTimezoneSchema,
  verifyRestaurantIssuanceProvenance,
} from "./issuance-provenance";
import type { TransactionScope } from "./transaction-model";
import type { ReceiptManifest } from "./receipt-model";

function unavailable(): never {
  throw new AppError(409, "PROVENANCE_UNAVAILABLE");
}
/** Explicit local synthetic cutover only; never enables deployed/real-data publication. */
export const syntheticProvenanceEnabled = () =>
  process.env.NODE_ENV === "test" &&
  process.env.RESTAURANTS_SYNTHETIC_PROVENANCE === "1";

/** Server-controlled publication policy; disabled unless explicitly configured. */
export const authenticProvenanceEnabled = () =>
  process.env.RESTAURANTS_AUTHENTIC_PROVENANCE === "1";

export class RestaurantIssuanceProvenanceRepository {
  private static async get(Key: { PK: string; SK: string }) {
    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: restaurantsTableName(),
        Key: marshall(Key),
        ConsistentRead: true,
      }),
    );
    return response.Item ? unmarshall(response.Item) : undefined;
  }
  static async read(scope: TransactionScope, m: ReceiptManifest) {
    const row = await this.get({
      PK: K.restaurantBillPK(scope.orgId, scope.outletId, m.receiptId),
      SK: K.restaurantIssuanceProvenanceSK(),
    });
    if (!row)
      return verifyRestaurantIssuanceProvenance(
        undefined,
        this.expected(scope, m),
      );
    if (
      row.orgId !== scope.orgId ||
      row.outletId !== scope.outletId ||
      row.invoiceId !== m.receiptId ||
      row.entityType !== "RESTAURANT_INVOICE_ISSUANCE_PROVENANCE" ||
      row.schemaVersion !== 1
    )
      throw new AppError(409, "PROVENANCE_INTEGRITY");
    const result = verifyRestaurantIssuanceProvenance(
      row.data,
      this.expected(scope, m),
    );
    if (
      !result.verified ||
      (m.issuanceProvenanceOrigin === "AUTHENTIC" &&
        result.evidence.evidenceOrigin !== "AUTHENTIC") ||
      (m.issuanceProvenanceOrigin !== "AUTHENTIC" &&
        result.evidence.evidenceOrigin === "AUTHENTIC") ||
      result.evidence.sourceVersion !== m.sourceVersion ||
      result.evidence.financialRevision !== m.financialRevision ||
      result.evidence.finalManifestVersion !== m.version
    )
      throw new AppError(409, "PROVENANCE_INTEGRITY");
    return result;
  }
  private static expected(scope: TransactionScope, m: ReceiptManifest) {
    return {
      ...scope,
      invoiceId: m.receiptId,
      guestSessionId: m.guestSessionId,
      commercialRootDigest: m.digest,
      issuedAt: m.result?.issuedAt ?? "",
    };
  }
  static async prepare(
    scope: TransactionScope,
    actorId: string,
    m: ReceiptManifest,
    now: string,
  ): Promise<TransactWriteItem[]> {
    const authentic = m.issuanceProvenanceOrigin === "AUTHENTIC";
    if (!authentic && !syntheticProvenanceEnabled()) unavailable();
    const seller =
      await OrganizationLegalIdentityService.readSellerIssuanceAuthority(
        scope.orgId,
      );
    const key = {
      PK: K.orgKey(scope.orgId),
      SK: K.restaurantIssuanceTimezoneCurrentSK(),
    };
    const current = await this.get(key);
    if (
      !current ||
      current.orgId !== scope.orgId ||
      current.entityType !== "RESTAURANTS_ISSUANCE_TIMEZONE_CURRENT" ||
      current.status !== "ACTIVE" ||
      !Number.isSafeInteger(current.version) ||
      Number(current.version) < 1
    )
      unavailable();
    const reference = z.string().uuid().parse(current.selectedRevisionId);
    const revision = await this.get({
      PK: key.PK,
      SK: K.restaurantIssuanceTimezoneRevisionSK(reference),
    });
    if (
      !revision ||
      revision.entityType !== "RESTAURANTS_ISSUANCE_TIMEZONE_REVISION" ||
      revision.orgId !== scope.orgId ||
      revision.revisionId !== reference ||
      revision.recordVersion !== 1
    )
      unavailable();
    const timezone = restaurantIssuanceTimezoneSchema.parse(
      Object.fromEntries(
        Object.keys(restaurantIssuanceTimezoneSchema.shape).map((k) => [
          k,
          revision[k],
        ]),
      ),
    );
    if (
      timezone.reference !== reference ||
      ["configurationDigest", "approvalReference", "approvalVersion"].some(
        (k) => current[k] !== revision[k],
      )
    )
      unavailable();
    // Owner records are immutable reviewed authorities; this consumer never creates or repairs them.
    const values = seller.check.ConditionCheck?.ExpressionAttributeValues;
    const names = seller.check.ConditionCheck?.ExpressionAttributeNames;
    const versionName = Object.entries(names ?? {}).find(
      ([, value]) => value === "version",
    )?.[0];
    const index = versionName?.replace("#f", "");
    const sellerVersion = Number(
      index === undefined ? NaN : values?.[`:v${index}`]?.N,
    );
    if (!Number.isSafeInteger(sellerVersion) || sellerVersion < 1)
      unavailable();
    const data = bindRestaurantIssuanceProvenance({
      ...(m.issuanceProvenanceOrigin
        ? { evidenceOrigin: m.issuanceProvenanceOrigin }
        : {}),
      schemaVersion: 1,
      captureProtocol: "RESTAURANTS-FINAL-AUTHORITY-1",
      ...scope,
      invoiceId: m.receiptId,
      guestSessionId: m.guestSessionId,
      sourceVersion: m.sourceVersion,
      financialRevision: m.financialRevision,
      finalManifestVersion: m.version,
      event: "RESTAURANTS_INVOICE_FINAL",
      issuedAt: now,
      capturedAt: now,
      actorUserId: actorId,
      commercialRootDigest: m.digest,
      seller: seller.sellerAuthority,
      timezone,
      sellerSelectionVersion: sellerVersion,
      timezoneSelectionVersion: Number(current.version),
    });
    const row = {
      PK: K.restaurantBillPK(scope.orgId, scope.outletId, m.receiptId),
      SK: K.restaurantIssuanceProvenanceSK(),
      ...scope,
      invoiceId: m.receiptId,
      entityType: "RESTAURANT_INVOICE_ISSUANCE_PROVENANCE",
      schemaVersion: 1,
      data: restaurantIssuanceProvenanceSchema.parse(data),
    };
    admission(row, 128 * 1024);
    const fields = Object.keys(current).filter(
      (k) => !["PK", "SK", "updatedAt", "updatedByUserId"].includes(k),
    );
    return [
      seller.check,
      {
        ConditionCheck: {
          TableName: restaurantsTableName(),
          Key: marshall(key),
          ConditionExpression: fields
            .map((_, i) => `#f${i} = :v${i}`)
            .join(" AND "),
          ExpressionAttributeNames: Object.fromEntries(
            fields.map((k, i) => [`#f${i}`, k]),
          ),
          ExpressionAttributeValues: marshall(
            Object.fromEntries(fields.map((k, i) => [`:v${i}`, current[k]])),
          ),
        },
      },
      {
        Put: {
          TableName: restaurantsTableName(),
          Item: marshall(row),
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        },
      },
    ];
  }
}
