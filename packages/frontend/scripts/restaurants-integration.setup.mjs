import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
export default async function setup(project) {
  const backend = fileURLToPath(new URL('../../backend/', import.meta.url));
  const child = spawn(
    process.execPath,
    [
      '-r',
      require.resolve('ts-node/register'),
      '-r',
      require.resolve('tsconfig-paths/register'),
      'test/integration/restaurants/http-server.ts',
    ],
    {
      cwd: backend,
      env: {
        ...process.env,
        TABLE_NAME: 'resto-integration-memory',
        AWS_EC2_METADATA_DISABLED: 'true',
        AWS_PROFILE: '',
        TS_NODE_PROJECT: `${backend}/tsconfig.json`,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  let diagnostics = '';
  child.stdout.on('data', (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-4000);
  });
  child.stderr.on('data', (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-4000);
  });
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Local restaurant runtime timed out: ${diagnostics}`));
      }, 30000);
      child.once('message', (message) => {
        clearTimeout(timer);
        resolve(message.url);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Local restaurant runtime exited ${code}: ${diagnostics}`));
      });
    });
    project.provide('restaurantsUrl', url);
  } catch (error) {
    child.kill();
    throw error;
  }
  return async () => {
    if (child.exitCode !== null) return;
    await new Promise((resolve) => {
      child.once('exit', resolve);
      child.kill();
    });
  };
}
