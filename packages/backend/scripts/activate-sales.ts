import {
  SalesActivationResult,
  SalesActivationService,
} from "../lambda/domains/sales/activation/sales-activation-service";

export interface ActivateSalesOptions {
  apply: boolean;
  defaultCurrency: string;
  orgId: string;
}

export const parseActivateSalesArgs = (
  args: string[],
): ActivateSalesOptions => {
  let apply = false;
  let defaultCurrency: string | undefined;
  let orgId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (argument === "--org-id" || argument === "--default-currency") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      if (argument === "--org-id") {
        if (orgId !== undefined) {
          throw new Error("--org-id may be provided only once.");
        }
        orgId = value.trim();
      } else {
        if (defaultCurrency !== undefined) {
          throw new Error("--default-currency may be provided only once.");
        }
        defaultCurrency = value.trim();
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!orgId) {
    throw new Error("--org-id is required.");
  }
  if (!defaultCurrency) {
    throw new Error("--default-currency is required.");
  }

  return { apply, defaultCurrency, orgId };
};

const reportResult = (result: SalesActivationResult): void => {
  const details = {
    defaultCurrency: result.defaultCurrency,
    mode: result.mode,
    orgId: result.orgId,
    outcome: result.outcome,
    productCode: "SALES",
  };
  if (
    result.outcome === "BLOCKED_INACTIVE" ||
    result.outcome === "CONCURRENT_CONFLICT" ||
    result.outcome === "ORGANIZATION_NOT_FOUND" ||
    result.outcome === "PARTIAL_STATE" ||
    result.outcome === "UNSUPPORTED_ORGANIZATION"
  ) {
    console.warn("[SALES_ACTIVATION]", details);
    return;
  }
  console.info("[SALES_ACTIVATION]", details);
};

export const runActivateSales = async (
  options: ActivateSalesOptions,
): Promise<SalesActivationResult> => {
  const result = await SalesActivationService.activate(options);
  reportResult(result);
  return result;
};

if (require.main === module) {
  runActivateSales(parseActivateSalesArgs(process.argv.slice(2))).catch(
    (error) => {
      console.error("SALES activation failed.", error);
      process.exitCode = 1;
    },
  );
}
