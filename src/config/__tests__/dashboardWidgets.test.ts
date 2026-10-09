import { describe, expect, it } from 'vitest';
import { addIntroducedWidgets } from '../dashboardWidgets';

describe('introducing dashboard widgets to saved layouts', () => {
    it('puts the financial overview widgets first in layouts saved before them', () => {
        expect(addIntroducedWidgets({ u1: ['cash_on_hand', 'customer_sales'] }, 9)).toEqual({
            u1: ['monthly_sales', 'yearly_profit_loss', 'cash_on_hand', 'customer_sales'],
        });
    });
    it('leaves layouts saved after the widgets existed, so removed widgets stay removed', () => {
        const config = { u1: ['cash_on_hand'] };
        expect(addIntroducedWidgets(config, 10)).toBe(config);
    });
    it('keeps users without a saved layout on the defaults', () => {
        expect(addIntroducedWidgets({}, 9)).toEqual({});
    });
});
