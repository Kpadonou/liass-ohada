import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configurationFingerprint, FINAL_PUBLISHER_RELEASE, FISCAL_EXECUTOR_RELEASE, FISCAL_GET_EXTENSION_RELEASE, ORGANIZATION_PROFILE_RELEASE, RESTAURANTS_ATTESTED_FISCAL_RELEASE, makePreflight, releaseFingerprint, validateReleaseManifest } from "./dev-immutable-lambda-code-release.mjs";

const target = { account: "570197775998", region: "eu-west-3", stage: "dev" };
const entry = (name, bytes) => ({ functionName: name, logicalId: "L", artifact: `artifacts/${name}.zip`, sha256Hex: "", codeSha256: "", liveCodeSha256: "old", liveLastModified: "2026-11-11T00:00:00.000+0000" });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "immutable-lambda-release-")); mkdirSync(join(directory, "artifacts"));
  const artifacts = Array.from({ length: 77 }, (_, index) => entry(`liass-ohada-dev-restaurants-test-${index}`, Buffer.from(`zip-${index}`)));
  for (const item of artifacts) { const bytes = Buffer.from(item.functionName.replace("liass-ohada-dev-restaurants-test-", "zip-")); const crypto = awaitableHash(bytes); item.sha256Hex = crypto.hex; item.codeSha256 = crypto.base64; writeFileSync(join(directory, item.artifact), bytes); }
  return { directory, manifest: { mode: "PREPARE_ONLY", deploymentExecuted: false, target, commit: "a4f5b225b4fce4424a85b1ea18ff96b03c97207e", artifacts } };
}
function awaitableHash(bytes) { return { hex: createHash("sha256").update(bytes).digest("hex"), base64: createHash("sha256").update(bytes).digest("base64") }; }

test("validates exact immutable DEV Restaurants artifact inventory", () => {
  const { directory, manifest } = fixture();
  assert.equal(validateReleaseManifest(manifest, directory).length, 77);
  manifest.artifacts[0].functionName = "liass-ohada-dev-accounting-post-entry";
  assert.throws(() => validateReleaseManifest(manifest, directory), /Out-of-scope/);
});

test("validates only the approved fiscal executor in its single-target release profile", () => {
  const { directory } = fixture();
  const item = entry(FISCAL_EXECUTOR_RELEASE.functionName, Buffer.from("fiscal-zip"));
  const bytes = Buffer.from("fiscal-zip"), crypto = awaitableHash(bytes);
  item.logicalId = FISCAL_EXECUTOR_RELEASE.logicalId;
  item.artifact = `artifacts/${FISCAL_EXECUTOR_RELEASE.functionName}.zip`;
  item.sha256Hex = crypto.hex; item.codeSha256 = crypto.base64;
  writeFileSync(join(directory, item.artifact), bytes);
  const manifest = { mode: "PREPARE_ONLY", deploymentExecuted: false, releaseProfile: FISCAL_EXECUTOR_RELEASE.profile,
    target, commit: FISCAL_EXECUTOR_RELEASE.commit, artifacts: [item] };
  assert.equal(validateReleaseManifest(manifest, directory).length, 1);
  manifest.artifacts[0].functionName = "liass-ohada-dev-accounting-post-entry";
  assert.throws(() => validateReleaseManifest(manifest, directory), /Out-of-scope/);
});

test("validates the immutable FINAL publisher artifact and exact target", () => {
  const { directory } = fixture();
  const bytes = Buffer.from("publisher-zip"), hashes = awaitableHash(bytes);
  const name = FINAL_PUBLISHER_RELEASE.functionName;
  writeFileSync(join(directory, "artifacts", `${name}.zip`), bytes);
  const manifest = { mode: "PREPARE_ONLY", deploymentExecuted: false,
    releaseProfile: FINAL_PUBLISHER_RELEASE.profile, commit: FINAL_PUBLISHER_RELEASE.commit,
    target: { ...target, functionName: name, logicalId: FINAL_PUBLISHER_RELEASE.logicalId },
    artifact: { path: `artifacts/${name}.zip`, sha256Hex: hashes.hex,
      codeSha256: hashes.base64, liveCodeSha256: "old" } };
  assert.equal(validateReleaseManifest(manifest, directory).length, 1);
  manifest.artifact.sha256Hex = "wrong";
  assert.throws(() => validateReleaseManifest(manifest, directory), /Artifact SHA-256 mismatch/);
  manifest.artifact.sha256Hex = hashes.hex;
  manifest.target.functionName = "liass-ohada-dev-restaurants-capture-payment";
  assert.throws(() => validateReleaseManifest(manifest, directory), /Out-of-scope/);
});

