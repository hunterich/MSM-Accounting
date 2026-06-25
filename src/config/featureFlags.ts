/** Multi-document workspace (Accurate-style tabs). Off unless VITE_WORKSPACE_TABS=1. */
export const WORKSPACE_TABS_ENABLED: boolean =
    import.meta.env.VITE_WORKSPACE_TABS === '1';
