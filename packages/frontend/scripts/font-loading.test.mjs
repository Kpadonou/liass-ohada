import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = readFileSync(resolve(frontendRoot, 'src/index.html'), 'utf8');
const styles = readFileSync(resolve(frontendRoot, 'src/styles.css'), 'utf8');

test('self-hosts variable Inter weights and preserves Material Icons', () => {
  const fontFaces = [...styles.matchAll(/@font-face\s*{([^}]+)}/g)]
    .map(([, fontFace]) => fontFace)
    .filter((fontFace) => /font-family:\s*'Inter'/.test(fontFace));

  assert.equal(fontFaces.length, 2);
  assert.ok(
    fontFaces.every(
      (fontFace) =>
        /font-weight:\s*100 900/.test(fontFace) &&
        /font-display:\s*swap/.test(fontFace) &&
        /url\('\/assets\/fonts\/inter-(?:latin|latin-ext)-variable\.woff2'\)/.test(fontFace) &&
        /format\('woff2'\)/.test(fontFace),
    ),
  );
  assert.match(indexHtml, /href="\/assets\/fonts\/inter-latin-variable\.woff2"/);
  assert.match(indexHtml, /fonts\.googleapis\.com\/icon\?family=Material\+Icons/);
  assert.doesNotMatch(indexHtml, /fonts\.googleapis\.com\/css2\?family=Roboto/);
  assert.ok(
    existsSync(resolve(frontendRoot, 'src/assets/fonts/inter-latin-variable.woff2')),
  );
  assert.ok(
    existsSync(resolve(frontendRoot, 'src/assets/fonts/inter-latin-ext-variable.woff2')),
  );
});
