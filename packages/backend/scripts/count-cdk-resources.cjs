const fs = require("node:fs");
const path = require("node:path");

const threshold = Number(process.env.CDK_RESOURCE_THRESHOLD ?? "350");
const outputDirectory = path.resolve(
  process.argv[2] ?? path.join(__dirname, "..", "cdk.out"),
);

// Restaurants policy is explicit and cannot be relaxed by the generic env override.
function resourceBudget(file, resources, otherThreshold = threshold) {
  if (/RestaurantsApi.*\.template\.json$/.test(path.basename(file))) {
    return resources >= 400 ? "STOP" : resources >= 375 ? "WARNING" : "NORMAL";
  }
  return resources > otherThreshold ? "STOP" : "NORMAL";
}
module.exports = { resourceBudget };

function templateFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? templateFiles(entryPath)
      : entry.name.endsWith(".template.json")
        ? [entryPath]
        : [];
  });
}

if (require.main !== module) {
  // Importing the policy for focused tests must not inspect generated assemblies.
} else if (!Number.isInteger(threshold) || threshold < 1) {
  console.error("CDK_RESOURCE_THRESHOLD must be a positive integer.");
  process.exitCode = 1;
} else if (!fs.existsSync(outputDirectory)) {
  console.error(`CDK output directory not found: ${outputDirectory}`);
  process.exitCode = 1;
} else {
  const counts = templateFiles(outputDirectory)
    .map((file) => {
      const template = JSON.parse(fs.readFileSync(file, "utf8"));
      return {
        file: path.relative(outputDirectory, file),
        resources: Object.keys(template.Resources ?? {}).length,
      };
    })
    .sort(
      (left, right) =>
        right.resources - left.resources || left.file.localeCompare(right.file),
    );

  for (const count of counts) {
    console.log(`${String(count.resources).padStart(4)}  ${count.file}`);
  }

  for (const count of counts.filter(
    (c) => resourceBudget(c.file, c.resources) === "WARNING",
  )) {
    console.warn(
      `Restaurants resource pressure: ${count.resources} (${count.file}); architecture review required at 375, hard stop at 400.`,
    );
  }
  const oversized = counts.filter(
    (count) => resourceBudget(count.file, count.resources) === "STOP",
  );
  if (oversized.length > 0) {
    console.error(
      `CloudFormation internal resource guard failed: Restaurants must remain below 400; other templates at or below ${threshold}. Stack decomposition/architecture approval is required before adding Restaurants resources at the hard gate.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `All ${counts.length} templates pass internal resource guards (Restaurants <400, review >=375; other templates <=${threshold}).`,
    );
  }
}
