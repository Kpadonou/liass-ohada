import * as cdk from "aws-cdk-lib";
import { Stack, StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { DeploymentStage } from "../config/deployment";

// Import your custom constructs
import { LiassOhadaApiGateway } from "../constructs/api/api-gateway";
import { LiassOhadaAuth } from "../constructs/auth/cognito-auth";

// Import your Domain Constructs
import { CoreLedgerEndpoints } from "../constructs/domains/core-ledger-endpoints";
import { IdentityEndpoints } from "../constructs/domains/identity-endpoints";
import { ProjectEndpoints } from "../constructs/domains/project-endpoints";

/**
 * Interface for ApiStack properties.
 * It requires the accounting table from the DataStack to be passed in.
 */
interface ApiStackProps extends StackProps {
  /** The DynamoDB table provided by the DataStack */
  accountingTable: dynamodb.ITable;
  stage: DeploymentStage;
}

/**
 * ApiStack handles the infrastructure for the API Gateway and
 * orchestrates the different functional domains (Ledger, Projects, etc.).
 */
export class ApiStack extends Stack {
  public readonly apiGateway: LiassOhadaApiGateway;
  public readonly auth: LiassOhadaAuth;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // 1. Authentication: Cognito user pool and default HTTP API authorizer
    this.auth = new LiassOhadaAuth(this, "LiassOhadaAuth", {
      stage: props.stage,
    });

    // 2. Base Infrastructure: Initialize API Gateway v2 (HTTP API)
    this.apiGateway = new LiassOhadaApiGateway(this, "LiassOhada-ApiGateway", {
      defaultAuthorizer: this.auth.authorizer,
      stage: props.stage,
    });

    // -----------------------------------------------------------
    // 3. Domain Modules Initialization (Dependency Injection)
    // -----------------------------------------------------------

    /**
     * IDENTITY MODULE
     * Handles authenticated user context before tenant selection.
     */
    new IdentityEndpoints(this, "IdentityModule", {
      api: this.apiGateway.httpApi,
      table: props.accountingTable,
      stage: props.stage,
    });

    /**
     * CORE LEDGER MODULE
     * Handles General Accounting, Accounts, Entries, and Books.
     */
    new CoreLedgerEndpoints(this, "CoreLedgerModule", {
      api: this.apiGateway.httpApi,
      table: props.accountingTable,
      stage: props.stage,
    });

    /**
     * PROJECT MODULE (SYCEBNL)
     * Handles Projects, Donors, and specialized Reporting.
     */
    new ProjectEndpoints(this, "ProjectModule", {
      api: this.apiGateway.httpApi,
      table: props.accountingTable,
      stage: props.stage,
    });

    // FUTURE: Add more modules here (Payroll, Commercial, etc.)
    // new PayrollEndpoints(this, "PayrollModule", { ... });

    // Output the API URL for easy access
    new cdk.CfnOutput(this, "ApiUrl", {
      value: this.apiGateway.httpApi.apiEndpoint,
      description: "The URL of the Liass-OHADA API Gateway",
    });

    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.auth.userPool.userPoolId,
      description: "The Cognito User Pool ID for Liass-OHADA users",
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: this.auth.userPoolClient.userPoolClientId,
      description: "The Cognito User Pool Client ID for the Liass-OHADA frontend",
    });

    new cdk.CfnOutput(this, "CognitoRegion", {
      value: cdk.Stack.of(this).region,
      description: "The AWS region for the Liass-OHADA Cognito User Pool",
    });
  }
}
