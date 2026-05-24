import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";
import * as path from "path";
import { DomainConstructFactory, DomainProps } from "./domain-constructs-factory";

export class IdentityEndpoints extends DomainConstructFactory {
  constructor(scope: Construct, id: string, props: DomainProps) {
    super(scope, id);

    const projectRoot = path.resolve(__dirname, "..", "..", "..");
    const entry = path.join(
      projectRoot,
      "lambda",
      "domains",
      "identity",
      "get-workspaces.ts",
    );

    this.addRoute({
      api: props.api,
      authorizer: props.authorizer,
      domainName: "identity",
      handlerEntry: entry,
      idPrefix: "Identity-",
      method: apigw.HttpMethod.GET,
      routePath: "/me/workspaces",
      stage: props.stage,
      table: props.table,
    });
  }
}
