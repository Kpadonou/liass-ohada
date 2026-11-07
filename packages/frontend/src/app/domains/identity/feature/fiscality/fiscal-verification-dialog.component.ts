import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import type { OrganizationFiscalConnection } from '@liass-ohada/shared/shared';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { fiscalVerificationDate } from './fiscal-verification.presentation';

@Component({
  imports: [MatDialogModule, TranslocoModule, LiassButtonComponent, LiassStatusChipComponent],
  template: ` <h2 mat-dialog-title>{{ 'FISCALITY.VERIFICATION.DETAIL' | transloco }}</h2>
    <mat-dialog-content>
      <p class="mb-4 break-words text-sm font-semibold">
        {{ connection.label }} · {{ 'FISCALITY.ENV.' + connection.environment | transloco }}
      </p>
      @if (connection.verification?.latestAttempt; as result) {
        <liass-status-chip
          [label]="'FISCALITY.VERIFICATION.STATUS.' + result.status | transloco"
          tone="info"
        />
        <dl class="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-app-text-secondary">{{ 'FISCALITY.VERIFICATION.DATE' | transloco }}</dt>
            <dd>{{ date(result.completedAt ?? result.startedAt) }}</dd>
          </div>
          <div>
            <dt class="text-app-text-secondary">
              {{ 'FISCALITY.VERIFICATION.EXPIRY' | transloco }}
            </dt>
            <dd>{{ date(result.tokenValidUntil) }}</dd>
          </div>
          <div>
            <dt class="text-app-text-secondary">
              {{ 'FISCALITY.VERIFICATION.CURRENT' | transloco }}
            </dt>
            <dd>
              {{
                (result.applicable ? 'FISCALITY.VERIFICATION.YES' : 'FISCALITY.VERIFICATION.NO')
                  | transloco
              }}
            </dd>
          </div>
          <div>
            <dt class="text-app-text-secondary">{{ 'FISCALITY.CHECK.PROVIDER' | transloco }}</dt>
            <dd>
              {{
                (result.checks.technicallyVerified
                  ? 'FISCALITY.VERIFICATION.YES'
                  : 'FISCALITY.UNVERIFIED'
                ) | transloco
              }}
            </dd>
          </div>
          <div>
            <dt class="text-app-text-secondary">{{ 'FISCALITY.CHECK.TAXPAYER' | transloco }}</dt>
            <dd>
              {{
                'FISCALITY.VERIFICATION.CORRESPONDENCE.' + result.checks.ifuConsistency | transloco
              }}
            </dd>
          </div>
          <div>
            <dt class="text-app-text-secondary">{{ 'FISCALITY.NIM' | transloco }}</dt>
            <dd>
              {{
                'FISCALITY.VERIFICATION.CORRESPONDENCE.' + result.checks.nimCorrespondence
                  | transloco
              }}
            </dd>
          </div>
          <div>
            <dt class="text-app-text-secondary">{{ 'FISCALITY.CHECK.SELLER' | transloco }}</dt>
            <dd>
              {{
                (result.checks.legalSellerAuthority === 'APPROVED'
                  ? 'FISCALITY.VERIFICATION.APPROVED'
                  : 'FISCALITY.UNVERIFIED'
                ) | transloco
              }}
            </dd>
          </div>
          <div>
            <dt class="text-app-text-secondary">{{ 'FISCALITY.SFE' | transloco }}</dt>
            <dd>
              {{
                (result.checks.sfeApprovalReferences === 'AVAILABLE'
                  ? 'FISCALITY.VERIFICATION.AVAILABLE'
                  : 'FISCALITY.SFE_PENDING'
                ) | transloco
              }}
            </dd>
          </div>
        </dl>
        @if (connection.verification?.lastVerified; as previous) {
          <p class="mt-4 text-sm text-app-text-secondary">
            {{ 'FISCALITY.VERIFICATION.LAST_SUCCESS' | transloco }} :
            {{ date(previous.completedAt) }}
          </p>
        }
      }
      <p class="mt-4 text-sm text-app-text-secondary">
        {{ 'FISCALITY.VERIFICATION.SAFETY' | transloco }}
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end"
      ><liass-button mat-dialog-close>{{
        'FISCALITY.VERIFICATION.CLOSE' | transloco
      }}</liass-button></mat-dialog-actions
    >`,
})
export class FiscalVerificationDialogComponent {
  readonly connection = inject<OrganizationFiscalConnection>(MAT_DIALOG_DATA);
  private readonly transloco = inject(TranslocoService);
  date(value?: string) {
    if (!value) return this.transloco.translate<string>('FISCALITY.UNVERIFIED');
    return fiscalVerificationDate(value, this.transloco.getActiveLang());
  }
}
