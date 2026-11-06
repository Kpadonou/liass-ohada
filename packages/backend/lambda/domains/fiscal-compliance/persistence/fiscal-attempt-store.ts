import { GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { config, dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { admission } from "@/lambda/shared/authority/integrity";
import {
  FiscalAttemptConflict,
  FiscalAttemptEvent,
  FiscalObligationIdentity,
  fiscalAttemptStateSchema,
  reserveFiscalAttempt,
  transitionFiscalAttempt,
  obligationIdentity,
  fiscalReconciliationRead,
} from "../core/fiscal-attempt-state";

/** One bounded authoritative effect aggregate. Commands, UID and state share one
 * conditional item; provider changes cannot select a new reservation key.
 * Synthetic development only. No HTTP dispatch, automatic write retry or TTL.
 */
export class FiscalAttemptStore {
  private enabled() {
    if (
      process.env.NODE_ENV !== "test" ||
      process.env.FISCAL_SYNTHETIC_STORAGE !== "1"
    )
      throw new FiscalAttemptConflict("SCOPE_DENIED");
  }
  private key(scope: FiscalObligationIdentity) {
    return {
      PK: KeyFactory.orgKey(scope.orgId),
      SK: KeyFactory.fiscalAttemptEffectSK(
        scope.environment,
        obligationIdentity(scope),
      ),
    };
  }
  async read(scope: FiscalObligationIdentity) {
    this.enabled();
    const key = this.key(scope);
    try {
      const response = await dynamoClient.send(
        new GetItemCommand({
          TableName: config.TABLE_NAME,
          Key: marshall(key),
          ConsistentRead: true,
        }),
      );
      if (!response.Item) return undefined;
      const row = unmarshall(response.Item);
      if (
        row.PK !== key.PK ||
        row.SK !== key.SK ||
        row.orgId !== scope.orgId ||
        row.entityType !== "FISCAL_ATTEMPT_EFFECT" ||
        row.schemaVersion !== 1
      )
        throw new FiscalAttemptConflict("SCOPE_DENIED");
      const state = fiscalAttemptStateSchema.safeParse(row.state);
      if (
        !state.success ||
        state.data.obligationId !== obligationIdentity(scope) ||
        row.version !== state.data.version
      )
        throw new FiscalAttemptConflict("INVALID_INPUT");
      return state.data;
    } catch (error) {
      this.fail(error);
    }
  }
  private fail(error: unknown): never {
    if (error instanceof FiscalAttemptConflict) throw error;
    // Never surface raw AWS messages, response bodies or request state.
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "ConditionalCheckFailedException"
    )
      throw new FiscalAttemptConflict("VERSION_CONFLICT");
    throw new Error("FISCAL_STORAGE_OUTCOME_UNKNOWN");
  }
  async reserve(input: Parameters<typeof reserveFiscalAttempt>[0]) {
    this.enabled();
    const state = reserveFiscalAttempt(input);
    await this.write(state, undefined);
    return state;
  }
  private async write(
    state: ReturnType<typeof reserveFiscalAttempt>,
    expectedVersion: number | undefined,
  ) {
    const row = {
      ...this.key(state.identity),
      orgId: state.identity.orgId,
      entityType: "FISCAL_ATTEMPT_EFFECT",
      schemaVersion: 1,
      version: state.version,
      state,
    };
    admission(row, 128 * 1024);
    try {
      await dynamoClient.send(
        new PutItemCommand({
          TableName: config.TABLE_NAME,
          Item: marshall(row, { removeUndefinedValues: true }),
          ConditionExpression:
            expectedVersion === undefined
              ? "attribute_not_exists(PK) AND attribute_not_exists(SK)"
              : "#version = :version AND orgId = :org AND entityType = :type",
          ...(expectedVersion === undefined
            ? {}
            : {
                ExpressionAttributeNames: { "#version": "version" },
                ExpressionAttributeValues: marshall({
                  ":version": expectedVersion,
                  ":org": state.identity.orgId,
                  ":type": "FISCAL_ATTEMPT_EFFECT",
                }),
              }),
        }),
      );
    } catch (error) {
      this.fail(error);
    }
  }
  async transition(
    scope: FiscalObligationIdentity,
    expectedVersion: number,
    event: FiscalAttemptEvent,
  ) {
    const state = await this.read(scope);
    if (!state) throw new FiscalAttemptConflict("INVALID_INPUT");
    const result = transitionFiscalAttempt(
      state,
      scope,
      expectedVersion,
      event,
    );
    if (!result.replay) await this.write(result.state, state.version);
    // replay is evidence only, never permission to send another provider mutation.
    return result;
  }
  async recover(scope: FiscalObligationIdentity, expectedVersion: number) {
    return this.transition(scope, expectedVersion, {
      kind: "RECOVER_INTERRUPTED",
    });
  }
  async reconciliationRead(scope: FiscalObligationIdentity) {
    const state = await this.read(scope);
    if (!state) throw new FiscalAttemptConflict("INVALID_INPUT");
    return fiscalReconciliationRead(state, scope);
  }
}
