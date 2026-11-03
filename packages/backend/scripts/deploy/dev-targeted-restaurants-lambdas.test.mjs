import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWLIST,
  CORE_TRANSACTION_ROUTE_LAMBDAS,
  SCHEMA_COMPATIBILITY_LAMBDAS,
  DEV_ACCOUNT,
  DEV_REGION,
  FUNCTION_PREFIX,
  REQUIRED_RUNTIME_LAMBDAS,
  deterministicManifest,
  executeIfRequested,
  releaseSequentially,
  sha256Base64,
  validateTarget,
} from "./dev-targeted-restaurants-lambdas.mjs";

const valid = REQUIRED_RUNTIME_LAMBDAS[0].functionName;

test("fixed manifest is deterministic and explicitly allowlisted", () => {
  assert.equal(CORE_TRANSACTION_ROUTE_LAMBDAS.length, 23);
  assert.equal(SCHEMA_COMPATIBILITY_LAMBDAS.length, 11);
  assert.equal(REQUIRED_RUNTIME_LAMBDAS.length, 34);
  assert.equal(ALLOWLIST.size, 34);
  assert.equal(23 + 11 + 43, 77);
  assert.deepEqual(
    deterministicManifest([{ functionName: "b" }, { functionName: "a" }]).map(
      ({ functionName }) => functionName,
    ),
    ["a", "b"],
  );
});

test("rejects PROD, wrong account, wrong region, prefix and allowlist violations", () => {
  assert.throws(() =>
    validateTarget({
      stage: "prod",
      account: DEV_ACCOUNT,
      region: DEV_REGION,
      functionName: valid,
    }),
  );
  assert.throws(() =>
    validateTarget({
      stage: "dev",
      account: "000000000000",
      region: DEV_REGION,
      functionName: valid,
    }),
  );
  assert.throws(() =>
    validateTarget({
      stage: "dev",
      account: DEV_ACCOUNT,
      region: "us-east-1",
      functionName: valid,
    }),
  );
  assert.throws(() =>
    validateTarget({
      stage: "dev",
      account: DEV_ACCOUNT,
      region: DEV_REGION,
      functionName: "liass-ohada-dev-accounting-post-entry",
    }),
  );
  assert.throws(() =>
    validateTarget({
      stage: "dev",
      account: DEV_ACCOUNT,
      region: DEV_REGION,
      functionName: `${FUNCTION_PREFIX}not-allowlisted`,
    }),
  );
});

test("hash comparison uses AWS Lambda base64 SHA-256 semantics", () => {
  assert.equal(
    sha256Base64(Buffer.from("liass")),
    "kWlIcHKaAvm73lE3mbAnQwzO467WPAGxd4tjeaGtXlc=",
  );
});

test("dry-run performs no update and execute is explicit", async () => {
  let updates = 0;
  assert.deepEqual(
    await executeIfRequested(
      false,
      [{ functionName: "a", differs: true }],
      async () => {
        updates += 1;
      },
    ),
    [],
  );
  assert.equal(updates, 0);
  await executeIfRequested(
    true,
    [{ functionName: "a", differs: true }],
    async () => {
      updates += 1;
    },
  );
  assert.equal(updates, 1);
  await executeIfRequested(
    true,
    [{ functionName: "a", differs: false }],
    async () => {
      updates += 1;
    },
  );
  assert.equal(updates, 1);
});

test("partial failure stops the deterministic sequence", async () => {
  const calls = [];
  await assert.rejects(
    releaseSequentially(
      [{ functionName: "c" }, { functionName: "a" }, { functionName: "b" }],
      async ({ functionName }) => {
        calls.push(functionName);
        if (functionName === "b") throw new Error("failure");
      },
    ),
    (error) => {
      assert.deepEqual(error.updated, ["a"]);
      assert.equal(error.failed, "b");
      assert.deepEqual(error.remaining, ["c"]);
      return true;
    },
  );
  assert.deepEqual(calls, ["a", "b"]);
});
