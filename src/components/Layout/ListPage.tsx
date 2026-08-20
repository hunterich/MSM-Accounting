import React from 'react';
import PageHeader from './PageHeader';

interface ListPageProps {
    containerClassName?: string;
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    actions?: React.ReactNode;
    /** Filter chips rendered on their own row above the grid (Accurate style). */
    filters?: React.ReactNode;
    /** Right-hand tools of the toolbar row: export, print, search, count. */
    tools?: React.ReactNode;
    children?: React.ReactNode;
}

/**
 * List surface, laid out like an Accurate Online list tab: full-bleed (no
 * centred content column), a compact title strip, then a filter/tool row that
 * sits directly on top of the grid.
 */
const ListPage = ({
    containerClassName = '',
    title,
    subtitle = '',
    actions = null,
    filters = null,
    tools = null,
    children,
}: ListPageProps): React.ReactElement => {
    return (
        <div className={`acc-page ${containerClassName}`}>
            <PageHeader title={title} subtitle={subtitle} />
            {(filters || tools || actions) && (
                <div className="acc-toolbar">
                    {filters ? <div className="acc-toolbar-row">{filters}</div> : null}
                    {(actions || tools) && (
                        <div className="acc-toolbar-row">
                            {actions}
                            <div className="spacer" />
                            {tools}
                        </div>
                    )}
                </div>
            )}
            {children}
        </div>
    );
};

export default ListPage;
