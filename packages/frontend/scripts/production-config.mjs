const PLACEHOLDER_PATTERN = /(?:<[^>]+>|replace(?:_with)?|placeholder|change[-_ ]?me|prod[-_ ]?api[-_ ]?id|your[-_ ](?:host|domain|id))/i;
const REQUIRED_PROVIDERS = ['Google', 'LinkedIn'];

function required(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`Missing production frontend configuration: ${label}.`);
  }
  if (PLACEHOLDER_PATTERN.test(normalized)) {
    throw new Error(`Placeholder production frontend configuration is forbidden: ${label}.`);
  }
  return normalized;
}

function optional(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function parseList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return typeof value === 'string'
    ? value.split(',').map((item) => item.trim()).filter(Boolean)
    : [];
}

function httpsUrl(value, label, { rootOnly = false } = {}) {
  const normalized = required(value, label);
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error(`${label} must be a credential-free HTTPS URL without a custom port.`);
  }
  if (rootOnly && (url.pathname !== '/' || url.search || url.hash)) {
    throw new Error(`${label} must be an origin URL without a path, query, or fragment.`);
  }
  return rootOnly ? url.origin : url.toString().replace(/\/$/, '');
}

function routeUrls(value, label, expectedUrl) {
  const urls = parseList(value).map((item, index) =>
    httpsUrl(item, `${label}[${index}]`)
  );
  if (urls.length === 0) {
    throw new Error(`Missing production frontend configuration: ${label}.`);
  }
  if (!urls.includes(expectedUrl)) {
    throw new Error(`${label} must include ${expectedUrl}.`);
  }

  for (const candidate of urls) {
    const parsed = new URL(candidate);
    const expected = new URL(expectedUrl);
    if (
      parsed.origin !== expected.origin ||
      parsed.pathname !== expected.pathname ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error(`${label} may only contain ${expectedUrl} without query parameters or fragments.`);
    }
  }
  return urls;
}

function socialProviders(value) {
  const providers = [...new Set(parseList(value))];
  for (const provider of providers) {
    if (!REQUIRED_PROVIDERS.includes(provider)) {
      throw new Error(`Unsupported production Cognito provider: ${provider}.`);
    }
  }
  for (const provider of REQUIRED_PROVIDERS) {
    if (!providers.includes(provider)) {
      throw new Error(`Production Cognito must enable ${provider} because the signup and login pages expose that action.`);
    }
  }
  return providers.map((provider) => provider === 'Google' ? 'Google' : { custom: provider });
}

export function flattenCdkOutputs(document) {
  const flattened = {};
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('The CDK outputs document must be a JSON object.');
  }

  for (const stackOutputs of Object.values(document)) {
    if (!stackOutputs || typeof stackOutputs !== 'object' || Array.isArray(stackOutputs)) {
      continue;
    }
    for (const [key, value] of Object.entries(stackOutputs)) {
      if (flattened[key] !== undefined && flattened[key] !== value) {
        throw new Error(`Conflicting CDK output values found for ${key}.`);
      }
      flattened[key] = value;
    }
  }
  return flattened;
}

