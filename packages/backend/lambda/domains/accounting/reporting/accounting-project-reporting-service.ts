import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";

const AccountingProjectFactPersistenceSchema = z
  .object({
    PK: z.string().min(1),
    SK: z.string().min(1),
    GSI4PK: z.string().min(1),
    GSI4SK: z.string().min(1),
    entityType: z.literal("ENTRY_LINE"),
    orgId: z.string().min(1),
    year: z.union([z.string(), z.number()]),
    entryId: z.string().min(1),
    lineId: z.string().min(1),
    entryDate: z.string().min(1),
    accountId: z.string().min(1),
    debit: z.number(),
    credit: z.number(),
    projectId: z.string().optional(),
    donorId: z.string().optional(),
    budgetLineId: z.string().optional(),
  })
  .passthrough();

export const AccountingProjectFactSchema = z
  .object({
    entryId: z.string().min(1),
    entryLineId: z.string().min(1),
    date: z.string().min(1),
    year: z.union([z.string(), z.number()]),
    accountId: z.string().min(1),
    debit: z.number(),
    credit: z.number(),
    projectId: z.string().min(1),
    donorId: z.string().optional(),
    budgetLineId: z.string().optional(),
  })
  .strict();

export type AccountingProjectFact = z.infer<
  typeof AccountingProjectFactSchema
>;

const projectIdFromIndexKey = (indexKey: string): string | undefined =>
  /^PRJ#(.+?)#FY#/.exec(indexKey)?.[1];

const toProjectFact = (
  line: z.infer<typeof AccountingProjectFactPersistenceSchema>,
): AccountingProjectFact | undefined => {
  const indexedProjectId = projectIdFromIndexKey(line.GSI4SK);
  if (!indexedProjectId) return undefined;

  return AccountingProjectFactSchema.parse({
    entryId: line.entryId,
    entryLineId: line.lineId,
    date: line.entryDate,
    year: line.year,
    accountId: line.accountId,
    debit: line.debit,
    credit: line.credit,
    projectId: indexedProjectId,
    donorId: line.donorId,
    budgetLineId: line.budgetLineId,
  });
};

export class AccountingProjectReportingService {
  static async listProjectFacts(input: {
    orgId: string;
    projectId: string;
    year: string;
  }): Promise<AccountingProjectFact[]> {
    const parsed = z
      .object({
        orgId: z.string().min(1),
        projectId: z.string().min(1),
        year: z.string().regex(/^\d{4}$/),
      })
      .strict()
      .parse(input);
    const expectedIndexPK = KeyFactory.gsi4PK(parsed.orgId);
    const expectedIndexPrefix = KeyFactory.projectYearPrefix(
      parsed.projectId,
      parsed.year,
    );
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI4,
        KeyConditionExpression: "GSI4PK = :pk AND begins_with(GSI4SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": expectedIndexPK,
          ":sk": expectedIndexPrefix,
        }),
      }),
    );

    return (result.Items ?? [])
      .map((item) =>
        AccountingProjectFactPersistenceSchema.parse(unmarshall(item)),
      )
      .filter(
        (line) =>
          line.GSI4PK === expectedIndexPK &&
          line.GSI4SK.startsWith(expectedIndexPrefix) &&
          line.orgId === parsed.orgId &&
          String(line.year) === parsed.year,
      )
      .map(toProjectFact)
      .filter((fact): fact is AccountingProjectFact => fact !== undefined);
  }

  static async listOrganizationProjectFacts(input: {
    orgId: string;
  }): Promise<AccountingProjectFact[]> {
    const parsed = z
      .object({ orgId: z.string().min(1) })
      .strict()
      .parse(input);
    const expectedIndexPK = KeyFactory.gsi4PK(parsed.orgId);
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI4,
        KeyConditionExpression: "GSI4PK = :pk",
        ExpressionAttributeValues: marshall({
          ":pk": expectedIndexPK,
        }),
      }),
    );

    return (result.Items ?? [])
      .map((item) =>
        AccountingProjectFactPersistenceSchema.parse(unmarshall(item)),
      )
      .filter(
        (line) =>
          line.GSI4PK === expectedIndexPK && line.orgId === parsed.orgId,
      )
      .map(toProjectFact)
      .filter((fact): fact is AccountingProjectFact => fact !== undefined);
  }
}
