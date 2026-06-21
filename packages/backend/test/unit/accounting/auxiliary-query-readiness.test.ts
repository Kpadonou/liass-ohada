import { LetteringService } from "@/lambda/shared/services/lettering-service";
import { ThirdPartyService } from "@/lambda/shared/services/third-party-service";
import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

describe("auxiliary query readiness", () => {
  beforeEach(() => dynamoMock.reset());

  test("queries permanent GSI2 history by tenant/account/third party and date", async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    await ThirdPartyService.getLedger("org-a", {
      accountId: "411",
      thirdPartyId: "TP-1",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    const query = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    const values = unmarshall(query.ExpressionAttributeValues!);

    expect(query.IndexName).toBe("GSI2");
    expect(query.KeyConditionExpression).toBe(
      "GSI2PK = :pk AND GSI2SK BETWEEN :start AND :end",
    );
    expect(values).toEqual({
      ":pk": "ORG#org-a#ACC#41100000#TP#TP-1",
      ":start": "DT#2026-01-01#",
      ":end": "DT#2026-12-31#\uffff",
    });
    expect(query.ScanIndexForward).toBe(true);
    expect(query.ConsistentRead).toBeUndefined();
  });

  test("queries only the chronological unlettered GSI3 prefix", async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    await LetteringService.getUnletteredLines("org-a", "411", "TP-1");
    const query = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    const values = unmarshall(query.ExpressionAttributeValues!);

    expect(query.IndexName).toBe("GSI3");
    expect(query.KeyConditionExpression).toBe(
      "GSI3PK = :lpk AND begins_with(GSI3SK, :lsk)",
    );
    expect(values).toEqual({
      ":lpk": "ORG#org-a#ACC#41100000#TP#TP-1",
      ":lsk": "UNLETTERED#",
    });
    expect(query.ConsistentRead).toBeUndefined();
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });
});
