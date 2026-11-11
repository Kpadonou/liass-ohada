#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [synthArg, liveParentArg, liveFiscalArg, liveRestaurantsArg, parametersArg, outputArg] = process.argv.slice(2);
if (![synthArg, liveParentArg, liveFiscalArg, liveRestaurantsArg, parametersArg, outputArg].every(Boolean))
  throw new Error("Usage: prepare SYNTH LIVE_PARENT LIVE_FISCAL LIVE_RESTAURANTS LIVE_NESTED_PARAMETERS OUTPUT");
const parse = (file) => {
  const value = JSON.parse(readFileSync(file, "utf8"));
  return typeof value === "string" ? JSON.parse(value) : value.TemplateBody ?? value;
};
const stable = (value) => `${JSON.stringify(value, null, 2)}\n`;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const find = (directory, marker) => {
  const files = readdirSync(directory).filter((name) => name.includes(marker) && name.endsWith(".nested.template.json"));
  if (files.length !== 1) throw new Error(`Expected one ${marker} template, found ${files.length}`);
  return parse(join(directory, files[0]));
};
const liveParent = parse(liveParentArg);
const liveFiscal = parse(liveFiscalArg);
const liveRestaurants = parse(liveRestaurantsArg);
const candidateFiscal = find(synthArg, "FiscalComplianceApi");
const candidateRestaurants = find(synthArg, "RestaurantsApi");
if (Object.keys(liveParent.Resources ?? {}).length !== 278 || Object.keys(liveFiscal.Resources ?? {}).length !== 48 || Object.keys(liveRestaurants.Resources ?? {}).length !== 390)
  throw new Error("Live resource-count baseline changed");

const functionId = Object.keys(liveFiscal.Resources).find((id) =>
  liveFiscal.Resources[id].Type === "AWS::Lambda::Function" &&
  liveFiscal.Resources[id].Properties?.FunctionName === "liass-ohada-dev-fiscal-compliance-real-test");
if (!functionId || !candidateFiscal.Resources[functionId]) throw new Error("Fiscal executor identity changed");
const policyId = Object.keys(liveFiscal.Resources).find((id) =>
  liveFiscal.Resources[id].Type === "AWS::IAM::Policy" &&
  id.includes("RealTestExecutorExecutionRoleDefaultPolicy"));
if (!policyId || !candidateFiscal.Resources[policyId]) throw new Error("Fiscal executor policy identity changed");
const candidateGet = candidateFiscal.Resources[policyId].Properties.PolicyDocument.Statement.filter((statement) =>
  (Array.isArray(statement.Action) ? statement.Action : [statement.Action]).includes("s3:GetObject"));
if (candidateGet.length !== 1 || JSON.stringify(candidateGet[0]).includes("*")) throw new Error("Capture reader is not exact-object scoped");
const frozenFunction = structuredClone(liveFiscal.Resources[functionId]);
frozenFunction.Properties.Code = candidateFiscal.Resources[functionId].Properties.Code;
frozenFunction.Properties.Environment = candidateFiscal.Resources[functionId].Properties.Environment;
if (frozenFunction.Properties.Environment.Variables.FISCAL_REAL_TEST_ENABLED !== "0" || frozenFunction.Properties.Environment.Variables.FISCAL_ADJUDICATION_ENABLED !== "1" || frozenFunction.Properties.Environment.Variables.FISCAL_TEST_CONFIGURATION_SECRET_ARN !== "")
  throw new Error("Fiscal gate or credential safeguard invalid");
const frozenPolicy = structuredClone(liveFiscal.Resources[policyId]);
frozenPolicy.Properties.PolicyDocument.Statement = [
  ...liveFiscal.Resources[policyId].Properties.PolicyDocument.Statement,
  candidateGet[0],
];
const frozenFiscal = structuredClone(liveFiscal);
frozenFiscal.Resources[functionId] = frozenFunction;
frozenFiscal.Resources[policyId] = frozenPolicy;

