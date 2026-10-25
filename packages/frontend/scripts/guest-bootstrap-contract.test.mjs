import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const read = (p) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8');
test('direct Guest startup remains independent of staff initialization', () => {
  const guest = read('app/guest.bootstrap.ts'),
    main = read('main.ts'),
    staff = read('app/staff.bootstrap.ts'),
    cartStore = read('app/domains/restaurants/data-access/restaurant-guest-cart.store.ts'),
    cartComponent = read('app/domains/restaurants/feature/restaurant-guest-cart.component.ts');
  assert.match(main, /import\('\.\/app\/guest.bootstrap'\)/);
  assert.match(main, /import\('\.\/app\/staff.bootstrap'\)/);
  assert.doesNotMatch(
    guest,
    /Amplify|AuthStore|BrowserSessionContext|appConfig|app-shell|accounting|sales/,
  );
  assert.match(guest, /guestInterceptor/);
  assert.match(guest, /guestRoutes/);
  assert.match(guest, /provideTanStackQuery/);
  assert.match(guest, /createI18nProviders\(resolveInitialLanguage\(\)\)/);
  assert.match(staff, /import '\.\/core\/auth\/amplify.config'/);
  assert.match(staff, /bootstrapApplication\(App,\s*appConfig\)/);
  assert.doesNotMatch(
    read('app/core/http/guest.interceptor.ts'),
    /AuthStore|fetchAuthSession|aws-amplify/,
  );
  for (const source of [
    cartStore,
    cartComponent,
    read('app/domains/restaurants/feature/restaurant-guest-waiter-call.component.ts'),
    read('app/domains/restaurants/feature/restaurant-guest-carte.component.ts'),
    read('app/domains/restaurants/feature/restaurant-guest-submission.component.ts'),
    read('app/domains/restaurants/feature/restaurant-guest.page.ts'),
    read('app/domains/restaurants/ui/guest-icon.component.ts'),
  ]) {
    assert.doesNotMatch(
      source,
      /Amplify|Cognito|AuthStore|BrowserSessionContext|workspace|accounting|sales|HttpClient/,
    );
  }
  assert.match(cartStore, /sessionStorage/);
  assert.doesNotMatch(cartStore, /localStorage|indexedDB|document\.cookie/);
});
