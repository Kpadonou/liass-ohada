import type { DynamoDBStreamEvent } from "aws-lambda";
import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { RestaurantFiscalWorkProcessor } from "@/lambda/domains/restaurants/fiscal-work-processor";
import { processFiscalIntentStream } from "@/lambda/domains/restaurants/fiscal-intent-stream";

const work = { orgId: "org", outletId: "00000000-0000-4000-8000-000000000001",
  sessionId: "00000000-0000-4000-8000-000000000002",
  invoiceId: "00000000-0000-4000-8000-000000000003",
  actorId: "actor", createdAt: "2026-11-18T10:00:00.000Z",
  fiscalBinding: { environment: "TEST", connectionId: "00000000-0000-4000-8000-000000000004", policyVersion: 1 } };
const PK = K.restaurantBillPK(work.orgId, work.outletId, work.invoiceId);
const record = (sequence: string, eventName = "INSERT", sk = K.restaurantFiscalIntentSK()) => ({
  eventName, dynamodb: { SequenceNumber: sequence, Keys: { PK: { S: PK }, SK: { S: sk } } },
});
const event = (...records: ReturnType<typeof record>[]) => ({ Records: records } as unknown as DynamoDBStreamEvent);
let processorSpy: jest.SpyInstance;
beforeEach(() => {
  process.env.RESTAURANTS_TABLE_NAME = "restaurants";
  process.env.TABLE_NAME = "platform";
  processorSpy = jest.spyOn(RestaurantFiscalWorkProcessor, "process").mockResolvedValue({ state: "BLOCKED" });
  jest.spyOn(dynamoClient, "send").mockImplementation(async (command) => {
    if (!(command instanceof GetItemCommand)) throw new Error("Unexpected command");
    return { Item: marshall({ PK, SK: K.restaurantFiscalIntentSK(), ...work,
      entityType: "RESTAURANT_FISCAL_INTENT", schemaVersion: 1, state: "PENDING" }) } as never;
  });
});
afterEach(() => { jest.restoreAllMocks(); delete process.env.RESTAURANTS_TABLE_NAME; delete process.env.TABLE_NAME; });
test("only committed INSERT intent invokes the processor", async () => {
  expect(await processFiscalIntentStream(event(record("1"), record("2", "MODIFY"),
    record("3", "REMOVE"), record("4", "INSERT", "OTHER")))).toEqual({ batchItemFailures: [] });
  expect(processorSpy).toHaveBeenCalledTimes(1);
  expect(processorSpy).toHaveBeenCalledWith(work);
});
test("duplicate delivery reaches the idempotent processor without mutating in the handler", async () => {
  expect(await processFiscalIntentStream(event(record("1"), record("2")))).toEqual({ batchItemFailures: [] });
  expect(processorSpy).toHaveBeenCalledTimes(2);
});
test("historical unbound work is not replayed", async () => {
  const { fiscalBinding: _binding, ...historical } = work;
  jest.mocked(dynamoClient.send).mockResolvedValueOnce({ Item: marshall({
    PK, SK: K.restaurantFiscalIntentSK(), ...historical,
    entityType: "RESTAURANT_FISCAL_INTENT", schemaVersion: 1, state: "PENDING",
  }) } as never);
  expect(await processFiscalIntentStream(event(record("1")))).toEqual({ batchItemFailures: [] });
  expect(processorSpy).not.toHaveBeenCalled();
});
test("a failed record is reported for retry while later records continue", async () => {
  processorSpy.mockRejectedValueOnce(new Error("storage unavailable"));
  expect(await processFiscalIntentStream(event(record("1"), record("2")))).toEqual({
    batchItemFailures: [{ itemIdentifier: "1" }],
  });
  expect(processorSpy).toHaveBeenCalledTimes(2);
});
