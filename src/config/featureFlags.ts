/** Multi-document workspace (Accurate-style tabs). Off unless VITE_WORKSPACE_TABS=1. */
export const WORKSPACE_TABS_ENABLED: boolean =
    import.meta.env.VITE_WORKSPACE_TABS === '1';

/** Accurate→MSM migration wizard tab (Data & Tools). Off unless VITE_MIGRATION_WIZARD=1. */
export const MIGRATION_WIZARD_ENABLED: boolean =
    import.meta.env.VITE_MIGRATION_WIZARD === '1';