test("validates only the exact Organization profile Lambda pair", () => {
  const { directory } = fixture();
  const artifacts = ORGANIZATION_PROFILE_RELEASE.functions.map((target) => {
    const bytes = Buffer.from(target.functionName), hashes = awaitableHash(bytes);
    writeFileSync(join(directory, "artifacts", `${target.functionName}.zip`), bytes);
    return { ...entry(target.functionName, bytes), logicalId: target.logicalId,
      sha256Hex: hashes.hex, codeSha256: hashes.base64 };
  });
  const manifest = { mode: "PREPARE_ONLY", deploymentExecuted: false,
    releaseProfile: ORGANIZATION_PROFILE_RELEASE.profile, target,
    commit: ORGANIZATION_PROFILE_RELEASE.commit, artifacts };
  assert.equal(validateReleaseManifest(manifest, directory).length, 2);
  manifest.artifacts[0].functionName = "liass-ohada-dev-identity-read-fiscal-profile";
  assert.throws(() => validateReleaseManifest(manifest, directory), /Out-of-scope/);
});

test("validates only the attested Restaurants fiscal path", () => {
  const { directory } = fixture();
  const artifacts = RESTAURANTS_ATTESTED_FISCAL_RELEASE.functions.map((target) => {
    const bytes = Buffer.from(target.functionName), hashes = awaitableHash(bytes);
    writeFileSync(join(directory, "artifacts", `${target.functionName}.zip`), bytes);
    return { ...entry(target.functionName, bytes), logicalId: target.logicalId,
      sha256Hex: hashes.hex, codeSha256: hashes.base64 };
  });
  const manifest = { mode: "PREPARE_ONLY", deploymentExecuted: false,
    releaseProfile: RESTAURANTS_ATTESTED_FISCAL_RELEASE.profile, target,
    commit: RESTAURANTS_ATTESTED_FISCAL_RELEASE.commit, artifacts };
  assert.equal(validateReleaseManifest(manifest, directory).length, 3);
  manifest.artifacts[0].functionName = "liass-ohada-dev-identity-update-organization-profile";
  assert.throws(() => validateReleaseManifest(manifest, directory), /Out-of-scope/);
});

test("validates only the fiscal GET extension Lambda pair", () => {
  const { directory } = fixture();
  const artifacts = FISCAL_GET_EXTENSION_RELEASE.functions.map((target) => {
    const bytes = Buffer.from(target.functionName), hashes = awaitableHash(bytes);
    writeFileSync(join(directory, "artifacts", `${target.functionName}.zip`), bytes);
    return { ...entry(target.functionName, bytes), logicalId: target.logicalId,
      sha256Hex: hashes.hex, codeSha256: hashes.base64 };
  });
  const manifest = { mode: "PREPARE_ONLY", deploymentExecuted: false,
    releaseProfile: FISCAL_GET_EXTENSION_RELEASE.profile, target,
    commit: FISCAL_GET_EXTENSION_RELEASE.commit, artifacts };
  assert.equal(validateReleaseManifest(manifest, directory).length, 2);
  manifest.artifacts[0].functionName = "liass-ohada-dev-accounting-post-entry";
  assert.throws(() => validateReleaseManifest(manifest, directory), /Out-of-scope/);
});

test("configuration fingerprint excludes code state but detects configuration drift", () => {
  const config = { FunctionName: "f", CodeSha256: "old", RevisionId: "one", Runtime: "nodejs24.x", Timeout: 15, Environment: { Variables: { A: "1" } } };
  const sameConfigNewCode = { ...config, CodeSha256: "new", RevisionId: "two" };
  assert.equal(configurationFingerprint(config), configurationFingerprint(sameConfigNewCode));
  assert.notEqual(configurationFingerprint(config), configurationFingerprint({ ...config, Timeout: 30 }));
  assert.notEqual(configurationFingerprint(config), configurationFingerprint({ ...config, Environment: { Variables: { A: "2" } } }));
});

test("preflight fails closed on stale live code", () => {
  const { directory, manifest } = fixture(); const targets = validateReleaseManifest(manifest, directory);
  const configs = new Map(targets.map((item) => [item.functionName, { FunctionName: item.functionName, CodeSha256: "wrong", RevisionId: "one", Runtime: "nodejs24.x" }]));
  assert.throws(() => makePreflight(manifest, targets, configs, { Account: target.account }), /Live code drift/);
  assert.equal(releaseFingerprint(manifest), releaseFingerprint(structuredClone(manifest)));
});

test("the rollback procedure is documented for retained partial execution evidence", () => {
  const source = String(process.getBuiltinModule("node:fs").readFileSync(new URL("./dev-immutable-lambda-code-release.mjs", import.meta.url)));
  assert.match(source, /Rollback requires retained execution evidence/);
  assert.doesNotMatch(source, /Rollback requires a completed execution record/);
});
