// Dedicated in-memory Angular build configuration; production entry/config/auth stay unchanged.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { logging } = createRequire(require.resolve('@angular-devkit/architect'))(
  '@angular-devkit/core',
);
import { Architect } from '@angular-devkit/architect';
import { WorkspaceNodeModulesArchitectHost } from '@angular-devkit/architect/node/index.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(resolve(root, 'angular.json'), 'utf8'));
const host = new WorkspaceNodeModulesArchitectHost(
  {
    async getBuilderName(project, target) {
      return config.projects[project].architect[target].builder;
    },
    async getMetadata(project) {
      const { architect, ...metadata } = config.projects[project];
      return metadata;
    },
    async hasTarget(project, target) {
      return !!config.projects[project]?.architect[target];
    },
    async getDefaultConfigurationName(project, target) {
      return config.projects[project].architect[target].defaultConfiguration;
    },
    async getOptions(project, target, configuration) {
      const item = config.projects[project].architect[target];
      if (target === 'build' && configuration === 'team-review')
        return {
          ...item.options,
          ...item.configurations.development,
          watch: true,
          browser: 'scripts/team-review/main.ts',
          tsConfig: 'scripts/team-review/tsconfig.json',
        };
      return { ...item.options, ...item.configurations?.[configuration] };
    },
  },
  root,
);
process.chdir(root);
const logger = new logging.Logger('team-review');
logger.subscribe((entry) => console.log(entry.message));
const run = await new Architect(host).scheduleTarget(
  { project: 'frontend', target: 'serve', configuration: 'development' },
  {
    buildTarget: 'frontend:build:team-review',
    port: 4200,
    host: 'localhost',
    open: false,
    watch: true,
    liveReload: true,
    hmr: false,
  },
  { logger },
);
run.output.subscribe((output) => {
  if (output.success) console.log('Local fixtures: http://localhost:4200/restaurants/setup/team');
  else console.error(output);
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await run.stop();
    process.exit(0);
  });
