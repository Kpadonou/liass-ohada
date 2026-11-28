#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RESTAURANTS_SPECIFIC_TAX_ORDER_RELEASE, validateReleaseManifest } from './dev-immutable-lambda-code-release.mjs';

const region = 'eu-west-3';
const account = '570197775998';
const backend = resolve(import.meta.dirname, '../..');
const synth = join(backend, 'cdk.out/specific-tax-order-compat');
const release = join(backend, 'cdk.out/releases/specific-tax-order-compat');
const templateName = readdirSync(synth).find(name => name.includes('RestaurantsApi') && name.endsWith('.nested.template.json'));
assert.ok(templateName, 'Restaurants nested template missing');
const template = JSON.parse(readFileSync(join(synth, templateName), 'utf8'));
const aws = (...args) => JSON.parse(execFileSync('aws', [...args, '--profile', 'rem', '--region', region, '--output', 'json'], { encoding: 'utf8' }));
assert.equal(aws('sts', 'get-caller-identity').Account, account);
mkdirSync(join(release, 'artifacts'), { recursive: true });
const files = dir => readdirSync(dir).sort().flatMap(name => statSync(join(dir, name)).isDirectory()
  ? files(join(dir, name)).map(child => join(name, child)) : [name]);
const artifacts = RESTAURANTS_SPECIFIC_TAX_ORDER_RELEASE.functions.map(target => {
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
  releaseProfile: RESTAURANTS_SPECIFIC_TAX_ORDER_RELEASE.profile,
  target: { account, region, stage: 'dev' },
  commit: RESTAURANTS_SPECIFIC_TAX_ORDER_RELEASE.commit,
  scope: 'code-only create-order and order-items Menu schema compatibility', artifacts };
validateReleaseManifest(manifest, release);
writeFileSync(join(release, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ release, artifacts: artifacts.map(({ functionName, codeSha256, liveCodeSha256 }) =>
  ({ functionName, codeSha256, liveCodeSha256 })) }, null, 2));
