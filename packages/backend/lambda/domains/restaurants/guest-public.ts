import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { randomUUID } from "crypto";
import {
  GuestCapabilitySchema,
  GuestContextResponseSchema,
  GuestRenewRequestSchema,
} from "@liass-ohada/shared/restaurants";
import { GuestService } from "./guest-service";
import { AppError } from "@/lambda/shared/app-error";

/** Deliberately independent of Cognito/tenant staff middleware. Exact route allowlist. */
export async function handler(event: APIGatewayProxyEventV2) {
  const started = Date.now(),
    correlationId = event.requestContext?.requestId || randomUUID();
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Correlation-Id": correlationId,
  };
  const send = (statusCode: number, body: unknown) => {
    console.info("[RESTAURANTS_GUEST]", {
      correlationId,
      statusCode,
      outcome: (body as { state?: string }).state,
      latencyMs: Date.now() - started,
    });
    return { statusCode, headers, body: JSON.stringify(body) };
  };
  try {
    if (
      ![
        "POST /public/restaurants/guest/resolve",
        "POST /public/restaurants/guest/renew",
      ].includes(event.routeKey)
    )
      return send(404, { state: "UNAVAILABLE" });
    if (
      event.isBase64Encoded ||
      Buffer.byteLength(event.body ?? "", "utf8") > 1024
    )
      return send(400, { state: "UNAVAILABLE" });
    let input: unknown;
    try {
      input = JSON.parse(event.body ?? "{}");
    } catch {
      return send(400, { state: "UNAVAILABLE" });
    }
    let result;
    if (event.routeKey.endsWith("/resolve"))
      result = await GuestService.resolve(input);
    else {
      if (!GuestRenewRequestSchema.safeParse(input).success)
        return send(400, { state: "UNAVAILABLE" });
      const authorization =
        event.headers?.authorization ?? event.headers?.Authorization;
      const match = /^Bearer ([^\s]+)$/.exec(authorization ?? "");
      if (!match || !GuestCapabilitySchema.safeParse(match[1]).success)
        return send(200, { state: "UNAVAILABLE" });
      result = await GuestService.renew(match[1]);
    }
    return send(200, GuestContextResponseSchema.parse(result));
  } catch (error) {
    // No exception text, input, token or Authorization enters logs or the public body.
    const denied =
      error instanceof AppError &&
      [400, 403, 404, 409].includes(error.statusCode);
    return send(denied ? 200 : 503, { state: "UNAVAILABLE" });
  }
}
