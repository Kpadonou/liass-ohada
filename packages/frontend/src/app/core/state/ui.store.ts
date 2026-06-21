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
  | 'accounting.journalBook'
  | 'accounting.journals'
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
  sidebarOpen: boolean;
  themeMode: ThemeMode;
}

const THEME_STORAGE_KEY = 'liass-ohada.themeMode';

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
      }
    };
  })
);
