import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { type FiscalYearDetailsDto, type FiscalYearDto } from '@liass-ohada/shared/accounting';

import { AuthStore } from '../../identity/data-access/auth.store';

interface FiscalYearContextState {
  activeYear: number | null;
  fiscalYears: FiscalYearDto[];
}

const STORAGE_PREFIX = 'liass-ohada.accounting.fiscalYearContext';

@Injectable({ providedIn: 'root' })
export class AccountingFiscalYearContextService {
  private readonly authStore = inject(AuthStore);
  private readonly state = signal<FiscalYearContextState>({
    activeYear: null,
    fiscalYears: []
  });
  private lastScope: string | null = null;

  readonly tenantScope = computed(() => {
    if (this.authStore.activeWorkspaceType() === 'ACCOUNTING_FIRM') {
      return this.authStore.activeDossierOrgId() || null;
    }

    return this.authStore.activeWorkspaceOrgId();
  });
  readonly activeFiscalYear = computed(() => {
    const activeYear = this.state().activeYear;

    return activeYear
      ? (this.state().fiscalYears.find((fiscalYear) => fiscalYear.year === activeYear) ?? null)
      : null;
  });
  readonly activeYear = computed(() => this.state().activeYear);
  readonly fiscalYears = computed(() =>
    [...this.state().fiscalYears].sort((left, right) => right.year - left.year)
  );
  readonly hasActiveFiscalYear = computed(() => !!this.activeFiscalYear());

  constructor() {
    effect(() => {
      const scope = this.tenantScope();

      if (scope === this.lastScope) {
        return;
      }

      this.lastScope = scope;
      this.state.set(scope ? this.readState(scope) : { activeYear: null, fiscalYears: [] });
      untracked(() => this.autoSelectSingleOpenFiscalYear());
    });
  }

  rememberFiscalYear(fiscalYear: FiscalYearDto | FiscalYearDetailsDto): void {
    const scope = this.tenantScope();

    if (!scope) {
      return;
    }

    this.state.update((state) => {
      const fiscalYears = upsertFiscalYear(state.fiscalYears, fiscalYear);
      const nextState = {
        activeYear: state.activeYear,
        fiscalYears
      };

      this.writeState(scope, nextState);
      return nextState;
    });
    this.autoSelectSingleOpenFiscalYear();
  }

  selectFiscalYear(fiscalYear: FiscalYearDto | FiscalYearDetailsDto): void {
    const scope = this.tenantScope();

    if (!scope) {
      return;
    }

    const fiscalYears = upsertFiscalYear(this.state().fiscalYears, fiscalYear);
    const nextState = {
      activeYear: fiscalYear.year,
      fiscalYears
    };

    this.state.set(nextState);
    this.writeState(scope, nextState);
  }

  clearActiveFiscalYear(): void {
    const scope = this.tenantScope();
    const nextState = {
      ...this.state(),
      activeYear: null
    };

    this.state.set(nextState);
    if (scope) {
      this.writeState(scope, nextState);
    }
  }

  private autoSelectSingleOpenFiscalYear(): void {
    const scope = this.tenantScope();
    const state = this.state();

    if (!scope || state.activeYear) {
      return;
    }

    const openFiscalYears = state.fiscalYears.filter((fiscalYear) => fiscalYear.status === 'OPEN');

    if (openFiscalYears.length !== 1) {
      return;
    }

    const nextState = {
      ...state,
      activeYear: openFiscalYears[0].year
    };

    this.state.set(nextState);
    this.writeState(scope, nextState);
  }

  private readState(scope: string): FiscalYearContextState {
    if (typeof localStorage === 'undefined') {
      return { activeYear: null, fiscalYears: [] };
    }

    try {
      const parsed = JSON.parse(localStorage.getItem(this.storageKey(scope)) || '{}') as Partial<FiscalYearContextState>;
      const fiscalYears = Array.isArray(parsed.fiscalYears) ? parsed.fiscalYears : [];
      const activeYear =
        typeof parsed.activeYear === 'number' &&
        fiscalYears.some((fiscalYear) => fiscalYear.year === parsed.activeYear)
          ? parsed.activeYear
          : null;

      return { activeYear, fiscalYears };
    } catch {
      return { activeYear: null, fiscalYears: [] };
    }
  }

  private writeState(scope: string, state: FiscalYearContextState): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    localStorage.setItem(this.storageKey(scope), JSON.stringify(state));
  }

  private storageKey(scope: string): string {
    return `${STORAGE_PREFIX}.${scope}`;
  }
}

function upsertFiscalYear(fiscalYears: FiscalYearDto[], fiscalYear: FiscalYearDto): FiscalYearDto[] {
  const fiscalYearsByYear = new Map<number, FiscalYearDto>();

  for (const candidate of fiscalYears) {
    fiscalYearsByYear.set(candidate.year, candidate);
  }

  fiscalYearsByYear.set(fiscalYear.year, fiscalYear);

  return [...fiscalYearsByYear.values()];
}
