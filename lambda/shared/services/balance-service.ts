import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "../dynamo-client";
import { config } from "../config";

/**
 * Account balance result
 */
export interface AccountBalance {
  accountNumber: string;
  totalDebit: number;
  totalCredit: number;
  balance: number; // debit - credit
  position: "DEBIT" | "CREDIT" | "ZERO";
}

/**
 * Get account balance for a specific fiscal year
 * @param orgId Organization ID
 * @param fiscalYear Fiscal year (e.g., "2024")
 * @param accountNumber Account number (e.g., "4111" - will be padded to 8 digits)
 * @returns Account balance information
 */
export async function getAccountBalance(
  orgId: string,
  fiscalYear: string,
  accountNumber: string
): Promise<AccountBalance> {
  // Pad account number to 8 digits
  const paddedAccountNumber = accountNumber.padStart(8, "0");

  let totalDebit = 0;
  let totalCredit = 0;
  let exclusiveStartKey: any = undefined;

  // Handle pagination to ensure all entries are fetched
  do {
    // Query the GSI-Account to get all entries for this account in the fiscal year
    const queryResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: "GSI-Account",
        KeyConditionExpression: "PK = :pk AND begins_with(GSI1SK, :gsi1sk)",
        ExpressionAttributeValues: {
          ":pk": { S: `ORG#${orgId}#FY#${fiscalYear}` },
          ":gsi1sk": { S: `ACC#${paddedAccountNumber}` },
        },
        ExclusiveStartKey: exclusiveStartKey,
      })
    );

    // Sum all debit and credit amounts from the entry lines
    if (queryResult.Items) {
      for (const item of queryResult.Items) {
        const unmarshalled = unmarshall(item);
        // Sum debit and credit as integers to avoid floating point issues
        totalDebit += Math.round(unmarshalled.debit || 0);
        totalCredit += Math.round(unmarshalled.credit || 0);
      }
    }

    // Continue pagination if there are more results
    exclusiveStartKey = queryResult.LastEvaluatedKey;
  } while (exclusiveStartKey);

  const balance = totalDebit - totalCredit;
  let position: "DEBIT" | "CREDIT" | "ZERO";

  if (balance > 0) {
    position = "DEBIT";
  } else if (balance < 0) {
    position = "CREDIT";
  } else {
    position = "ZERO";
  }

  return {
    accountNumber: paddedAccountNumber,
    totalDebit,
    totalCredit,
    balance,
    position,
  };
}
