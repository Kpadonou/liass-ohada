import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Stack, StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { DeploymentStage } from "../config/deployment";

// Import your custom constructs
import { LiassOhadaApiGateway } from "../constructs/api/api-gateway";
import { LiassOhadaAuth } from "../constructs/auth/cognito-auth";

// Import your Domain Constructs
import {
  AccountingApiStack,
  FiscalComplianceApiStack,
  IdentityApiStack,
  ProjectApiStack,
  SalesApiStack,
  RestaurantsApiStack,
  TreasuryApiStack,
} from "./api-domain-stacks";

/**
 * Interface for ApiStack properties.
 * It requires the accounting table from the DataStack to be passed in.
 */
interface ApiStackProps extends StackProps {
  /** The DynamoDB table provided by the DataStack */
  accountingTable: dynamodb.ITable;
  restaurantsTable: dynamodb.ITable;
  documentBucket: s3.IBucket;
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

    const apiLambdaRole = new iam.Role(this, "ApiLambdaExecutionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole",
        ),
      ],
    });
    props.accountingTable.grantReadWriteData(apiLambdaRole);

    // -----------------------------------------------------------
    // 3. Domain Modules Initialization (Dependency Injection)
    // -----------------------------------------------------------

    /**
     * IDENTITY MODULE
     * Handles authenticated user context before tenant selection.
     */
    new IdentityApiStack(this, "IdentityApi", {
      api: this.apiGateway.httpApi,
      lambdaRole: apiLambdaRole,
      table: props.accountingTable,
      stage: props.stage,
    });

    /**
     * ACCOUNTING MODULE
     * Handles General Accounting, Accounts, Entries, and Books.
     */
    new AccountingApiStack(this, "AccountingApi", {
      api: this.apiGateway.httpApi,
      lambdaRole: apiLambdaRole,
      table: props.accountingTable,
      stage: props.stage,
    });

    /**
     * PROJECT MODULE (SYCEBNL)
     * Handles Projects, Donors, and specialized Reporting.
     */
    new ProjectApiStack(this, "ProjectApi", {
      api: this.apiGateway.httpApi,
      lambdaRole: apiLambdaRole,
      table: props.accountingTable,
      stage: props.stage,
    });

    /**
     * TREASURY MODULE
     * Handles treasury accounts, cash movements, bank statements, and reconciliation.
     */
    new TreasuryApiStack(this, "TreasuryApi", {
      api: this.apiGateway.httpApi,
      lambdaRole: apiLambdaRole,
      table: props.accountingTable,
      stage: props.stage,
    });

    /** SALES MODULE — customer management and future SALES capabilities. */
    new SalesApiStack(this, "SalesApi", {
      api: this.apiGateway.httpApi,
      authorizer: this.auth.authorizer,
      lambdaRole: apiLambdaRole,
      documentBucket: props.documentBucket,
      table: props.accountingTable,
      stage: props.stage,
    });

    new FiscalComplianceApiStack(this, "FiscalComplianceApi", {
      api: this.apiGateway.httpApi,
      authorizer: this.auth.authorizer,
      lambdaRole: apiLambdaRole,
      table: props.accountingTable,
      stage: props.stage,
    });

    new RestaurantsApiStack(this, "RestaurantsApi", {
      api: this.apiGateway.httpApi,
      authorizer: this.auth.authorizer,
      restaurantsTable: props.restaurantsTable,
      table: props.accountingTable,
      stage: props.stage,
    });

    // FUTURE: Add more modules here (Payroll, etc.)
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

    new cdk.CfnOutput(this, "CognitoDomainPrefix", {
      value: this.auth.domainPrefix,
      description: "The Cognito hosted UI domain prefix for Liass-OHADA authentication",
    });

    new cdk.CfnOutput(this, "CognitoDomainUrl", {
      value: this.auth.domainUrl,
      description: "The Cognito hosted UI domain URL for Liass-OHADA authentication",
    });

    new cdk.CfnOutput(this, "OAuthRedirectSignInUrls", {
      value: cdk.Fn.join(",", this.auth.oauthCallbackUrls),
      description: "Allowed OAuth redirect sign-in URLs for the frontend",
    });

    new cdk.CfnOutput(this, "OAuthRedirectSignOutUrls", {
      value: cdk.Fn.join(",", this.auth.oauthLogoutUrls),
      description: "Allowed OAuth redirect sign-out URLs for the frontend",
    });

    new cdk.CfnOutput(this, "EnabledSocialProviders", {
      value: cdk.Fn.join(",", this.auth.enabledSocialProviders),
      description: "Enabled Cognito social identity providers for Liass-OHADA",
    });
  }
}
