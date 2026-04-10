import React from 'react';
import PageHeader from './PageHeader';

interface ListPageProps {
    containerClassName?: string;
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    actions?: React.ReactNode;
    children?: React.ReactNode;
}

const ListPage = ({ containerClassName = '', title, subtitle = '', actions = null, children }: ListPageProps): React.ReactElement => {
    return (
        <div className={`max-w-[1200px] mx-auto ${containerClassName}`}>
            <PageHeader title={title} subtitle={subtitle} actions={actions} />
            {children}
        </div>
    );
};

export default ListPage;
