import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { resolveDeploymentStage } from "../lib/config/deployment";
import { RelinkOptions, relinkUserIdentity } from "./identity/relink";

export function parseRelinkArgs(args: string[]): RelinkOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const names = [
    "--old-user-id",
    "--new-user-id",
    "--email",
    "--stage",
    "--table-name",
    "--user-pool-id",
    "--region",
    "--ack-production",
  ];
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (flags.has(name) || values.has(name))
      throw new Error(`Duplicate argument: ${name}`);
    if (["--apply", "--maintenance-confirmed"].includes(name)) {
      flags.add(name);
      continue;
    }
    if (!names.includes(name)) throw new Error(`Unknown argument: ${name}`);
    const value = args[++i];
    if (!value || value.startsWith("--") || !value.trim())
      throw new Error(`${name} requires a value.`);
    values.set(name, value.trim());
  }
  const required = (name: string) => {
    const value = values.get(name);
    if (!value) throw new Error(`${name} is required.`);
    return value;
  };
  return {
    oldUserId: required("--old-user-id"),
    newUserId: required("--new-user-id"),
    email: required("--email"),
    stage: resolveDeploymentStage(required("--stage")),
    tableName: required("--table-name"),
    userPoolId: required("--user-pool-id"),
    region: required("--region"),
    apply: flags.has("--apply"),
    maintenanceConfirmed: flags.has("--maintenance-confirmed"),
    productionAcknowledgement: values.get("--ack-production"),
  };
}

if (require.main === module) {
  (async () => {
    const options = parseRelinkArgs(process.argv.slice(2));
    console.info(
      JSON.stringify({
        operation: "USER_IDENTITY_RELINK",
        mode: options.apply ? "APPLY" : "DRY_RUN",
        stage: options.stage,
        region: options.region,
        tableName: options.tableName,
        userPoolId: options.userPoolId,
      }),
    );
    await relinkUserIdentity(
      options,
      {
        dynamo: new DynamoDBClient({ region: options.region }),
        cognito: new CognitoIdentityProviderClient({ region: options.region }),
      },
      (report) => console.info(JSON.stringify(report)),
    );
  })().catch((error: unknown) => {
    // Do not serialize AWS exceptions, request payloads, credentials or tokens.
    console.error(
      JSON.stringify({
        operation: "USER_IDENTITY_RELINK",
        outcome: "FAILED",
        code:
          error instanceof Error
            ? /^[A-Z_]+(?::[A-Z_]+:[A-Za-z0-9_]+)?$/.test(error.message)
              ? error.message
              : error.name
            : "UNKNOWN_ERROR",
        safeToApply: false,
      }),
    );
    process.exitCode = 1;
  });
}
