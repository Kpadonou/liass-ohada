#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEV_ACCOUNT = "570197775998";
export const DEV_REGION = "eu-west-3";
export const FUNCTION_PREFIX = "liass-ohada-dev-restaurants-";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const backendRoot = resolve(scriptDir, "..", "..");
export const repositoryRoot = resolve(backendRoot, "..", "..");

const transactionOperations = [
  "service-floor",
  "open-session",
  "get-session",
  "active-sessions",
  "active-table-session",
  "session-history",
  "table-session-history",
  "replace-responsible-staff",
  "close-session",
  "create-order",
  "get-order",
  "active-orders",
  "unpaid-orders",
  "session-orders",
  "table-orders",
  "order-history",
  "order-items",
  "add-draft-item",
  "edit-draft-item",
  "cancel-order-item",
  "submit-order",
  "cancel-order",
  "close-order",
];

export const CORE_TRANSACTION_ROUTE_LAMBDAS = Object.freeze(
  transactionOperations.map((operation) => ({
    operation,
    functionName: `${FUNCTION_PREFIX}${operation}`,
    sourceEntrypoint: `lambda/domains/restaurants/${operation}.ts`,
  })),
);

export const SCHEMA_COMPATIBILITY_LAMBDAS = Object.freeze(
  [
    "station-preparation",
    "order-preparation",
    "start-preparation",
    "ready-preparation",
    "serve-preparation",
    "capture-payment",
    "publish-receipt",
    "get-receipt",
    "get-outlet",
    "guest-public",
    "guest-qr-staff",
  ].map((operation) => ({
    operation,
    functionName: `${FUNCTION_PREFIX}${operation}`,
    sourceEntrypoint: `lambda/domains/restaurants/${operation}.ts`,
  })),
);

export const REQUIRED_RUNTIME_LAMBDAS = Object.freeze([
  ...CORE_TRANSACTION_ROUTE_LAMBDAS,
  ...SCHEMA_COMPATIBILITY_LAMBDAS,
]);

export const ALLOWLIST = new Set(
  REQUIRED_RUNTIME_LAMBDAS.map(({ functionName }) => functionName),
);

export function validateTarget({ stage, account, region, functionName }) {
  if (stage !== "dev") throw new Error("Targeted releases are DEV-only");
  if (account !== DEV_ACCOUNT)
    throw new Error(
      `Refusing AWS account ${account}; expected DEV ${DEV_ACCOUNT}`,
    );
  if (region !== DEV_REGION)
    throw new Error(`Refusing AWS region ${region}; expected ${DEV_REGION}`);
  if (!functionName.startsWith(FUNCTION_PREFIX))
    throw new Error(`Refusing non-Restaurants DEV function ${functionName}`);
  if (!ALLOWLIST.has(functionName))
    throw new Error(
      `Function is not in the abandonment runtime allowlist: ${functionName}`,
    );
}

export function sha256Base64(bytes) {
  return createHash("sha256").update(bytes).digest("base64");
}

export function deterministicManifest(items) {
  return [...items].sort((a, b) =>
    a.functionName.localeCompare(b.functionName),
  );
}

export async function releaseSequentially(items, update) {
  const updated = [];
  for (const item of deterministicManifest(items)) {
    try {
      await update(item);
      updated.push(item.functionName);
    } catch (error) {
      const remaining = deterministicManifest(items)
        .map(({ functionName }) => functionName)
        .filter(
          (name) => !updated.includes(name) && name !== item.functionName,
        );
      const failure = new Error(
        `Targeted release stopped at ${item.functionName}`,
      );
      failure.cause = error;
      failure.updated = updated;
      failure.failed = item.functionName;
      failure.remaining = remaining;
      throw failure;
    }
  }
  return updated;
}

export async function executeIfRequested(execute, items, update) {
  if (!execute) return [];
  return releaseSequentially(
    items.filter(({ differs }) => differs),
    update,
  );
}

function command(commandName, args, options = {}) {
  return execFileSync(commandName, args, {
    cwd: backendRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    ...options,
  });
}

function awsJson(args, profile) {
  return JSON.parse(
    command(
      "aws",
      [
        ...args,
        "--region",
        DEV_REGION,
        "--profile",
        profile,
        "--output",
        "json",
      ],
      { capture: true },
    ),
  );
}

function parseArguments(argv) {
  const result = { execute: false, profile: "rem" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--execute") result.execute = true;
    else if (value === "--profile") result.profile = argv[++index];
    else throw new Error(`Unsupported argument: ${value}`);
  }
  if (!result.profile) throw new Error("--profile requires a value");
  return result;
}

function synthesize(outputDirectory, profile) {
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  command("npx", [
    "cdk",
    "synth",
    "LiassOhadaBackendStack",
    "--quiet",
    "--output",
    outputDirectory,
    "--profile",
    profile,
  ]);
}

function findRestaurantsTemplate(outputDirectory) {
  const candidates = readdirSync(outputDirectory).filter(
    (value) =>
      value.includes("RestaurantsApi") &&
      value.endsWith(".nested.template.json"),
  );
  if (candidates.length !== 1)
    throw new Error(
      `Expected one Restaurants nested template, found ${candidates.length}`,
    );
  return join(outputDirectory, candidates[0]);
}

