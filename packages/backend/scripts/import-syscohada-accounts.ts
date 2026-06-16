import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SyscohadaAccountImportService } from "../lambda/shared/services/syscohada-account-import-service";

interface CliArgs {
  orgId: string;
  referencePath: string;
}

const DEFAULT_REFERENCE_PATH =
  "../../../.agents/skills/ohada-legal-reference/references/syscohada-plan-comptable.md";

function readArgs(argv: string[]): CliArgs {
  const args = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (key?.startsWith("--") && value && !value.startsWith("--")) {
      args.set(key.slice(2), value);
      index += 1;
    }
  }

  const orgId = args.get("org-id") ?? process.env.ORG_ID;

  if (!orgId) {
    throw new Error(
      "Missing organization id. Pass --org-id <orgId> or set ORG_ID.",
    );
  }

  return {
    orgId,
    referencePath: args.get("reference") ?? DEFAULT_REFERENCE_PATH,
  };
}

async function main(): Promise<void> {
  const { orgId, referencePath } = readArgs(process.argv.slice(2));
  const absoluteReferencePath = resolve(__dirname, referencePath);
  const markdown = readFileSync(absoluteReferencePath, "utf8");
  const accounts = SyscohadaAccountImportService.parseReference(markdown);
  const result = await SyscohadaAccountImportService.importAccounts(orgId, accounts);

  console.log(
    JSON.stringify(
      {
        orgId,
        referencePath: absoluteReferencePath,
        ...result,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
