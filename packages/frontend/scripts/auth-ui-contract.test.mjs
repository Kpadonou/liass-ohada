import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(frontendRoot, path), 'utf8');

function translationKeys(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === 'object' && !Array.isArray(child)
      ? translationKeys(child, path)
      : [path];
  });
}

test('the shared auth shell uses the white logo on a navy surface without a split panel', () => {
  const template = read('src/app/domains/identity/ui/auth-layout/auth-layout.component.html');

  assert.match(template, /class="liass-auth-brand-surface"/);
  assert.match(template, /theme="light"/);
  assert.match(template, /variant="horizontal"/);
  assert.doesNotMatch(template, /liass-auth-marketing-panel|APPROVED_MESSAGE/);
});

test('auth motion has an explicit reduced-motion override', () => {
  const styles = read('src/styles.css');
  const reducedMotion = styles.slice(styles.indexOf('@media (prefers-reduced-motion: reduce)'));

  assert.match(reducedMotion, /\.liass-auth-brand-surface/);
  assert.match(reducedMotion, /\.liass-auth-card/);
  assert.match(reducedMotion, /\.liass-auth-section/);
  assert.match(reducedMotion, /animation:\s*none/);
  assert.match(reducedMotion, /transition:\s*none/);
});

test('auth templates contain no waitlist or manual-approval flow', () => {
  const templates = [
    read('src/app/domains/identity/feature/login/login.page.html'),
    read('src/app/domains/identity/feature/signup/signup.page.html'),
    read('src/app/domains/identity/ui/auth-layout/auth-layout.component.html')
  ].join('\n');

  assert.doesNotMatch(templates, /waitlist|manual approval|approbation|liste d’attente/i);
});

test('French and English translation keys remain in parity', () => {
  const french = JSON.parse(read('public/assets/i18n/fr.json'));
  const english = JSON.parse(read('public/assets/i18n/en.json'));

  assert.deepEqual(
    translationKeys(french).sort(),
    translationKeys(english).sort()
  );
});
