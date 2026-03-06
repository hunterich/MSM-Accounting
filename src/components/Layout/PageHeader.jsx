import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const PageHeader = ({
    title,
    subtitle = '',
    actions = null,
    backTo = '',
    onBack = null,
    backLabel = 'Back',
    className = '',
    noBorder = false
}) => {
    const navigate = useNavigate();

    const handleBack = () => {
        if (onBack) {
            onBack();
            return;
        }
        if (backTo) {
            navigate(backTo);
        }
    };

    return (
        <div className={`flex justify-between items-center mb-6 pb-4 ${noBorder ? '' : 'border-b border-neutral-200'} ${className}`}>
            <div className="flex items-center gap-4">
                {(backTo || onBack) && (
                    <button
                        className="inline-flex items-center gap-[5px] pl-0 bg-transparent text-primary-700 border-none rounded-md h-8 text-sm px-3 cursor-pointer hover:bg-primary-100 transition-all duration-150"
                        onClick={handleBack}
                    >
                        <ArrowLeft size={16} /> {backLabel}
                    </button>
                )}
                <div>
                    <h1 className="m-0 text-2xl font-semibold text-neutral-900">{title}</h1>
                    {subtitle ? <div className="mt-1 text-neutral-600 text-[0.9rem]">{subtitle}</div> : null}
                </div>
            </div>
            {actions ? <div className="flex gap-2 items-center">{actions}</div> : null}
        </div>
    );
};

export default PageHeader;
