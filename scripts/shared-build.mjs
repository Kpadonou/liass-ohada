import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const sharedRoot = path.join(repositoryRoot, "packages", "shared");
const sharedDist = path.join(sharedRoot, "dist");
const cacheFile = path.join(
  repositoryRoot,
  "node_modules",
  ".cache",
  "liass-ohada",
  "shared-build.json",
);
const cacheVersion = 1;
const heapSizeEnvironmentVariable = "LIASS_SHARED_BUILD_MAX_OLD_SPACE_SIZE";

const configNames = [
  "tsup.config.ts",
  "tsup.config.mts",
  "tsup.config.cts",
  "tsup.config.js",
  "tsup.config.mjs",
  "tsup.config.cjs",
];

export function resolveHeapSize(environment = process.env) {
  const configuredSize = environment[heapSizeEnvironmentVariable];
  if (configuredSize === undefined || configuredSize === "") {
    return 6144;
  }

  const parsedSize = Number(configuredSize);
  if (
    !/^\d+$/.test(configuredSize) ||
    !Number.isSafeInteger(parsedSize) ||
    parsedSize < 1
  ) {
    throw new Error(
      `${heapSizeEnvironmentVariable} must be a positive integer in MiB.`,
    );
  }

  return parsedSize;
}

export function withHeapSize(nodeOptions, heapSize) {
  const options = (nodeOptions ?? "")
    .replace(/(?:^|\s)--max-old-space-size(?:=|\s+)\d+(?=\s|$)/g, " ")
    .trim();

  return [options, `--max-old-space-size=${heapSize}`]
    .filter(Boolean)
    .join(" ");
}

export async function fingerprintFiles(root, relativeFiles) {
  const hash = createHash("sha256");

  for (const relativeFile of [...relativeFiles].sort()) {
    const contents = await readFile(path.join(root, relativeFile));
    hash.update(relativeFile);
    hash.update("\0");
    hash.update(contents);
    hash.update("\0");
  }

  return hash.digest("hex");
}

