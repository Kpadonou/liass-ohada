import { Amplify } from 'aws-amplify';
import 'aws-amplify/auth/enable-oauth-listener';

import { environment } from '../../../environments/environment';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: environment.cognito.userPoolId,
      userPoolClientId: environment.cognito.userPoolClientId,
      loginWith: {
        email: true,
        oauth: {
          domain: environment.cognito.oauth.domain,
          scopes: [...environment.cognito.oauth.scopes],
          redirectSignIn: [...environment.cognito.oauth.redirectSignIn],
          redirectSignOut: [...environment.cognito.oauth.redirectSignOut],
          responseType: 'code',
          providers: [...environment.cognito.oauth.providers]
        }
      }
    }
  }
});
