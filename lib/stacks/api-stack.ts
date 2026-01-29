import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { LiassOhadaApiGateway } from "../constructs/api/api-gateway";

export class ApiStack extends Stack {
  public readonly api: LiassOhadaApiGateway;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.api = new LiassOhadaApiGateway(this, "ApiGateway");
  }
}
