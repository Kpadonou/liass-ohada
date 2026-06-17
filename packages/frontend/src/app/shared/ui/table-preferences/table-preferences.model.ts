export interface LiassTableColumnPreference {
  readonly id: string;
  readonly labelKey: string;
  readonly required?: boolean;
  readonly defaultVisible?: boolean;
}

export interface LiassTablePreferences {
  readonly visibleColumnIds: string[];
}

export interface LiassTablePreferencesDialogData {
  readonly tableId: string;
  readonly columns: LiassTableColumnPreference[];
  readonly visibleColumnIds: string[];
}

export interface LiassTablePreferencesDialogResult {
  readonly visibleColumnIds: string[];
}
