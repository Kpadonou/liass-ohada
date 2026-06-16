import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { config } from "./config";

/**
 * Global DynamoDB client instance
 * Initialized once with configuration from config.ts
 */
export { config };
export const dynamoClient = new DynamoDBClient({
  region: config.REGION,
  requestHandler: new NodeHttpHandler({
    connectionTimeout: Number(process.env.AWS_CONNECTION_TIMEOUT_MS ?? 5_000),
    requestTimeout: Number(process.env.AWS_REQUEST_TIMEOUT_MS ?? 20_000),
    throwOnRequestTimeout: true,
  }),
  ...(config.IS_LOCAL &&
    config.DYNAMODB_ENDPOINT && {
      endpoint: config.DYNAMODB_ENDPOINT,
    }),
});
