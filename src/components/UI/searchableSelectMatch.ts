/**
 * Matching + ranking for SearchableSelect.
 *
 * Matching is token-based (all query words must appear, in any order) across
 * an option's label and subLabel. Ranking prioritises code/SKU (subLabel)
 * matches over name (label) matches, and exact/prefix matches over substring
 * matches. Designed for accounting pickers where users often type known
 * codes — deliberately NOT typo-fuzzy, to avoid surfacing wrong items.
 */

export interface RankableOption {
    value: string;
    label: string;
    subLabel?: string | number;
}

/** Lowercase, strip diacritics, collapse whitespace. */
function normalize(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Lower score = better rank.
const RANK_SUBLABEL_EXACT = 0;
const RANK_SUBLABEL_PREFIX = 1;
const RANK_LABEL_EXACT = 2;
const RANK_LABEL_PREFIX = 3;
const RANK_LABEL_WORD_PREFIX = 4;
const RANK_SUBLABEL_CONTAINS = 5;
const RANK_LABEL_CONTAINS = 6;
const RANK_TOKEN_SPREAD = 7;
const RANK_NONE = Infinity;

function scoreOption(label: string, subLabel: string, query: string, tokens: string[]): number {
    // Every token must appear somewhere (label or subLabel) for a match.
    const haystack = subLabel ? `${label} ${subLabel}` : label;
    const allTokensMatch = tokens.every(t => haystack.includes(t));
    if (!allTokensMatch) return RANK_NONE;

    if (subLabel) {
        if (subLabel === query) return RANK_SUBLABEL_EXACT;
        if (subLabel.startsWith(query)) return RANK_SUBLABEL_PREFIX;
    }
    if (label === query) return RANK_LABEL_EXACT;
    if (label.startsWith(query)) return RANK_LABEL_PREFIX;
    if (label.split(' ').some(word => word.startsWith(query))) return RANK_LABEL_WORD_PREFIX;
    if (subLabel && subLabel.includes(query)) return RANK_SUBLABEL_CONTAINS;
    if (label.includes(query)) return RANK_LABEL_CONTAINS;
    return RANK_TOKEN_SPREAD;
}

/**
 * Filter options to those matching `query`, sorted best-match first.
 * An empty/whitespace query returns all options in their original order.
 */
export function rankOptions<T extends RankableOption>(options: T[], query: string): T[] {
    const normQuery = normalize(query);
    if (!normQuery) return options;

    const tokens = normQuery.split(' ');

    return options
        .map((opt, index) => {
            const label = normalize(opt.label);
            const subLabel = opt.subLabel != null ? normalize(opt.subLabel.toString()) : '';
            return { opt, index, score: scoreOption(label, subLabel, normQuery, tokens), label };
        })
        .filter(entry => entry.score !== RANK_NONE)
        .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label) || a.index - b.index)
        .map(entry => entry.opt);
}
