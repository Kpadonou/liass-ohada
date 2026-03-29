import * as cdk from "aws-cdk-lib";
import { Stack, StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

// Import your custom constructs
import { LiassOhadaApiGateway } from "../constructs/api/api-gateway";
// import { LiassOhadaAuth } from "../constructs/auth/cognito-auth"; // Uncomment when ready

// Import your Domain Constructs
import { CoreLedgerEndpoints } from "../constructs/domains/core-ledger-endpoints";
import { ProjectEndpoints } from "../constructs/domains/project-endpoints";

/**
 * Interface for ApiStack properties.
 * It requires the accounting table from the DataStack to be passed in.
 */
interface ApiStackProps extends StackProps {
  /** The DynamoDB table provided by the DataStack */
  accountingTable: dynamodb.ITable;
}

/**
 * ApiStack handles the infrastructure for the API Gateway and
 * orchestrates the different functional domains (Ledger, Projects, etc.).
 */
export class ApiStack extends Stack {
  public readonly apiGateway: LiassOhadaApiGateway;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // 1. Base Infrastructure: Initialize API Gateway v2 (HTTP API)
    this.apiGateway = new LiassOhadaApiGateway(this, "LiassOhada-ApiGateway");

    // 2. Authentication: Initialize Cognito/Authorizer (Optional for now)
    // const auth = new LiassOhadaAuth(this, "LiassOhadaAuth");
    const authorizer = undefined; // Set to auth.authorizer once Cognito is ready

    // -----------------------------------------------------------
    // 3. Domain Modules Initialization (Dependency Injection)
    // -----------------------------------------------------------

    /**
     * CORE LEDGER MODULE
     * Handles General Accounting, Accounts, Entries, and Books.
     */
    new CoreLedgerEndpoints(this, "CoreLedgerModule", {
      api: this.apiGateway.httpApi,
      table: props.accountingTable,
      authorizer: authorizer,
    });

    /**
     * PROJECT MODULE (SYCEBNL)
     * Handles Projects, Donors, and specialized Reporting.
     */
    new ProjectEndpoints(this, "ProjectModule", {
      api: this.apiGateway.httpApi,
      table: props.accountingTable,
      authorizer: authorizer,
    });

    // FUTURE: Add more modules here (Payroll, Commercial, etc.)
    // new PayrollEndpoints(this, "PayrollModule", { ... });

    // Output the API URL for easy access
    new cdk.CfnOutput(this, "ApiUrl", {
      value: this.apiGateway.httpApi.apiEndpoint,
      description: "The URL of the Liass-OHADA API Gateway",
    });
  }
}
