import * as cdk from "aws-cdk-lib";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";
import { DeploymentStage } from "../../config/deployment";

interface LiassOhadaAuthProps {
  stage: DeploymentStage;
}

export class LiassOhadaAuth extends Construct {
  public readonly authorizer: HttpUserPoolAuthorizer;
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: LiassOhadaAuthProps) {
    super(scope, id);

    const resourcePrefix = `liass-ohada-${props.stage}`;

    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `${resourcePrefix}-users`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      userVerification: {
        emailSubject: "Verify your Liass-OHADA account",
        emailBody: "Your Liass-OHADA verification code is {####}",
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      removalPolicy:
        props.stage === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    this.userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool: this.userPool,
      userPoolClientName: `${resourcePrefix}-frontend-client`,
      generateSecret: false,
      disableOAuth: true,
      authFlows: {
        userSrp: true,
        userPassword: true,
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.minutes(60),
      idTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(30),
      enableTokenRevocation: true,
    });

    this.authorizer = new HttpUserPoolAuthorizer(
      "LiassOhadaUserPoolAuthorizer",
      this.userPool,
      {
        userPoolClients: [this.userPoolClient],
        identitySource: ["$request.header.Authorization"],
      },
    );
  }
}
