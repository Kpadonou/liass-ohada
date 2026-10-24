import { z } from "zod";
import {
  ManageTableQrRequestSchema,
  ManagedTableQrResponseSchema,
} from "@liass-ohada/shared/restaurants";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { QrManagement } from "./qr-management";
import { WaiterCalls } from "./waiter-call";
import { AppError } from "@/lambda/shared/app-error";

const base =
  "/restaurants/outlets/{outletId}/service-areas/{areaId}/tables/{tableId}/qr";
export const QR_STAFF_ROUTES = ["rotate", "revoke"].map((operation) => ({
  operation: operation as "rotate" | "revoke",
  path: `${base}/${operation}`,
}));
const qrHandler = createHandler(
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

const activityPath = "/restaurants/outlets/{outletId}/guest-activity";
const acknowledgePath =
  "/restaurants/outlets/{outletId}/waiter-calls/{waiterCallId}/acknowledge";
const activityHandler = createHandler(
  z
    .object({
      outletId: z.string().uuid(),
      cursor: z.string().max(2000).optional(),
    })
    .strict(),
  async (input, context) =>
    WaiterCalls.activity(
      { orgId: context.orgId, outletId: input.outletId },
      context.userId,
      input.cursor,
    ),
  {
    permission: "RESTAURANTS_SERVICE_FLOOR_READ",
    productCode: "RESTAURANTS",
    action: "GUEST_ACTIVITY_READ",
  },
);
const acknowledgeHandler = createHandler(
  z
    .object({ outletId: z.string().uuid(), waiterCallId: z.string().uuid() })
    .strict(),
  async (input, context) =>
    WaiterCalls.acknowledge(
      { orgId: context.orgId, outletId: input.outletId },
      context.userId,
      input.waiterCallId,
    ),
  {
    permission: "RESTAURANTS_SERVICE_FLOOR_READ",
    productCode: "RESTAURANTS",
    action: "WAITER_CALL_ACKNOWLEDGE",
  },
);
/** Route selection precedes authorization; QR keeps its original setup permission. */
export const handler: typeof qrHandler = async (event) => {
  if (event.routeKey === `GET ${activityPath}`) return activityHandler(event);
  if (event.routeKey === `POST ${acknowledgePath}`)
    return acknowledgeHandler(event);
  return qrHandler(event);
};
