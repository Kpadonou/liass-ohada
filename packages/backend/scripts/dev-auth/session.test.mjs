import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  pkce,
  callback,
  accessToken,
  redactHeaders,
  listenForCode,
} from "./session.mjs";
test("secure independent PKCE S256 and state", () => {
  const a = pkce();
  assert.equal(a.verifier.length, 43);
  assert.equal(
    a.challenge,
    createHash("sha256").update(a.verifier).digest("base64url"),
  );
  assert.notEqual(a.state, pkce().state);
});
test("callback requires exact state, single code and expected path", () => {
  assert.equal(callback("/auth/callback?state=s&code=c", "s"), "c");
  for (const u of [
    "/auth/callback?state=x&code=c",
    "/auth/callback?state=s&state=s&code=c",
    "/auth/callback?state=s&code=a&code=b",
    "/auth/callback?state=s&error=denied",
    "/else?state=s&code=c",
  ])
    assert.throws(() => callback(u, "s"));
});
test("token response rejects malformed, expired and wrong type", () => {
  assert.equal(
    accessToken({
      token_type: "Bearer",
      access_token: "a.b.c",
      expires_in: 10,
    }),
    "a.b.c",
  );
  for (const d of [
    null,
    {},
    { token_type: "Bearer", access_token: "secret", expires_in: 10 },
    { token_type: "Bearer", access_token: "a.b.c", expires_in: 0 },
  ])
    assert.throws(() => accessToken(d));
});
test("authorization and cookies are redacted", () => {
  assert.deepEqual(
    redactHeaders({
      Authorization: "Bearer secret",
      Cookie: "secret",
      Accept: "application/json",
    }),
    {
      accept: "application/json",
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
    },
  );
});
test("timeout cleanup releases callback listener", async () => {
  const l = await listenForCode("s", 20, 0);
  await assert.rejects(l.code, /timed out/);
  await l.close();
  await assert.rejects(fetch(`http://localhost:${l.port}/auth/callback`));
});
test("rejected callback cleans up without echoing credentials", async () => {
  const l = await listenForCode("s", 1000, 0);
  const r = await fetch(
    `http://localhost:${l.port}/auth/callback?state=wrong&code=secret`,
  );
  assert.equal(r.status, 400);
  assert.ok(!(await r.text()).includes("secret"));
  await assert.rejects(l.code);
  await l.close();
});

test("valid callback resolves once and listener closes", async () => {
  const l = await listenForCode("s", 1000, 0);
  const r = await fetch(
    `http://localhost:${l.port}/auth/callback?state=s&code=local-test-code`,
  );
  assert.equal(r.status, 200);
  assert.equal(await l.code, "local-test-code");
  await l.close();
});
