#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const inventory = JSON.parse(readFileSync(process.argv[2], "utf8"));
const output = resolve(process.argv[3]);
if (!output.startsWith("/Users/kpadonou/Projects/liass-ohada/packages/backend/cdk.out/fiscal-b4-") || inventory.length !== 232)
  throw new Error("Invalid frozen DEV ZIP target or inventory");
mkdirSync(output, { recursive: true });
const b64 = (bytes) => createHash("sha256").update(bytes).digest("base64");
let checked = 0;
const start = Number(process.env.B4_START ?? 0), end = Number(process.env.B4_END ?? inventory.length);
if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 232 || start > end) throw new Error("Invalid inventory slice");
for (const item of inventory.slice(start, end)) {
  const zip = join(output, `${Buffer.from(item.CodeSha256, "base64").toString("hex")}.zip`);
  if (existsSync(zip) && b64(readFileSync(zip)) === item.CodeSha256) { checked++; continue; }
  const info = JSON.parse(execFileSync("aws", ["lambda", "get-function", "--profile", "rem", "--region", "eu-west-3", "--function-name", item.FunctionName, "--output", "json"], { encoding: "utf8" }));
  if (info.Configuration?.CodeSha256 !== item.CodeSha256) throw new Error(`Live hash changed: ${item.FunctionName}`);
  execFileSync("curl", ["--fail", "--silent", "--show-error", "--location", "--retry", "5", "--retry-all-errors", "--output", zip, info.Code.Location], { stdio: "pipe" });
  const bytes = readFileSync(zip);
  if (b64(bytes) !== item.CodeSha256) throw new Error(`ZIP hash mismatch: ${item.FunctionName}`);
  checked++;
  if (checked % 20 === 0) process.stdout.write(`Verified ${checked}/232\n`);
}
process.stdout.write(`Verified ${checked}/${end - start} byte-derived Lambda ZIP hashes in slice ${start}:${end}\n`);
