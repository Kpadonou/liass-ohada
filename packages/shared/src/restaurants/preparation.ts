import { z } from "zod";
const id = z.string().uuid();
const timestamp = z.string().datetime();
export const PreparationStateSchema = z.enum([
  "QUEUED",
  "IN_PROGRESS",
  "READY",
  "SERVED",
  "CANCELLED",
]);
export const PreparationLaneSchema = z.enum(["QUEUED", "IN_PROGRESS", "READY"]);
export const RestaurantPreparationSchema = z
  .object({
    orgId: z.string().min(1),
    outletId: id,
    schemaVersion: z.literal(1),
    orderId: id,
    itemId: id,
    submissionId: id,
    stationId: id,
    stationVersion: z.number().int().positive(),
    fireId: id,
    generation: z.number().int().min(1).max(11),
    name: z.string().min(1).max(160),
    quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    notes: z.string().max(1000).optional(),
    state: PreparationStateSchema,
    queuedAt: timestamp,
    queuedBy: z.string().min(1),
    startedAt: timestamp.optional(),
    startedBy: z.string().min(1).optional(),
    readyAt: timestamp.optional(),
    readyBy: z.string().min(1).optional(),
    servedAt: timestamp.optional(),
    servedBy: z.string().min(1).optional(),
    cancelledAt: timestamp.optional(),
    cancelledBy: z.string().min(1).optional(),
    cancellationReason: z.string().max(500).optional(),
    version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .superRefine((task, ctx) => {
    const required =
      task.state === "SERVED"
        ? [
            "startedAt",
            "startedBy",
            "readyAt",
            "readyBy",
            "servedAt",
            "servedBy",
          ]
        : task.state === "READY"
          ? ["startedAt", "startedBy", "readyAt", "readyBy"]
          : task.state === "IN_PROGRESS"
            ? ["startedAt", "startedBy"]
            : task.state === "CANCELLED"
              ? ["cancelledAt", "cancelledBy", "cancellationReason"]
              : [];
    for (const field of required)
      if (!task[field as keyof typeof task])
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Missing preparation transition evidence",
        });
    const timeline = [
      task.queuedAt,
      task.startedAt,
      task.readyAt,
      task.servedAt ?? task.cancelledAt,
    ].filter((time): time is string => time !== undefined);
    if (
      timeline.some(
        (time, index) =>
          index > 0 && Date.parse(time) < Date.parse(timeline[index - 1]),
      )
    )
      ctx.addIssue({ code: "custom", message: "Invalid preparation timeline" });
  });
export const PreparationTransitionRequestSchema = z
  .object({
    clientRequestId: id,
    expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const PreparationListResponseSchema = z
  .object({
    items: z.array(RestaurantPreparationSchema).max(100),
    nextCursor: z.string().optional(),
  })
  .strict();
export const PreparationResponseSchema = z
  .object({ data: RestaurantPreparationSchema })
  .strict();
export type RestaurantPreparation = z.infer<typeof RestaurantPreparationSchema>;
