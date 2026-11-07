#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEV_ACCOUNT = "570197775998";
export const DEV_REGION = "eu-west-3";
export const ASSET_BUCKET = `cdk-hnb659fds-assets-${DEV_ACCOUNT}-${DEV_REGION}`;
export const APPROVED_COMMITS = Object.freeze(["5d57d5f", "46d2834", "fe612df"]);
export const TARGET_FUNCTIONS = Object.freeze([
  "liass-ohada-dev-identity-configure-fiscal-connection",
  "liass-ohada-dev-identity-list-fiscal-connections",
  "liass-ohada-dev-identity-read-sfe-approval",
  "liass-ohada-dev-identity-revoke-fiscal-credential",
  "liass-ohada-dev-identity-store-fiscal-credential",
  "liass-ohada-dev-identity-update-sfe-approval",
  "liass-ohada-dev-identity-verify-fiscal-connection",
]);

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(scriptDirectory, "..", "..");

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256Base64 = (bytes) => createHash("sha256").update(bytes).digest("base64");
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const parseAwsTemplate = (file) => {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
};

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || !value) throw new Error("Every option requires a value");
    result[name.slice(2)] = value;
  }
  for (const required of [
    "synth-dir",
    "live-identity-template",
    "live-api-template",
    "live-lambdas",
    "output-dir",
    "source-commit",
  ]) if (!result[required]) throw new Error(`Missing --${required}`);
  return result;
}

function findOne(directory, predicate, description) {
  const matches = readdirSync(directory).filter(predicate);
  if (matches.length !== 1) throw new Error(`Expected one ${description}, found ${matches.length}`);
  return join(directory, matches[0]);
}

function listFiles(root, directory = "") {
  return readdirSync(join(root, directory)).sort().flatMap((name) => {
    const relative = join(directory, name);
    return statSync(join(root, relative)).isDirectory()
      ? listFiles(root, relative)
      : [relative];
  });
}

function packageAsset(assetDirectory, artifactPath) {
  if (!existsSync(assetDirectory)) throw new Error(`Missing asset directory: ${assetDirectory}`);
  const timestamp = new Date("1980-01-01T00:00:00.000Z");
  const files = listFiles(assetDirectory);
  for (const file of files) utimesSync(join(assetDirectory, file), timestamp, timestamp);
  execFileSync("zip", ["-X", "-q", artifactPath, ...files], { cwd: assetDirectory });
  return readFileSync(artifactPath);
}

export function addedResources(live, synthesized) {
  const removed = Object.keys(live.Resources ?? {}).filter((id) => !synthesized.Resources?.[id]);
  if (removed.length) throw new Error(`Refusing removed live resources: ${removed.join(",")}`);
  return Object.fromEntries(
    Object.entries(synthesized.Resources ?? {}).filter(([id]) => !live.Resources?.[id]),
  );
}

export function assertContainedAdditions(resources) {
  const expected = {
    "AWS::ApiGatewayV2::Integration": 7,
    "AWS::ApiGatewayV2::Route": 7,
    "AWS::IAM::Policy": 3,
    "AWS::IAM::Role": 3,
    "AWS::Lambda::Function": 7,
    "AWS::Lambda::Permission": 7,
  };
  const actual = {};
  for (const resource of Object.values(resources)) actual[resource.Type] = (actual[resource.Type] ?? 0) + 1;
  if (Object.keys(actual).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([type, count]) => actual[type] !== count))
    throw new Error(`Unexpected contained resource inventory: ${JSON.stringify(actual)}`);
  const functions = Object.values(resources)
    .filter((resource) => resource.Type === "AWS::Lambda::Function")
    .map((resource) => resource.Properties.FunctionName)
    .sort();
  if (JSON.stringify(functions) !== JSON.stringify([...TARGET_FUNCTIONS].sort()))
    throw new Error(`Unexpected target functions: ${JSON.stringify(functions)}`);
  for (const resource of Object.values(resources).filter((item) => item.Type === "AWS::ApiGatewayV2::Route")) {
    if (resource.Properties.AuthorizationType !== "JWT" || !resource.Properties.AuthorizerId)
      throw new Error(`Route is not protected by the existing JWT authorizer: ${resource.Properties.RouteKey}`);
  }
  const policies = Object.values(resources)
    .filter((item) => item.Type === "AWS::IAM::Policy")
    .flatMap((item) => item.Properties.PolicyDocument?.Statement ?? []);
  if (!policies.some((statement) =>
    statement.Effect === "Allow" &&
    statement.Action.includes("ssm:PutParameter") &&
    statement.Condition?.StringEquals?.["ssm:Overwrite"] === "false"
  )) throw new Error("Missing create-only SSM PutParameter policy");
  const serialized = JSON.stringify(resources);
  for (const required of [
    "FISCAL_CREDENTIAL_TEST_VERIFICATION_ENABLED",
    '"FISCAL_CREDENTIAL_TEST_VERIFICATION_ENABLED":"0"',
    "PLATFORM_ADMIN#dev#*",
    "PLATFORM_SFE#dev#BJ",
    "/TEST/*",
  ]) if (!serialized.includes(required)) throw new Error(`Missing release safeguard: ${required}`);
  for (const forbidden of ["ssm:GetParametersByPath", "ssm:DeleteParameter", "secretsmanager:"])
    if (serialized.includes(forbidden)) throw new Error(`Forbidden permission: ${forbidden}`);
}

