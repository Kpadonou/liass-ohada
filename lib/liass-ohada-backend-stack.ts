import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { DataStack } from "./stacks/data-stack";
import { ApiStack } from "./stacks/api-stack";

export class LiassOhadaBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Data Stack
    const dataStack = new DataStack(this, "DataStack");

    // API Stack
    const apiStack = new ApiStack(this, "ApiStack");
  }
}
