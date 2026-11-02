import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(32).toString("base64url"),
  };
}
export function callback(url, expectedState) {
  const u = new URL(url, "http://localhost:4200");
  if (u.pathname !== "/auth/callback") throw Error("Unexpected callback path");
  const states = u.searchParams.getAll("state");
  const supplied = Buffer.from(states[0] ?? "");
  const expected = Buffer.from(expectedState);
  if (
    states.length !== 1 ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    throw Error("Invalid OAuth state");
  if (u.searchParams.has("error")) throw Error("Login was not completed");
  const codes = u.searchParams.getAll("code");
  if (codes.length !== 1 || !codes[0])
    throw Error("Missing authorization code");
  return codes[0];
}
export function accessToken(data) {
  if (
    !data ||
    data.token_type?.toLowerCase() !== "bearer" ||
    typeof data.access_token !== "string" ||
    !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(data.access_token) ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0
  )
    throw Error("Invalid token response");
  return data.access_token;
}
export function redactHeaders(headers) {
  return Object.fromEntries(
    new Headers(headers)
      .entries()
      .map(([k, v]) => [k, /authorization|cookie/i.test(k) ? "[REDACTED]" : v]),
  );
}
export async function listenForCode(state, timeoutMs = 300000, port = 4200) {
  let timer;
  let finish;
  const code = new Promise((resolve, reject) => {
    finish = (error, value) => (error ? reject(error) : resolve(value));
  });
  // Attach immediately so startup/timeout failures cannot become unhandled rejections.
  code.catch(() => {});
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    if (
      req.method !== "GET" ||
      new URL(req.url, "http://localhost").pathname !== "/auth/callback"
    ) {
      res.writeHead(404).end();
      return;
    }
    try {
      const value = callback(req.url, state);
      res.end("Authentication received. You may close this tab.");
      finish(null, value);
    } catch {
      res.writeHead(400).end("Authentication failed. Restart the harness.");
      finish(Error("Callback rejected"));
    }
  });
  const close = async () => {
    clearTimeout(timer);
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  };
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "localhost", resolve);
    });
    timer = setTimeout(() => finish(Error("Login timed out")), timeoutMs);
  } catch {
    await close();
    throw Error(
      "Callback unavailable: stop the frontend on localhost:4200 first",
    );
  }
  return { code, close, port: server.address().port };
}
