import React from 'react';
import PageHeader from './PageHeader';
import { FormSkeleton, SkeletonBlock } from '../UI/LoadingSkeleton';

interface FormPageProps {
    containerClassName?: string;
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    backTo?: string;
    onBack?: (() => void) | null;
    backLabel?: string;
    actions?: React.ReactNode;
    isLoading?: boolean;
    sticky?: boolean;
    children?: React.ReactNode;
}

const FormPage = ({
    containerClassName = '',
    title,
    subtitle = '',
    backTo = '',
    onBack = null,
    backLabel = 'Back',
    actions = null,
    isLoading = false,
    sticky = false,
    children
}: FormPageProps): React.ReactElement => {
    if (isLoading) {
        return (
            <div className={`acc-page ${containerClassName}`}>
                <div className="flex justify-between items-center acc-page-head">
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
        <div className={`acc-page ${containerClassName}`}>
            <PageHeader
                title={title}
                subtitle={subtitle}
                backTo={backTo}
                onBack={onBack}
                backLabel={backLabel}
                actions={actions}
                sticky={sticky}
                className="no-print"
            />
            {children}
        </div>
    );
};

export default FormPage;
