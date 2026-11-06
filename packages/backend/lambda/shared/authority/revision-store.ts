import {
  GetItemCommand,
  PutItemCommand,
  TransactWriteItemsCommand,
  TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";
import { AppError } from "../app-error";
import { admission, canonical, clean } from "./integrity";

interface StoreOptions {
  type: string;
  cap: number;
  revisionKey: (id: string) => string;
  currentKey: () => string;
  historyKey: (v: number) => string;
  digestField: "identityDigest" | "configurationDigest";
}
/** Shared transaction mechanics only. Each owner supplies its own keys and validated business evidence. */
export class RevisionStore {
  constructor(private readonly options: StoreOptions) {}
  private key(orgId: string, SK: string) {
    return {
      PK: KeyFactory.orgKey(z.string().min(1).max(200).parse(orgId)),
      SK,
    };
  }
  private async get(
    orgId: string,
    SK: string,
  ): Promise<Record<string, unknown> | undefined> {
    const r = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall(this.key(orgId, SK)),
        ConsistentRead: true,
      }),
    );
    if (!r.Item) return undefined;
    const item = unmarshall(r.Item);
    if (item.orgId !== orgId)
      throw new AppError(409, "AUTHORITY_TENANT_MISMATCH");
    return item;
  }
  async revision(orgId: string, id: string) {
    const item = await this.get(
      orgId,
      this.options.revisionKey(
        z
          .string()
          .regex(
            /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
          )
          .parse(id),
      ),
    );
    if (
      !item ||
      item.entityType !== `${this.options.type}_REVISION` ||
      item.revisionId !== id ||
      item.recordVersion !== 1
    )
      throw new AppError(409, "AUTHORITY_REVISION_UNAVAILABLE");
    return item;
  }
  async create(
    orgId: string,
    id: string,
    data: Record<string, unknown>,
    actorUserId: string,
  ): Promise<void> {
    const item = clean({
      ...data,
      ...this.key(
        orgId,
        this.options.revisionKey(
          z
            .string()
            .regex(
              /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
            )
            .parse(id),
        ),
      ),
      orgId,
      revisionId: id,
      recordVersion: 1,
      entityType: `${this.options.type}_REVISION`,
      createdAt: new Date().toISOString(),
      createdByUserId: z.string().min(1).max(200).parse(actorUserId),
    });
    admission(item, this.options.cap);
    try {
      await dynamoClient.send(
        new PutItemCommand({
          TableName: config.TABLE_NAME,
          Item: marshall(item),
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        }),
      );
    } catch (e) {
      if ((e as Error).name !== "ConditionalCheckFailedException") throw e;
      const old = await this.revision(orgId, id);
      const { createdAt, createdByUserId, ...a } = old;
      const { createdAt: _a, createdByUserId: _b, ...b } = item;
      if (canonical(a) !== canonical(b))
        throw new AppError(409, "AUTHORITY_REVISION_CONFLICT");
    }
  }
  async select(
    orgId: string,
    id: string,
    expectedVersion: number,
    actorUserId: string,
    status: "ACTIVE" | "DISABLED",
    facts: Record<string, unknown>,
  ): Promise<void> {
    z.number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1)
      .parse(expectedVersion);
    const revision = await this.revision(orgId, id);
    const old = await this.get(orgId, this.options.currentKey());
    if ((old?.version ?? 0) !== expectedVersion)
      throw new AppError(409, "AUTHORITY_SELECTION_CONFLICT");
    if (
      status === "DISABLED" &&
      (!old || old.status !== "ACTIVE" || old.selectedRevisionId !== id)
    )
      throw new AppError(409, "AUTHORITY_SELECTION_CONFLICT");
    if (
      status === "ACTIVE" &&
      old?.status === "DISABLED" &&
      old.selectedRevisionId === id
    )
      throw new AppError(409, "AUTHORITY_NEW_ACCEPTANCE_REQUIRED");
    const version = expectedVersion + 1;
    const now = new Date().toISOString();
    const current = clean({
      ...this.key(orgId, this.options.currentKey()),
      entityType: `${this.options.type}_CURRENT`,
      orgId,
      version,
      status,
      selectedRevisionId: id,
      ...facts,
      updatedAt: now,
      updatedByUserId: actorUserId,
    });
    const history = clean({
      ...this.key(orgId, this.options.historyKey(version)),
      entityType: `${this.options.type}_SELECTION`,
      orgId,
      version,
      previousVersion: expectedVersion,
      status,
      selectedRevisionId: id,
      ...facts,
      actorUserId,
      occurredAt: now,
    });
    admission(current, 4096);
    admission(history, 4096);
    await dynamoClient.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: config.TABLE_NAME,
              Key: marshall(this.key(orgId, this.options.revisionKey(id))),
              ConditionExpression:
                "entityType = :type AND orgId = :org AND #digest = :digest",
              ExpressionAttributeNames: { "#digest": this.options.digestField },
              ExpressionAttributeValues: marshall({
                ":type": `${this.options.type}_REVISION`,
                ":org": orgId,
                ":digest": revision[this.options.digestField],
              }),
            },
          },
          {
            Put: {
              TableName: config.TABLE_NAME,
              Item: marshall(current),
              ConditionExpression:
                expectedVersion === 0
                  ? "attribute_not_exists(PK) AND attribute_not_exists(SK)"
                  : "#version = :version AND entityType = :type AND orgId = :org",
              ...(expectedVersion === 0
                ? {}
                : {
                    ExpressionAttributeNames: { "#version": "version" },
                    ExpressionAttributeValues: marshall({
                      ":version": expectedVersion,
                      ":type": `${this.options.type}_CURRENT`,
                      ":org": orgId,
                    }),
                  }),
            },
          },
          {
            Put: {
              TableName: config.TABLE_NAME,
              Item: marshall(history),
              ConditionExpression:
                "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            },
          },
        ],
      }),
    );
  }
  async current(
    orgId: string,
  ): Promise<{ revision: Record<string, unknown>; check: TransactWriteItem }> {
    const p = await this.get(orgId, this.options.currentKey());
    if (
      !p ||
      p.entityType !== `${this.options.type}_CURRENT` ||
      p.status !== "ACTIVE" ||
      !Number.isSafeInteger(p.version) ||
      Number(p.version) < 1
    )
      throw new AppError(409, "AUTHORITY_UNAVAILABLE");
    const revision = await this.revision(
      orgId,
      z
        .string()
        .regex(
          /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
        )
        .parse(p.selectedRevisionId),
    );
    if (
      revision[this.options.digestField] !== p[this.options.digestField] ||
      [
        "acceptanceReference",
        "acceptanceVersion",
        "legalEntityReference",
        "approvalReference",
      ].some((k) => p[k] !== undefined && p[k] !== revision[k])
    )
      throw new AppError(409, "AUTHORITY_DIGEST_MISMATCH");
    // Match all immutable selection approval/subject fields as well as the ABA-resistant counter.
    const fields = Object.keys(p).filter(
      (k) => !["PK", "SK", "updatedAt", "updatedByUserId"].includes(k),
    );
    const names = Object.fromEntries(fields.map((k, i) => [`#f${i}`, k]));
    const values = Object.fromEntries(fields.map((k, i) => [`:v${i}`, p[k]]));
    return {
      revision,
      check: {
        ConditionCheck: {
          TableName: config.TABLE_NAME,
          Key: marshall(this.key(orgId, this.options.currentKey())),
          ConditionExpression: fields
            .map((_, i) => `#f${i} = :v${i}`)
            .join(" AND "),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: marshall(values),
        },
      },
    };
  }
}
