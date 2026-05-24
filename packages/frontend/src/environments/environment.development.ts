export const environment = {
  production: false,
  apiBaseUrl: 'https://zxt5p28x8g.execute-api.eu-west-2.amazonaws.com',
  cognito: {
    region: 'eu-west-2',
    userPoolId: 'eu-west-2_REPLACE_WITH_DEV_USER_POOL_ID',
    userPoolClientId: 'REPLACE_WITH_DEV_USER_POOL_CLIENT_ID'
  }
} as const;
