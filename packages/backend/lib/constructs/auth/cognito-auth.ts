import * as cdk from "aws-cdk-lib";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";
import { DeploymentStage } from "../../config/deployment";

interface LiassOhadaAuthProps {
  stage: DeploymentStage;
}

interface OAuthUrlConfig {
  callbackUrls: string[];
  logoutUrls: string[];
}

const LINKEDIN_PROVIDER_NAME = "LinkedIn";
const OAUTH_SCOPES = ["openid", "email", "profile"];

function parseDelimitedConfig(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
    return items.length > 0 ? items : undefined;
  }

  if (typeof value === "string") {
    const items = value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return items.length > 0 ? items : undefined;
  }

  return undefined;
}

function getContextValue(scope: Construct, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = scope.node.tryGetContext(key);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function getConfiguredString(
  scope: Construct,
  parameterId: string,
  description: string,
  contextKeys: string[],
  environmentVariableName: string,
  options?: { noEcho?: boolean },
): string {
  const contextValue = getContextValue(scope, ...contextKeys);
  if (typeof contextValue === "string" && contextValue.trim().length > 0) {
    return contextValue.trim();
  }

  const environmentValue = process.env[environmentVariableName]?.trim();
  if (environmentValue) {
    return environmentValue;
  }

  return new cdk.CfnParameter(scope, parameterId, {
    type: "String",
    noEcho: options?.noEcho,
    description,
  }).valueAsString;
}

function getOAuthUrlConfig(scope: Construct, stage: DeploymentStage): OAuthUrlConfig {
  const defaultDevCallbackUrls = [
    "http://localhost:4200/auth/callback",
  ];
  const defaultDevLogoutUrls = [
    "http://localhost:4200/login",
  ];

  const callbackUrls =
    parseDelimitedConfig(
      getContextValue(
        scope,
        `auth.${stage}.callbackUrls`,
        `${stage}AuthCallbackUrls`,
        "authCallbackUrls",
      ),
    ) ??
    parseDelimitedConfig(process.env[`COGNITO_CALLBACK_URLS_${stage.toUpperCase()}`]) ??
    parseDelimitedConfig(process.env.COGNITO_CALLBACK_URLS) ??
    (stage === "dev" ? defaultDevCallbackUrls : undefined);

  const logoutUrls =
    parseDelimitedConfig(
      getContextValue(
        scope,
        `auth.${stage}.logoutUrls`,
        `${stage}AuthLogoutUrls`,
        "authLogoutUrls",
      ),
    ) ??
    parseDelimitedConfig(process.env[`COGNITO_LOGOUT_URLS_${stage.toUpperCase()}`]) ??
    parseDelimitedConfig(process.env.COGNITO_LOGOUT_URLS) ??
    (stage === "dev" ? defaultDevLogoutUrls : undefined);

  if (!callbackUrls || !logoutUrls) {
    throw new Error(
      [
        `Missing OAuth callback/logout URL configuration for stage "${stage}".`,
        "Provide auth.<stage>.callbackUrls and auth.<stage>.logoutUrls as CDK context arrays,",
        "or set COGNITO_CALLBACK_URLS and COGNITO_LOGOUT_URLS as comma-separated absolute URLs.",
      ].join(" "),
    );
  }

  return { callbackUrls, logoutUrls };
}

export class LiassOhadaAuth extends Construct {
  public readonly authorizer: HttpUserPoolAuthorizer;
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;
  public readonly domainPrefix: string;
  public readonly domainUrl: string;
  public readonly oauthCallbackUrls: string[];
  public readonly oauthLogoutUrls: string[];
  public readonly enabledSocialProviders: string[];

  constructor(scope: Construct, id: string, props: LiassOhadaAuthProps) {
    super(scope, id);

    const resourcePrefix = `liass-ohada-${props.stage}`;
    const oauthUrlConfig = getOAuthUrlConfig(this, props.stage);
    const googleClientId = getConfiguredString(
      this,
      "GoogleClientId",
      "Google OAuth client ID for Cognito federation. May also be supplied as GOOGLE_CLIENT_ID or googleClientId CDK context.",
      ["googleClientId", "GOOGLE_CLIENT_ID"],
      "GOOGLE_CLIENT_ID",
    );
    const googleClientSecret = getConfiguredString(
      this,
      "GoogleClientSecret",
      "Google OAuth client secret for Cognito federation. May also be supplied as GOOGLE_CLIENT_SECRET or googleClientSecret CDK context.",
      ["googleClientSecret", "GOOGLE_CLIENT_SECRET"],
      "GOOGLE_CLIENT_SECRET",
      { noEcho: true },
    );
    const linkedInClientId = getConfiguredString(
      this,
      "LinkedInClientId",
      "LinkedIn OAuth client ID for Cognito OIDC federation. May also be supplied as LINKEDIN_CLIENT_ID or linkedInClientId CDK context.",
      ["linkedInClientId", "LINKEDIN_CLIENT_ID"],
      "LINKEDIN_CLIENT_ID",
    );
    const linkedInClientSecret = getConfiguredString(
      this,
      "LinkedInClientSecret",
      "LinkedIn OAuth client secret for Cognito OIDC federation. May also be supplied as LINKEDIN_CLIENT_SECRET or linkedInClientSecret CDK context.",
      ["linkedInClientSecret", "LINKEDIN_CLIENT_SECRET"],
      "LINKEDIN_CLIENT_SECRET",
      { noEcho: true },
    );

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

    const googleProvider = new cognito.UserPoolIdentityProviderGoogle(
      this,
      "GoogleIdentityProvider",
      {
        userPool: this.userPool,
        clientId: googleClientId,
        clientSecretValue: cdk.SecretValue.unsafePlainText(googleClientSecret),
        scopes: OAUTH_SCOPES,
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
          familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
          profilePicture: cognito.ProviderAttribute.GOOGLE_PICTURE,
        },
      },
    );

    const linkedInProvider = new cognito.UserPoolIdentityProviderOidc(
      this,
      "LinkedInIdentityProvider",
      {
        userPool: this.userPool,
        name: LINKEDIN_PROVIDER_NAME,
        clientId: linkedInClientId,
        clientSecret: linkedInClientSecret,
        issuerUrl: "https://www.linkedin.com",
        scopes: OAUTH_SCOPES,
        endpoints: {
          authorization: "https://www.linkedin.com/oauth/v2/authorization",
          token: "https://www.linkedin.com/oauth/v2/accessToken",
          userInfo: "https://api.linkedin.com/v2/userinfo",
          jwksUri: "https://www.linkedin.com/oauth/openid/jwks",
        },
        // LinkedIn OIDC exposes standard claims in both ID token and userinfo responses.
        attributeMapping: {
          email: cognito.ProviderAttribute.other("email"),
          givenName: cognito.ProviderAttribute.other("given_name"),
          familyName: cognito.ProviderAttribute.other("family_name"),
          profilePicture: cognito.ProviderAttribute.other("picture"),
        },
      },
    );

    this.domainPrefix = `${resourcePrefix}-auth`;
    this.domainUrl = `https://${this.domainPrefix}.auth.${cdk.Stack.of(this).region}.amazoncognito.com`;
    this.oauthCallbackUrls = oauthUrlConfig.callbackUrls;
    this.oauthLogoutUrls = oauthUrlConfig.logoutUrls;
    this.enabledSocialProviders = ["Google", LINKEDIN_PROVIDER_NAME];

    this.userPoolDomain = this.userPool.addDomain("UserPoolDomain", {
      cognitoDomain: {
        domainPrefix: this.domainPrefix,
      },
    });

    this.userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool: this.userPool,
      userPoolClientName: `${resourcePrefix}-frontend-client`,
      generateSecret: false,
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
        cognito.UserPoolClientIdentityProvider.GOOGLE,
        cognito.UserPoolClientIdentityProvider.custom(LINKEDIN_PROVIDER_NAME),
      ],
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: this.oauthCallbackUrls,
        logoutUrls: this.oauthLogoutUrls,
      },
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
    this.userPoolClient.node.addDependency(googleProvider);
    this.userPoolClient.node.addDependency(linkedInProvider);

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
