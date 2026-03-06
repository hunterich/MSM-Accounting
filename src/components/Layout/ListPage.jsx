import React from 'react';
import PageHeader from './PageHeader';

const ListPage = ({ containerClassName = '', title, subtitle = '', actions = null, children }) => {
    return (
        <div className={`max-w-[1200px] mx-auto ${containerClassName}`}>
            <PageHeader title={title} subtitle={subtitle} actions={actions} />
            {children}
        </div>
    );
};

export default ListPage;
