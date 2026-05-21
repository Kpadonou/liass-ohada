import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { DataStack } from "./stacks/data-stack";
import { ApiStack } from "./stacks/api-stack";

export interface LiassOhadaBackendStackProps extends cdk.StackProps {
  stage: string;
}

export class LiassOhadaBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LiassOhadaBackendStackProps) {
    super(scope, id, props);

    const resourcePrefix = `liass-ohada-${props.stage}`;

    // Data Stack
    const dataStack = new DataStack(this, "DataStack", {
      tableName: `${resourcePrefix}-accounting-table`,
    });

    // API Stack
    new ApiStack(this, "ApiStack", {
      accountingTable: dataStack.accountingTable.table,
    });
  }
}
