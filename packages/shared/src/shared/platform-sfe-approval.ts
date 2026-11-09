import { z } from "zod";

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
export const SfeContactSchema = z
  .object({
    name: text(160),
    email: z.string().email().max(254),
    phone: text(60),
  })
  .strict();
export const SfeApprovalFieldsSchema = z
  .object({
    approvalLetterReference: text(200),
    softwareName: text(160),
    softwareVersion: text(100),
    countryOfOrigin: text(100).optional(),
    publisher: SfeContactSchema,
    supplier: SfeContactSchema,
  })
  .strict();
export const SfeApprovalSchema = SfeApprovalFieldsSchema.extend({
  version: z.number().int().positive().safe(),
  updatedAt: z.string().datetime(),
}).strict();
export const PutSfeApprovalRequestSchema = SfeApprovalFieldsSchema.extend({
  expectedVersion: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  commandId: z.string().uuid(),
}).strict();
export const SfeApprovalViewSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("UNAVAILABLE"), approval: z.null() }).strict(),
  z
    .object({ status: z.literal("REGISTERED"), approval: SfeApprovalSchema })
    .strict(),
]);
export type SfeApproval = z.infer<typeof SfeApprovalSchema>;
export type SfeApprovalView = z.infer<typeof SfeApprovalViewSchema>;
