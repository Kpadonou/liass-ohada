#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { LiassOhadaBackendStack } from "../lib/liass-ohada-backend-stack";

const app = new cdk.App();

const stage = app.node.tryGetContext("stage") ?? "dev";
const account = app.node.tryGetContext("account") ?? "570197775998";
const region = app.node.tryGetContext("region") ?? "eu-west-2";

new LiassOhadaBackendStack(app, "LiassOhadaBackendStack", {
  env: { account, region },
  stage,
});
