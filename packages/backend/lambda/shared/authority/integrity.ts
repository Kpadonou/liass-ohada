import { createHash } from "node:crypto";
import { marshall } from "@aws-sdk/util-dynamodb";
import { AppError } from "../app-error";

export const hash = (bytes: string | Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");
/** Closed authority structures contain only strings, booleans, safe integers and collections. */
export function canonical(value: unknown): string {
  if (value === null || value === undefined)
    throw new AppError(422, "AUTHORITY_INVALID_CANONICAL_INPUT");
  if (typeof value === "string") {
    for (let i = 0; i < value.length; i++) {
      const n = value.charCodeAt(i);
      if (n >= 0xd800 && n <= 0xdbff) {
        const next = value.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff))
          throw new AppError(422, "AUTHORITY_INVALID_UNICODE");
      } else if (n >= 0xdc00 && n <= 0xdfff)
        throw new AppError(422, "AUTHORITY_INVALID_UNICODE");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < 0)
      throw new AppError(422, "AUTHORITY_INVALID_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length)
      throw new AppError(422, "AUTHORITY_INVALID_ARRAY");
    return `[${value.map(canonical).join(",")}]`;
  }
  if (
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new AppError(422, "AUTHORITY_INVALID_OBJECT");
  return `{${Object.keys(value)
    .sort()
    .map(
      (k) =>
        `${canonical(k)}:${canonical((value as Record<string, unknown>)[k])}`,
    )
    .join(",")}}`;
}
export function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
export function admission(value: object, cap: number): void {
  const item = marshall(value, { removeUndefinedValues: true });
  if (Buffer.byteLength(JSON.stringify(item), "utf8") > cap)
    throw new AppError(422, "AUTHORITY_ITEM_TOO_LARGE");
}
export function assertArtifact(artifact: {
  bytes: string;
  digest: string;
}): void {
  if (
    Buffer.byteLength(artifact.bytes, "utf8") > 65536 ||
    hash(artifact.bytes) !== artifact.digest
  )
    throw new AppError(422, "AUTHORITY_ARTIFACT_MISMATCH");
  // Authority JSON evidence is canonical: raw duplicate keys, whitespace and ambiguity cannot be discarded by JSON.parse.
  try {
    if (canonical(JSON.parse(artifact.bytes)) !== artifact.bytes) throw Error();
  } catch {
    throw new AppError(422, "AUTHORITY_ARTIFACT_INVALID");
  }
}
