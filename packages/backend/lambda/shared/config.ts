import { z } from "zod";

/**
 * Environment configuration schema
 */
const ConfigSchema = z.object({
  TABLE_NAME: z.string().min(1, "TABLE_NAME is required"),
  REGION: z.string().default("us-east-1"),
  IS_LOCAL: z.boolean(),
  DYNAMODB_ENDPOINT: z.string().optional(),
  GSI1: z.string(),
  GSI2: z.string(),
  GSI3: z.string(),
  GSI4: z.string(),
  GSI5: z.string(),
  GSI6: z.string(),
});

/**
 * Configuration type
 */
export type Config = z.infer<typeof ConfigSchema>;

/**
 * Load and validate configuration from environment variables
 */
function loadConfig(): Config {
  const isLocal = !!process.env.LOCALSTACK_URL;
  const tableName = process.env.TABLE_NAME;

  // In production, TABLE_NAME is required
  // In local development, default to liass-ohada-dev-accounting-table
  let finalTableName: string;
  if (tableName) {
    finalTableName = tableName;
  } else if (isLocal) {
    finalTableName = "liass-ohada-dev-accounting-table";
  } else {
    throw new Error(
      "TABLE_NAME environment variable is required in production. " +
        "Set TABLE_NAME=your-table-name or LOCALSTACK_URL for local development.",
    );
  }

  const config = {
    TABLE_NAME: finalTableName,
    REGION: process.env.AWS_REGION || "us-east-1",
    IS_LOCAL: isLocal,
    DYNAMODB_ENDPOINT: process.env.LOCALSTACK_URL,
    GSI1: "GSI1", // GSI1 for accounting queries
    GSI2: "GSI2", // GSI2 for third party queries
    GSI3: "GSI3", // GSI3 for lettering queries
    GSI4: "GSI4", // GSI4 for project queries (SYCEBNL)
    GSI5: "GSI5", // GSI5 for journal/audit trail queries
    GSI6: "GSI6", // GSI6 for authenticated user workspace discovery
  };

  // Validate configuration
  const validation = ConfigSchema.safeParse(config);
  if (!validation.success) {
    throw new Error(
      `Configuration validation failed: ${validation.error.message}`,
    );
  }

  return validation.data;
}

/**
 * Global configuration object
 * Loaded once and cached for the lifetime of the process
 */
export const config: Config = loadConfig();
