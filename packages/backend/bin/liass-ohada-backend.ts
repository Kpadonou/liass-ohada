#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveDeploymentStage } from "../lib/config/deployment";
import { LiassOhadaBackendStack } from "../lib/liass-ohada-backend-stack";

function stripInlineComment(value: string): string {
  let quoted = false;
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if ((character === '"' || character === "'") && value[index - 1] !== "\\") {
      if (!quoted) {
        quoted = true;
        quote = character;
      } else if (quote === character) {
        quoted = false;
        quote = undefined;
      }
    }

    if (!quoted && character === "#") {
      return value.slice(0, index).trim();
    }
  }

  return value.trim();
}

function unquote(value: string): string {
  const trimmed = stripInlineComment(value);
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];

  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\'/g, "'");
  }

  return trimmed;
}

function loadBackendLocalEnv(): void {
  const backendRoot = path.resolve(__dirname, "..");
  const candidates = [
    path.join(backendRoot, ".env.local"),
    path.join(process.cwd(), ".env.local"),
  ];
  const loaded = new Set<string>();

  for (const filePath of candidates) {
    if (loaded.has(filePath) || !fs.existsSync(filePath)) {
      continue;
    }

    loaded.add(filePath);
    const contents = fs.readFileSync(filePath, "utf8");

    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
      if (!match) {
        continue;
      }

      const [, key, rawValue] = match;
      if (process.env[key] === undefined) {
        process.env[key] = unquote(rawValue);
      }
    }
  }
}

loadBackendLocalEnv();

const app = new cdk.App();

const stage = resolveDeploymentStage(
  app.node.tryGetContext("stage") ?? process.env.STAGE ?? "dev",
);
const account = app.node.tryGetContext("account") ?? "570197775998";
const region = app.node.tryGetContext("region") ?? "eu-west-3";

new LiassOhadaBackendStack(app, "LiassOhadaBackendStack", {
  env: { account, region },
  stage,
  restaurantsMigrationTrustedRoleArn: app.node.tryGetContext("restaurantsMigrationTrustedRoleArn"),
});
