import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configurationFingerprint, makePreflight, releaseFingerprint, validateReleaseManifest } from "./dev-immutable-lambda-code-release.mjs";

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
