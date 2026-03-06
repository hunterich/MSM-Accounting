import React from 'react';

const InvoiceWorkbenchLayout = ({ catalog, detail, showDetail, mobileCatalogOpen, onToggleCatalog }) => {
    if (!showDetail) {
        return (
            <div className="grid grid-cols-1 gap-3">
                <div>
                    {catalog}
                </div>
            </div>
        );
    }

    return (
        <div className="invoice-workbench with-detail">
            <div className={`invoice-workbench-catalog ${mobileCatalogOpen ? 'mobile-open' : ''}`}>
                <button
                    type="button"
                    className="invoice-workbench-mobile-toggle"
                    onClick={onToggleCatalog}
                >
                    {mobileCatalogOpen ? 'Hide Catalog' : 'Show Catalog'}
                </button>
                {catalog}
            </div>
            <div className="invoice-workbench-detail">
                {detail}
            </div>
        </div>
    );
};

export default InvoiceWorkbenchLayout;
