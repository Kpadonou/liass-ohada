import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import * as c from '@liass-ohada/shared/restaurants';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AuthStore } from '../../identity/data-access/auth.store';
import {
  userMessageFromResponse,
  ApiMutationResult,
} from '../../../core/notifications/notification-message';
import {
  createRequests,
  updateRequests,
  entityResponses,
  listResponses,
  restaurantPath,
  RestaurantKind,
  RestaurantListKind,
  RestaurantEntities,
  RestaurantContext,
} from './restaurants-model';

@Injectable({ providedIn: 'root' })
export class RestaurantsApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthStore);
  private readonly base = environment.apiBaseUrl.replace(/\/$/, '');
  private assertScope(scope: string) {
    if (!scope || this.auth.effectiveOrgId() !== scope)
      throw new HttpErrorResponse({ status: 409, error: { error: { code: 'WORKSPACE_CHANGED' } } });
  }
  async guestRequests(
    ctx: { org: string; user: string; revision: number; outlet: string; session: string },
    action?: { requestId: string; operation: 'approve' | 'reject'; reason?: string },
  ) {
    const check = () => {
      this.assertScope(ctx.org);
      if (
        this.auth.currentUserId() !== ctx.user ||
        (this.auth.contextRevision?.() ?? 0) !== ctx.revision
      )
        throw new HttpErrorResponse({ status: 409 });
    };
    check();
    const path =
      this.base +
      `/restaurants/outlets/${c.RestaurantIdSchema.parse(ctx.outlet)}/sessions/${c.RestaurantIdSchema.parse(ctx.session)}/guest-requests`;
    const result = action
      ? c.GuestOrderRequestSchema.parse(
          (
            await firstValueFrom(
              this.http
                .post<{
                  request: unknown;
                }>(
                  path + `/${c.RestaurantIdSchema.parse(action.requestId)}/${action.operation}`,
                  action.operation === 'reject'
                    ? c.RejectGuestRequestSchema.parse({ reason: action.reason })
                    : {},
                )
                .pipe(timeout(30_000)),
            )
          ).request,
        )
      : c.GuestRequestReviewResponseSchema.parse(
          await firstValueFrom(this.http.get<unknown>(path).pipe(timeout(15_000))),
        );
    check();
    return result;
  }
  async guestActivity(
    ctx: { org: string; user: string; revision: number; outlet: string },
    cursor?: string,
  ) {
    const check = () => {
      this.assertScope(ctx.org);
      if (
        this.auth.currentUserId() !== ctx.user ||
        (this.auth.contextRevision?.() ?? 0) !== ctx.revision
      )
        throw new HttpErrorResponse({ status: 409 });
    };
    check();
    const response = c.GuestActivityResponseSchema.parse(
      await firstValueFrom(
        this.http
          .get<unknown>(
            this.base +
              `/restaurants/outlets/${c.RestaurantIdSchema.parse(ctx.outlet)}/guest-activity`,
            { params: cursor ? { cursor } : {} },
          )
          .pipe(timeout(15_000)),
      ),
    );
    check();
    return response;
  }
  async acknowledgeWaiterCall(
    ctx: { org: string; user: string; revision: number; outlet: string },
    callId: string,
  ) {
    const check = () => {
      this.assertScope(ctx.org);
      if (
        this.auth.currentUserId() !== ctx.user ||
        (this.auth.contextRevision?.() ?? 0) !== ctx.revision
      )
        throw new HttpErrorResponse({ status: 409 });
    };
    check();
    const response = c.AcknowledgeWaiterCallResponseSchema.parse(
      await firstValueFrom(
        this.http
          .post<unknown>(
            this.base +
              `/restaurants/outlets/${c.RestaurantIdSchema.parse(ctx.outlet)}/waiter-calls/${c.RestaurantIdSchema.parse(callId)}/acknowledge`,
            {},
          )
          .pipe(timeout(15_000)),
      ),
    );
    check();
    if (response.waiterCallId !== callId) throw new Error('Mismatched acknowledgement');
    return response;
  }
  async cartePage(
    ctx: { org: string; user: string; revision: number; outlet: string; menu: string },
    cursor: string | undefined,
    signal: AbortSignal,
  ) {
    const assertCurrent = () => {
      this.assertScope(ctx.org);
      if (
        this.auth.currentUserId() !== ctx.user ||
        this.auth.contextRevision() !== ctx.revision ||
        signal.aborted
      )
        throw new HttpErrorResponse({
          status: 409,
          error: { error: { code: 'WORKSPACE_CHANGED' } },
        });
    };
    assertCurrent();
    let params = new HttpParams().set('limit', 100);
    if (cursor) params = params.set('cursor', cursor);
    // Unsubscription aborts Angular HttpClient's underlying request.
    const response = await new Promise<unknown>((resolve, reject) => {
      const abort = () => {
        subscription.unsubscribe();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const subscription = this.http
        .get<unknown>(this.base + '/restaurants/outlets/' + ctx.outlet + '/menu/items', { params })
        .subscribe({ next: resolve, error: reject });
      signal.addEventListener('abort', abort, { once: true });
      subscription.add(() => signal.removeEventListener('abort', abort));
      if (signal.aborted) abort();
    });
    assertCurrent();
    const page = c.MenuItemsBrowseResponseSchema.parse(response);
    if (
      page.outletId !== ctx.outlet ||
      page.menuId !== ctx.menu ||
      page.items.some((item) => item.outletId !== ctx.outlet || item.menuId !== ctx.menu) ||
      (cursor && cursor === page.nextCursor)
    )
      throw new Error('Mismatched Carte context');
    return page;
  }
  async myOutlets(scope: string, userId: string, cursor?: string) {
    this.assertScope(scope);
    const assertUser = () => {
      if (!userId || this.auth.currentUserId() !== userId) throw new Error('User context changed');
    };
    assertUser();
    const input = c.RestaurantsListRequestSchema.parse({ limit: 50, cursor });
    let params = new HttpParams().set('limit', input.limit);
    if (input.cursor) params = params.set('cursor', input.cursor);
    const response = await firstValueFrom(
      this.http.get<unknown>(this.base + '/restaurants/me/outlets', { params }),
    );
    this.assertScope(scope);
    assertUser();
    const data = c.RestaurantMyOutletsResponseSchema.parse(response);
    if (
      new Set(data.items.map((item) => item.outletId)).size !== data.items.length ||
      (input.cursor && data.nextCursor === input.cursor)
    )
      throw new Error('Invalid operational context');
    return data;
  }
  async get<K extends RestaurantKind>(
    scope: string,
    kind: K,
    context: RestaurantContext = {},
    id?: string,
  ): Promise<RestaurantEntities[K] | null> {
    this.assertScope(scope);
    try {
      const response = await firstValueFrom(
        this.http.get<unknown>(this.base + restaurantPath(kind, context, id)),
      );
      return entityResponses[kind].parse(response).data as RestaurantEntities[K];
    } catch (error) {
      if (
        (kind === 'restaurant' || kind === 'menu') &&
        error instanceof HttpErrorResponse &&
        error.status === 404 &&
        error.error?.error?.code === 'RESTAURANTS_NOT_FOUND'
      )
        return null;
      throw error;
    }
  }
  async list<K extends RestaurantListKind>(
    scope: string,
    kind: K,
    context: RestaurantContext,
    cursor?: string,
  ): Promise<{ items: RestaurantEntities[K][]; nextCursor?: string }> {
    this.assertScope(scope);
    const input = c.RestaurantsListRequestSchema.parse({ limit: 50, cursor });
    let params = new HttpParams().set('limit', input.limit);
    if (input.cursor) params = params.set('cursor', input.cursor);
    const response = await firstValueFrom(
      this.http.get<unknown>(this.base + restaurantPath(kind, context), { params }),
    );
    return listResponses[kind].parse(response) as {
      items: RestaurantEntities[K][];
      nextCursor?: string;
    };
  }
  async save<K extends RestaurantKind>(
    scope: string,
    kind: K,
    context: RestaurantContext,
    input: unknown,
    id?: string,
  ): Promise<ApiMutationResult<RestaurantEntities[K]>> {
    this.assertScope(scope);
    const update = id !== undefined;
    const request = (update ? updateRequests[kind] : createRequests[kind]).parse(input);
    const url =
      this.base +
      restaurantPath(
        kind,
        context,
        update && !['restaurant', 'menu'].includes(kind) ? id : undefined,
      );
    const response = await firstValueFrom(
      update ? this.http.patch<unknown>(url, request) : this.http.post<unknown>(url, request),
    );
    return {
      data: entityResponses[kind].parse(response).data as RestaurantEntities[K],
      message: userMessageFromResponse(response),
    };
  }
  async deactivate<K extends RestaurantListKind>(
    scope: string,
    kind: K,
    context: RestaurantContext,
    id: string,
    version: number,
  ) {
    this.assertScope(scope);
    const request = c.RestaurantsLifecycleRequestSchema.parse({ expectedVersion: version });
    const response = await firstValueFrom(
      this.http.post<unknown>(
        this.base + restaurantPath(kind, context, id) + '/deactivate',
        request,
      ),
    );
    return {
      data: entityResponses[kind].parse(response).data as RestaurantEntities[K],
      message: userMessageFromResponse(response),
    };
  }
  async availability(
    scope: string,
    context: RestaurantContext,
    id: string,
    version: number,
    availability: c.MenuItemAvailability,
  ) {
    this.assertScope(scope);
    const request = c.ChangeMenuItemAvailabilityRequestSchema.parse({
      expectedVersion: version,
      availability,
    });
    const response = await firstValueFrom(
      this.http.post<unknown>(
        this.base + restaurantPath('item', context, id) + '/availability',
        request,
      ),
    );
    return {
      data: c.MenuItemResponseSchema.parse(response).data,
      message: userMessageFromResponse(response),
    };
  }
  async serviceFloor(scope: string, outletId: string, cursor?: string) {
    this.assertScope(scope);
    c.RestaurantIdSchema.parse(outletId);
    const request = c.RestaurantServiceFloorRequestSchema.parse({ limit: 100, cursor });
    let params = new HttpParams().set('limit', request.limit);
    if (request.cursor) params = params.set('cursor', request.cursor);
    const result = c.RestaurantServiceFloorResponseSchema.parse(
      await firstValueFrom(
        this.http
          .get<unknown>(this.base + `/restaurants/outlets/${outletId}/service-floor`, { params })
          .pipe(timeout(35_000)),
      ),
    );
    if (result.outletId !== outletId) throw new Error('Mismatched floor context');
    return result;
  }
  async openSession(scope: string, outletId: string, input: unknown) {
    this.assertScope(scope);
    const user = this.auth.currentUserId?.();
    c.RestaurantIdSchema.parse(outletId);
    const request = c.OpenGuestSessionRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http
        .post<unknown>(this.base + `/restaurants/outlets/${outletId}/sessions`, request)
        .pipe(timeout(35_000)),
    );
    this.assertScope(scope);
    if (user && this.auth.currentUserId?.() !== user) throw new Error('User context changed');
    const data = c.GuestSessionResponseSchema.parse(response).data;
    if (
      data.orgId !== scope ||
      data.outletId !== outletId ||
      data.tableId !== request.tableId ||
      data.areaId !== request.areaId
    )
      throw new Error('Mismatched session context');
    return { data, message: userMessageFromResponse(response) };
  }
  async guestSession(scope: string, outletId: string, sessionId: string) {
    const user = this.auth.currentUserId?.();
    const revision = this.auth.contextRevision?.();
    const assertContext = () => {
      this.assertScope(scope);
      if (this.auth.currentUserId?.() !== user || this.auth.contextRevision?.() !== revision)
        throw new HttpErrorResponse({
          status: 409,
          error: { error: { code: 'WORKSPACE_CHANGED' } },
        });
    };
    assertContext();
    c.RestaurantIdSchema.parse(outletId);
    c.RestaurantIdSchema.parse(sessionId);
    const response = await firstValueFrom(
      this.http
        .get<unknown>(this.base + `/restaurants/outlets/${outletId}/sessions/${sessionId}`)
        .pipe(timeout(35_000)),
    );
    assertContext();
    const data = c.GuestSessionResponseSchema.parse(response).data;
    if (data.orgId !== scope || data.outletId !== outletId || data.guestSessionId !== sessionId)
      throw new Error('Mismatched session context');
    return data;
  }
  async replaceResponsibleStaff(
    scope: string,
    outletId: string,
    sessionId: string,
    input: unknown,
  ) {
    this.assertScope(scope);
    c.RestaurantIdSchema.parse(outletId);
    c.RestaurantIdSchema.parse(sessionId);
    const request = c.ReplaceGuestSessionResponsibleStaffRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http
        .patch<unknown>(
          this.base + `/restaurants/outlets/${outletId}/sessions/${sessionId}/responsible-staff`,
          request,
        )
        .pipe(timeout(35_000)),
    );
    this.assertScope(scope);
    const data = c.GuestSessionResponseSchema.parse(response).data;
    if (data.orgId !== scope || data.outletId !== outletId || data.guestSessionId !== sessionId)
      throw new Error('Mismatched session context');
    if ((data.responsibleStaff?.staffId ?? null) !== request.staffId)
      throw new Error('Mismatched responsibility context');
    return { data, message: userMessageFromResponse(response) };
  }
  private staffPath(userId: string) {
    return '/restaurants/staff/' + encodeURIComponent(c.RestaurantStaffUserIdSchema.parse(userId));
  }
  private pageParams(cursor?: string) {
    const request = c.RestaurantsListRequestSchema.parse({ limit: 50, cursor });
    let params = new HttpParams().set('limit', request.limit);
    if (request.cursor) params = params.set('cursor', request.cursor);
    return params;
  }
  async staff(scope: string, cursor?: string) {
    this.assertScope(scope);
    const response = await firstValueFrom(
      this.http.get<unknown>(this.base + '/restaurants/staff', { params: this.pageParams(cursor) }),
    );
    this.assertScope(scope);
    return c.RestaurantStaffListResponseSchema.parse(response);
  }
  async staffMember(scope: string, userId: string) {
    this.assertScope(scope);
    const response = await firstValueFrom(
      this.http.get<unknown>(this.base + this.staffPath(userId)),
    );
    this.assertScope(scope);
    const data = c.RestaurantStaffResponseSchema.parse(response).data;
    if (data.userId !== userId) throw new Error('Mismatched staff context');
    return data;
  }
  async bindStaff(scope: string, input: unknown) {
    this.assertScope(scope);
    const request = c.BindRestaurantStaffRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http.post<unknown>(this.base + '/restaurants/staff', request).pipe(timeout(35_000)),
    );
    this.assertScope(scope);
    const data = c.RestaurantStaffResponseSchema.parse(response).data;
    if (data.userId !== request.memberUserId) throw new Error('Mismatched staff context');
    return { data, message: userMessageFromResponse(response) };
  }
  async staffOutlets(scope: string, userId: string, cursor?: string) {
    this.assertScope(scope);
    const response = await firstValueFrom(
      this.http.get<unknown>(this.base + this.staffPath(userId) + '/outlets', {
        params: this.pageParams(cursor),
      }),
    );
    this.assertScope(scope);
    const result = c.RestaurantStaffOutletListResponseSchema.parse(response);
    if (result.items.some((row) => row.userId !== userId))
      throw new Error('Mismatched assignment context');
    return result;
  }
  async outletStaff(scope: string, outletId: string, cursor?: string) {
    this.assertScope(scope);
    c.RestaurantIdSchema.parse(outletId);
    const response = await firstValueFrom(
      this.http.get<unknown>(this.base + `/restaurants/outlets/${outletId}/staff`, {
        params: this.pageParams(cursor),
      }),
    );
    this.assertScope(scope);
    const result = c.RestaurantOutletStaffListResponseSchema.parse(response);
    if (
      result.items.some(
        (row) => row.assignment.outletId !== outletId || row.staff.userId !== row.assignment.userId,
      )
    )
      throw new Error('Mismatched outlet staff context');
    return result;
  }
  async updateStaff(scope: string, userId: string, input: unknown) {
    this.assertScope(scope);
    const request = c.UpdateRestaurantStaffRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http.patch<unknown>(this.base + this.staffPath(userId), request).pipe(timeout(35_000)),
    );
    this.assertScope(scope);
    const data = c.RestaurantStaffResponseSchema.parse(response).data;
    if (data.userId !== userId) throw new Error('Mismatched staff context');
    return { data, message: userMessageFromResponse(response) };
  }
  async staffAssignment(
    scope: string,
    userId: string,
    outletId: string,
    active: boolean,
    input: unknown,
  ) {
    this.assertScope(scope);
    c.RestaurantIdSchema.parse(outletId);
    const request = (
      active
        ? c.AssignRestaurantStaffOutletRequestSchema
        : c.UnassignRestaurantStaffOutletRequestSchema
    ).parse(input);
    const response = await firstValueFrom(
      this.http
        .post<unknown>(
          this.base +
            this.staffPath(userId) +
            `/outlets/${outletId}` +
            (active ? '' : '/deactivate'),
          request,
        )
        .pipe(timeout(35_000)),
    );
    this.assertScope(scope);
    const data = c.RestaurantStaffOutletResponseSchema.parse(response).data;
    if (data.userId !== userId || data.outletId !== outletId)
      throw new Error('Mismatched assignment context');
    return { data, message: userMessageFromResponse(response) };
  }
  async qr(scope: string, context: RestaurantContext, id: string) {
    this.assertScope(scope);
    return c.RestaurantTableQrResponseSchema.parse(
      await firstValueFrom(
        this.http.get<unknown>(this.base + restaurantPath('table', context, id) + '/qr'),
      ),
    );
  }
  async managedQr(scope: string, context: RestaurantContext, id: string) {
    this.assertScope(scope);
    const result = c.ManagedTableQrResponseSchema.parse(
      await firstValueFrom(
        this.http.get<unknown>(this.base + restaurantPath('table', context, id) + '/qr/status'),
      ),
    );
    this.assertScope(scope);
    return result;
  }
  async changeQr(
    scope: string,
    context: RestaurantContext,
    id: string,
    operation: 'rotate' | 'revoke',
    request: unknown,
  ) {
    this.assertScope(scope);
    const result = c.ManagedTableQrResponseSchema.parse(
      await firstValueFrom(
        this.http.post<unknown>(
          this.base + restaurantPath('table', context, id) + '/qr/' + operation,
          c.ManageTableQrRequestSchema.parse(request),
        ),
      ),
    );
    this.assertScope(scope);
    return result;
  }
}
