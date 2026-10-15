import type { DomainPermission } from "@/lambda/shared/authorization/domain-permission";
import type { RestaurantTransactionCommand } from "./transaction-service";
import type { TransactionQuery } from "./transaction-queries";

interface TransactionRoute {
  name: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  permission: DomainPermission;
  command?: RestaurantTransactionCommand;
  query?: TransactionQuery;
}
const base = "/restaurants/outlets/{outletId}";
export const RESTAURANT_TRANSACTION_ROUTES = [
  {
    name: "service-floor",
    method: "GET",
    path: `${base}/service-floor`,
    permission: "RESTAURANTS_SERVICE_FLOOR_READ",
    query: "SERVICE_FLOOR",
  },
  {
    name: "open-session",
    method: "POST",
    path: `${base}/sessions`,
    permission: "RESTAURANTS_SERVICE_SESSION_OPEN_MANAGE",
    command: "OPEN_SESSION",
  },
  {
    name: "get-session",
    method: "GET",
    path: `${base}/sessions/{sessionId}`,
    permission: "RESTAURANTS_SESSION_READ",
    query: "GET_SESSION",
  },
  {
    name: "active-sessions",
    method: "GET",
    path: `${base}/sessions`,
    permission: "RESTAURANTS_SESSION_READ",
    query: "ACTIVE_SESSIONS",
  },
  {
    name: "active-table-session",
    method: "GET",
    path: `${base}/tables/{tableId}/active-session`,
    permission: "RESTAURANTS_SESSION_READ",
    query: "ACTIVE_TABLE",
  },
  {
    name: "session-history",
    method: "GET",
    path: `${base}/sessions/history`,
    permission: "RESTAURANTS_SESSION_READ",
    query: "SESSION_HISTORY",
  },
  {
    name: "table-session-history",
    method: "GET",
    path: `${base}/tables/{tableId}/sessions/history`,
    permission: "RESTAURANTS_SESSION_READ",
    query: "TABLE_SESSION_HISTORY",
  },
  {
    name: "replace-responsible-staff",
    method: "PATCH",
    path: `${base}/sessions/{sessionId}/responsible-staff`,
    permission: "RESTAURANTS_SESSION_RESPONSIBILITY_MANAGE",
    command: "REPLACE_RESPONSIBLE_STAFF",
  },
  {
    name: "close-session",
    method: "POST",
    path: `${base}/sessions/{sessionId}/close`,
    permission: "RESTAURANTS_SESSION_CLOSE_MANAGE",
    command: "CLOSE_SESSION",
  },
  {
    name: "create-order",
    method: "POST",
    path: `${base}/orders`,
    permission: "RESTAURANTS_ORDER_CREATE_MANAGE",
    command: "CREATE_ORDER",
  },
  {
    name: "get-order",
    method: "GET",
    path: `${base}/orders/{orderId}`,
    permission: "RESTAURANTS_ORDER_READ",
    query: "GET_ORDER",
  },
  {
    name: "active-orders",
    method: "GET",
    path: `${base}/orders`,
    permission: "RESTAURANTS_ORDER_READ",
    query: "ACTIVE_ORDERS",
  },
  {
    name: "unpaid-orders",
    method: "GET",
    path: `${base}/orders/unpaid`,
    permission: "RESTAURANTS_ORDER_READ",
    query: "UNPAID_ORDERS",
  },
  {
    name: "session-orders",
    method: "GET",
    path: `${base}/sessions/{sessionId}/orders`,
    permission: "RESTAURANTS_ORDER_READ",
    query: "SESSION_ORDERS",
  },
  {
    name: "table-orders",
    method: "GET",
    path: `${base}/tables/{tableId}/orders`,
    permission: "RESTAURANTS_ORDER_READ",
    query: "TABLE_ORDERS",
  },
  {
    name: "order-history",
    method: "GET",
    path: `${base}/orders/history`,
    permission: "RESTAURANTS_ORDER_READ",
    query: "ORDER_HISTORY",
  },
  {
    name: "order-items",
    method: "GET",
    path: `${base}/orders/{orderId}/items`,
    permission: "RESTAURANTS_ORDER_READ",
    query: "ORDER_ITEMS",
  },
  {
    name: "add-draft-item",
    method: "POST",
    path: `${base}/orders/{orderId}/items`,
    permission: "RESTAURANTS_ORDER_DRAFT_MANAGE",
    command: "ADD_ITEM",
  },
  {
    name: "edit-draft-item",
    method: "PATCH",
    path: `${base}/orders/{orderId}/items/{itemId}`,
    permission: "RESTAURANTS_ORDER_DRAFT_MANAGE",
    command: "EDIT_ITEM",
  },
  {
    name: "cancel-order-item",
    method: "POST",
    path: `${base}/orders/{orderId}/items/{itemId}/cancel`,
    permission: "RESTAURANTS_ORDER_CANCEL_MANAGE",
    command: "CANCEL_ITEM",
  },
  {
    name: "submit-order",
    method: "POST",
    path: `${base}/orders/{orderId}/submit`,
    permission: "RESTAURANTS_ORDER_SUBMIT_MANAGE",
    command: "SUBMIT_ORDER",
  },
  {
    name: "cancel-order",
    method: "POST",
    path: `${base}/orders/{orderId}/cancel`,
    permission: "RESTAURANTS_ORDER_CANCEL_MANAGE",
    command: "CANCEL_ORDER",
  },
  {
    name: "close-order",
    method: "POST",
    path: `${base}/orders/{orderId}/close`,
    permission: "RESTAURANTS_ORDER_CLOSE_MANAGE",
    command: "CLOSE_ORDER",
  },
] as const satisfies readonly TransactionRoute[];
