import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";
import * as path from "path";
import { DomainConstructFactory, DomainProps } from "./domain-constructs-factory";

export class CoreLedgerEndpoints extends DomainConstructFactory {
  constructor(scope: Construct, id: string, props: DomainProps) {
    super(scope, id);

    // Resolve project root from current directory
    const projectRoot = path.resolve(__dirname, "..", "..", "..");

    // helper: resolve path to handler using absolute path from project root
    const resolveHandlerEntry = (domain: string, fullHandlerPath: string) => {
      return path.join(
        projectRoot,
        "lambda",
        "domains",
        domain,
        `${fullHandlerPath}.ts`,
      );
    };

    const map = (
      method: apigw.HttpMethod,
      routePath: string,
      handlerPath: string,
    ) => {
      const entry = resolveHandlerEntry("core-ledger", handlerPath);
      this.addRoute({
        api: props.api,
        authorizer: props.authorizer,
        domainName: "ledger",
        handlerEntry: entry,
        idPrefix: "CoreLedger-",
        method,
        routePath,
        stage: props.stage,
        table: props.table,
      });
    };

    // --- Core Ledger Endpoints ---
    // Accounts
    map(apigw.HttpMethod.POST, "/accounts", "accounts/create-account");
    map(apigw.HttpMethod.GET, "/accounts/{accountId}", "accounts/get-account");
    map(
      apigw.HttpMethod.GET,
      "/accounts/{accountId}/balance",
      "accounts/get-balance",
    );
    map(
      apigw.HttpMethod.GET,
      "/accounts/{accountId}/entries",
      "accounts/get-entries",
    );

    // Entries
    map(apigw.HttpMethod.POST, "/entries", "entries/post-entry");

    // Books
    map(
      apigw.HttpMethod.GET,
      "/books/general-ledger",
      "books/get-general-ledger",
    );
    map(
      apigw.HttpMethod.GET,
      "/books/trial-balance",
      "books/get-trial-balance",
    );
    map(
      apigw.HttpMethod.GET,
      "/books/third-party-ledger",
      "books/get-third-party-ledger",
    );
    map(
      apigw.HttpMethod.GET,
      "/books/matching-report",
      "books/get-matching-report",
    );

    // Fiscal Year
    map(apigw.HttpMethod.GET, "/fiscal-year/{year}", "fiscal-year/get-details");
    map(
      apigw.HttpMethod.POST,
      "/fiscal-year/{year}/close",
      "fiscal-year/close-fiscal-year",
    );
    map(
      apigw.HttpMethod.POST,
      "/fiscal-year/{year}/lock",
      "fiscal-year/lock-period",
    );
    map(
      apigw.HttpMethod.POST,
      "/fiscal-year/{year}/unlock",
      "fiscal-year/unlock-period",
    );

    // Lettering
    map(apigw.HttpMethod.POST, "/lettering", "lettering/post-lettering");
    map(
      apigw.HttpMethod.POST,
      "/lettering/cancel",
      "lettering/cancel-lettering",
    );
    map(
      apigw.HttpMethod.GET,
      "/lettering/unlettered",
      "lettering/get-unlettered-lines",
    );

    // Journals
    map(apigw.HttpMethod.POST, "/journals", "journals/create-journal");
    map(apigw.HttpMethod.GET, "/journals", "journals/list-journals");
    map(
      apigw.HttpMethod.GET,
      "/journals/{journalCode}",
      "journals/get-journal",
    );
    map(
      apigw.HttpMethod.PUT,
      "/journals/{journalCode}",
      "journals/update-journal",
    );
    map(
      apigw.HttpMethod.DELETE,
      "/journals/{journalCode}",
      "journals/delete-journal",
    );
  }
}
