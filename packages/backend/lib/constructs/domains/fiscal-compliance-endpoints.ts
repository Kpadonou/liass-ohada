import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";
import * as path from "node:path";
import { DomainConstructFactory, DomainProps } from "./domain-constructs-factory";

export class FiscalComplianceEndpoints extends DomainConstructFactory {
  constructor(scope: Construct, id: string, props: DomainProps) {
    super(scope, id);
    const root = path.resolve(__dirname, "..", "..", "..");
    const map = (method: apigw.HttpMethod, routePath: string, handler: string) => this.addRoute({
      api: props.api, authorizer: props.authorizer, domainName: "fiscal-compliance", idPrefix: "FiscalCompliance-",
      handlerEntry: path.join(root, "lambda/domains/fiscal-compliance/handlers", `${handler}.ts`),
      lambdaRole: props.lambdaRole, method, routePath, routeInDomainStack: true, stage: props.stage, table: props.table,
    });
    map(apigw.HttpMethod.GET, "/fiscal-compliance/benin/profile", "get-profile");
    map(apigw.HttpMethod.PUT, "/fiscal-compliance/benin/profile", "put-profile");
    map(apigw.HttpMethod.POST, "/fiscal-compliance/benin/connections", "create-connection");
    map(apigw.HttpMethod.GET, "/fiscal-compliance/benin/connections/{connectionId}", "get-connection");
    map(apigw.HttpMethod.GET, "/fiscal-compliance/benin/connections", "list-connections");
    map(apigw.HttpMethod.PATCH, "/fiscal-compliance/benin/connections/{connectionId}", "update-connection");
    map(apigw.HttpMethod.POST, "/fiscal-compliance/certifications", "prepare-certification");
    map(apigw.HttpMethod.GET, "/fiscal-compliance/certifications/sources/{sourceDocumentType}/{sourceDocumentId}", "get-certification");
    map(apigw.HttpMethod.PATCH, "/fiscal-compliance/certifications/sources/{sourceDocumentType}/{sourceDocumentId}/preparation", "revise-preparation");
    map(apigw.HttpMethod.POST, "/fiscal-compliance/readiness", "evaluate-readiness");
  }
}
