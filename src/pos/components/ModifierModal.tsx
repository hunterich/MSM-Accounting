import React, { useMemo, useState } from 'react';
import Modal from '@/src/components/UI/Modal';
import Button from '@/src/components/UI/Button';
import type { SelectedModifier } from '@/lib/pos/pricing';
import type { CatalogItem, ModifierGroupView, ModifierOptionView } from '../state/cart';
import { requiredGroupsSatisfied } from '../state/cart';
import { t } from '../i18n/strings';

/** Format a tax-inclusive price delta with an explicit sign, e.g. `+5.000` / `-2.000`. */
function formatDelta(n: number): string {
  return `${n < 0 ? '-' : '+'}${Math.abs(n).toLocaleString('id-ID')}`;
}

function toSelected(group: ModifierGroupView, option: ModifierOptionView): SelectedModifier {
  return {
    groupId: group.id,
    groupName: group.name,
    optionId: option.id,
    optionName: option.name,
    priceDelta: option.priceDelta,
    itemId: option.itemId ?? null,
  };
}

function OptionRow({ group, option, checked, onToggle }: {
  group: ModifierGroupView;
  option: ModifierOptionView;
  checked: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const single = group.selectionType === 'SINGLE';
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-neutral-200 px-3 py-2.5 hover:bg-neutral-50">
      <span className="flex min-w-0 items-center gap-2.5">
        <input
          type={single ? 'radio' : 'checkbox'}
          name={group.id}
          checked={checked}
          onChange={onToggle}
          className="h-4 w-4 shrink-0"
        />
        <span className="truncate text-sm text-neutral-800">{option.name}</span>
      </span>
      {option.priceDelta !== 0 && (
        <span className="shrink-0 text-sm tabular-nums text-neutral-500">{formatDelta(option.priceDelta)}</span>
      )}
    </label>
  );
}

export default function ModifierModal({ item, groups, onConfirm, onCancel }: {
  item: CatalogItem;
  groups: ModifierGroupView[];
  onConfirm: (mods: SelectedModifier[]) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [selected, setSelected] = useState<SelectedModifier[]>([]);

  // Only show active groups/options, in their configured order.
  const visibleGroups = useMemo(
    () => groups
      .filter((g) => g.isActive)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((g) => ({ ...g, options: g.options.filter((o) => o.isActive).slice().sort((a, b) => a.sortOrder - b.sortOrder) })),
    [groups],
  );

  function toggle(group: ModifierGroupView, option: ModifierOptionView) {
    setSelected((prev) => {
      const isChosen = prev.some((m) => m.optionId === option.id);
      if (group.selectionType === 'SINGLE') {
        // Replace any existing selection within this group.
        const withoutGroup = prev.filter((m) => m.groupId !== group.id);
        return isChosen ? withoutGroup : [...withoutGroup, toSelected(group, option)];
      }
      // MULTI: toggle this option.
      return isChosen ? prev.filter((m) => m.optionId !== option.id) : [...prev, toSelected(group, option)];
    });
  }

  const canConfirm = requiredGroupsSatisfied(visibleGroups, selected);

  return (
    <Modal isOpen onClose={onCancel} title={item.name} size="sm">
      <div className="space-y-5">
        {visibleGroups.map((group) => (
          <div key={group.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-neutral-800">{group.name}</span>
              {group.isRequired && (
                <span className="rounded bg-danger-50 px-1.5 py-0.5 text-[11px] font-medium text-danger-700">
                  {t('modifiers.required')}
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {group.options.map((option) => (
                <OptionRow
                  key={option.id}
                  group={group}
                  option={option}
                  checked={selected.some((m) => m.optionId === option.id)}
                  onToggle={() => toggle(group, option)}
                />
              ))}
            </div>
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <Button variant="secondary" className="flex-1" text={t('common.cancel')} onClick={onCancel} />
          <Button variant="primary" className="flex-1" disabled={!canConfirm} text={t('modifiers.add')} onClick={() => onConfirm(selected)} />
        </div>
      </div>
    </Modal>
  );
}
