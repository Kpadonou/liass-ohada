import { z } from "zod";
import {
  ManageTableQrRequestSchema,
  ManagedTableQrResponseSchema,
} from "@liass-ohada/shared/restaurants";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { QrManagement } from "./qr-management";
import { AppError } from "@/lambda/shared/app-error";

const base =
  "/restaurants/outlets/{outletId}/service-areas/{areaId}/tables/{tableId}/qr";
export const QR_STAFF_ROUTES = ["rotate", "revoke"].map((operation) => ({
  operation: operation as "rotate" | "revoke",
  path: `${base}/${operation}`,
}));
export const handler = createHandler(
  z
    .object({
      clientRequestId: z.string().uuid().optional(),
      expectedVersion: z.number().int().positive().optional(),
      outletId: z.string().uuid(),
      areaId: z.string().uuid(),
      tableId: z.string().uuid(),
    })
    .strict(),
  async (input, context) => {
    if (context.event.routeKey === `GET ${base}/status`)
      return QrManagement.read(
        context.orgId,
        input.outletId,
        input.areaId,
        input.tableId,
      );
    const route = QR_STAFF_ROUTES.find(
      (r) => context.event.routeKey === `POST ${r.path}`,
    );
    if (!route) throw new AppError(404, "RESTAURANTS_NOT_FOUND");
    const { outletId, areaId, tableId, ...request } = input;
    return ManagedTableQrResponseSchema.parse(
      await QrManagement.mutate(
        context.orgId,
        context.userId,
        outletId,
        areaId,
        tableId,
        route.operation,
        ManageTableQrRequestSchema.parse(request),
      ),
    );
  },
  {
    permission: "RESTAURANTS_SETUP_MANAGE",
    productCode: "RESTAURANTS",
    action: "MANAGE_TABLE_QR",
  },
);
