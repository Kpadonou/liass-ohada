export const environment = {
  production: true,
  apiBaseUrl: 'https://<prod-api-id>.execute-api.eu-west-3.amazonaws.com',
  publicSite: {
    publicBaseUrl: 'https://liassohada.com',
    appBaseUrl: 'https://app.liassohada.com',
    signupUrl: 'https://app.liassohada.com/signup',
    loginUrl: 'https://app.liassohada.com/login',
    contactEmail: null,
    linkedInUrl: null
  },
  cognito: {
    region: 'eu-west-3',
    userPoolId: 'eu-west-3_REPLACE_WITH_PROD_USER_POOL_ID',
    userPoolClientId: 'REPLACE_WITH_PROD_USER_POOL_CLIENT_ID',
    oauth: {
      domain: 'liass-ohada-prod-auth.auth.eu-west-3.amazoncognito.com',
      redirectSignIn: [
        'https://REPLACE_WITH_PROD_FRONTEND_HOST/auth/callback'
      ],
      redirectSignOut: [
        'https://REPLACE_WITH_PROD_FRONTEND_HOST/login'
      ],
      scopes: ['openid', 'email', 'profile'],
      providers: ['Google', { custom: 'LinkedIn' }]
    }
  }
} as const;
