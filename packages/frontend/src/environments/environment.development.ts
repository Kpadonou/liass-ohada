export const environment = {
  production: false,
  apiBaseUrl: 'https://mk5jf2sco3.execute-api.eu-west-3.amazonaws.com',
  cognito: {
    region: 'eu-west-3',
    userPoolId: 'eu-west-3_UIXfYuL4D',
    userPoolClientId: '36qnnjljg4c4qomkiaan1u4cte',
    oauth: {
      domain: 'liass-ohada-dev-auth.auth.eu-west-3.amazoncognito.com',
      redirectSignIn: [
        'http://localhost:4200/auth/callback'
      ],
      redirectSignOut: [
        'http://localhost:4200/login'
      ],
      scopes: ['openid', 'email', 'profile'],
      providers: ['Google']
    }
  }
} as const;
