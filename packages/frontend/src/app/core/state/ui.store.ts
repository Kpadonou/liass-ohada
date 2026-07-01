import { OverlayContainer } from '@angular/cdk/overlay';
import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';

export type AppPage =
  | 'dashboard'
  | 'cabinet.dashboard'
  | 'cabinet.dossiers'
  | 'cabinet.collaborators'
  | 'cabinet.missions'
  | 'cabinet.deadlines'
  | 'cabinet.settings'
  | 'accounting.overview'
  | 'accounting.fiscalYear'
  | 'accounting.generalLedger'
  | 'accounting.auxiliaryLedger'
  | 'accounting.auxiliaryBalance'
  | 'accounting.journalBook'
  | 'accounting.journals'
  | 'accounting.thirdParties'
  | 'accounting.entries'
  | 'accounting.lettering'
  | 'accounting.trialBalance'
  | 'accounting.chartOfAccounts'
  | 'projects'
  | 'treasury'
  | 'reports'
  | 'administration';
export type ThemeMode = 'light' | 'dark';

interface UiState {
  currentPage: AppPage;
  sidebarCollapsed: boolean;
  sidebarOpen: boolean;
  themeMode: ThemeMode;
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'liass-ohada.sidebarCollapsed';
const THEME_STORAGE_KEY = 'liass-ohada.themeMode';

function readStoredSidebarCollapsed(): boolean {
  if (typeof localStorage === 'undefined') {
    return false;
  }

  return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
}

function persistSidebarCollapsed(sidebarCollapsed: boolean): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed));
  }
}

function readStoredThemeMode(): ThemeMode {
  if (typeof localStorage === 'undefined') {
    return 'light';
  }

  return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
}

function persistThemeMode(themeMode: ThemeMode): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }
}

function applyThemeClass(themeMode: ThemeMode, overlayElement?: HTMLElement): void {
  if (typeof document === 'undefined') {
    return;
  }

  const dark = themeMode === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = themeMode;
  overlayElement?.classList.toggle('dark', dark);
}

const initialState: UiState = {
  currentPage: 'dashboard',
  sidebarCollapsed: readStoredSidebarCollapsed(),
  sidebarOpen: false,
  themeMode: readStoredThemeMode()
};

export const UiStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store) => {
    const overlayElement = inject(OverlayContainer).getContainerElement();

    return {
      applyTheme(): void {
        applyThemeClass(store.themeMode(), overlayElement);
      },
      closeSidebar(): void {
        patchState(store, { sidebarOpen: false });
      },
      setCurrentPage(currentPage: AppPage): void {
        patchState(store, { currentPage });
      },
      setSidebarCollapsed(sidebarCollapsed: boolean): void {
        persistSidebarCollapsed(sidebarCollapsed);
        patchState(store, { sidebarCollapsed });
      },
      setThemeMode(themeMode: ThemeMode): void {
        persistThemeMode(themeMode);
        applyThemeClass(themeMode, overlayElement);
        patchState(store, { themeMode });
      },
      toggleThemeMode(): void {
        const themeMode: ThemeMode = store.themeMode() === 'dark' ? 'light' : 'dark';
        persistThemeMode(themeMode);
        applyThemeClass(themeMode, overlayElement);
        patchState(store, { themeMode });
      },
      toggleSidebar(): void {
        patchState(store, ({ sidebarOpen }) => ({ sidebarOpen: !sidebarOpen }));
      },
      toggleSidebarCollapsed(): void {
        const sidebarCollapsed = !store.sidebarCollapsed();
        persistSidebarCollapsed(sidebarCollapsed);
        patchState(store, { sidebarCollapsed });
      }
    };
  })
);
