#!/usr/bin/env node
import { App, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as api from 'aws-cdk-lib/aws-apigatewayv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'node:path';

/** Additive Platform API extension. Existing API/authorizer/role remain externally owned. */
export class FiscalPolicyApiStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    const httpApi = api.HttpApi.fromHttpApiAttributes(this, 'ExistingApi', { httpApiId: 'mk5jf2sco3' });
    const role = iam.Role.fromRoleArn(this, 'ExistingEnrollmentRole',
      'arn:aws:iam::570197775998:role/LiassOhadaBackendStackApi-IdentityModulePlatformFis-8huOpiQl7Rif', { mutable: false });
    for (const [method, action] of [['GET', 'read'], ['PUT', 'save']] as const) {
      const fn = new NodejsFunction(this, `${action}Policy`, {
        functionName: `liass-ohada-dev-identity-${action}-fiscal-issuance-policy`,
        entry: path.join(__dirname, '../lambda/domains/identity/organization-fiscal-handler.ts'),
        runtime: lambda.Runtime.NODEJS_24_X, role, bundling: { bundleAwsSDK: true },
        environment: { STAGE: 'dev', TABLE_NAME: 'liass-ohada-dev-accounting-table',
          PLATFORM_COGNITO_ISSUER: 'https://cognito-idp.eu-west-3.amazonaws.com/eu-west-3_UIXfYuL4D' },
      });
      const integration = new api.CfnIntegration(this, `${action}Integration`, {
        apiId: httpApi.apiId, integrationType: 'AWS_PROXY', integrationUri: fn.functionArn, payloadFormatVersion: '2.0',
      });
      new api.CfnRoute(this, `${action}Route`, { apiId: httpApi.apiId,
        routeKey: `${method} /me/organization/fiscality/issuance-policy`, authorizationType: 'JWT',
        authorizerId: 'm8yqfd', target: `integrations/${integration.ref}` });
      new lambda.CfnPermission(this, `${action}Invoke`, { action: 'lambda:InvokeFunction',
        functionName: fn.functionArn, principal: 'apigateway.amazonaws.com',
        sourceArn: `arn:aws:execute-api:eu-west-3:570197775998:${httpApi.apiId}/*/${method}/me/organization/fiscality/issuance-policy` });
    }
  }
}
const app = new App();
new FiscalPolicyApiStack(app, 'LiassOhadaDevFiscalPolicyApi', { env: { account: '570197775998', region: 'eu-west-3' } });
