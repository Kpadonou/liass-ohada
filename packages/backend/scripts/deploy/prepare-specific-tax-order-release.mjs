#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RESTAURANTS_SPECIFIC_TAX_ORDER_RELEASE, RESTAURANTS_SPECIFIC_TAX_DRAFT_RELEASE, RESTAURANTS_SPECIFIC_TAX_CLOSE_RELEASE, validateReleaseManifest } from './dev-immutable-lambda-code-release.mjs';

const draft = process.argv.includes('--draft-items');
const close = process.argv.includes('--close-order');
assert.ok(!(draft && close), 'Choose one release profile');
const profile = close ? RESTAURANTS_SPECIFIC_TAX_CLOSE_RELEASE : draft ? RESTAURANTS_SPECIFIC_TAX_DRAFT_RELEASE : RESTAURANTS_SPECIFIC_TAX_ORDER_RELEASE;

const region = 'eu-west-3';
const account = '570197775998';
const backend = resolve(import.meta.dirname, '../..');
const synth = join(backend, 'cdk.out/specific-tax-order-compat');
const release = join(backend, close ? 'cdk.out/releases/specific-tax-close-compat' : draft ? 'cdk.out/releases/specific-tax-draft-compat' : 'cdk.out/releases/specific-tax-order-compat');
const templateName = readdirSync(synth).find(name => name.includes('RestaurantsApi') && name.endsWith('.nested.template.json'));
assert.ok(templateName, 'Restaurants nested template missing');
const template = JSON.parse(readFileSync(join(synth, templateName), 'utf8'));
const aws = (...args) => JSON.parse(execFileSync('aws', [...args, '--profile', 'rem', '--region', region, '--output', 'json'], { encoding: 'utf8' }));
assert.equal(aws('sts', 'get-caller-identity').Account, account);
mkdirSync(join(release, 'artifacts'), { recursive: true });
const files = dir => readdirSync(dir).sort().flatMap(name => statSync(join(dir, name)).isDirectory()
  ? files(join(dir, name)).map(child => join(name, child)) : [name]);
const artifacts = profile.functions.map(target => {
  const [logicalId, resource] = Object.entries(template.Resources).find(([, value]) =>
    value.Type === 'AWS::Lambda::Function' && value.Properties.FunctionName === target.functionName) ?? [];
  assert.equal(logicalId, target.logicalId);
  const asset = join(synth, resource.Metadata['aws:asset:path']);
  const artifact = `artifacts/${target.functionName}.zip`;
  execFileSync('zip', ['-X', '-q', join(release, artifact), ...files(asset)], { cwd: asset });
  const bytes = readFileSync(join(release, artifact));
  const live = aws('lambda', 'get-function-configuration', '--function-name', target.functionName);
  return { ...target, artifact, sha256Hex: createHash('sha256').update(bytes).digest('hex'),
    codeSha256: createHash('sha256').update(bytes).digest('base64'), liveCodeSha256: live.CodeSha256 };
});
const manifest = { mode: 'PREPARE_ONLY', deploymentExecuted: false,
  releaseProfile: profile.profile,
  target: { account, region, stage: 'dev' },
  commit: profile.commit,
  scope: close ? 'code-only close-order fiscal policy v2 schema compatibility' : draft ? 'code-only add/edit draft item Menu schema compatibility' : 'code-only create-order and order-items Menu schema compatibility', artifacts };
validateReleaseManifest(manifest, release);
writeFileSync(join(release, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ release, artifacts: artifacts.map(({ functionName, codeSha256, liveCodeSha256 }) =>
  ({ functionName, codeSha256, liveCodeSha256 })) }, null, 2));
