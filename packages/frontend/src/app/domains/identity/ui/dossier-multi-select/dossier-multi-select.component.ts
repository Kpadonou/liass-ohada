import { Component, EventEmitter, Output, computed, inject, input, signal } from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { CabinetDossierSummary } from '@liass-ohada/shared/shared';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';

import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';

@Component({
  selector: 'liass-dossier-multi-select',
  host: {
    class: 'block',
  },
  imports: [
    LiassStatusChipComponent,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    TranslocoModule,
  ],
  templateUrl: './dossier-multi-select.component.html',
})
export class DossierMultiSelectComponent {
  readonly disabled = input(false);
  readonly disabledIds = input<ReadonlySet<string>>(new Set());
  readonly dossiers = input<readonly CabinetDossierSummary[]>([]);
  readonly emptyKey = input('IDENTITY.CABINET_TEAM.DOSSIER_SELECTOR.EMPTY');
  readonly errorKey = input<string | null>(null);
  readonly labelKey = input('IDENTITY.CABINET_TEAM.DOSSIER_SELECTOR.LABEL');
  readonly loading = input(false);
  readonly loadingKey = input('IDENTITY.CABINET_TEAM.DOSSIER_SELECTOR.LOADING');
  readonly maxSelected = input<number | null>(null);
  readonly searchKey = input('IDENTITY.CABINET_TEAM.DOSSIER_SELECTOR.SEARCH');
  readonly selectedIds = input<ReadonlySet<string>>(new Set());
  readonly showStatus = input(false);

  @Output() readonly selectedIdsChange = new EventEmitter<Set<string>>();

  protected readonly searchQuery = signal('');
  private readonly transloco = inject(TranslocoService);

  protected readonly selectedCount = computed(() => this.selectedIds().size);
  protected readonly countLabel = computed(() => {
    const maxSelected = this.maxSelected();
    return this.transloco.translate(
      maxSelected === null
        ? 'IDENTITY.CABINET_TEAM.DOSSIER_SELECTOR.COUNT'
        : 'IDENTITY.CABINET_TEAM.DOSSIER_SELECTOR.COUNT_WITH_MAX',
      {
        count: this.selectedCount(),
        max: maxSelected,
      },
    );
  });
  protected readonly limitReached = computed(() => {
    const maxSelected = this.maxSelected();
    return maxSelected !== null && this.selectedCount() >= maxSelected;
  });
  protected readonly filteredDossiers = computed(() => {
    const query = normalizeSearch(this.searchQuery());
    const dossiers = this.dossiers();

    if (!query) {
      return dossiers;
    }

    return dossiers.filter((dossier) => normalizeSearch(this.searchableText(dossier)).includes(query));
  });
  protected readonly showMaxSelectedHint = computed(() => this.limitReached() && !this.disabled());

  protected updateSearch(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  protected isSelected(dossier: CabinetDossierSummary): boolean {
    return this.selectedIds().has(dossier.orgId);
  }

  protected isItemDisabled(dossier: CabinetDossierSummary): boolean {
    return (
      this.disabled() ||
      this.disabledIds().has(dossier.orgId) ||
      (this.limitReached() && !this.isSelected(dossier))
    );
  }

  protected rowClass(dossier: CabinetDossierSummary): string {
    const base = 'rounded-app-control border px-3 py-2 transition-colors';
    return this.isSelected(dossier)
      ? `${base} border-brand-200 bg-brand-50 dark:border-brand-900 dark:bg-brand-950`
      : `${base} border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900`;
  }

  protected toggleDossier(dossier: CabinetDossierSummary, checked: boolean): void {
    if (this.disabled() || this.disabledIds().has(dossier.orgId)) {
      return;
    }

    const next = new Set(this.selectedIds());
    if (checked) {
      if (!next.has(dossier.orgId) && this.limitReached()) {
        return;
      }
      next.add(dossier.orgId);
    } else {
      next.delete(dossier.orgId);
    }
    this.selectedIdsChange.emit(next);
  }

  protected countryLabelKey(dossier: CabinetDossierSummary): string {
    return `IDENTITY.ONBOARDING.COUNTRIES.${countryTranslationCode(dossier.country)}`;
  }

  protected frameworkLabelKey(dossier: CabinetDossierSummary): string {
    return `IDENTITY.ONBOARDING.FRAMEWORKS.${dossier.accountingFramework}`;
  }

  protected statusLabelKey(dossier: CabinetDossierSummary): string {
    return `IDENTITY.CABINET_DOSSIERS.STATUS.${dossier.status}`;
  }

  private searchableText(dossier: CabinetDossierSummary): string {
    return [
      dossier.displayName,
      dossier.country,
      dossier.accountingFramework,
      dossier.status,
      this.transloco.translate(this.countryLabelKey(dossier)),
      this.transloco.translate(this.frameworkLabelKey(dossier)),
      this.transloco.translate(this.statusLabelKey(dossier)),
    ].join(' ');
  }
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function countryTranslationCode(country: string): string {
  const countryCodes: Record<string, string> = {
    BF: 'BURKINA_FASO',
    BJ: 'BENIN',
    CD: 'DEMOCRATIC_REPUBLIC_OF_CONGO',
    CF: 'CENTRAL_AFRICAN_REPUBLIC',
    CG: 'CONGO',
    CI: 'COTE_D_IVOIRE',
    CM: 'CAMEROON',
    GA: 'GABON',
    GN: 'GUINEA',
    GQ: 'EQUATORIAL_GUINEA',
    GW: 'GUINEA_BISSAU',
    KM: 'COMOROS',
    ML: 'MALI',
    NE: 'NIGER',
    SN: 'SENEGAL',
    TD: 'CHAD',
    TG: 'TOGO',
  };

  return countryCodes[country] ?? country;
}
