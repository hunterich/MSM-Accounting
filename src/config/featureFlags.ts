/** Accurate→MSM migration wizard tab (Data & Tools). Off unless VITE_MIGRATION_WIZARD=1. */
export const MIGRATION_WIZARD_ENABLED: boolean =
    import.meta.env.VITE_MIGRATION_WIZARD === '1';
