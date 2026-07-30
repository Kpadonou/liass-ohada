import { z } from "zod";
import {
  OnboardingAccountingFrameworkSchema,
  WorkspaceCountrySchema,
} from "./workspace";

const optionalTrimmedString = (maxLength: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length === 0
        ? undefined
        : value,
    z.string().trim().max(maxLength).optional(),
  );

const optionalWebsite = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0
      ? undefined
      : value,
  z
    .string()
    .trim()
    .max(2048)
    .url()
    .refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    }, "Website must use HTTP or HTTPS")
    .optional(),
);

export const ApplicationLanguageSchema = z.enum(["fr", "en"]);

export const CabinetContactSchema = z
  .object({
    email: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim().length === 0
          ? undefined
          : value,
      z.string().trim().max(254).email().optional(),
    ),
    phone: optionalTrimmedString(40),
    website: optionalWebsite,
  })
  .strict();

export const CabinetAddressSchema = z
  .object({
    line1: optionalTrimmedString(200),
    line2: optionalTrimmedString(200),
    city: optionalTrimmedString(120),
    region: optionalTrimmedString(120),
    postalCode: optionalTrimmedString(32),
  })
  .strict();

export const CabinetClientDossierDefaultsSchema = z
  .object({
    country: WorkspaceCountrySchema.optional(),
    accountingFramework: OnboardingAccountingFrameworkSchema.optional(),
  })
  .strict();

export const CabinetSettingsSchema = z
  .object({
    cabinetOrgId: z.string().min(1),
    organizationName: z.string().trim().min(1).max(160),
    country: WorkspaceCountrySchema,
    contact: CabinetContactSchema,
    address: CabinetAddressSchema,
    preferredLanguage: ApplicationLanguageSchema,
    defaults: CabinetClientDossierDefaultsSchema,
    version: z.number().int().nonnegative(),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .strict();

export const GetCabinetSettingsRequestSchema = z.object({}).strict();
export const GetCabinetSettingsResponseSchema = CabinetSettingsSchema;

export const UpdateCabinetSettingsRequestSchema = z
  .object({
    organizationName: z.string().trim().min(1).max(160).optional(),
    country: WorkspaceCountrySchema.optional(),
    contact: CabinetContactSchema.partial().optional(),
    address: CabinetAddressSchema.partial().optional(),
    preferredLanguage: ApplicationLanguageSchema.optional(),
    defaults: CabinetClientDossierDefaultsSchema.partial().optional(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

export const UpdateCabinetSettingsResponseSchema = CabinetSettingsSchema;

export type ApplicationLanguage = z.infer<typeof ApplicationLanguageSchema>;
export type CabinetContact = z.infer<typeof CabinetContactSchema>;
export type CabinetAddress = z.infer<typeof CabinetAddressSchema>;
export type CabinetClientDossierDefaults = z.infer<
  typeof CabinetClientDossierDefaultsSchema
>;
export type CabinetSettings = z.infer<typeof CabinetSettingsSchema>;
export type UpdateCabinetSettingsRequest = z.infer<
  typeof UpdateCabinetSettingsRequestSchema
>;
