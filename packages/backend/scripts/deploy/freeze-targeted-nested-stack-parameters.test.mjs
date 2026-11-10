import test from "node:test";
import assert from "node:assert/strict";
import { freezeTargetedNestedStackParameters } from "./freeze-targeted-nested-stack-parameters.mjs";

test("freezes only approved nested parameter bindings", () => {
  const parent = { Resources: {
    Identity: { Type: "AWS::CloudFormation::Stack", Properties: { TemplateURL: "old", Parameters: { ApiId: { Ref: "Api" } } } },
    Untouched: { Type: "AWS::CloudFormation::Stack", Properties: { TemplateURL: "same", Parameters: { Value: { Ref: "Other" } } } },
  } };
  const frozen = freezeTargetedNestedStackParameters(parent, [{ logicalId: "Identity", currentParameters: { ApiId: "api-123" } }]);
  assert.equal(frozen.Resources.Identity.Properties.Parameters.ApiId, "api-123");
  assert.deepEqual(frozen.Resources.Untouched, parent.Resources.Untouched);
  assert.notEqual(frozen, parent);
});

test("rejects missing, duplicate, incomplete and empty parameter evidence", () => {
  const parent = { Resources: { Stack: { Type: "AWS::CloudFormation::Stack", Properties: { Parameters: { ApiId: { Ref: "Api" } } } } } };
  assert.throws(() => freezeTargetedNestedStackParameters(parent, [{ logicalId: "Missing", currentParameters: {} }]));
  assert.throws(() => freezeTargetedNestedStackParameters(parent, [{ logicalId: "Stack", currentParameters: {} }]));
  assert.throws(() => freezeTargetedNestedStackParameters(parent, [{ logicalId: "Stack", currentParameters: { ApiId: "" } }]));
  assert.throws(() => freezeTargetedNestedStackParameters(parent, [
    { logicalId: "Stack", currentParameters: { ApiId: "api" } },
    { logicalId: "Stack", currentParameters: { ApiId: "api" } },
  ]));
});
