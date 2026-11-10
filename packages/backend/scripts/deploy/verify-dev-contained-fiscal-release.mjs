#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { APPROVED_COMMITS, TARGET_FUNCTIONS, addedResources, assertContainedAdditions, assertIdentityParameterContract } from "./prepare-dev-contained-fiscal-release.mjs";
import { reviewReleaseScope } from "./review-fiscal-nested-change-set.mjs";

const [releaseArg, baselineArg, zipArg, liveHashesArg, apiBaselineArg, executorArg, scopeReviewArg] = process.argv.slice(2);
if (!releaseArg || !baselineArg || !zipArg || !liveHashesArg || !apiBaselineArg || !executorArg || !scopeReviewArg) throw new Error("Usage: verify RELEASE_DIR LIVE_IDENTITY_TEMPLATE LIVE_ZIP_DIR CURRENT_LAMBDA_HASHES LIVE_API_TEMPLATE EXECUTOR_CONFIG SCOPE_REVIEW_JSON");
const release = resolve(releaseArg), zipDirectory = resolve(zipArg);
const json = (file) => { const value = JSON.parse(readFileSync(file, "utf8")); return typeof value === "string" ? JSON.parse(value) : value; };
const hash = (bytes) => createHash("sha256").update(bytes).digest();
const manifest = json(join(release, "release-manifest.json"));
if (manifest.mode !== "PREPARE_ONLY" || manifest.deployAuthorized !== false ||
    manifest.target.account !== "570197775998" || manifest.target.region !== "eu-west-3" || manifest.target.stage !== "dev" ||
    JSON.stringify(manifest.source.approvedCommits) !== JSON.stringify(APPROVED_COMMITS)) throw new Error("Release identity mismatch");
const executor = json(executorArg);
const scopeReview = json(scopeReviewArg);
const scopeFiles = (file) => json(resolve(file));
if (executor.Environment?.FISCAL_REAL_TEST_ENABLED !== "0" ||
    manifest.desired.gates.FISCAL_CREDENTIAL_TEST_VERIFICATION_ENABLED !== "0" ||
    manifest.desired.gates.productionProviderDispatch !== false ||
    manifest.desired.gates.automaticFiscalActivation !== false) throw new Error("Fiscal safety gate invalid");
const baseline = json(baselineArg);
const identityAsset = join(release, "assets", manifest.assets.identityTemplate.key);
const apiAsset = join(release, "assets", manifest.assets.apiTemplate.key);
for (const [file, expected] of [[identityAsset, manifest.assets.identityTemplate.sha256Hex], [apiAsset, manifest.assets.apiTemplate.sha256Hex]])
  if (hash(readFileSync(file)).toString("hex") !== expected) throw new Error(`Template hash mismatch: ${file}`);
const frozen = json(identityAsset);
const apiBaseline = json(apiBaselineArg), frozenApi = json(apiAsset);
const apiChanged = Object.keys(apiBaseline.Resources).filter((id) => JSON.stringify(apiBaseline.Resources[id]) !== JSON.stringify(frozenApi.Resources[id]));
if (apiChanged.length !== 1 || !apiChanged[0].includes("IdentityApiNestedStack")) throw new Error(`API parent scope changed: ${apiChanged}`);
const parentIdentity = frozenApi.Resources[apiChanged[0]];
const baselineIdentity = apiBaseline.Resources[apiChanged[0]];
assertIdentityParameterContract(parentIdentity, frozen);
const supplied = parentIdentity.Properties.Parameters ?? {};
for (const [name, value] of Object.entries(baselineIdentity.Properties.Parameters ?? {}))
  if (JSON.stringify(supplied[name]) !== JSON.stringify(value)) throw new Error(`Existing Identity binding changed: ${name}`);
const addedBindings = Object.keys(supplied).filter((name) => !(name in (baselineIdentity.Properties.Parameters ?? {})));
if (addedBindings.length !== 1) throw new Error(`Unexpected Identity parameter bindings: ${addedBindings}`);
const providerBinding = supplied[addedBindings[0]]?.["Fn::GetAtt"];
if (!addedBindings[0].endsWith("ProviderURL") || !Array.isArray(providerBinding) ||
    providerBinding[1] !== "ProviderURL" || apiBaseline.Resources[providerBinding[0]]?.Type !== "AWS::Cognito::UserPool")
  throw new Error("Identity ProviderURL must reference the existing parent Cognito user pool");
