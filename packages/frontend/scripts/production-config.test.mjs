import assert from 'node:assert/strict';
import test from 'node:test';

import { createProductionConfig } from './production-config.mjs';

const validOutputs = {
  LiassOhadaBackendStackApiStack: {
    ApiUrl: 'https://a1b2c3d4.execute-api.eu-west-3.amazonaws.com',
    CognitoRegion: 'eu-west-3',
    UserPoolId: 'eu-west-3_AbCdEf123',
    UserPoolClientId: '0123456789abcdefghijklmnop',
    CognitoDomainUrl: 'https://liass-ohada-prod-auth.auth.eu-west-3.amazoncognito.com',
    OAuthRedirectSignInUrls: 'https://app.liassohada.com/auth/callback',
    OAuthRedirectSignOutUrls: 'https://app.liassohada.com/login',
    EnabledSocialProviders: 'Google,LinkedIn'
  }
};

test('builds production auth and landing CTA configuration from CDK outputs', () => {
  const config = createProductionConfig({ cdkOutputs: validOutputs });

  assert.equal(config.production, true);
  assert.equal(config.publicSite.appBaseUrl, 'https://app.liassohada.com');
  assert.deepEqual(config.cognito.oauth.redirectSignIn, [
    'https://app.liassohada.com/auth/callback'
  ]);
  assert.deepEqual(config.cognito.oauth.redirectSignOut, [
    'https://app.liassohada.com/login'
  ]);
  assert.deepEqual(config.cognito.oauth.providers, [
    'Google',
    { custom: 'LinkedIn' }
  ]);
});

test('rejects every placeholder-bearing production auth field', () => {
  const cases = [
    ['ApiUrl', 'https://<prod-api-id>.execute-api.eu-west-3.amazonaws.com'],
    ['UserPoolId', 'eu-west-3_REPLACE_WITH_PROD_USER_POOL_ID'],
    ['UserPoolClientId', 'REPLACE_WITH_PROD_USER_POOL_CLIENT_ID'],
    ['CognitoDomainUrl', 'https://REPLACE_WITH_PROD_DOMAIN'],
    ['OAuthRedirectSignInUrls', 'https://REPLACE_WITH_PROD_FRONTEND_HOST/auth/callback'],
    ['OAuthRedirectSignOutUrls', 'https://REPLACE_WITH_PROD_FRONTEND_HOST/login']
  ];

  for (const [key, placeholder] of cases) {
    const outputs = structuredClone(validOutputs);
    outputs.LiassOhadaBackendStackApiStack[key] = placeholder;
    assert.throws(
      () => createProductionConfig({ cdkOutputs: outputs }),
      /placeholder|must be|forbidden/i,
      key
    );
  }
});

test('rejects development Cognito outputs in a production build', () => {
  const outputs = structuredClone(validOutputs);
  Object.assign(outputs.LiassOhadaBackendStackApiStack, {
    CognitoDomainUrl: 'https://liass-ohada-dev-auth.auth.eu-west-3.amazoncognito.com',
    OAuthRedirectSignInUrls: 'http://localhost:4200/auth/callback',
    OAuthRedirectSignOutUrls: 'http://localhost:4200/login'
  });

  assert.throws(
    () => createProductionConfig({ cdkOutputs: outputs }),
    /Production Cognito domain|HTTPS URL/
  );
});

test('rejects callback and logout URLs that do not return to the application host', () => {
  const outputs = structuredClone(validOutputs);
  outputs.LiassOhadaBackendStackApiStack.OAuthRedirectSignInUrls =
    'https://liassohada.com/auth/callback';

  assert.throws(
    () => createProductionConfig({ cdkOutputs: outputs }),
    /must include https:\/\/app\.liassohada\.com\/auth\/callback/
  );

  outputs.LiassOhadaBackendStackApiStack.OAuthRedirectSignInUrls =
    'https://app.liassohada.com/auth/callback,https://attacker.example/auth/callback';
  assert.throws(
    () => createProductionConfig({ cdkOutputs: outputs }),
    /may only contain https:\/\/app\.liassohada\.com\/auth\/callback/
  );
});

test('rejects a configured provider that the auth pages cannot safely offer', () => {
  const outputs = structuredClone(validOutputs);
  outputs.LiassOhadaBackendStackApiStack.EnabledSocialProviders = 'Google';

  assert.throws(
    () => createProductionConfig({ cdkOutputs: outputs }),
    /must enable LinkedIn/
  );
});
