import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = readFileSync(resolve(frontendRoot, 'src/index.html'), 'utf8');
const styles = readFileSync(resolve(frontendRoot, 'src/styles.css'), 'utf8');
const materialTheme = readFileSync(resolve(frontendRoot, 'src/material-theme.scss'), 'utf8');

test('self-hosts both variable fonts and wires Material/Tailwind to the selected family', () => {
  const fontFaces = [...styles.matchAll(/@font-face\s*{([^}]+)}/g)]
    .map(([, fontFace]) => fontFace)
    .filter((fontFace) => /font-family:\s*'(?:Inter|Plus Jakarta Sans)'/.test(fontFace));
  const interFontFaces = fontFaces.filter((fontFace) => /font-family:\s*'Inter'/.test(fontFace));
  const jakartaFontFaces = fontFaces.filter((fontFace) =>
    /font-family:\s*'Plus Jakarta Sans'/.test(fontFace),
  );

  assert.equal(interFontFaces.length, 2);
  assert.equal(jakartaFontFaces.length, 2);
  assert.ok(fontFaces.every((fontFace) => /font-display:\s*swap/.test(fontFace)));
  assert.ok(fontFaces.every((fontFace) => /format\('woff2'\)/.test(fontFace)));
  assert.ok(
    interFontFaces.every(
      (fontFace) =>
        /font-weight:\s*100 900/.test(fontFace) &&
        /url\('\/assets\/fonts\/inter-(?:latin|latin-ext)-variable\.woff2'\)/.test(fontFace),
    ),
  );
  assert.ok(
    jakartaFontFaces.every(
      (fontFace) =>
        /font-weight:\s*200 800/.test(fontFace) &&
        /url\('\/assets\/fonts\/plus-jakarta-sans-(?:latin|latin-ext)-variable\.woff2'\)/.test(
          fontFace,
        ),
    ),
  );
  assert.match(indexHtml, /href="\/assets\/fonts\/inter-latin-variable\.woff2"/);
  assert.match(indexHtml, /fonts\.googleapis\.com\/icon\?family=Material\+Icons/);
  assert.doesNotMatch(indexHtml, /fonts\.googleapis\.com\/css2\?family=Roboto/);
  assert.match(styles, /--font-sans:\s*var\(--liass-font-family\)/);
  assert.match(styles, /--liass-font-family:\s*'Plus Jakarta Sans', Inter/);
  assert.match(materialTheme, /plain-family:\s*\(\s*var\(--liass-font-family\),\s*\)/);
  assert.match(materialTheme, /brand-family:\s*\(\s*var\(--liass-font-family\),\s*\)/);
  assert.match(indexHtml, /liass-ohada\.fontFamily/);

  for (const asset of [
    'inter-latin-variable.woff2',
    'inter-latin-ext-variable.woff2',
    'plus-jakarta-sans-latin-variable.woff2',
    'plus-jakarta-sans-latin-ext-variable.woff2',
    'OFL-Inter.txt',
    'OFL-Plus-Jakarta-Sans.txt',
  ]) {
    assert.ok(existsSync(resolve(frontendRoot, 'src/assets/fonts', asset)), asset);
  }
});
