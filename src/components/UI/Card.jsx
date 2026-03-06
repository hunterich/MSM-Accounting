import React from 'react';

const Card = ({ title, children, footer, className = '', padding = true, actions = null }) => {
    return (
        <div className={`bg-neutral-0 border border-neutral-200 rounded-lg shadow-sm flex flex-col h-full ${className}`}>
            {(title || actions) && (
                <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between">
                    {title && <h3 className="text-lg font-semibold m-0 text-neutral-900">{title}</h3>}
                    {actions && <div className="flex items-center gap-2">{actions}</div>}
                </div>
            )}

            <div className={`flex-1 ${padding ? 'p-6' : 'p-0'}`}>
                {children}
            </div>

            {footer && (
                <div className="px-6 py-4 border-t border-neutral-200 bg-neutral-50 rounded-b-lg">
                    {footer}
                </div>
            )}
        </div>
    );
};

export default Card;
