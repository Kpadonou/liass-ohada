import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  fingerprintDirectory,
  fingerprintFiles,
  resolveHeapSize,
  withHeapSize,
} from "./shared-build.mjs";

test("uses the scoped shared-build heap default and accepts an override", () => {
  assert.equal(resolveHeapSize({}), 6144);
  assert.equal(
    resolveHeapSize({ LIASS_SHARED_BUILD_MAX_OLD_SPACE_SIZE: "4096" }),
    4096,
  );
  assert.throws(
    () => resolveHeapSize({ LIASS_SHARED_BUILD_MAX_OLD_SPACE_SIZE: "large" }),
    /must be a positive integer/,
  );
  assert.throws(
    () =>
      resolveHeapSize({
        LIASS_SHARED_BUILD_MAX_OLD_SPACE_SIZE: "9007199254740993",
      }),
    /must be a positive integer/,
  );
});

test("sets one shared-build heap option while preserving other Node options", () => {
  assert.equal(
    withHeapSize("--trace-warnings --max-old-space-size=1024", 6144),
    "--trace-warnings --max-old-space-size=6144",
  );
});

test("input and output fingerprints detect source edits and missing output files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "liass-shared-build-"));
  const source = path.join(directory, "src", "index.ts");
  const output = path.join(directory, "dist", "index.d.ts");

  try {
    await mkdir(path.dirname(source), { recursive: true });
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(source, "export type Value = string;\n");
    await writeFile(output, "export type Value = string;\n");

    const firstInput = await fingerprintFiles(directory, ["src/index.ts"]);
    const firstOutput = await fingerprintDirectory(
      path.join(directory, "dist"),
    );
    await writeFile(source, "export type Value = number;\n");
    assert.notEqual(
      await fingerprintFiles(directory, ["src/index.ts"]),
      firstInput,
    );

    await rm(output);
    assert.notEqual(
      await fingerprintDirectory(path.join(directory, "dist")),
      firstOutput,
    );
    assert.equal(
      await fingerprintDirectory(path.join(directory, "dist")),
      null,
    );
    assert.equal(
      await fingerprintDirectory(path.join(directory, "missing-dist")),
      null,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
