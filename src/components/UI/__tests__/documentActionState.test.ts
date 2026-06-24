import { describe, expect, it } from 'vitest';
import { resolveActionBarState } from '../documentActionState';

describe('resolveActionBarState', () => {
  it('disables Print/History/Delete on a new (unsaved) document but keeps Save enabled', () => {
    const s = resolveActionBarState({ entityId: undefined, hasPrint: true, hasDelete: true, canDelete: true });
    expect(s.printEnabled).toBe(false);
    expect(s.historyEnabled).toBe(false);
    expect(s.deleteEnabled).toBe(false);
    expect(s.saveEnabled).toBe(true);
  });

  it('enables Print/History on a saved document', () => {
    const s = resolveActionBarState({ entityId: 'bill-1', hasPrint: true });
    expect(s.printEnabled).toBe(true);
    expect(s.historyEnabled).toBe(true);
  });

  it('enables Delete only when saved AND canDelete', () => {
    expect(resolveActionBarState({ entityId: 'bill-1', hasDelete: true, canDelete: true }).deleteEnabled).toBe(true);
    expect(resolveActionBarState({ entityId: 'bill-1', hasDelete: true, canDelete: false }).deleteEnabled).toBe(false);
  });

  it('hides Print/Delete/SaveDraft when their callbacks are absent', () => {
    const s = resolveActionBarState({ entityId: 'bill-1' });
    expect(s.showPrint).toBe(false);
    expect(s.showDelete).toBe(false);
    expect(s.showSaveDraft).toBe(false);
  });

  it('disables Save when canSave is false', () => {
    expect(resolveActionBarState({ entityId: 'bill-1', canSave: false }).saveEnabled).toBe(false);
  });
});
