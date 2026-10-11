/** Test-only loopback adapter. Cognito authorizer is simulated; domain boundaries are production code. */
import { createServer } from "node:http";
import {
  GetItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { memoryDynamo } from "../../unit/restaurants/memory-dynamo";
import { RESTAURANTS_ROUTES } from "@/lambda/domains/restaurants/restaurant-routes";
import { restaurantsHandler } from "@/lambda/domains/restaurants/restaurant-handler";
import { handler as productAccessHandler } from "@/lambda/domains/identity/get-product-access";

let memory = memoryDynamo();
let fault: string | null = null;
const calls: { name: string; method: string; path: string }[] = [];
function reset() {
  memory.db.restore();
  memory = memoryDynamo();
  // Fail closed at the SDK boundary: unexpected commands can never reach AWS.
  memory.db.on(ScanCommand).callsFake(() => {
    throw new Error("Scan forbidden");
  });
  for (const org of ["org-a", "org-b", "org-no-product"])
    for (const role of ["OWNER", "MANAGER", "WAITER", "CASHIER", "KITCHEN"])
      memory.seedAccess(
        org,
        role.toLowerCase(),
        role,
        org !== "org-no-product",
      );
  calls.length = 0;
  fault = null;
}
reset();
const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Access-Control-Allow-Origin", "http://localhost:4200");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "authorization,content-type,x-org-id,accept-language",
  );
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  if (request.method === "OPTIONS") {
    response.end();
    return;
  }
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/__test/reset" && request.method === "POST") {
      reset();
      response.end("{}");
      return;
    }
    if (url.pathname === "/__test/fault" && request.method === "POST") {
      fault = url.searchParams.get("kind");
      response.end("{}");
      return;
    }
    if (url.pathname === "/__test/registry") {
      response.end(JSON.stringify(RESTAURANTS_ROUTES));
      return;
    }
    if (url.pathname === "/__test/stats") {
      response.end(
        JSON.stringify({
          calls,
          reads: memory.db.commandCalls(GetItemCommand).length,
          queries: memory.db.commandCalls(QueryCommand).length,
          scans: memory.db.commandCalls(ScanCommand).length,
          rows: memory.rows.size,
        }),
      );
      return;
    }
    const route = RESTAURANTS_ROUTES.find(
      (candidate) =>
        candidate.method === request.method &&
        new RegExp(
          "^" + candidate.path.replace(/\{\w+\}/g, "([^/]+)") + "$",
        ).test(url.pathname),
    );
    const platform =
      url.pathname === "/me/product-access" && request.method === "GET";
    if (!route && !platform) {
      response.statusCode = 404;
      response.end('{"error":{"code":"NOT_FOUND"}}');
      return;
    }
    const pathParameters: Record<string, string> = {};
    if (route) {
      const match = new RegExp(
        "^" + route.path.replace(/\{\w+\}/g, "([^/]+)") + "$",
      ).exec(url.pathname)!;
      [...route.path.matchAll(/\{(\w+)\}/g)].forEach(
        (field, index) =>
          (pathParameters[field[1]] = decodeURIComponent(match[index + 1])),
      );
      calls.push({
        name: route.name,
        method: request.method!,
        path: url.pathname,
      });
    }
    const buffers: Buffer[] = [];
    for await (const chunk of request) buffers.push(Buffer.from(chunk));
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers))
      if (typeof value === "string") headers[key] = value;
    const token = headers.authorization?.replace(/^Bearer /, "");
    const user = ["owner", "manager", "waiter", "cashier", "kitchen"].includes(
      token ?? "",
    )
      ? token
      : undefined;
    const event = {
      headers,
      body: Buffer.concat(buffers).toString() || undefined,
      pathParameters,
      queryStringParameters: Object.fromEntries(url.searchParams),
      requestContext: {
        authorizer: { jwt: { claims: user ? { sub: user } : {} } },
      },
    };
    if (fault === "network") {
      fault = null;
      request.socket.destroy();
      return;
    }
    const result = await (
      route ? restaurantsHandler(route.name) : productAccessHandler
    )(event);
    if (route && fault === "network-after-commit") {
      fault = null;
      request.socket.destroy();
      return;
    }
    response.statusCode = result.statusCode;
    response.end(
      fault === "malformed" ? '{"data":{"name":"invalid DTO"}}' : result.body,
    );
    fault = null;
  } catch {
    response.statusCode = 500;
    response.end('{"error":{"code":"LOCAL_TEST_FAILURE"}}');
  }
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (typeof address === "object" && address)
    process.send?.({ url: `http://127.0.0.1:${address.port}` });
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
