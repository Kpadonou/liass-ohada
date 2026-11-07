import { Component, computed, effect, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import {
  QueryClient,
  injectInfiniteQuery,
  injectQuery,
} from '@tanstack/angular-query-experimental';
import type { OrganizationFiscalConnection } from '@liass-ohada/shared/shared';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassConfirmationDialogComponent } from '../../../../shared/ui/confirmation-dialog/confirmation-dialog.component';
import { FiscalityApi, fiscalityKey } from '../../data-access/fiscality.api';
import { FiscalConnectionDialogComponent } from './fiscal-connection-dialog.component';
import { NotificationService } from '../../../../core/notifications/notification.service';
import {
  safeMessageFromError,
  userMessageFromResponse,
} from '../../../../core/notifications/notification-message';

@Component({
  imports: [
    TranslocoModule,
    MatFormFieldModule,
    MatSelectModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    LiassPageHeaderComponent,
    LiassCardComponent,
    LiassButtonComponent,
    LiassStatusChipComponent,
    LiassSkeletonComponent,
  ],
  templateUrl: './fiscality.page.html',
})
export class FiscalityPage {
  private readonly api = inject(FiscalityApi);
  private readonly dialog = inject(MatDialog);
  private readonly client = inject(QueryClient);
  private readonly notification = inject(NotificationService);
  private readonly transloco = inject(TranslocoService);
  readonly environment = signal<'TEST' | 'PRODUCTION'>('TEST');
  readonly busy = signal(false);
  readonly context = computed(() => this.api.context());
  readonly approvals = injectQuery(() => {
    const context = this.context();
    return {
      queryKey: [...fiscalityKey(context, 'GLOBAL'), 'sfe'],
      queryFn: () => this.api.approval(context),
      enabled: !!context.org && !!context.user,
      staleTime: 300_000,
      retry: false,
    };
  });
  readonly settings = injectInfiniteQuery(() => {
    const context = this.context(),
      environment = this.environment();
    return {
      queryKey: fiscalityKey(context, environment),
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
        this.api.list(context, environment, pageParam),
      getNextPageParam: (last: Awaited<ReturnType<FiscalityApi['list']>>) => last.nextCursor,
      enabled: !!context.org && !!context.user,
      staleTime: 30_000,
      retry: false,
    };
  });
  readonly connections = computed(
    () => this.settings.data()?.pages.flatMap((page) => page.connections) ?? [],
  );
  readonly canManage = computed(() => this.settings.data()?.pages[0]?.canManage === true);
  readonly readiness = ['PROVIDER', 'TAXPAYER', 'SELLER', 'TIMEZONE', 'ESTABLISHMENT'] as const;
  constructor() {
    effect(() => {
      this.context();
      this.busy.set(false);
    });
  }
  configure(
    connection?: OrganizationFiscalConnection,
    kind: 'CONFIGURE' | 'STORE_CREDENTIAL' = 'CONFIGURE',
  ) {
    if (!this.canManage() || this.busy()) return;
    const context = this.context(),
      environment = this.environment();
    const ref = this.dialog.open(FiscalConnectionDialogComponent, {
      width: '520px',
      maxWidth: 'calc(100vw - 32px)',
      data: { context, environment, kind, connection },
    });
    ref.afterClosed().subscribe((saved) => {
      if (saved && this.api.current(context))
        void this.client.invalidateQueries({
          queryKey: fiscalityKey(context, environment),
          exact: true,
        });
    });
  }
  revoke(connection: OrganizationFiscalConnection) {
    if (!this.canManage() || this.busy()) return;
    const context = this.context();
    const ref = this.dialog.open(LiassConfirmationDialogComponent, {
      width: '440px',
      maxWidth: 'calc(100vw - 32px)',
      data: {
        titleKey: 'FISCALITY.REVOKE',
        descriptionKey: 'FISCALITY.REVOKE_HELP',
        confirmKey: 'FISCALITY.REVOKE',
        cancelKey: 'FISCALITY.CANCEL',
        tone: 'danger',
      },
    });
    ref.afterClosed().subscribe(async (confirmed) => {
      if (!confirmed || !this.api.current(context)) return;
      this.busy.set(true);
      try {
        const result = await this.api.change(context, 'REVOKE_CREDENTIAL', {
          connectionId: connection.connectionId,
          environment: connection.environment,
          expectedVersion: connection.version,
          commandId: crypto.randomUUID(),
        });
        if (this.api.current(context)) {
          this.notification.success(
            userMessageFromResponse(result) ?? this.transloco.translate<string>('FISCALITY.SAVED'),
          );
          await this.client.invalidateQueries({
            queryKey: fiscalityKey(context, connection.environment),
            exact: true,
          });
        }
      } catch (error) {
        if (this.api.current(context))
          this.notification.error(
            safeMessageFromError(error) ?? this.transloco.translate<string>('FISCALITY.ERROR'),
          );
      } finally {
        if (this.api.current(context)) this.busy.set(false);
      }
    });
  }
}
