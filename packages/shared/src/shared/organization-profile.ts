import { z } from 'zod';
import { LegalSellerAuthoritySchema } from './legal-identity-authority';
import { OrganizationSchema } from './workspace';
const text = z.string().trim().max(500).refine(v => !/[\u0000-\u001f\u007f]/.test(v));
export const OrganizationContactSchema = z.object({
  email: z.union([z.literal(''), z.email().max(254)]), phone: text,
  address: text, city: text, postalCode: text,
}).strict();
export const OrganizationContactUpdateSchema = z.object({
  expectedVersion: z.number().int().nonnegative(), contact: OrganizationContactSchema,
}).strict();
export const OrganizationProfileSchema = z.object({
  organization: OrganizationSchema, contact: OrganizationContactSchema,
  version: z.number().int().nonnegative(), canManage: z.boolean(),
  legalIdentity: z.object({
    addressTrust: z.enum(['ORGANIZATION_ATTESTED', 'VERIFIED', 'UNVERIFIED']).optional(),
    authority: LegalSellerAuthoritySchema.optional(), selectionVersion: z.number().int().nonnegative().optional(),
    version: z.string(), name: z.string(), ifu: z.string().nullable(),
    address: z.string().nullable(), missingEvidence: z.array(z.enum(['name', 'ifu', 'address'])),
  }).nullable(),
}).strict();