export async function fingerprintDirectory(directory) {
  let files;
  try {
    files = await listFiles(directory);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }

  if (files.length === 0) {
    return null;
  }

  const root = path.dirname(directory);
  const relativeFiles = files.map((file) => path.relative(root, file));
  return fingerprintFiles(root, relativeFiles);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

async function getInputFingerprint() {
  const sourceFiles = await listFiles(path.join(sharedRoot, "src"));
  const buildInputs = [
    ...sourceFiles.map((file) => path.relative(repositoryRoot, file)),
    "packages/shared/package.json",
    "packages/shared/tsconfig.json",
    "package-lock.json",
    "scripts/shared-build.mjs",
  ];

  for (const configName of configNames) {
    const configPath = path.join(sharedRoot, configName);
    if (await fileExists(configPath)) {
      buildInputs.push(path.relative(repositoryRoot, configPath));
    }
  }

  const hash = createHash("sha256");
  hash.update(
    `${process.versions.node}\0${process.platform}\0${process.arch}\0`,
  );
  hash.update(await fingerprintFiles(repositoryRoot, buildInputs));
  return hash.digest("hex");
}

function collectDistPaths(value, paths = new Set()) {
  if (typeof value === "string") {
    const normalized = value.replace(/^\.\//, "");
    if (normalized.startsWith("dist/")) {
      paths.add(normalized);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectDistPaths(item, paths);
    }
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectDistPaths(item, paths);
    }
  }

  return paths;
}

async function verifyDeclaredOutputs() {
  const packageJson = JSON.parse(
    await readFile(path.join(sharedRoot, "package.json"), "utf8"),
  );
  const declaredOutputs = collectDistPaths(packageJson);

  for (const relativePath of declaredOutputs) {
    if (!(await fileExists(path.join(sharedRoot, relativePath)))) {
      throw new Error(
        `Shared build did not produce its declared output: ${relativePath}`,
      );
    }
  }
}

async function readBuildCache() {
  try {
    return JSON.parse(await readFile(cacheFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    if (error instanceof SyntaxError) {
      console.warn(
        "Shared build cache metadata is invalid; rebuilding the shared package.",
      );
      return null;
    }

    throw error;
  }
}

async function isBuildCurrent() {
  const [cache, inputFingerprint, outputFingerprint] = await Promise.all([
    readBuildCache(),
    getInputFingerprint(),
    fingerprintDirectory(sharedDist),
  ]);

  return Boolean(
    cache &&
    cache.version === cacheVersion &&
    cache.inputFingerprint === inputFingerprint &&
    outputFingerprint &&
    cache.outputFingerprint === outputFingerprint,
  );
}

async function writeBuildCache(inputFingerprint, outputFingerprint) {
  const cacheDirectory = path.dirname(cacheFile);
  await mkdir(cacheDirectory, { recursive: true });
  const temporaryFile = `${cacheFile}.${process.pid}.tmp`;
  await writeFile(
    temporaryFile,
    JSON.stringify(
      {
        version: cacheVersion,
        inputFingerprint,
        outputFingerprint,
      },
      null,
      2,
    ),
  );
  await rename(temporaryFile, cacheFile);
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

async function buildSharedPackage(args) {
  if (args.length === 0) {
    throw new Error(
      "The shared build command requires the tsup entry points and options.",
    );
  }

  const heapSize = resolveHeapSize();
  const inputFingerprintBeforeBuild = await getInputFingerprint();
  const packageRequire = createRequire(path.join(sharedRoot, "package.json"));
  const tsupPackagePath = packageRequire.resolve("tsup/package.json");
  const tsupPackage = JSON.parse(await readFile(tsupPackagePath, "utf8"));
  const tsupBinary = path.resolve(
    path.dirname(tsupPackagePath),
    tsupPackage.bin.tsup,
  );
  const childEnvironment = {
    ...process.env,
    NODE_OPTIONS: withHeapSize(process.env.NODE_OPTIONS, heapSize),
  };

  console.log(
    `Building @liass-ohada/shared (DTS worker heap limit: ${heapSize} MiB).`,
  );
  const status = run(process.execPath, [tsupBinary, ...args], {
    cwd: sharedRoot,
    env: childEnvironment,
  });

  if (status !== 0) {
    process.exitCode = status;
    return;
  }

  const inputFingerprintAfterBuild = await getInputFingerprint();
  if (inputFingerprintAfterBuild !== inputFingerprintBeforeBuild) {
    throw new Error(
      "Shared build inputs changed during compilation; run the build again.",
    );
  }

  await verifyDeclaredOutputs();
  const outputFingerprint = await fingerprintDirectory(sharedDist);
  if (!outputFingerprint) {
    throw new Error(
      "Shared build completed without producing any files in packages/shared/dist.",
    );
  }

  await writeBuildCache(inputFingerprintAfterBuild, outputFingerprint);
}

async function ensureSharedPackage() {
  if (await isBuildCurrent()) {
    console.log("@liass-ohada/shared outputs are current; skipping its build.");
    return;
  }

  console.log(
    "@liass-ohada/shared outputs are missing or stale; building the package.",
  );
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : "npm";
  const args = npmExecPath
    ? [npmExecPath, "run", "build", "--workspace", "@liass-ohada/shared"]
    : ["run", "build", "--workspace", "@liass-ohada/shared"];
  const status = run(command, args, { cwd: repositoryRoot });

  if (status !== 0) {
    process.exitCode = status;
    return;
  }

  if (!(await isBuildCurrent())) {
    throw new Error(
      "Shared build finished, but its outputs are still missing or stale.",
    );
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "build") {
    await buildSharedPackage(args);
    return;
  }

  if (command === "ensure" && args.length === 0) {
    await ensureSharedPackage();
    return;
  }

  throw new Error("Usage: shared-build.mjs build <tsup options...> | ensure");
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
