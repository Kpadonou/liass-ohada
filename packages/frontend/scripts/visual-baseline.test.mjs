import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as sass from 'sass';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
test('compiled Material theme connects controls and overlays to existing Liass tokens', () => {
  const css = sass.compile(new URL('../src/material-theme.scss', import.meta.url).pathname, {
    loadPaths: ['node_modules', '../../node_modules'],
  }).css;
  for (const token of [
    '--mat-sys-primary: var(--color-brand-700)',
    '--mat-sys-primary: var(--color-brand-300)',
    '--mat-button-filled-container-shape: var(--radius-app-control)',
    '--mat-form-field-outlined-container-shape: var(--radius-app-control)',
    '--mat-dialog-container-color: var(--liass-overlay-bg)',
    '--mat-dialog-container-shape: var(--radius-app-panel)',
    '--mat-select-panel-background-color: var(--liass-overlay-bg)',
    '--mat-menu-container-color: var(--liass-overlay-bg)',
    '--mat-autocomplete-background-color: var(--liass-overlay-bg)',
  ])
    assert.ok(css.includes(token), token);
  assert.ok(css.includes('html.dark'));
  assert.ok(!read('src/styles.css').includes('--mdc-'), 'no obsolete MDC variable overrides');
  assert.ok(read('src/styles.css').includes('--color-brand-700: #0b4378'));
});
