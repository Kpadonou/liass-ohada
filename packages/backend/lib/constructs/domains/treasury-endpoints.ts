import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";
import * as path from "path";
import { DomainConstructFactory, DomainProps } from "./domain-constructs-factory";

export class TreasuryEndpoints extends DomainConstructFactory {
  constructor(scope: Construct, id: string, props: DomainProps) {
    super(scope, id);

    const projectRoot = path.resolve(__dirname, "..", "..", "..");
    const resolveHandlerEntry = (handlerPath: string) =>
      path.join(projectRoot, "lambda", "domains", "treasury", `${handlerPath}.ts`);

    const map = (
      method: apigw.HttpMethod,
      routePath: string,
      handlerPath: string,
      actionName?: string,
    ) => {
      this.addRoute({
        actionName,
        api: props.api,
        authorizer: props.authorizer,
        domainName: "treasury",
        handlerEntry: resolveHandlerEntry(handlerPath),
        idPrefix: "Treasury-",
        lambdaRole: props.lambdaRole,
        method,
        routePath,
        stage: props.stage,
        table: props.table,
      });
    };

    map(apigw.HttpMethod.GET, "/treasury/accounts", "list-accounts");
    map(apigw.HttpMethod.POST, "/treasury/accounts", "create-account");
    map(
      apigw.HttpMethod.GET,
      "/treasury/accounts/{treasuryAccountId}/movements",
      "list-movements",
    );
    map(apigw.HttpMethod.POST, "/treasury/transactions", "post-transaction");
    map(
      apigw.HttpMethod.GET,
      "/treasury/accounts/{treasuryAccountId}/statement-lines",
      "list-statement-lines",
    );
    map(
      apigw.HttpMethod.POST,
      "/treasury/accounts/{treasuryAccountId}/statement-lines/import",
      "import-statement-lines",
    );
    map(apigw.HttpMethod.POST, "/treasury/reconciliations", "reconcile");
    map(apigw.HttpMethod.GET, "/treasury/reconciliations", "list-reconciliations");
    map(
      apigw.HttpMethod.POST,
      "/treasury/reconciliations/{matchId}/cancel",
      "cancel-reconciliation",
    );
    map(apigw.HttpMethod.GET, "/treasury/summary", "get-summary");
  }
}
