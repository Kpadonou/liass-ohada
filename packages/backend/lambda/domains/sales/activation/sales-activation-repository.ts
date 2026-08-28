import {
  TransactionCanceledException,
  TransactWriteItem,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";

export class SalesActivationRepository {
  static async activateAtomically(
    transactItems: readonly TransactWriteItem[],
  ): Promise<boolean> {
    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({ TransactItems: [...transactItems] }),
      );
      return true;
    } catch (error) {
      if (
        error instanceof TransactionCanceledException ||
        (error as { name?: string })?.name === "TransactionCanceledException"
      ) {
        return false;
      }
      throw error;
    }
  }
}
