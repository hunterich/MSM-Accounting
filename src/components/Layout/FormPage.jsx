import React from 'react';
import PageHeader from './PageHeader';

const FormPage = ({
    containerClassName = '',
    title,
    subtitle = '',
    backTo = '',
    onBack = null,
    backLabel = 'Back',
    actions = null,
    children
}) => {
    return (
        <div className={`max-w-[1200px] mx-auto ${containerClassName}`}>
            <PageHeader
                title={title}
                subtitle={subtitle}
                backTo={backTo}
                onBack={onBack}
                backLabel={backLabel}
                actions={actions}
                className="no-print"
            />
            {children}
        </div>
    );
};

export default FormPage;
