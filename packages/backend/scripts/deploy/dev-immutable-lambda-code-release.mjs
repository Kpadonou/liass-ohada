#!/usr/bin/env node

/**
 * DEV-only code release executor.  It deliberately consumes an immutable
 * release directory; it never synthesizes CDK or changes CloudFormation.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEV_ACCOUNT = "570197775998";
export const DEV_REGION = "eu-west-3";
export const DEV_STAGE = "dev";
export const RESTAURANTS_PREFIX = "liass-ohada-dev-restaurants-";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..", "..", "..");
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
};
const sha256 = (bytes, encoding = "hex") => createHash("sha256").update(bytes).digest(encoding);
const codeHash = (bytes) => sha256(bytes, "base64");

export function configurationFingerprint(configuration) {
  const selected = {
    Architectures: configuration.Architectures,
    DeadLetterConfig: configuration.DeadLetterConfig,
    Environment: configuration.Environment,
    EphemeralStorage: configuration.EphemeralStorage,
    FileSystemConfigs: configuration.FileSystemConfigs,
    Handler: configuration.Handler,
    ImageConfigResponse: configuration.ImageConfigResponse,
    KmsKeyArn: configuration.KmsKeyArn,
    Layers: configuration.Layers,
    LoggingConfig: configuration.LoggingConfig,
    MemorySize: configuration.MemorySize,
    PackageType: configuration.PackageType,
    Role: configuration.Role,
    Runtime: configuration.Runtime,
    RuntimeVersionConfig: configuration.RuntimeVersionConfig,
    SnapStart: configuration.SnapStart,
    Timeout: configuration.Timeout,
    TracingConfig: configuration.TracingConfig,
    VpcConfig: configuration.VpcConfig,
  };
  return sha256(stable(selected));
}

export function releaseFingerprint(manifest) {
  return sha256(stable(manifest));
}

function readJson(file) { return JSON.parse(readFileSync(file, "utf8")); }
function writeJson(file, value) { writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

export function validateReleaseManifest(manifest, releaseDirectory) {
  assert.equal(manifest?.mode, "PREPARE_ONLY", "Release must be preparation-only");
  assert.equal(manifest?.deploymentExecuted, false, "Release must not already be deployed");
  assert.equal(manifest?.target?.account, DEV_ACCOUNT, "Release is not for DEV account");
  assert.equal(manifest?.target?.region, DEV_REGION, "Release is not for DEV region");
  assert.equal(manifest?.target?.stage, DEV_STAGE, "Release is not for DEV stage");
  assert.equal(manifest?.commit, "a4f5b225b4fce4424a85b1ea18ff96b03c97207e", "Release commit is not approved");
  assert.ok(Array.isArray(manifest.artifacts) && manifest.artifacts.length === 77, "Expected exactly 77 immutable artifacts");
  const names = new Set();
  for (const item of manifest.artifacts) {
    assert.equal(typeof item.functionName, "string");
    assert.ok(item.functionName.startsWith(RESTAURANTS_PREFIX), `Out-of-scope target ${item.functionName}`);
    assert.ok(!names.has(item.functionName), `Duplicate target ${item.functionName}`);
    names.add(item.functionName);
    assert.equal(typeof item.logicalId, "string");
    assert.equal(typeof item.liveCodeSha256, "string");
    assert.equal(typeof item.codeSha256, "string");
    assert.match(item.artifact, /^artifacts\/liass-ohada-dev-restaurants-[a-z0-9-]+\.zip$/);
    const bytes = readFileSync(join(releaseDirectory, item.artifact));
    assert.equal(sha256(bytes), item.sha256Hex, `Artifact SHA-256 mismatch: ${item.functionName}`);
    assert.equal(codeHash(bytes), item.codeSha256, `Artifact CodeSha256 mismatch: ${item.functionName}`);
  }
  return [...manifest.artifacts].sort((a, b) => a.functionName.localeCompare(b.functionName));
}

function command(args, profile, capture = true) {
  return execFileSync("aws", [...args, "--region", DEV_REGION, "--profile", profile, "--output", "json"], {
    cwd: repositoryRoot, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}
function awsJson(args, profile) { return JSON.parse(command(args, profile)); }

function parseArguments(argv) {
  const result = { mode: "plan", profile: "rem" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--release-dir") result.releaseDirectory = argv[++index];
    else if (value === "--manifest") result.manifestFile = argv[++index];
    else if (value === "--evidence-dir") result.evidenceDirectory = argv[++index];
    else if (value === "--profile") result.profile = argv[++index];
    else if (value === "--execute") result.mode = "execute";
    else if (value === "--rollback") result.mode = "rollback";
    else if (value === "--approval-id") result.approvalId = argv[++index];
    else throw new Error(`Unsupported argument: ${value}`);
  }
  if (!result.releaseDirectory || !result.evidenceDirectory) throw new Error("--release-dir and --evidence-dir are required");
  if (!result.profile) throw new Error("--profile requires a value");
  if (result.mode !== "plan" && (!result.approvalId || process.env.LIASS_CODE_ONLY_RELEASE_EXECUTION !== "AUTHORIZED"))
    throw new Error("Execution requires --approval-id and LIASS_CODE_ONLY_RELEASE_EXECUTION=AUTHORIZED");
  return result;
}

export function makePreflight(manifest, targets, configurations, identity) {
  assert.equal(identity.Account, DEV_ACCOUNT, "Connected AWS account is not DEV");
  const items = targets.map((target) => {
    const configuration = configurations.get(target.functionName);
    assert.ok(configuration, `Missing deployed configuration: ${target.functionName}`);
    assert.equal(configuration.FunctionName, target.functionName, `Wrong deployed function: ${target.functionName}`);
    assert.equal(configuration.CodeSha256, target.liveCodeSha256, `Live code drift: ${target.functionName}`);
    return {
      functionName: target.functionName,
      logicalId: target.logicalId,
      expectedCodeSha256: target.codeSha256,
      liveCodeSha256: configuration.CodeSha256,
      revisionId: configuration.RevisionId,
      configurationFingerprint: configurationFingerprint(configuration),
    };
  });
  return { schemaVersion: 1, mode: "CODE_ONLY_PLAN", releaseCommit: manifest.commit, releaseFingerprint: releaseFingerprint(manifest), target: manifest.target, createdAt: new Date().toISOString(), items };
}

function saveEvidence(directory, name, value) {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, name);
  writeJson(file, value);
  return file;
}

function assertCurrent(preflight, target, configuration) {
  const item = preflight.items.find((entry) => entry.functionName === target.functionName);
  assert.ok(item, `Target not present in preflight: ${target.functionName}`);
  assert.equal(configuration.CodeSha256, item.liveCodeSha256, `Code changed since preflight: ${target.functionName}`);
  assert.equal(configuration.RevisionId, item.revisionId, `Revision changed since preflight: ${target.functionName}`);
  assert.equal(configurationFingerprint(configuration), item.configurationFingerprint, `Configuration drift: ${target.functionName}`);
}

function downloadRollbackZip(location, file) {
  execFileSync("curl", ["--fail", "--silent", "--show-error", "--location", location, "--output", file], { cwd: repositoryRoot });
}

function executeRelease({ releaseDirectory, evidenceDirectory, profile, approvalId, manifest, targets, preflight }) {
  const rollbackDirectory = join(evidenceDirectory, "rollback-artifacts");
  mkdirSync(rollbackDirectory, { recursive: true });
  const evidence = { ...preflight, mode: "CODE_ONLY_EXECUTION", approvalId, startedAt: new Date().toISOString(), updates: [], rollback: [] };
  for (const target of targets) {
    const current = awsJson(["lambda", "get-function-configuration", "--function-name", target.functionName], profile);
    assertCurrent(preflight, target, current);
    const functionInfo = awsJson(["lambda", "get-function", "--function-name", target.functionName], profile);
    const rollbackFile = join(rollbackDirectory, `${target.functionName}.zip`);
    downloadRollbackZip(functionInfo.Code?.Location, rollbackFile);
    const rollbackBytes = readFileSync(rollbackFile);
    assert.equal(codeHash(rollbackBytes), current.CodeSha256, `Rollback artifact mismatch: ${target.functionName}`);
    const artifactPath = join(releaseDirectory, target.artifact);
    awsJson(["lambda", "update-function-code", "--function-name", target.functionName, "--zip-file", `fileb://${artifactPath}`, "--no-publish", "--revision-id", current.RevisionId], profile);
    command(["lambda", "wait", "function-updated-v2", "--function-name", target.functionName], profile, false);
    const after = awsJson(["lambda", "get-function-configuration", "--function-name", target.functionName], profile);
    assert.equal(configurationFingerprint(after), configurationFingerprint(current), `Configuration changed during code update: ${target.functionName}`);
    assert.equal(after.CodeSha256, target.codeSha256, `Code verification failed: ${target.functionName}`);
    evidence.rollback.push({ functionName: target.functionName, artifact: `rollback-artifacts/${target.functionName}.zip`, codeSha256: current.CodeSha256, sha256Hex: sha256(rollbackBytes) });
    evidence.updates.push({ functionName: target.functionName, codeSha256: after.CodeSha256, revisionId: after.RevisionId, lastModified: after.LastModified });
    saveEvidence(evidenceDirectory, "execution-evidence.json", evidence);
  }
  evidence.completedAt = new Date().toISOString();
  saveEvidence(evidenceDirectory, "execution-evidence.json", evidence);
  return evidence;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.mode === "rollback") throw new Error("Rollback execution is intentionally withheld pending a separately approved rollback procedure");
  const releaseDirectory = resolve(options.releaseDirectory);
  const evidenceDirectory = resolve(options.evidenceDirectory);
  const manifest = readJson(options.manifestFile ? resolve(options.manifestFile) : join(releaseDirectory, "release-manifest.json"));
  const targets = validateReleaseManifest(manifest, releaseDirectory);
  const identity = awsJson(["sts", "get-caller-identity"], options.profile);
  const configurations = new Map(targets.map((target) => [target.functionName, awsJson(["lambda", "get-function-configuration", "--function-name", target.functionName], options.profile)]));
  const preflight = makePreflight(manifest, targets, configurations, identity);
  saveEvidence(evidenceDirectory, "preflight.json", preflight);
  if (options.mode === "execute") executeRelease({ ...options, releaseDirectory, evidenceDirectory, manifest, targets, preflight });
  console.log(JSON.stringify({ mode: options.mode.toUpperCase(), targets: targets.length, preflight: join(evidenceDirectory, "preflight.json"), releaseFingerprint: preflight.releaseFingerprint }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
