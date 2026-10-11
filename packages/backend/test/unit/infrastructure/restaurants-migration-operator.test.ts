import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { RestaurantsMigrationOperator } from "../../../lib/constructs/storage/restaurants-migration-operator";
import { DataStack } from "../../../lib/stacks/data-stack";

const trustedRoleArn = "arn:aws:iam::123456789012:role/release-operator";

test("restricts trust and every migration action to its exact owning table", () => {
  const stack = new Stack(new App(), "Operator", { env: { account: "123456789012", region: "eu-west-3" } });
  const sourceArn = "arn:aws:dynamodb:eu-west-3:123456789012:table/source";
  const destinationArn = "arn:aws:dynamodb:eu-west-3:123456789012:table/destination";
  new RestaurantsMigrationOperator(stack, "Migration", {
    sourceTable: Table.fromTableArn(stack, "Source", sourceArn),
    destinationTable: Table.fromTableArn(stack, "Destination", destinationArn),
    trustedRoleArn,
  });
  const template = Template.fromStack(stack);
  const role = Object.values(template.findResources("AWS::IAM::Role"))[0];
  expect(role.Properties.AssumeRolePolicyDocument.Statement).toEqual([
    { Action: "sts:AssumeRole", Effect: "Allow", Principal: { AWS: trustedRoleArn } },
  ]);
  expect(role.Properties.MaxSessionDuration).toBe(3600);
  expect(role.Properties.ManagedPolicyArns).toBeUndefined();
  const policy = Object.values(template.findResources("AWS::IAM::Policy"))[0];
  expect(policy.Properties.PolicyDocument.Statement).toEqual([
    { Action: "dynamodb:Scan", Effect: "Allow", Resource: sourceArn },
    { Action: ["dynamodb:Scan", "dynamodb:GetItem", "dynamodb:PutItem"], Effect: "Allow", Resource: destinationArn },
    { Action: ["dynamodb:GetItem", "dynamodb:PutItem"], Effect: "Deny", Resource: destinationArn,
      Condition: { "ForAnyValue:StringEquals": { "dynamodb:EnclosingOperation": ["TransactWriteItems", "TransactGetItems"] } } },
  ]);
  template.resourceCountIs("AWS::IAM::Role", 1);
  template.resourceCountIs("AWS::IAM::Policy", 1);
});

test.each(["*", "arn:aws:iam::123456789012:root", "arn:aws:iam::123456789012:role/*", "arn:aws:sts::123456789012:assumed-role/release/session"])(
  "rejects non-specific role trust %s", (arn) => {
    const stack = new Stack(new App(), "Invalid");
    const table = Table.fromTableName(stack, "Table", "table");
    expect(() => new RestaurantsMigrationOperator(stack, "Migration", {
      sourceTable: table, destinationTable: table, trustedRoleArn: arn,
    })).toThrow("explicit IAM role ARN");
  },
);

test("DataStack opts in without moving, replacing or duplicating stateful resources", () => {
  const props = {
    env: { account: "123456789012", region: "eu-west-3" },
    tableName: "liass-ohada-dev-accounting-table",
    restaurantsTableName: "liass-ohada-dev-restaurants-table",
    documentBucketName: "liass-ohada-dev-documents-123456789012-eu-west-3",
  };
  const baseline = Template.fromStack(new DataStack(new App(), "Data", props));
  const enabled = Template.fromStack(new DataStack(new App(), "Data", { ...props, restaurantsMigrationTrustedRoleArn: trustedRoleArn }));
  baseline.resourceCountIs("AWS::IAM::Role", 0);
  enabled.resourceCountIs("AWS::IAM::Role", 1);
  expect(enabled.findResources("AWS::DynamoDB::Table")).toEqual(baseline.findResources("AWS::DynamoDB::Table"));
  expect(enabled.findResources("AWS::S3::Bucket")).toEqual(baseline.findResources("AWS::S3::Bucket"));
  expect(enabled.toJSON().Outputs).toHaveProperty("RestaurantsMigrationOperatorArn");
});

test("cannot grant destination writes when source and destination are the same table", () => {
  const stack = new Stack(new App(), "SameTable");
  const table = Table.fromTableName(stack, "Table", "source");
  expect(() => new RestaurantsMigrationOperator(stack, "Migration", {
    sourceTable: table, destinationTable: table, trustedRoleArn,
  })).toThrow("source and destination must differ");
});
