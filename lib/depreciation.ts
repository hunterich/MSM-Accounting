/**
 * Asset depreciation calculation utilities.
 */

export function calculateMonthlyDepreciation(
  method: 'STRAIGHT_LINE' | 'DECLINING_BALANCE' | 'DOUBLE_DECLINING',
  acquisitionCost: number,
  salvageValue: number,
  usefulLifeMonths: number,
  accumulatedDepreciation: number,
  _monthsElapsed: number,
): number {
  const bookValue = acquisitionCost - accumulatedDepreciation;

  // If already at or below salvage value, no depreciation
  if (bookValue <= salvageValue) return 0;

  const usefulLifeYears = usefulLifeMonths / 12;

  let monthlyAmount: number;

  switch (method) {
    case 'STRAIGHT_LINE': {
      monthlyAmount = (acquisitionCost - salvageValue) / usefulLifeMonths;
      break;
    }

    case 'DECLINING_BALANCE': {
      const annualRate = 1 / usefulLifeYears;
      monthlyAmount = (bookValue * annualRate) / 12;
      break;
    }

    case 'DOUBLE_DECLINING': {
      const annualRate = 2 / usefulLifeYears;
      monthlyAmount = (bookValue * annualRate) / 12;
      break;
    }

    default:
      monthlyAmount = 0;
  }

  // Don't depreciate below salvage value
  const maxDepreciation = bookValue - salvageValue;
  monthlyAmount = Math.min(monthlyAmount, maxDepreciation);

  // Round to 2 decimal places
  return Math.round((monthlyAmount + Number.EPSILON) * 100) / 100;
}

export function calculateDisposalGainLoss(
  bookValue: number,
  disposalAmount: number,
): { gainLoss: number; isGain: boolean } {
  const gainLoss = Math.round((disposalAmount - bookValue + Number.EPSILON) * 100) / 100;
  return {
    gainLoss,
    isGain: gainLoss >= 0,
  };
}
