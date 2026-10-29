import type { DomainPermission } from "@/lambda/shared/authorization/domain-permission";
const base = "/restaurants/outlets/{outletId}";
export const RESTAURANT_CASH_ROUTES = [
  {
    method: "POST",
    path: `${base}/business-days/open`,
    command: "OPEN_DAY",
    permission: "RESTAURANTS_SETUP_MANAGE",
  },
  {
    method: "GET",
    path: `${base}/business-days/current`,
    query: "CURRENT_DAY",
    permission: "RESTAURANTS_CHECKOUT_READ",
  },
  {
    method: "GET",
    path: `${base}/business-days`,
    query: "DAYS",
    permission: "RESTAURANTS_SETUP_MANAGE",
  },
  {
    method: "GET",
    path: `${base}/business-days/{businessDayId}`,
    query: "DAY",
    permission: "RESTAURANTS_CHECKOUT_READ",
  },
  {
    method: "GET",
    path: `${base}/business-days/{businessDayId}/summary`,
    query: "SUMMARY_DAY",
    permission: "RESTAURANTS_SETUP_MANAGE",
  },
  {
    method: "POST",
    path: `${base}/business-days/{businessDayId}/close`,
    command: "CLOSE_DAY",
    permission: "RESTAURANTS_SETUP_MANAGE",
  },
  {
    method: "GET",
    path: `${base}/business-days/{businessDayId}/cash-sessions`,
    query: "SESSIONS",
    permission: "RESTAURANTS_SETUP_MANAGE",
  },
  {
    method: "POST",
    path: `${base}/cash-sessions`,
    command: "OPEN_CASH",
    permission: "RESTAURANTS_PAYMENT_CAPTURE_MANAGE",
  },
  {
    method: "GET",
    path: `${base}/cash-sessions/current`,
    query: "CURRENT_CASH",
    permission: "RESTAURANTS_CHECKOUT_READ",
  },
  {
    method: "GET",
    path: `${base}/cash-sessions/{cashSessionId}`,
    query: "CASH",
    permission: "RESTAURANTS_CHECKOUT_READ",
  },
  {
    method: "GET",
    path: `${base}/cash-sessions/{cashSessionId}/summary`,
    query: "SUMMARY_CASH",
    permission: "RESTAURANTS_CHECKOUT_READ",
  },
  {
    method: "POST",
    path: `${base}/cash-sessions/{cashSessionId}/close`,
    command: "CLOSE_CASH",
    permission: "RESTAURANTS_PAYMENT_CAPTURE_MANAGE",
  },
  {
    method: "POST",
    path: `${base}/cash-sessions/{cashSessionId}/movements`,
    command: "MOVEMENT",
    permission: "RESTAURANTS_SETUP_MANAGE",
  },
  {
    method: "GET",
    path: `${base}/cash-sessions/{cashSessionId}/movements`,
    query: "MOVEMENTS",
    permission: "RESTAURANTS_CHECKOUT_READ",
  },
] as const satisfies readonly {
  method: "GET" | "POST";
  path: string;
  permission: DomainPermission;
  command?: string;
  query?: string;
}[];