const parentWithoutIdentity = structuredClone(frozenApi);
parentWithoutIdentity.Resources[apiChanged[0]] = baselineIdentity;
if (JSON.stringify(parentWithoutIdentity) !== JSON.stringify(apiBaseline)) throw new Error("Unexpected parent template change");
if (Object.keys(baseline.Resources).length !== 103 || Object.keys(frozen.Resources).length !== 137) throw new Error("Identity resource count mismatch");
for (const [id, resource] of Object.entries(baseline.Resources))
  if (JSON.stringify(frozen.Resources[id]) !== JSON.stringify(resource)) throw new Error(`Existing Identity resource changed: ${id}`);
const additions = addedResources(baseline, frozen);
assertContainedAdditions(additions);
const byType = (type) => Object.entries(additions).filter(([, item]) => item.Type === type);
const routes = byType("AWS::ApiGatewayV2::Route");
const integrations = new Map(byType("AWS::ApiGatewayV2::Integration"));
const permissions = byType("AWS::Lambda::Permission");
const functions = new Map(byType("AWS::Lambda::Function"));
const roleIds = new Set(byType("AWS::IAM::Role").map(([id]) => id));
const policyByRole = new Map(byType("AWS::IAM::Policy").map(([id, item]) => {
  const role = item.Properties.Roles?.[0]?.Ref;
  if (!role || !roleIds.has(role)) throw new Error(`IAM policy role binding invalid: ${id}`);
  return [role, item.Properties.PolicyDocument.Statement];
}));
if (policyByRole.size !== 3) throw new Error("Expected three isolated execution policies");
const policyFor = (suffix) => {
  const role = [...roleIds].find((id) => id.endsWith(suffix));
  if (!role) throw new Error(`Missing role: ${suffix}`);
  return policyByRole.get(role);
};
const actions = (statement) => Array.isArray(statement.Action) ? statement.Action : [statement.Action];
const has = (statements, action, resource, condition) => statements.some((statement) =>
  statement.Effect === "Allow" && actions(statement).includes(action) &&
  (resource === undefined || statement.Resource === resource) &&
  (condition === undefined || JSON.stringify(statement.Condition) === JSON.stringify(condition))
);
const enrollment = policyFor("EnrollmentRole2F7D2ED6");
const verification = policyFor("VerificationRole51EECC53");
const sfe = policyFor("SfeReferenceRole3D6679DB");
const ssmBase = "arn:aws:ssm:eu-west-3:570197775998:parameter/dev/platform/fiscal/*";
if (!has(enrollment, "ssm:PutParameter", ssmBase, { StringEquals: { "ssm:Overwrite": "false" } }) ||
    !has(enrollment, "ssm:GetParameter", ssmBase) ||
    !has(verification, "ssm:GetParameter", `${ssmBase}/TEST/*`) ||
    verification.some((statement) => actions(statement).some((action) => action.startsWith("ssm:") && action !== "ssm:GetParameter")))
  throw new Error("SSM access boundary invalid");
