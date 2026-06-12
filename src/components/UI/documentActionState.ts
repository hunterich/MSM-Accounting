/**
 * Pure resolver for which DocumentActionBar actions are shown/enabled.
 * Kept separate from the React component so it can be unit-tested without a DOM.
 */
export interface ActionBarInput {
  /** undefined while the document is new/unsaved. */
  entityId?: string;
  /** false disables Save (e.g. no edit permission). Defaults to enabled. */
  canSave?: boolean;
  /** whether the document is in a deletable state (e.g. DRAFT). */
  canDelete?: boolean;
  hasPrint?: boolean;
  hasSaveDraft?: boolean;
  hasDelete?: boolean;
}

export interface ActionBarState {
  showPrint: boolean;
  printEnabled: boolean;
  historyEnabled: boolean;
  showDelete: boolean;
  deleteEnabled: boolean;
  showSaveDraft: boolean;
  saveEnabled: boolean;
}

export function resolveActionBarState(input: ActionBarInput): ActionBarState {
  const hasDoc = Boolean(input.entityId);
  return {
    showPrint: Boolean(input.hasPrint),
    printEnabled: hasDoc,
    historyEnabled: hasDoc,
    showDelete: Boolean(input.hasDelete),
    deleteEnabled: hasDoc && Boolean(input.canDelete),
    showSaveDraft: Boolean(input.hasSaveDraft),
    saveEnabled: input.canSave !== false,
  };
}
