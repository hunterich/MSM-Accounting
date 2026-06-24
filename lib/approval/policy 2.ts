export interface ApprovalDecisionInput {
  hasCanApprove: boolean;
  isSelf: boolean;
  roleType: string;
  requireDistinctApproverForAdmins: boolean;
}

export type ApprovalDecision =
  | { allowed: true }
  | { allowed: false; reason: 'no-permission' | 'self-approval' };

export function isApprovalAllowed(input: ApprovalDecisionInput): ApprovalDecision {
  if (!input.hasCanApprove) return { allowed: false, reason: 'no-permission' };
  if (input.isSelf) {
    const adminExempt = input.roleType === 'ADMIN' && !input.requireDistinctApproverForAdmins;
    if (!adminExempt) return { allowed: false, reason: 'self-approval' };
  }
  return { allowed: true };
}
