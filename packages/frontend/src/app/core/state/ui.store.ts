import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';

export type AppSection = 'ledger' | 'projects' | 'treasury' | 'reports';
export type ThemeMode = 'light' | 'dark';

interface UiState {
  selectedSection: AppSection;
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

function applyThemeClass(themeMode: ThemeMode): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.classList.toggle('dark', themeMode === 'dark');
}

const initialState: UiState = {
  selectedSection: 'ledger',
  sidebarOpen: false,
  themeMode: readStoredThemeMode()
};

export const UiStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store) => ({
    applyTheme(): void {
      applyThemeClass(store.themeMode());
    },
    closeSidebar(): void {
      patchState(store, { sidebarOpen: false });
    },
    selectSection(selectedSection: AppSection): void {
      patchState(store, { selectedSection });
    },
    setThemeMode(themeMode: ThemeMode): void {
      persistThemeMode(themeMode);
      applyThemeClass(themeMode);
      patchState(store, { themeMode });
    },
    toggleThemeMode(): void {
      const themeMode: ThemeMode = store.themeMode() === 'dark' ? 'light' : 'dark';
      persistThemeMode(themeMode);
      applyThemeClass(themeMode);
      patchState(store, { themeMode });
    },
    toggleSidebar(): void {
      patchState(store, ({ sidebarOpen }) => ({ sidebarOpen: !sidebarOpen }));
    }
  }))
);
