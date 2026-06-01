export const environment = {
  production: false,
  apiBaseUrl: 'https://zxt5p28x8g.execute-api.eu-west-2.amazonaws.com',
  cognito: {
    region: 'eu-west-2',
    userPoolId: 'eu-west-2_UisYGIavQ',
    userPoolClientId: '6v7hu33a45j24g7bojjipukcs2',
    oauth: {
      domain: 'liass-ohada-dev-auth.auth.eu-west-2.amazoncognito.com',
      redirectSignIn: [
        'http://localhost:4200/auth/callback'
      ],
      redirectSignOut: [
        'http://localhost:4200/login'
      ],
      scopes: ['openid', 'email', 'profile'],
      providers: ['Google', { custom: 'LinkedIn' }]
    }
  }
} as const;
