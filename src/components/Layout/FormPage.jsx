import React from 'react';
import PageHeader from './PageHeader';
import { FormSkeleton, SkeletonBlock } from '../UI/LoadingSkeleton';

const FormPage = ({
    containerClassName = '',
    title,
    subtitle = '',
    backTo = '',
    onBack = null,
    backLabel = 'Back',
    actions = null,
    isLoading = false,
    children
}) => {
    if (isLoading) {
        return (
            <div className={`max-w-[1200px] mx-auto ${containerClassName}`}>
                <div className="flex justify-between items-center mb-6 pb-4 border-b border-neutral-200">
                    <div className="flex items-center gap-4">
                        {(backTo || onBack) ? <SkeletonBlock className="h-8 w-32 rounded-md" /> : null}
                        <div className="space-y-2">
                            <SkeletonBlock className="h-8 w-56" />
                            {subtitle ? <SkeletonBlock className="h-4 w-72" /> : null}
                        </div>
                    </div>
                    {actions ? (
                        <div className="flex gap-2 items-center">
                            <SkeletonBlock className="h-10 w-28 rounded-md" />
                            <SkeletonBlock className="h-10 w-32 rounded-md" />
                        </div>
                    ) : null}
                </div>
                <FormSkeleton className="mt-4" />
            </div>
        );
    }

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
