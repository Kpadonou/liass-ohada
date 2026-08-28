import {
  CurrencyCodeSchema,
  SalesSettings,
} from "@liass-ohada/shared/sales";
import { z } from "zod";
import { OrganizationService } from "@/lambda/shared/services/organization-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";
import { SalesSettingsService } from "../settings/sales-settings-service";
import { SalesActivationRepository } from "./sales-activation-repository";

const SalesActivationInputSchema = z
  .object({
    apply: z.boolean(),
    defaultCurrency: CurrencyCodeSchema,
    orgId: z.string().min(1),
    timestamp: z.string().datetime().optional(),
  })
  .strict();

export type SalesActivationOutcome =
  | "ACTIVATED"
  | "ALREADY_ACTIVE"
  | "BLOCKED_INACTIVE"
  | "CONCURRENT_CONFLICT"
  | "ORGANIZATION_NOT_FOUND"
  | "PARTIAL_STATE"
  | "PLANNED"
  | "UNSUPPORTED_ORGANIZATION";

export interface SalesActivationResult {
  defaultCurrency: string;
  mode: "APPLY" | "DRY_RUN";
  orgId: string;
  outcome: SalesActivationOutcome;
}

type ActivationState = {
  organization: Awaited<ReturnType<typeof OrganizationService.getOrganization>>;
  productAccess: Awaited<
    ReturnType<typeof ProductAccessService.getProductAccess>
  >;
  settings: SalesSettings | null;
};

const classifyState = (state: ActivationState): SalesActivationOutcome => {
  if (!state.organization) {
    return "ORGANIZATION_NOT_FOUND";
  }
  if (
    state.organization.workspaceType !== "COMPANY" ||
    state.organization.status !== "ACTIVE"
  ) {
    return "UNSUPPORTED_ORGANIZATION";
  }
  if (state.productAccess?.status === "INACTIVE") {
    return "BLOCKED_INACTIVE";
  }
  if (state.productAccess && state.settings) {
    return "ALREADY_ACTIVE";
  }
  if (state.productAccess || state.settings) {
    return "PARTIAL_STATE";
  }
  return "PLANNED";
};

export class SalesActivationService {
  private static async readState(orgId: string): Promise<ActivationState> {
    const [organization, productAccess, settings] = await Promise.all([
      OrganizationService.getOrganization(orgId),
      ProductAccessService.getProductAccess(orgId, "SALES"),
      SalesSettingsService.getSalesSettings(orgId),
    ]);
    return { organization, productAccess, settings };
  }

  static async activate(input: {
    apply: boolean;
    defaultCurrency: string;
    orgId: string;
    timestamp?: string;
  }): Promise<SalesActivationResult> {
    const request = SalesActivationInputSchema.parse(input);
    const mode = request.apply ? "APPLY" : "DRY_RUN";
    const initialOutcome = classifyState(await this.readState(request.orgId));

    if (initialOutcome !== "PLANNED" || !request.apply) {
      return {
        defaultCurrency: request.defaultCurrency,
        mode,
        orgId: request.orgId,
        outcome: initialOutcome,
      };
    }

    const timestamp = request.timestamp ?? new Date().toISOString();
    const activated = await SalesActivationRepository.activateAtomically([
      OrganizationService.buildActiveCompanyCondition(request.orgId),
      ProductAccessService.buildActivationWrite({
        orgId: request.orgId,
        productCode: "SALES",
        timestamp,
      }),
      SalesSettingsService.buildActivationWrite({
        orgId: request.orgId,
        defaultCurrency: request.defaultCurrency,
        timestamp,
      }),
    ]);

    if (activated) {
      return {
        defaultCurrency: request.defaultCurrency,
        mode,
        orgId: request.orgId,
        outcome: "ACTIVATED",
      };
    }

    const concurrentOutcome = classifyState(await this.readState(request.orgId));
    return {
      defaultCurrency: request.defaultCurrency,
      mode,
      orgId: request.orgId,
      outcome:
        concurrentOutcome === "PLANNED"
          ? "CONCURRENT_CONFLICT"
          : concurrentOutcome,
    };
  }
}
