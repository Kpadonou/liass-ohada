import { TransactWriteItem } from "@aws-sdk/client-dynamodb";
import {
  CurrencyCode,
  SalesSettings,
  SalesSettingsSchema,
} from "@liass-ohada/shared/sales";
import { z } from "zod";
import { SalesSettingsRepository } from "./sales-settings-repository";

const OrganizationIdSchema = z.string().min(1);

export class SalesSettingsService {
  static buildActivationWrite(input: {
    defaultCurrency: CurrencyCode;
    orgId: string;
    timestamp: string;
  }): TransactWriteItem {
    return SalesSettingsRepository.buildPutIfAbsentTransaction(
      SalesSettingsSchema.parse({
        orgId: OrganizationIdSchema.parse(input.orgId),
        defaultCurrency: input.defaultCurrency,
        version: 1,
        createdAt: input.timestamp,
        updatedAt: input.timestamp,
      }),
    );
  }

  static async getSalesSettings(
    orgId: string,
  ): Promise<SalesSettings | null> {
    return SalesSettingsRepository.getSalesSettings(
      OrganizationIdSchema.parse(orgId),
    );
  }
}
