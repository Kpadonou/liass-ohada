import { RestApi, Cors, MethodLoggingLevel } from "aws-cdk-lib/aws-apigateway";
import { Construct } from "constructs";

export class LiassOhadaApiGateway extends Construct {
  public readonly api: RestApi;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.api = new RestApi(this, "LiassOhadaApi", {
      restApiName: "liass-ohada-api",
      description: "API Gateway for Liass Ohada ERP",
      deployOptions: {
        loggingLevel: MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        tracingEnabled: true, // Enable X-Ray
      },
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: [
          "Content-Type",
          "X-Amz-Date",
          "Authorization",
          "X-Api-Key",
          "Accept-Language",
        ],
      },
    });
  }
}
