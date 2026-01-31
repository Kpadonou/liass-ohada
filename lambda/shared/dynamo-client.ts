import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { config } from "./config";

/**
 * Global DynamoDB client instance
 * Initialized once with configuration from config.ts
 */
export { config };
export const dynamoClient = new DynamoDBClient({
  region: config.REGION,
  ...(config.IS_LOCAL && config.DYNAMODB_ENDPOINT && {
    endpoint: config.DYNAMODB_ENDPOINT,
  }),
});