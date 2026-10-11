import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { DeploymentStage } from "./config/deployment";
import { DataStack } from "./stacks/data-stack";
import { ApiStack } from "./stacks/api-stack";

export interface LiassOhadaBackendStackProps extends cdk.StackProps {
  stage: DeploymentStage;
}

export class LiassOhadaBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LiassOhadaBackendStackProps) {
    super(scope, id, props);

    const resourcePrefix = `liass-ohada-${props.stage}`;

    // Data Stack
    const dataStack = new DataStack(this, "DataStack", {
      documentBucketName: `${resourcePrefix}-documents-${cdk.Stack.of(this).account}-${cdk.Stack.of(this).region}`,
      env: props.env,
      tableName: `${resourcePrefix}-accounting-table`,
      restaurantsTableName: `${resourcePrefix}-restaurants-table`,
    });

    // API Stack
    new ApiStack(this, "ApiStack", {
      accountingTable: dataStack.accountingTable.table,
      restaurantsTable: dataStack.restaurantsTable.table,
      documentBucket: dataStack.documentBucket,
      env: props.env,
      stage: props.stage,
    });
  }
}
