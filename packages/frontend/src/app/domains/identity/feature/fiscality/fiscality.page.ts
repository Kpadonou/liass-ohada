import { Component, computed, effect, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
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
import { FiscalVerificationDialogComponent } from './fiscal-verification-dialog.component';
import { fiscalVerificationDate } from './fiscal-verification.presentation';
import { NotificationService } from '../../../../core/notifications/notification.service';
import {
  safeMessageFromError,
  userMessageFromResponse,
} from '../../../../core/notifications/notification-message';
import { environment as deploymentEnvironment } from '../../../../../environments/environment';

@Component({
  imports: [
    NgTemplateOutlet,
    TranslocoModule,
    MatExpansionModule,
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
  readonly environment = signal<'TEST' | 'PRODUCTION'>(deploymentEnvironment.fiscalEnvironment);
  readonly busy = signal(false);
  readonly verifying = signal<string | null>(null);
  private readonly verificationCommands = new Map<string, { commandId: string; version: number }>();
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
  readonly readiness = ['TIMEZONE', 'ESTABLISHMENT'] as const;
  constructor() {
    effect(() => {
      this.context();
      this.busy.set(false);
      this.verifying.set(null);
      this.verificationCommands.clear();
    });
  }
  verificationDetails(connection: OrganizationFiscalConnection) {
    this.dialog.open(FiscalVerificationDialogComponent, {
      width: '620px',
      maxWidth: 'calc(100vw - 32px)',
      data: connection,
    });
  }
  verificationDate(value?: string) {
    return fiscalVerificationDate(value, this.transloco.getActiveLang());
  }
  referenceContact(contact: { name: string; email: string; phone: string }) {
    return `${contact.name} · ${contact.email} · ${contact.phone}`;
  }
  async copyReference(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      this.notification.success(this.transloco.translate<string>('FISCALITY.GUIDE.COPIED'));
    } catch {
      this.notification.error(this.transloco.translate<string>('FISCALITY.GUIDE.COPY_ERROR'));
    }
  }
  async verify(connection: OrganizationFiscalConnection) {
    if (
      !this.canManage() ||
      this.busy() ||
      this.verifying() ||
      connection.environment !== 'TEST' ||
      connection.credentialStatus !== 'STORED_UNVERIFIED'
    )
      return;
    const context = this.context(),
      environment = connection.environment;
    const previous = this.verificationCommands.get(connection.connectionId);
    const command =
      previous?.version === connection.version
        ? previous
        : { commandId: crypto.randomUUID(), version: connection.version };
    this.verificationCommands.set(connection.connectionId, command);
    this.verifying.set(connection.connectionId);
    this.busy.set(true);
    try {
      const response = await this.api.verify(context, {
        environment,
        connectionId: connection.connectionId,
        expectedVersion: connection.version,
        commandId: command.commandId,
      });
      if (this.api.current(context)) {
        if (!response.data.inProgress) this.verificationCommands.delete(connection.connectionId);
        const message =
          userMessageFromResponse(response) ??
          this.transloco.translate<string>('FISCALITY.VERIFICATION.STATUS.' + response.data.status);
        if (response.data.status === 'VERIFIED_TEST') this.notification.success(message);
        else this.notification.info(message);
        await this.client.invalidateQueries({
          queryKey: fiscalityKey(context, environment),
          exact: true,
        });
      }
    } catch (error) {
      if (this.api.current(context))
        this.notification.error(
          safeMessageFromError(error) ?? this.transloco.translate<string>('FISCALITY.ERROR'),
        );
    } finally {
      if (this.api.current(context)) {
        this.verifying.set(null);
        this.busy.set(false);
      }
    }
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
