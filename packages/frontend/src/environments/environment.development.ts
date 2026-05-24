export const environment = {
  production: false,
  apiBaseUrl: 'https://zxt5p28x8g.execute-api.eu-west-2.amazonaws.com',
  cognito: {
    region: 'eu-west-2',
    userPoolId: 'eu-west-2_UisYGIavQ',
    userPoolClientId: '6v7hu33a45j24g7bojjipukcs2'
  }
} as const;
