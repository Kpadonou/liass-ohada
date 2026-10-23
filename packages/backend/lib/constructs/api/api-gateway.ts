import { Construct } from "constructs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { DeploymentStage } from "../../config/deployment";

interface LiassOhadaApiGatewayProps {
  defaultAuthorizer: apigwv2.IHttpRouteAuthorizer;
  stage: DeploymentStage;
}

export class LiassOhadaApiGateway extends Construct {
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: LiassOhadaApiGatewayProps) {
    super(scope, id);

    this.httpApi = new apigwv2.HttpApi(this, "LiassOhadaHttpApi", {
      apiName: `liass-ohada-${props.stage}-http-api`,
      defaultAuthorizer: props.defaultAuthorizer,
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.OPTIONS,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.DELETE,
        ],
        exposeHeaders: ["ETag"],
        allowHeaders: [
          "content-type",
          "if-none-match",
          "x-amz-date",
          "authorization",
          "x-api-key",
          "accept-language",
          "x-org-id",
          "x-workspace-org-id",
        ],
      },
    });
  }
}
