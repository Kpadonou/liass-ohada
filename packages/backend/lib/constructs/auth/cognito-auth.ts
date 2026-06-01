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

interface CredentialConfig {
  parameterId: string;
  description: string;
  contextKeys: string[];
  environmentVariableName: string;
  secretName: string;
  secretJsonField: "clientId" | "clientSecret";
  noEcho?: boolean;
}

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

function parseBooleanConfig(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["1", "true", "yes", "y"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no", "n"].includes(normalized)) {
      return false;
    }
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

function shouldUseSecretsManager(scope: Construct, stage: DeploymentStage): boolean {
  return (
    parseBooleanConfig(
      getContextValue(
        scope,
        `auth.${stage}.useSecretsManager`,
        "authUseSecretsManager",
        "useSocialLoginSecretsManager",
      ),
    ) ??
    parseBooleanConfig(process.env[`SOCIAL_LOGIN_USE_SECRETS_MANAGER_${stage.toUpperCase()}`]) ??
    parseBooleanConfig(process.env.SOCIAL_LOGIN_USE_SECRETS_MANAGER) ??
    stage !== "dev"
  );
}

function getSecretName(
  scope: Construct,
  stage: DeploymentStage,
  provider: "google" | "linkedin",
): string {
  const pascalProvider = provider === "google" ? "Google" : "LinkedIn";
  const upperProvider = provider === "google" ? "GOOGLE" : "LINKEDIN";
  const configuredName = getContextValue(
    scope,
    `auth.${stage}.${provider}OAuthSecretName`,
    `${stage}${pascalProvider}OAuthSecretName`,
    `${provider}OAuthSecretName`,
  );

  if (typeof configuredName === "string" && configuredName.trim().length > 0) {
    return configuredName.trim();
  }

  const environmentName =
    process.env[`${upperProvider}_OAUTH_SECRET_NAME_${stage.toUpperCase()}`]?.trim() ??
    process.env[`${upperProvider}_OAUTH_SECRET_NAME`]?.trim();

  return environmentName || `liass-ohada-${stage}-${provider}-oauth`;
}

function resolveCredential(scope: Construct, useSecretsManager: boolean, config: CredentialConfig): string {
  // Resolution order for social login credentials:
  // 1. explicit CDK context, 2. backend/CDK environment variables,
  // 3. AWS Secrets Manager dynamic references, 4. NoEcho CloudFormation parameters.
  const contextValue = getContextValue(scope, ...config.contextKeys);
  if (typeof contextValue === "string" && contextValue.trim().length > 0) {
    return contextValue.trim();
  }

  const environmentValue = process.env[config.environmentVariableName]?.trim();
  if (environmentValue) {
    return environmentValue;
  }

  if (useSecretsManager) {
    return cdk.SecretValue.secretsManager(config.secretName, {
      jsonField: config.secretJsonField,
    }).unsafeUnwrap();
  }

  return new cdk.CfnParameter(scope, config.parameterId, {
    type: "String",
    noEcho: config.noEcho,
    description: config.description,
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
    const useSecretsManager = shouldUseSecretsManager(this, props.stage);
    const googleSecretName = getSecretName(this, props.stage, "google");
    const linkedInSecretName = getSecretName(this, props.stage, "linkedin");
    const googleClientId = resolveCredential(this, useSecretsManager, {
      parameterId: "GoogleClientId",
      description:
        "Google OAuth client ID for Cognito federation. May also be supplied as GOOGLE_CLIENT_ID, googleClientId CDK context, or the clientId field in the stage Google OAuth Secrets Manager secret.",
      contextKeys: ["googleClientId", "GOOGLE_CLIENT_ID"],
      environmentVariableName: "GOOGLE_CLIENT_ID",
      secretName: googleSecretName,
      secretJsonField: "clientId",
    });
    const googleClientSecret = resolveCredential(this, useSecretsManager, {
      parameterId: "GoogleClientSecret",
      description:
        "Google OAuth client secret for Cognito federation. May also be supplied as GOOGLE_CLIENT_SECRET, googleClientSecret CDK context, or the clientSecret field in the stage Google OAuth Secrets Manager secret.",
      contextKeys: ["googleClientSecret", "GOOGLE_CLIENT_SECRET"],
      environmentVariableName: "GOOGLE_CLIENT_SECRET",
      secretName: googleSecretName,
      secretJsonField: "clientSecret",
      noEcho: true,
    });
    const linkedInClientId = resolveCredential(this, useSecretsManager, {
      parameterId: "LinkedInClientId",
      description:
        "LinkedIn OAuth client ID for Cognito OIDC federation. May also be supplied as LINKEDIN_CLIENT_ID, linkedInClientId CDK context, or the clientId field in the stage LinkedIn OAuth Secrets Manager secret.",
      contextKeys: ["linkedInClientId", "LINKEDIN_CLIENT_ID"],
      environmentVariableName: "LINKEDIN_CLIENT_ID",
      secretName: linkedInSecretName,
      secretJsonField: "clientId",
    });
    const linkedInClientSecret = resolveCredential(this, useSecretsManager, {
      parameterId: "LinkedInClientSecret",
      description:
        "LinkedIn OAuth client secret for Cognito OIDC federation. May also be supplied as LINKEDIN_CLIENT_SECRET, linkedInClientSecret CDK context, or the clientSecret field in the stage LinkedIn OAuth Secrets Manager secret.",
      contextKeys: ["linkedInClientSecret", "LINKEDIN_CLIENT_SECRET"],
      environmentVariableName: "LINKEDIN_CLIENT_SECRET",
      secretName: linkedInSecretName,
      secretJsonField: "clientSecret",
      noEcho: true,
    });

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
