import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface PageHeaderProps {
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    actions?: React.ReactNode;
    backTo?: string;
    onBack?: (() => void) | null;
    backLabel?: string;
    className?: string;
    noBorder?: boolean;
    /** Pin the header to the top of the scroll container while the page scrolls. */
    sticky?: boolean;
}

/**
 * Compact title strip. Accurate Online names the document in its tab rather
 * than in a hero header, so this stays a single dense line: title, optional
 * subtitle beside it, actions on the right, one hairline rule underneath.
 */
const PageHeader = ({
    title,
    subtitle = '',
    actions = null,
    backTo = '',
    onBack = null,
    backLabel = 'Back',
    className = '',
    noBorder = false,
    sticky = false
}: PageHeaderProps): React.ReactElement => {
    const navigate = useNavigate();

    const handleBack = (): void => {
        if (onBack) {
            onBack();
            return;
        }
        if (backTo) {
            navigate(backTo);
        }
    };

    return (
        <div className={`acc-page-head ${noBorder ? 'no-rule' : ''} ${sticky ? 'sticky top-0 z-20 bg-neutral-100 pt-1' : ''} ${className}`}>
            <div className="flex min-w-0 items-baseline gap-3">
                {(backTo || onBack) && (
                    <button
                        className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-sm border-none bg-transparent px-1.5 py-0.5 text-[0.75rem] text-primary-800 transition-colors hover:bg-primary-50"
                        onClick={handleBack}
                    >
                        <ArrowLeft size={13} /> {backLabel}
                    </button>
                )}
                <h1 className="acc-page-title truncate">{title}</h1>
                {subtitle ? <div className="acc-page-subtitle truncate">{subtitle}</div> : null}
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </div>
    );
};

export default PageHeader;
