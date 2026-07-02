import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";
import * as path from "path";
import { DomainConstructFactory, DomainProps } from "./domain-constructs-factory";

export class AccountingEndpoints extends DomainConstructFactory {
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
      actionName?: string,
    ) => {
      const entry = resolveHandlerEntry("accounting", handlerPath);
      this.addRoute({
        actionName,
        api: props.api,
        authorizer: props.authorizer,
        domainName: "accounting",
        handlerEntry: entry,
        idPrefix: "Accounting-",
        method,
        routePath,
        stage: props.stage,
        table: props.table,
      });
    };

    // --- Accounting Endpoints ---
    // Accounts
    map(apigw.HttpMethod.POST, "/accounts", "accounts/create-account");
    map(apigw.HttpMethod.GET, "/accounts", "accounts/list-accounts");
    map(apigw.HttpMethod.GET, "/accounts/{accountId}", "accounts/get-account");
    map(apigw.HttpMethod.PUT, "/accounts/{accountId}", "accounts/update-account");
    map(
      apigw.HttpMethod.DELETE,
      "/accounts/{accountId}",
      "accounts/disable-account",
    );
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

    // Third parties
    map(
      apigw.HttpMethod.POST,
      "/third-parties",
      "third-parties/create-third-party",
    );
    map(
      apigw.HttpMethod.GET,
      "/third-parties",
      "third-parties/list-third-parties",
    );
    map(
      apigw.HttpMethod.GET,
      "/third-parties/{thirdPartyId}",
      "third-parties/get-third-party",
    );
    map(
      apigw.HttpMethod.PUT,
      "/third-parties/{thirdPartyId}",
      "third-parties/update-third-party",
      "update-third-party-put",
    );
    map(
      apigw.HttpMethod.PATCH,
      "/third-parties/{thirdPartyId}",
      "third-parties/update-third-party",
    );
    map(
      apigw.HttpMethod.POST,
      "/third-parties/{thirdPartyId}/activate",
      "third-parties/activate-third-party",
    );
    map(
      apigw.HttpMethod.POST,
      "/third-parties/{thirdPartyId}/deactivate",
      "third-parties/deactivate-third-party",
    );

    // Entries
    map(apigw.HttpMethod.POST, "/entries", "entries/post-entry");
    map(apigw.HttpMethod.GET, "/entries", "entries/list-entries");
    map(apigw.HttpMethod.POST, "/entries/drafts", "entries/create-draft");
    map(apigw.HttpMethod.GET, "/entries/{entryId}", "entries/get-entry");
    map(apigw.HttpMethod.PUT, "/entries/{entryId}/draft", "entries/update-draft");
    map(
      apigw.HttpMethod.DELETE,
      "/entries/{entryId}/draft",
      "entries/delete-draft",
    );
    map(apigw.HttpMethod.POST, "/entries/{entryId}/post", "entries/post-draft");

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
      "/books/journal-book",
      "books/get-journal-book",
    );
    map(
      apigw.HttpMethod.GET,
      "/books/third-party-ledger",
      "books/get-third-party-ledger",
    );
    map(
      apigw.HttpMethod.GET,
      "/books/third-party-balance",
      "books/get-third-party-balance",
    );
    map(
      apigw.HttpMethod.GET,
      "/books/matching-report",
      "books/get-matching-report",
    );

    // Reports
    map(
      apigw.HttpMethod.GET,
      "/reports/income-statement",
      "reports/get-income-statement",
    );
    map(
      apigw.HttpMethod.GET,
      "/reports/simplified",
      "reports/get-simplified-report",
    );

    // Fiscal Year
    map(apigw.HttpMethod.POST, "/fiscal-year", "fiscal-year/create-fiscal-year");
    map(apigw.HttpMethod.GET, "/fiscal-year/{year}", "fiscal-year/get-details");
    map(
      apigw.HttpMethod.GET,
      "/fiscal-year/{year}/closing-checks",
      "fiscal-year/get-closing-checks",
    );
    map(
      apigw.HttpMethod.POST,
      "/fiscal-year/{year}/close",
      "fiscal-year/close-fiscal-year",
    );
    map(
      apigw.HttpMethod.POST,
      "/fiscal-year/{year}/periods/{month}/close",
      "fiscal-year/close-period",
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
    map(
      apigw.HttpMethod.GET,
      "/lettering/candidates",
      "lettering/get-candidates",
    );
    map(
      apigw.HttpMethod.POST,
      "/lettering/matches",
      "lettering/create-match",
    );
    map(
      apigw.HttpMethod.GET,
      "/lettering/matches/{letteringId}",
      "lettering/get-match",
    );
    map(
      apigw.HttpMethod.POST,
      "/lettering/matches/{letteringId}/cancel",
      "lettering/cancel-match",
    );
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
    // Canonical Lot 4 livre-journal route. GSI5 is journal-first, so the
    // journal code remains mandatory until a date-first read model is added.
    map(
      apigw.HttpMethod.GET,
      "/journals/{journalCode}/entries",
      "journals/get-journal-entries",
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
