import fs from "node:fs/promises";
import ts from "typescript";
import { randomUUID } from "node:crypto";
import { pkce, listenForCode, accessToken, idToken } from "./session.mjs";

// Read only the canonical DEV configuration; never accept arbitrary OAuth/API hosts.
const source = await fs.readFile(
  new URL(
    "../../../frontend/src/environments/environment.development.ts",
    import.meta.url,
  ),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022 },
}).outputText;
const { environment: config } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);
if (
  config.production ||
  config.cognito.oauth.domain !==
    "liass-ohada-dev-auth.auth.eu-west-3.amazoncognito.com" ||
  config.apiBaseUrl !==
    "https://mk5jf2sco3.execute-api.eu-west-3.amazonaws.com" ||
  !config.cognito.oauth.redirectSignIn.includes(
    "http://localhost:4200/auth/callback",
  )
)
  throw Error("Unexpected DEV configuration");
const [orgId, outletId, sessionId = "62f61225-43ce-45bf-8381-8474fd9b8ab9", invoiceId = "60a509af-e385-4185-b86c-bf60be6c7b57"] = process.argv.slice(2);
if (
  !orgId ||
  !outletId ||
  process.argv.length < 4 || process.argv.length > 6 ||
  !/^[\w-]+$/.test(orgId) ||
  !/^[\w-]+$/.test(outletId)
)
  throw Error("Usage: restaurants:dev-auth -- <orgId> <outletId>");
const origin = `https://${config.cognito.oauth.domain}`;
const redirect = "http://localhost:4200/auth/callback";
const intent = pkce();
let listener;
let access;
let identity;
let stage = "initialization";
const abort = new AbortController();
const stop = () => {
  abort.abort();
  void listener?.close();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  listener = await listenForCode(intent.state);
  const url = new URL("/oauth2/authorize", origin);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.cognito.userPoolClientId,
    redirect_uri: redirect,
    scope: config.cognito.oauth.scopes.join(" "),
    state: intent.state,
    code_challenge: intent.challenge,
    code_challenge_method: "S256",
  }).toString();
  console.log(
    "Open this DEV login URL manually (no tokens are printed):\n" + url,
  );
  const code = await Promise.race([
    listener.code,
    new Promise((_, reject) =>
      abort.signal.addEventListener("abort", () => reject(Error("Cancelled")), {
        once: true,
      }),
    ),
  ]);
  await listener.close();
  const response = await fetch(`${origin}/oauth2/token`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.cognito.userPoolClientId,
      redirect_uri: redirect,
      code_verifier: intent.verifier,
      code,
    }),
  });
  if (!response.ok) throw Error("Token exchange rejected");
  // The profile/workspace synchronization endpoint consumes Cognito claims
  // (including email_verified) from the ID token. The access token is valid
  // for API authorization but does not carry the profile claims required here.
  stage = "token-validation";
  const tokens = await response.json();
  access = accessToken(tokens);
  identity = idToken(tokens);
  stage = "profile-synchronization";
  const profile = await fetch(`${config.apiBaseUrl}/me/workspaces`, {
    redirect: "error",
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
    headers: { Authorization: `Bearer ${identity}` },
  });
  console.log(JSON.stringify({ method: "GET", path: "/me/workspaces", status: profile.status, at: new Date().toISOString() }));
  await profile.body?.cancel();
  if (!profile.ok) throw Error(`Profile synchronization failed (${profile.status})`);
  stage = "restaurant-authorization";
  const path = `/restaurants/outlets/${outletId}/business-days/current`;
  const read = await fetch(config.apiBaseUrl + path, {
    redirect: "error",
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
    headers: { Authorization: `Bearer ${access}`, "x-org-id": orgId },
  });
  console.log(
    JSON.stringify({
      method: "GET",
      path,
      status: read.status,
      at: new Date().toISOString(),
    }),
  );
  await read.body?.cancel();
  if (!read.ok) throw Error("Authenticated read did not succeed");
  stage = "fiscal-connection-discovery";
  const connectionsResponse = await fetch(`${config.apiBaseUrl}/fiscal-compliance/benin/connections?environment=TEST`, {
    headers: { Authorization: `Bearer ${access}`, "x-org-id": orgId },
  });
  const connectionsPayload = await connectionsResponse.json();
  if (!connectionsResponse.ok) throw Error(`Fiscal connection discovery failed (${connectionsResponse.status})`);
  const connections = connectionsPayload.data ?? connectionsPayload;
  const eligible = (connections.items ?? []).filter((item) => item.environment === "TEST" && item.credentialConfigured === true);
  if (eligible.length !== 1) throw Error(`Expected exactly one configured TEST fiscal connection (found ${eligible.length})`);
  const connectionId = eligible[0].connectionId;
  stage = "source-preparation";
  const preparationResponse = await fetch(`${config.apiBaseUrl}/restaurants/outlets/${outletId}/sessions/${sessionId}/invoices/${invoiceId}/fiscal/test-authorization-preparations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "x-org-id": orgId, "content-type": "application/json" },
    body: JSON.stringify({ scenarioId: "02", commandId: randomUUID() }),
  });
  const preparationPayload = await preparationResponse.json();
  if (!preparationResponse.ok) throw Error(`Source preparation failed (${preparationResponse.status})`);
  const proof = preparationPayload.data ?? preparationPayload;
  stage = "platform-authorization";
  const approvalResponse = await fetch(`${config.apiBaseUrl}/platform/fiscality/test-execution-authorizations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "x-org-id": orgId, "content-type": "application/json" },
    body: JSON.stringify({ proofId: proof.proofId, proofDigest: proof.proofDigest, connectionId, commandId: randomUUID() }),
  });
  const approvalPayload = await approvalResponse.json();
  if (!approvalResponse.ok) throw Error(`Platform authorization failed (${approvalResponse.status})`);
  const authorization = approvalPayload.data ?? approvalPayload;
  console.log(JSON.stringify({ authorizationId: authorization.authorizationId, status: authorization.status, expiresAt: authorization.expiresAt, operations: authorization.operations, remaining: authorization.remaining, connectionId }));
} catch (error) {
  const detail = error instanceof Error ? error.message : "unknown error";
  console.error(`DEV authentication/read failed at ${stage}: ${detail}`);
  process.exitCode = 1;
} finally {
  access = undefined;
  identity = undefined;
  intent.verifier = "";
  await listener?.close();
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
