import type { DomainPermission } from "@/lambda/shared/authorization/domain-permission";
import type { StaffCommand } from "./staff-service";
export interface RestaurantStaffRoute {
  name: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  permission: DomainPermission;
  command?: StaffCommand;
  query?: "LIST" | "GET" | "STAFF_OUTLETS" | "OUTLET_STAFF";
}
export const RESTAURANT_STAFF_ROUTES = [
  {
    name: "list-staff",
    method: "GET",
    path: "/restaurants/staff",
    permission: "RESTAURANTS_STAFF_READ",
    query: "LIST",
  },
  {
    name: "get-staff",
    method: "GET",
    path: "/restaurants/staff/{memberUserId}",
    permission: "RESTAURANTS_STAFF_READ",
    query: "GET",
  },
  {
    name: "bind-staff",
    method: "POST",
    path: "/restaurants/staff",
    permission: "RESTAURANTS_STAFF_MANAGE",
    command: "BIND",
  },
  {
    name: "update-staff",
    method: "PATCH",
    path: "/restaurants/staff/{memberUserId}",
    permission: "RESTAURANTS_STAFF_MANAGE",
    command: "UPDATE",
  },
  {
    name: "list-staff-outlets",
    method: "GET",
    path: "/restaurants/staff/{memberUserId}/outlets",
    permission: "RESTAURANTS_STAFF_READ",
    query: "STAFF_OUTLETS",
  },
  {
    name: "assign-staff-outlet",
    method: "POST",
    path: "/restaurants/staff/{memberUserId}/outlets/{outletId}",
    permission: "RESTAURANTS_STAFF_MANAGE",
    command: "ASSIGN",
  },
  {
    name: "unassign-staff-outlet",
    method: "POST",
    path: "/restaurants/staff/{memberUserId}/outlets/{outletId}/deactivate",
    permission: "RESTAURANTS_STAFF_MANAGE",
    command: "UNASSIGN",
  },
  {
    name: "list-outlet-staff",
    method: "GET",
    path: "/restaurants/outlets/{outletId}/staff",
    permission: "RESTAURANTS_STAFF_READ",
    query: "OUTLET_STAFF",
  },
] as const satisfies readonly RestaurantStaffRoute[];
