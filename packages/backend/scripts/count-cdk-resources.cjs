const fs = require("node:fs");
const path = require("node:path");

const threshold = Number(process.env.CDK_RESOURCE_THRESHOLD ?? "350");
const outputDirectory = path.resolve(__dirname, "..", "cdk.out");

function templateFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? templateFiles(entryPath)
        : entry.name.endsWith(".template.json")
          ? [entryPath]
          : [];
    });
}

if (!fs.existsSync(outputDirectory)) {
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

  const oversized = counts.filter((count) => count.resources > threshold);
  if (oversized.length > 0) {
    console.error(`CloudFormation resource threshold exceeded (${threshold}).`);
    process.exitCode = 1;
  } else {
    console.log(
      `All ${counts.length} templates are at or below ${threshold} resources.`,
    );
  }
}