const additions = Object.fromEntries(Object.entries(candidateRestaurants.Resources).filter(([id]) => !liveRestaurants.Resources[id]));
const types = Object.values(additions).map((resource) => resource.Type).sort();
if (JSON.stringify(types) !== JSON.stringify(["AWS::ApiGatewayV2::Route", "AWS::Lambda::Permission"]) ||
    !JSON.stringify(additions).includes("/fiscal/adjudicate") || JSON.stringify(additions).includes("AWS::ApiGatewayV2::Integration"))
  throw new Error(`Unexpected Restaurants additions: ${JSON.stringify(types)}`);
const frozenRestaurants = structuredClone(liveRestaurants);
Object.assign(frozenRestaurants.Resources, additions);
if (Object.keys(frozenRestaurants.Resources).length !== 392) throw new Error("Restaurants resource count invalid");

const output = resolve(outputArg);
if (existsSync(output)) throw new Error("Output directory already exists");
mkdirSync(join(output, "assets"), { recursive: true });
const writeAsset = (template) => {
  const bytes = Buffer.from(stable(template));
  const key = `${digest(bytes)}.json`;
  writeFileSync(join(output, "assets", key), bytes);
  return { key, sha256: digest(bytes) };
};
const fiscalAsset = writeAsset(frozenFiscal);
const restaurantsAsset = writeAsset(frozenRestaurants);
const templateUrl = (key) => `https://cdk-hnb659fds-assets-570197775998-eu-west-3.s3.eu-west-3.amazonaws.com/${key}`;
const frozenParent = structuredClone(liveParent);
const nested = Object.entries(frozenParent.Resources).filter(([, resource]) => resource.Type === "AWS::CloudFormation::Stack");
const parameterEvidence = parse(parametersArg);
if (!Array.isArray(parameterEvidence) || parameterEvidence.length !== nested.length)
  throw new Error("Nested parameter evidence is incomplete");
for (const evidence of parameterEvidence) {
  const resource = frozenParent.Resources[evidence.logicalId];
  const existing = resource?.Properties?.Parameters ?? {};
  if (!resource || resource.Type !== "AWS::CloudFormation::Stack" ||
      JSON.stringify(Object.keys(existing).sort()) !== JSON.stringify(Object.keys(evidence.currentParameters ?? {}).sort()) ||
      Object.values(evidence.currentParameters ?? {}).some((value) => typeof value !== "string" || !value))
    throw new Error(`Nested parameter evidence invalid: ${evidence.logicalId}`);
  resource.Properties.Parameters = evidence.currentParameters;
}
const fiscalParent = nested.find(([id]) => id.includes("FiscalComplianceApiNestedStack"));
const restaurantsParent = nested.find(([id]) => id.includes("RestaurantsApiNestedStack"));
if (!fiscalParent || !restaurantsParent) throw new Error("Parent nested-stack identity changed");
fiscalParent[1].Properties.TemplateURL = templateUrl(fiscalAsset.key);
restaurantsParent[1].Properties.TemplateURL = templateUrl(restaurantsAsset.key);
const parentAsset = writeAsset(frozenParent);
writeFileSync(join(output, "manifest.json"), stable({
  schemaVersion: 1,
  target: { account: "570197775998", region: "eu-west-3", stack: "LiassOhadaBackendStackApiStack2823DE88" },
  sourceCommit: "7dc19cc",
  resourceCounts: { parent: 278, fiscal: 48, restaurants: 392 },
  changes: {
    parent: [fiscalParent[0], restaurantsParent[0]],
    fiscal: [functionId, policyId],
    restaurants: Object.keys(additions).sort(),
  },
  assets: { parent: parentAsset, fiscal: fiscalAsset, restaurants: restaurantsAsset },
}));
process.stdout.write(`${JSON.stringify({ status: "PASS", output, parent: parentAsset.key })}\n`);