function templateUrl(key) {
  return {
    "Fn::Join": ["", [
      `https://s3.${DEV_REGION}.`,
      { Ref: "AWS::URLSuffix" },
      `/${ASSET_BUCKET}/${key}`,
    ]],
  };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const synthDirectory = resolve(options["synth-dir"]);
  const outputDirectory = resolve(options["output-dir"]);
  if (existsSync(outputDirectory)) throw new Error(`Output directory already exists: ${outputDirectory}`);
  mkdirSync(join(outputDirectory, "assets"), { recursive: true });

  const identityFile = findOne(
    synthDirectory,
    (name) => name.includes("IdentityApi") && name.endsWith(".nested.template.json"),
    "Identity nested template",
  );
  const synthesizedIdentity = JSON.parse(readFileSync(identityFile, "utf8"));
  const liveIdentity = parseAwsTemplate(options["live-identity-template"]);
  const liveApi = parseAwsTemplate(options["live-api-template"]);
  const additions = addedResources(liveIdentity, synthesizedIdentity);
  assertContainedAdditions(additions);

  const liveLambdas = JSON.parse(readFileSync(options["live-lambdas"], "utf8"));
  if (liveLambdas.length !== 232 || liveLambdas.some((item) => !item.CodeSha256))
    throw new Error("Expected 232 live Lambdas with verified CodeSha256 values");
  if (liveLambdas.some((item) => TARGET_FUNCTIONS.includes(item.FunctionName)))
    throw new Error("A new fiscal target unexpectedly already exists in DEV");

  const artifacts = new Map();
  for (const resource of Object.values(additions).filter((item) => item.Type === "AWS::Lambda::Function")) {
    const key = resource.Properties.Code?.S3Key;
    const assetPath = resource.Metadata?.["aws:asset:path"];
    if (typeof key !== "string" || !key.endsWith(".zip") || typeof assetPath !== "string")
      throw new Error(`Missing synthesized asset metadata for ${resource.Properties.FunctionName}`);
    if (!artifacts.has(key)) {
      const artifactPath = join(outputDirectory, "assets", key);
      const bytes = packageAsset(join(synthDirectory, assetPath), artifactPath);
      artifacts.set(key, {
        key,
        file: join("assets", key),
        sha256Hex: sha256Hex(bytes),
        codeSha256Base64: sha256Base64(bytes),
      });
    }
  }
  if (artifacts.size !== 2) throw new Error(`Expected two executable ZIPs, found ${artifacts.size}`);

  const frozenIdentity = {
    ...synthesizedIdentity,
    Resources: { ...liveIdentity.Resources, ...additions },
    Outputs: liveIdentity.Outputs,
  };
  const identityBytes = Buffer.from(stableJson(frozenIdentity));
  const identityKey = `${sha256Hex(identityBytes)}.json`;
  writeFileSync(join(outputDirectory, "assets", identityKey), identityBytes);

  const frozenApi = structuredClone(liveApi);
  const identityStack = Object.values(frozenApi.Resources).find(
    (resource) => resource.Type === "AWS::CloudFormation::Stack" &&
      JSON.stringify(resource).includes("IdentityApi"),
  );
  if (!identityStack) throw new Error("Live API parent has no Identity nested stack");
  identityStack.Properties.TemplateURL = templateUrl(identityKey);
  const apiBytes = Buffer.from(stableJson(frozenApi));
  const apiKey = `${sha256Hex(apiBytes)}.json`;
  writeFileSync(join(outputDirectory, "assets", apiKey), apiBytes);

  const resourceCounts = {};
  for (const resource of Object.values(additions))
    resourceCounts[resource.Type] = (resourceCounts[resource.Type] ?? 0) + 1;
  const manifest = {
    schemaVersion: 1,
    mode: "PREPARE_ONLY",
    deployAuthorized: false,
    target: { account: DEV_ACCOUNT, region: DEV_REGION, stage: "dev" },
    source: { approvedCommits: APPROVED_COMMITS, releaseCommit: options["source-commit"] },
    liveBaseline: {
      identityStackResourceCount: Object.keys(liveIdentity.Resources).length,
      totalLambdaCount: liveLambdas.length,
      preservedExecutables: liveLambdas.sort((a, b) => a.FunctionName.localeCompare(b.FunctionName)),
    },
    desired: {
      identityStackResourceCount: Object.keys(frozenIdentity.Resources).length,
      addedResourceCounts: resourceCounts,
      targetFunctions: TARGET_FUNCTIONS,
      gates: {
        FISCAL_CREDENTIAL_TEST_VERIFICATION_ENABLED: "0",
        FISCAL_REAL_TEST_ENABLED: "0 (existing executor preserved)",
        productionProviderDispatch: false,
        automaticFiscalActivation: false,
      },
    },
    assets: {
      bucket: ASSET_BUCKET,
      executables: [...artifacts.values()],
      identityTemplate: { key: identityKey, sha256Hex: sha256Hex(identityBytes) },
      apiTemplate: { key: apiKey, sha256Hex: sha256Hex(apiBytes) },
    },
    operationalNotes: {
      disabledVerificationCanPersistAuditOperation: true,
      postSmokeTestsAreMutations: true,
      deploymentPerformed: false,
      assetsPublished: false,
    },
  };
  writeFileSync(join(outputDirectory, "release-manifest.json"), stableJson(manifest));
  process.stdout.write(stableJson({
    manifest: join(outputDirectory, "release-manifest.json"),
    sourceTemplate: basename(identityFile),
    identityTemplateKey: identityKey,
    apiTemplateKey: apiKey,
    executableAssets: [...artifacts.keys()].sort(),
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
