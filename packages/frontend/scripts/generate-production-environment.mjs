import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProductionConfig, renderProductionEnvironment } from './production-config.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDirectory, '..');
const repositoryRoot = resolve(frontendRoot, '../..');
const outputsFile = resolve(
  process.env.LIASS_CDK_OUTPUTS_FILE || resolve(repositoryRoot, 'cdk-outputs.prod.json')
);
const destination = resolve(
  frontendRoot,
  'src/environments/environment.production.generated.ts'
);

// Never allow an old generated configuration to survive a failed validation run.
rmSync(destination, { force: true });

let cdkOutputs = {};
if (existsSync(outputsFile)) {
  try {
    cdkOutputs = JSON.parse(readFileSync(outputsFile, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read production CDK outputs from ${outputsFile}: ${error.message}`);
  }
}

try {
  const config = createProductionConfig({ env: process.env, cdkOutputs });
  writeFileSync(destination, renderProductionEnvironment(config), 'utf8');
  console.log('Generated validated production frontend configuration.');
} catch (error) {
  throw new Error(
    [
      error.message,
      `Expected a production CDK outputs file at ${outputsFile}, or explicit LIASS_* build variables.`,
      'Generate the outputs during the production infrastructure workflow with CDK --outputs-file; this script does not deploy.'
    ].join(' ')
  );
}
