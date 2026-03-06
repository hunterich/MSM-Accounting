const TYPE_NORMAL_SIDE = {
    Asset: 'Debit',
    Liability: 'Credit',
    Equity: 'Credit',
    Revenue: 'Credit',
    Expense: 'Debit'
};

const codeSort = (a, b) => a.code.localeCompare(b.code, undefined, { numeric: true });

export const getDescendantAccountIds = (accountId, accounts) => {
    const childMap = accounts.reduce((map, account) => {
        const key = account.parentId || 'root';
        if (!map[key]) map[key] = [];
        map[key].push(account.id);
        return map;
    }, {});

    const stack = [...(childMap[accountId] || [])];
    const descendants = [];
    while (stack.length > 0) {
        const current = stack.pop();
        descendants.push(current);
        const children = childMap[current] || [];
        stack.push(...children);
    }
    return descendants;
};

const isCircularParent = (accountId, nextParentId, accounts) => {
    if (!nextParentId) return false;
    if (accountId === nextParentId) return true;
    const descendants = getDescendantAccountIds(accountId, accounts);
    return descendants.includes(nextParentId);
};

export const buildAccountTree = (accounts) => {
    const byId = new Map();
    accounts.forEach((account) => {
        byId.set(account.id, { ...account, children: [] });
    });

    const roots = [];
    byId.forEach((node) => {
        if (!node.parentId) {
            roots.push(node);
            return;
        }

        const parent = byId.get(node.parentId);
        if (!parent) {
            roots.push(node);
            return;
        }
        parent.children.push(node);
    });

    const sortTree = (nodes) => {
        nodes.sort(codeSort);
        nodes.forEach((node) => sortTree(node.children));
    };
    sortTree(roots);
    return roots;
};

export const flattenTree = (tree) => {
    const flat = [];
    const walk = (nodes, depth = 0) => {
        nodes.forEach((node) => {
            flat.push({
                ...node,
                depth,
                hasChildren: node.children.length > 0
            });
            if (node.children.length > 0) {
                walk(node.children, depth + 1);
            }
        });
    };
    walk(tree);
    return flat;
};

const validateShared = (payload, accounts, currentId = null) => {
    const errors = {};

    if (!payload.code?.trim()) errors.code = 'Account code is required.';
    if (!payload.name?.trim()) errors.name = 'Account name is required.';
    if (!payload.type) errors.type = 'Account type is required.';
    if (!payload.reportGroup?.trim()) errors.reportGroup = 'Report group is required.';

    const duplicateCode = accounts.find(
        (account) => account.code === payload.code && account.id !== currentId
    );
    if (duplicateCode) errors.code = 'Account code must be unique.';

    if (payload.parentId) {
        const parent = accounts.find((account) => account.id === payload.parentId);
        if (!parent) {
            errors.parentId = 'Parent account not found.';
        } else {
            if (parent.isPostable) {
                errors.parentId = 'Cannot use a postable account as parent.';
            }
            if (parent.type !== payload.type) {
                errors.parentId = 'Child account type must match parent type.';
            }
            if (payload.code && !payload.code.startsWith(parent.code)) {
                errors.code = `Child code must start with parent code (${parent.code}).`;
            }
        }
    }

    return errors;
};

export const validateAccountCreate = (payload, accounts) => {
    const errors = validateShared(payload, accounts);
    const isValid = Object.keys(errors).length === 0;
    return { isValid, errors };
};

export const validateAccountUpdate = (current, next, accounts) => {
    const errors = validateShared(next, accounts, current.id);

    if (current.hasPostings) {
        if (current.type !== next.type) {
            errors.type = 'Type is locked because this account already has postings.';
        }
        if (current.normalSide !== next.normalSide) {
            errors.normalSide = 'Normal side is locked because this account already has postings.';
        }
        if (current.parentId !== next.parentId) {
            errors.parentId = 'Parent is locked because this account already has postings.';
        }
    }

    if (next.isPostable && accounts.some((account) => account.parentId === current.id)) {
        errors.isPostable = 'A postable account cannot have child accounts.';
    }

    if (isCircularParent(current.id, next.parentId, accounts)) {
        errors.parentId = 'Circular hierarchy is not allowed.';
    }

    const isValid = Object.keys(errors).length === 0;
    return { isValid, errors };
};

export const canArchiveAccount = (account, accounts) => {
    const descendants = getDescendantAccountIds(account.id, accounts)
        .map((id) => accounts.find((a) => a.id === id))
        .filter(Boolean);

    const hasUsedDescendants = descendants.some((child) => child.hasPostings);
    const hasChildren = descendants.length > 0;
    const isUsed = account.hasPostings || hasUsedDescendants;

    return {
        canDelete: !isUsed,
        canArchive: true,
        hasChildren,
        hasUsedDescendants,
        reason: isUsed
            ? 'Account already has postings (or used descendants). Archive instead of delete.'
            : null,
        deleteScopeIds: [account.id, ...descendants.map((child) => child.id)]
    };
};

export const rollupBalances = (accounts, balancesByAccountId) => {
    const childrenByParent = accounts.reduce((map, account) => {
        const key = account.parentId || 'root';
        if (!map[key]) map[key] = [];
        map[key].push(account.id);
        return map;
    }, {});

    const totalsById = {};
    const ownBalanceById = {};

    const calculate = (accountId) => {
        const ownBalance = Number(balancesByAccountId[accountId] || 0);
        ownBalanceById[accountId] = ownBalance;
        const children = childrenByParent[accountId] || [];
        const childTotal = children.reduce((sum, childId) => sum + calculate(childId), 0);
        const total = ownBalance + childTotal;
        totalsById[accountId] = total;
        return total;
    };

    (childrenByParent.root || []).forEach((rootId) => calculate(rootId));

    return {
        totalsById,
        ownBalanceById
    };
};

export const getNormalSideByType = (type) => TYPE_NORMAL_SIDE[type];
