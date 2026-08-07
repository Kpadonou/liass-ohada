import { TransactWriteItem } from "@aws-sdk/client-dynamodb";
import {
  AccountingFramework,
  AccountingSettings,
  AccountingSettingsSchema,
} from "@liass-ohada/shared/accounting";
import { z } from "zod";
import { AppError } from "@/lambda/shared/app-error";
import { AccountingSettingsRepository } from "./accounting-settings-repository";

const OrganizationIdSchema = z.string().min(1);

export type AccountingSettingsBackfillOutcome =
  | "CREATED"
  | "WOULD_CREATE"
  | "UNCHANGED"
  | "MISMATCH"
  | "ORGANIZATION_NOT_FOUND"
  | "LEGACY_FRAMEWORK_MISSING"
  | "LEGACY_FRAMEWORK_INVALID";

export interface AccountingSettingsBackfillResult {
  accountingSettingsFramework?: AccountingSettings["accountingFramework"];
  legacyFramework?: unknown;
  orgId: string;
  outcome: AccountingSettingsBackfillOutcome;
}

export class AccountingSettingsService {
  static buildOnboardingWrite(input: {
    orgId: string;
    accountingFramework: AccountingSettings["accountingFramework"];
    timestamp: string;
  }): TransactWriteItem {
    const settings = AccountingSettingsSchema.parse({
      orgId: OrganizationIdSchema.parse(input.orgId),
      accountingFramework: input.accountingFramework,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    });
    return AccountingSettingsRepository.buildPutIfAbsentTransaction(settings);
  }

  static async getAccountingSettings(
    orgId: string,
  ): Promise<AccountingSettings | null> {
    return AccountingSettingsRepository.getAccountingSettings(
      OrganizationIdSchema.parse(orgId),
    );
  }

  static async resolveAccountingFramework(
    orgId: string,
    legacyAccountingFramework?: unknown,
  ): Promise<AccountingSettings["accountingFramework"]> {
    const validatedOrgId = OrganizationIdSchema.parse(orgId);
    const settings =
      await AccountingSettingsRepository.getAccountingSettings(validatedOrgId);
    if (settings) {
      return settings.accountingFramework;
    }

    let legacyValue = legacyAccountingFramework;
    if (legacyValue === undefined) {
      const legacy =
        await AccountingSettingsRepository.getLegacyOrganizationConfiguration(
          validatedOrgId,
        );
      legacyValue = legacy.accountingFramework;
    }

    const parsedFramework = AccountingFramework.safeParse(legacyValue);
    if (!parsedFramework.success) {
      throw new AppError(400, "ERROR_INVALID_INPUT", {
        field: "accountingFramework",
      });
    }

    console.info("[ACCOUNTING_SETTINGS_COMPATIBILITY_FALLBACK]", {
      orgId: validatedOrgId,
      source: "LEGACY_ORGANIZATION",
    });
    return parsedFramework.data;
  }

  static async backfillOrganization(input: {
    apply: boolean;
    orgId: string;
    timestamp?: string;
  }): Promise<AccountingSettingsBackfillResult> {
    const orgId = OrganizationIdSchema.parse(input.orgId);
    const [existing, legacy] = await Promise.all([
      AccountingSettingsRepository.getAccountingSettings(orgId),
      AccountingSettingsRepository.getLegacyOrganizationConfiguration(orgId),
    ]);

    if (!legacy.organizationExists) {
      return { orgId, outcome: "ORGANIZATION_NOT_FOUND" };
    }

    if (legacy.accountingFramework === undefined) {
      return { orgId, outcome: "LEGACY_FRAMEWORK_MISSING" };
    }

    const legacyFramework = AccountingFramework.safeParse(
      legacy.accountingFramework,
    );
    if (!legacyFramework.success) {
      return {
        legacyFramework: legacy.accountingFramework,
        orgId,
        outcome: "LEGACY_FRAMEWORK_INVALID",
      };
    }

    if (existing) {
      return {
        accountingSettingsFramework: existing.accountingFramework,
        legacyFramework: legacyFramework.data,
        orgId,
        outcome:
          existing.accountingFramework === legacyFramework.data
            ? "UNCHANGED"
            : "MISMATCH",
      };
    }

    if (!input.apply) {
      return {
        legacyFramework: legacyFramework.data,
        orgId,
        outcome: "WOULD_CREATE",
      };
    }

    const timestamp = input.timestamp ?? new Date().toISOString();
    const item = AccountingSettingsRepository.buildItem({
      orgId,
      accountingFramework: legacyFramework.data,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const created = await AccountingSettingsRepository.putIfAbsent(item);
    if (created) {
      return {
        accountingSettingsFramework: item.accountingFramework,
        legacyFramework: legacyFramework.data,
        orgId,
        outcome: "CREATED",
      };
    }

    const concurrentSettings =
      await AccountingSettingsRepository.getAccountingSettings(orgId);
    if (!concurrentSettings) {
      throw new Error(
        `AccountingSettings conditional write failed without an existing item for ${orgId}.`,
      );
    }

    return {
      accountingSettingsFramework: concurrentSettings.accountingFramework,
      legacyFramework: legacyFramework.data,
      orgId,
      outcome:
        concurrentSettings.accountingFramework === legacyFramework.data
          ? "UNCHANGED"
          : "MISMATCH",
    };
  }
}
