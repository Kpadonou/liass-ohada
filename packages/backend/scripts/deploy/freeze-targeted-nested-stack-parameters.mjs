#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function freezeTargetedNestedStackParameters(parentTemplate, targets) {
  const frozen = structuredClone(parentTemplate);
  const seen = new Set();
  for (const target of targets) {
    const resource = frozen.Resources?.[target.logicalId];
    if (!resource || resource.Type !== "AWS::CloudFormation::Stack")
      throw new Error(`Missing nested stack: ${target.logicalId}`);
    const existing = resource.Properties?.Parameters ?? {};
    const current = target.currentParameters ?? {};
    if (JSON.stringify(Object.keys(existing).sort()) !== JSON.stringify(Object.keys(current).sort()))
      throw new Error(`Nested parameter contract changed: ${target.logicalId}`);
    for (const [name, value] of Object.entries(current)) {
      if (typeof value !== "string" || !value) throw new Error(`Invalid live parameter: ${target.logicalId}.${name}`);
      existing[name] = value;
    }
    resource.Properties.Parameters = existing;
    seen.add(target.logicalId);
  }
  if (seen.size !== targets.length) throw new Error("Duplicate nested-stack target");
  return frozen;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [parentFile, evidenceFile, outputFile] = process.argv.slice(2);
  if (!parentFile || !evidenceFile || !outputFile)
    throw new Error("Usage: freeze-targeted-nested-stack-parameters PARENT_TEMPLATE TARGET_EVIDENCE OUTPUT_TEMPLATE");
  const read = (file) => JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(outputFile, `${JSON.stringify(freezeTargetedNestedStackParameters(read(parentFile), read(evidenceFile)), null, 2)}\n`);
}
