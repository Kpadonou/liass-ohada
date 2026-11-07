import { Component, effect, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import type { OrganizationFiscalConnection } from '@liass-ohada/shared/shared';
import { SubmitFiscalCredentialSchema } from '@liass-ohada/shared/shared';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { FiscalityApi, FiscalityContext } from '../../data-access/fiscality.api';
import {
  safeMessageFromError,
  userMessageFromResponse,
} from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';

export interface FiscalConnectionDialogData {
  context: FiscalityContext;
  environment: 'TEST' | 'PRODUCTION';
  kind: 'CONFIGURE' | 'STORE_CREDENTIAL';
  connection?: OrganizationFiscalConnection;
}
@Component({
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    TranslocoModule,
    LiassButtonComponent,
  ],
  template: ` <h2 mat-dialog-title>
      {{
        (data.kind === 'CONFIGURE' ? 'FISCALITY.CONFIGURE' : 'FISCALITY.TOKEN_ACTION') | transloco
      }}
    </h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content>
        <p class="mb-4 text-sm text-app-text-secondary">
          {{ 'FISCALITY.ENV.' + data.environment | transloco }}
        </p>
        @if (data.kind === 'CONFIGURE') {
          <div class="grid gap-4">
            <mat-form-field appearance="outline"
              ><mat-label>{{ 'FISCALITY.LABEL' | transloco }}</mat-label>
              <input matInput formControlName="label" required maxlength="160" />
              @if (form.controls.label.touched && form.controls.label.invalid) {
                <mat-error>{{ 'FISCALITY.REQUIRED' | transloco }}</mat-error>
              }
            </mat-form-field>
            <mat-form-field appearance="outline"
              ><mat-label>{{ 'FISCALITY.IFU' | transloco }}</mat-label
              ><input matInput formControlName="taxpayerIfu" maxlength="100"
            /></mat-form-field>
            <mat-form-field appearance="outline"
              ><mat-label>{{ 'FISCALITY.NIM' | transloco }}</mat-label
              ><input matInput formControlName="nim" maxlength="100"
            /></mat-form-field>
          </div>
          <p class="text-sm text-app-text-secondary">{{ 'FISCALITY.IDENTITY_HELP' | transloco }}</p>
        } @else {
          <mat-form-field appearance="outline" class="w-full"
            ><mat-label>{{ 'FISCALITY.TOKEN' | transloco }}</mat-label>
            <input
              matInput
              type="password"
              formControlName="token"
              autocomplete="new-password"
              spellcheck="false"
              required
            />
            <mat-hint>{{ 'FISCALITY.TOKEN_HELP' | transloco }}</mat-hint>
            @if (form.controls.token.touched && form.controls.token.invalid) {
              <mat-error>{{ 'FISCALITY.TOKEN_INVALID' | transloco }}</mat-error>
            }
          </mat-form-field>
          <p class="mt-4 text-sm text-app-text-secondary">
            {{ 'FISCALITY.TOKEN_LIMIT' | transloco }}
          </p>
        }
        @if (error()) {
          <p class="mt-4 text-sm text-danger-600" role="alert">{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <liass-button [disabled]="busy()" (pressed)="close()">{{
          'FISCALITY.CANCEL' | transloco
        }}</liass-button>
        <liass-button buttonType="submit" tone="brand" variant="solid" [loading]="busy()">{{
          'FISCALITY.SAVE' | transloco
        }}</liass-button>
      </mat-dialog-actions>
    </form>`,
})
export class FiscalConnectionDialogComponent {
  readonly data = inject<FiscalConnectionDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(FiscalityApi);
  private readonly ref = inject(MatDialogRef<FiscalConnectionDialogComponent>);
  private readonly notification = inject(NotificationService);
  private readonly transloco = inject(TranslocoService);
  readonly busy = signal(false);
  readonly error = signal('');
  private readonly commandId = crypto.randomUUID();
  private readonly connectionId = this.data.connection?.connectionId ?? crypto.randomUUID();
  readonly form = new FormGroup({
    label: new FormControl(this.data.connection?.label ?? '', {
      nonNullable: true,
      validators:
        this.data.kind === 'CONFIGURE' ? [Validators.required, Validators.maxLength(160)] : [],
    }),
    taxpayerIfu: new FormControl(this.data.connection?.taxpayerIfu ?? '', {
      nonNullable: true,
      validators: [Validators.maxLength(100)],
    }),
    nim: new FormControl(this.data.connection?.nim ?? '', {
      nonNullable: true,
      validators: [Validators.maxLength(100)],
    }),
    token: new FormControl('', {
      nonNullable: true,
      validators: this.data.kind === 'STORE_CREDENTIAL' ? [Validators.required] : [],
    }),
  });
  constructor() {
    effect(() => {
      if (!this.api.current(this.data.context)) {
        this.form.reset();
        this.ref.close();
      }
    });
  }
  close() {
    this.form.reset();
    this.ref.close();
  }
  async submit() {
    if (this.busy() || !this.api.current(this.data.context)) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const common = {
      environment: this.data.environment,
      connectionId: this.connectionId,
      commandId: this.commandId,
      expectedVersion: this.data.connection?.version ?? 0,
    };
    let request: unknown;
    if (this.data.kind === 'STORE_CREDENTIAL') {
      const parsed = SubmitFiscalCredentialSchema.safeParse({
        ...common,
        token: this.form.controls.token.value,
      });
      if (!parsed.success) {
        this.form.controls.token.setErrors({ format: true });
        return;
      }
      request = parsed.data;
      this.form.controls.token.reset('');
    } else {
      const value = this.form.getRawValue();
      request = {
        ...common,
        label: value.label.trim(),
        ...(value.taxpayerIfu.trim() ? { taxpayerIfu: value.taxpayerIfu.trim() } : {}),
        ...(value.nim.trim() ? { nim: value.nim.trim() } : {}),
      };
    }
    this.busy.set(true);
    this.error.set('');
    this.ref.disableClose = true;
    try {
      const response = await this.api.change(this.data.context, this.data.kind, request);
      if (this.api.current(this.data.context)) {
        this.notification.success(
          userMessageFromResponse(response) ?? this.transloco.translate<string>('FISCALITY.SAVED'),
        );
        this.form.reset();
        this.ref.close(true);
      }
    } catch (error) {
      if (this.api.current(this.data.context)) {
        const message =
          safeMessageFromError(error) ?? this.transloco.translate<string>('FISCALITY.ERROR');
        this.error.set(message);
        this.notification.error(message);
      }
    } finally {
      request = undefined;
      this.form.controls.token.reset('');
      this.busy.set(false);
      this.ref.disableClose = false;
    }
  }
}