export function createProductionConfig({ env = {}, cdkOutputs = {} } = {}) {
  const output = flattenCdkOutputs(cdkOutputs);
  const read = (environmentKey, outputKey) => env[environmentKey] ?? output[outputKey];

  const publicBaseUrl = httpsUrl(
    env.LIASS_PUBLIC_BASE_URL ?? 'https://liassohada.com',
    'LIASS_PUBLIC_BASE_URL',
    { rootOnly: true }
  );
  const appBaseUrl = httpsUrl(
    env.LIASS_APP_BASE_URL ?? 'https://app.liassohada.com',
    'LIASS_APP_BASE_URL',
    { rootOnly: true }
  );
  if (publicBaseUrl === appBaseUrl) {
    throw new Error('The production public site and application must use distinct origins.');
  }

  const region = required(read('LIASS_COGNITO_REGION', 'CognitoRegion'), 'LIASS_COGNITO_REGION');
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) {
    throw new Error('LIASS_COGNITO_REGION is not a valid AWS region.');
  }

  const userPoolId = required(
    read('LIASS_COGNITO_USER_POOL_ID', 'UserPoolId'),
    'LIASS_COGNITO_USER_POOL_ID'
  );
  if (!userPoolId.startsWith(`${region}_`) || !/^[\w-]+$/.test(userPoolId)) {
    throw new Error('LIASS_COGNITO_USER_POOL_ID must belong to LIASS_COGNITO_REGION.');
  }

  const userPoolClientId = required(
    read('LIASS_COGNITO_USER_POOL_CLIENT_ID', 'UserPoolClientId'),
    'LIASS_COGNITO_USER_POOL_CLIENT_ID'
  );
  if (!/^[a-z0-9]{20,128}$/i.test(userPoolClientId)) {
    throw new Error('LIASS_COGNITO_USER_POOL_CLIENT_ID has an invalid format.');
  }

  const domainValue = read('LIASS_COGNITO_DOMAIN_URL', 'CognitoDomainUrl');
  const domainUrl = httpsUrl(domainValue, 'LIASS_COGNITO_DOMAIN_URL', { rootOnly: true });
  const expectedDomain = `liass-ohada-prod-auth.auth.${region}.amazoncognito.com`;
  if (new URL(domainUrl).hostname !== expectedDomain) {
    throw new Error(`Production Cognito domain must be ${expectedDomain}.`);
  }

  const expectedSignIn = `${appBaseUrl}/auth/callback`;
  const expectedSignOut = `${appBaseUrl}/login`;
  const redirectSignIn = routeUrls(
    env.LIASS_COGNITO_REDIRECT_SIGN_IN ??
      env.COGNITO_CALLBACK_URLS_PROD ??
      env.COGNITO_CALLBACK_URLS ??
      output.OAuthRedirectSignInUrls,
    'LIASS_COGNITO_REDIRECT_SIGN_IN',
    expectedSignIn
  );
  const redirectSignOut = routeUrls(
    env.LIASS_COGNITO_REDIRECT_SIGN_OUT ??
      env.COGNITO_LOGOUT_URLS_PROD ??
      env.COGNITO_LOGOUT_URLS ??
      output.OAuthRedirectSignOutUrls,
    'LIASS_COGNITO_REDIRECT_SIGN_OUT',
    expectedSignOut
  );

  const providers = socialProviders(
    env.LIASS_COGNITO_PROVIDERS ?? output.EnabledSocialProviders
  );
  const contactEmail = optional(env.LIASS_CONTACT_EMAIL);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    throw new Error('LIASS_CONTACT_EMAIL must be a valid email address.');
  }
  const linkedInValue = optional(env.LIASS_LINKEDIN_URL);
  const linkedInUrl = linkedInValue
    ? httpsUrl(linkedInValue, 'LIASS_LINKEDIN_URL')
    : null;

  return {
    production: true,
    apiBaseUrl: httpsUrl(read('LIASS_API_BASE_URL', 'ApiUrl'), 'LIASS_API_BASE_URL'),
    publicSite: {
      publicBaseUrl,
      appBaseUrl,
      contactEmail,
      linkedInUrl
    },
    cognito: {
      region,
      userPoolId,
      userPoolClientId,
      oauth: {
        domain: expectedDomain,
        redirectSignIn,
        redirectSignOut,
        scopes: ['openid', 'email', 'profile'],
        providers
      }
    }
  };
}

export function renderProductionEnvironment(config) {
  return [
    '// Generated by scripts/generate-production-environment.mjs. Do not edit or commit.',
    `export const environment = ${JSON.stringify(config, null, 2)} as const;`,
    ''
  ].join('\n');
}