function templateResourceMap(outputDirectory) {
  const template = JSON.parse(
    readFileSync(findRestaurantsTemplate(outputDirectory), "utf8"),
  );
  return new Map(
    Object.entries(template.Resources ?? {})
      .filter(([, resource]) => resource.Type === "AWS::Lambda::Function")
      .map(([logicalId, resource]) => [
        resource.Properties.FunctionName,
        { logicalId, resource },
      ]),
  );
}

function zipAsset(assetDirectory, artifactPath) {
  if (!existsSync(assetDirectory))
    throw new Error(`Missing CDK asset directory ${assetDirectory}`);
  mkdirSync(dirname(artifactPath), { recursive: true });
  rmSync(artifactPath, { force: true });
  const files = listFiles(assetDirectory);
  const stableTimestamp = new Date("1980-01-01T00:00:00.000Z");
  for (const file of files)
    utimesSync(join(assetDirectory, file), stableTimestamp, stableTimestamp);
  command("zip", ["-X", "-q", artifactPath, ...files], { cwd: assetDirectory });
  return readFileSync(artifactPath);
}

function listFiles(root, directory = "") {
  return readdirSync(join(root, directory))
    .sort()
    .flatMap((name) => {
      const relative = join(directory, name);
      return statSync(join(root, relative)).isDirectory()
        ? listFiles(root, relative)
        : [relative];
    });
}

export function buildManifest({
  outputDirectory,
  configurations,
  artifactDirectory,
}) {
  const resolvedArtifacts = resolve(artifactDirectory);
  const resources = templateResourceMap(outputDirectory);
  return deterministicManifest(
    REQUIRED_RUNTIME_LAMBDAS.map((target) => {
      const match = resources.get(target.functionName);
      if (!match)
        throw new Error(`Synthesized Lambda not found: ${target.functionName}`);
      const assetPath = match.resource.Metadata?.["aws:asset:path"];
      if (typeof assetPath !== "string")
        throw new Error(
          `Synthesized asset metadata missing: ${target.functionName}`,
        );
      const artifactPath = join(resolvedArtifacts, `${target.operation}.zip`);
      const bytes = zipAsset(join(outputDirectory, assetPath), artifactPath);
      const deployed = configurations.get(target.functionName);
      if (!deployed)
        throw new Error(`Deployed Lambda not found: ${target.functionName}`);
      const localCodeSha256 = sha256Base64(bytes);
      return {
        ...target,
        logicalId: match.logicalId,
        artifactPath,
        localCodeSha256,
        deployedCodeSha256: deployed.CodeSha256,
        deployedLastModified: deployed.LastModified,
        differs: deployed.CodeSha256 !== localCodeSha256,
      };
    }),
  );
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const identity = awsJson(["sts", "get-caller-identity"], options.profile);
  if (identity.Account !== DEV_ACCOUNT)
    throw new Error(
      `Refusing AWS account ${identity.Account}; expected DEV ${DEV_ACCOUNT}`,
    );

  const releaseRoot = join(
    backendRoot,
    "cdk.out",
    "targeted-restaurants-release",
  );
  const synthDirectory = join(releaseRoot, "synth");
  const artifactDirectory = join(releaseRoot, "artifacts");
  synthesize(synthDirectory, options.profile);

  const configurations = new Map();
  for (const target of REQUIRED_RUNTIME_LAMBDAS) {
    validateTarget({
      stage: "dev",
      account: identity.Account,
      region: DEV_REGION,
      functionName: target.functionName,
    });
    const configuration = awsJson(
      [
        "lambda",
        "get-function-configuration",
        "--function-name",
        target.functionName,
      ],
      options.profile,
    );
    configurations.set(target.functionName, configuration);
  }

  const manifest = buildManifest({
    outputDirectory: synthDirectory,
    configurations,
    artifactDirectory,
  });
  console.log(
    JSON.stringify(
      { mode: options.execute ? "EXECUTE" : "DRY_RUN", manifest },
      null,
      2,
    ),
  );
  await executeIfRequested(options.execute, manifest, async (item) => {
    const before = configurations.get(item.functionName);
    awsJson(
      [
        "lambda",
        "update-function-code",
        "--function-name",
        item.functionName,
        "--zip-file",
        `fileb://${item.artifactPath}`,
        "--no-publish",
      ],
      options.profile,
    );
    command(
      "aws",
      [
        "lambda",
        "wait",
        "function-updated-v2",
        "--function-name",
        item.functionName,
        "--region",
        DEV_REGION,
        "--profile",
        options.profile,
      ],
      { capture: true },
    );
    const after = awsJson(
      [
        "lambda",
        "get-function-configuration",
        "--function-name",
        item.functionName,
      ],
      options.profile,
    );
    if (after.CodeSha256 !== item.localCodeSha256)
      throw new Error(
        `CodeSha256 verification failed for ${item.functionName}`,
      );
    if (after.LastModified === before.LastModified)
      throw new Error(`LastModified did not advance for ${item.functionName}`);
  });
  if (options.execute) {
    for (const item of manifest) {
      const after = awsJson(
        [
          "lambda",
          "get-function-configuration",
          "--function-name",
          item.functionName,
        ],
        options.profile,
      );
      if (after.CodeSha256 !== item.localCodeSha256)
        throw new Error(`Final verification failed for ${item.functionName}`);
    }
    console.log(JSON.stringify({ verified: manifest.length }));
  }
  return manifest;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    if (error.updated)
      console.error(
        JSON.stringify({
          updated: error.updated,
          failed: error.failed,
          remaining: error.remaining,
        }),
      );
    process.exitCode = 1;
  });
}
