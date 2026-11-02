import fs from "node:fs/promises";
import ts from "typescript";
import { pkce, listenForCode, accessToken } from "./session.mjs";

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
const [orgId, outletId] = process.argv.slice(2);
if (
  !orgId ||
  !outletId ||
  process.argv.length !== 4 ||
  !/^[\w-]+$/.test(orgId) ||
  !/^[\w-]+$/.test(outletId)
)
  throw Error("Usage: restaurants:dev-auth -- <orgId> <outletId>");
const origin = `https://${config.cognito.oauth.domain}`;
const redirect = "http://localhost:4200/auth/callback";
const intent = pkce();
let listener;
let token;
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
  token = accessToken(await response.json());
  const path = `/restaurants/outlets/${outletId}/business-days/current`;
  const read = await fetch(config.apiBaseUrl + path, {
    redirect: "error",
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
    headers: { Authorization: `Bearer ${token}`, "x-org-id": orgId },
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
} catch {
  console.error(
    "DEV authentication/read failed; no response bodies or credentials logged.",
  );
  process.exitCode = 1;
} finally {
  token = undefined;
  intent.verifier = "";
  await listener?.close();
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