if (!has(enrollment, "dynamodb:PutItem", undefined, { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["ORG#*"] } }) ||
    !has(verification, "dynamodb:PutItem", undefined, { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["ORG#*"] } }) ||
    !has(sfe, "dynamodb:PutItem", undefined, { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": ["PLATFORM_SFE#dev#BJ"] } }) ||
    !sfe.some((statement) => statement.Effect === "Deny" && actions(statement).includes("dynamodb:PutItem") &&
      JSON.stringify(statement.Condition).includes("PLATFORM_ADMIN#*"))) throw new Error("DynamoDB grant or tenant boundary invalid");
const authorizer = JSON.stringify(routes[0][1].Properties.AuthorizerId);
const apiId = JSON.stringify(routes[0][1].Properties.ApiId);
for (const [, route] of routes) {
  const p = route.Properties;
  if (p.AuthorizationType !== "JWT" || JSON.stringify(p.AuthorizerId) !== authorizer || JSON.stringify(p.ApiId) !== apiId)
    throw new Error(`JWT boundary mismatch: ${p.RouteKey}`);
  const integrationId = p.Target?.["Fn::Join"]?.[1]?.[1]?.Ref;
  const integration = integrations.get(integrationId);
  const functionId = integration?.Properties.IntegrationUri?.["Fn::GetAtt"]?.[0];
  if (!functionId || !functions.has(functionId) || integration.Properties.IntegrationType !== "AWS_PROXY" || integration.Properties.PayloadFormatVersion !== "2.0")
    throw new Error(`Route integration mismatch: ${p.RouteKey}`);
  const fn = functions.get(functionId);
  if (!roleIds.has(fn.Properties.Role?.["Fn::GetAtt"]?.[0])) throw new Error(`Execution role missing: ${fn.Properties.FunctionName}`);
  if (!permissions.some(([, permission]) => permission.Properties.FunctionName?.["Fn::GetAtt"]?.[0] === functionId &&
    permission.Properties.Principal === "apigateway.amazonaws.com" && permission.Properties.Action === "lambda:InvokeFunction"))
    throw new Error(`Invoke permission missing: ${p.RouteKey}`);
}
const names = Object.values(additions).filter((item) => item.Type === "AWS::Lambda::Function").map((item) => item.Properties.FunctionName).sort();
if (JSON.stringify(names) !== JSON.stringify([...TARGET_FUNCTIONS].sort())) throw new Error("Lambda mapping changed");
const newAssets = new Map(manifest.assets.executables.map((asset) => [asset.key, asset]));
if (newAssets.size !== 2) throw new Error("Expected two new ZIP assets");
for (const resource of Object.values(additions).filter((item) => item.Type === "AWS::Lambda::Function")) {
  const key = resource.Properties.Code?.S3Key, asset = newAssets.get(key);
  if (!asset || resource.Properties.Code.S3Bucket !== manifest.assets.bucket) throw new Error(`Lambda asset mapping invalid: ${resource.Properties.FunctionName}`);
  if (resource.Properties.FunctionName.endsWith("verify-fiscal-connection") && resource.Properties.Environment.Variables.FISCAL_CREDENTIAL_TEST_VERIFICATION_ENABLED !== "0") throw new Error("Verification gate enabled");
}
for (const asset of newAssets.values()) {
  const bytes = readFileSync(join(release, "assets", asset.key));
  if (hash(bytes).toString("hex") !== asset.sha256Hex || hash(bytes).toString("base64") !== asset.codeSha256Base64) throw new Error(`New ZIP mismatch: ${asset.key}`);
}
reviewReleaseScope({
  root: scopeFiles(scopeReview.rootChangeSet),
  parentLive: scopeFiles(scopeReview.parentLive),
  parentCandidate: scopeFiles(scopeReview.parentCandidate),
  parentResolutions: scopeReview.parentResolutions,
  stacks: scopeReview.stacks.map((stack) => ({
    ...stack,
    liveTemplate: scopeFiles(stack.liveTemplate),
    candidateTemplate: scopeFiles(stack.candidateTemplate),
    childChangeSet: scopeFiles(stack.childChangeSet),
  })),
});
const preserved = manifest.liveBaseline.preservedExecutables;
if (preserved.length !== 232) throw new Error("Existing Lambda inventory incomplete");
const current = new Map(json(liveHashesArg).map((entry) => [entry.FunctionName, entry.CodeSha256]));
if (current.size !== 232) throw new Error("Current live Lambda inventory incomplete");
let identity = 0, sales = 0;
for (const functionInfo of preserved) {
  if (current.get(functionInfo.FunctionName) !== functionInfo.CodeSha256) throw new Error(`Live Lambda changed: ${functionInfo.FunctionName}`);
  if (functionInfo.FunctionName.startsWith("liass-ohada-dev-identity-")) identity++;
  if (functionInfo.FunctionName.startsWith("liass-ohada-dev-sales-")) sales++;
  const filename = `${Buffer.from(functionInfo.CodeSha256, "base64").toString("hex")}.zip`;
  const file = join(zipDirectory, filename);
  if (!existsSync(file) || hash(readFileSync(file)).toString("base64") !== functionInfo.CodeSha256) throw new Error(`Preserved ZIP missing or corrupt: ${functionInfo.FunctionName}`);
}
if (identity !== 36 || sales !== 37) throw new Error(`Domain count mismatch: Identity ${identity}, Sales ${sales}`);
process.stdout.write(JSON.stringify({status:"PASS",preserved:232,identity,sales,existingIdentityResources:103,addedResources:34,newZipAssets:2,newLambdas:7})+"\n");
