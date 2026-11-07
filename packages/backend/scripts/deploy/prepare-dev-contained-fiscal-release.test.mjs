import assert from "node:assert/strict";
import test from "node:test";
import {
  TARGET_FUNCTIONS,
  addedResources,
  assertContainedAdditions,
} from "./prepare-dev-contained-fiscal-release.mjs";

test("freezes every live resource and accepts only the exact B1/B2/B3 additions", () => {
  const resources = {};
  const types = [
    ["AWS::ApiGatewayV2::Integration", 7],
    ["AWS::ApiGatewayV2::Route", 7],
    ["AWS::IAM::Policy", 3],
    ["AWS::IAM::Role", 3],
    ["AWS::Lambda::Function", 7],
    ["AWS::Lambda::Permission", 7],
  ];
  let functionIndex = 0;
  for (const [type, count] of types) for (let index = 0; index < count; index += 1) {
    const resource = { Type: type, Properties: {} };
    if (type === "AWS::Lambda::Function")
      resource.Properties.FunctionName = TARGET_FUNCTIONS[functionIndex++];
    if (type === "AWS::ApiGatewayV2::Route")
      Object.assign(resource.Properties, { AuthorizationType: "JWT", AuthorizerId: { Ref: "Jwt" } });
    resources[`${type}${index}`] = resource;
  }
  resources["AWS::IAM::Policy0"].Properties.PolicyDocument = {
    Statement: [{ Effect: "Allow", Action: ["ssm:PutParameter"], Condition: { StringEquals: { "ssm:Overwrite": "false" } } }],
    admin: "PLATFORM_ADMIN#dev#*",
    sfe: "PLATFORM_SFE#dev#BJ",
    test: "/TEST/*",
  };
  resources["AWS::Lambda::Function0"].Properties.Environment = {
    Variables: { FISCAL_CREDENTIAL_TEST_VERIFICATION_ENABLED: "0" },
  };
  assert.doesNotThrow(() => assertContainedAdditions(resources));
  assert.deepEqual(
    addedResources(
      { Resources: { Existing: { Type: "Existing" } } },
      { Resources: { Existing: { Type: "ChangedButFrozen" }, Added: { Type: "Added" } } },
    ),
    { Added: { Type: "Added" } },
  );
});

test("refuses deletion of a live resource", () => {
  assert.throws(() => addedResources({ Resources: { Existing: {} } }, { Resources: {} }));
});
