#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { resolveDeploymentStage } from "../lib/config/deployment";
import { LiassOhadaBackendStack } from "../lib/liass-ohada-backend-stack";

const app = new cdk.App();

const stage = resolveDeploymentStage(
  app.node.tryGetContext("stage") ?? process.env.STAGE ?? "dev",
);
const account = app.node.tryGetContext("account") ?? "570197775998";
const region = app.node.tryGetContext("region") ?? "eu-west-2";

new LiassOhadaBackendStack(app, "LiassOhadaBackendStack", {
  env: { account, region },
  stage,
});
