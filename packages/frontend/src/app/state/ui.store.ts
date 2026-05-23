import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';

export type AppSection = 'ledger' | 'projects' | 'treasury' | 'reports';

interface UiState {
  selectedSection: AppSection;
  sidebarOpen: boolean;
}

const initialState: UiState = {
  selectedSection: 'ledger',
  sidebarOpen: true
};

export const UiStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store) => ({
    selectSection(selectedSection: AppSection): void {
      patchState(store, { selectedSection });
    },
    toggleSidebar(): void {
      patchState(store, ({ sidebarOpen }) => ({ sidebarOpen: !sidebarOpen }));
    }
  }))
);
