export const environment = {
  production: true,
  apiBaseUrl: 'https://<prod-api-id>.execute-api.eu-west-2.amazonaws.com',
  cognito: {
    region: 'eu-west-2',
    userPoolId: 'eu-west-2_REPLACE_WITH_PROD_USER_POOL_ID',
    userPoolClientId: 'REPLACE_WITH_PROD_USER_POOL_CLIENT_ID'
  }
} as const;
