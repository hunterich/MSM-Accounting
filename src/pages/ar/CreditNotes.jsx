import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Table from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import FilterBar from '../../components/UI/FilterBar';
import { Plus, List, X, FileText, Paperclip, MoreHorizontal, Trash2 } from 'lucide-react';
import { useCreditNotes, useSalesReturns, useWarehouses } from '../../hooks/useReturns';
import { formatDateID, formatIDR } from '../../utils/formatters';

const CreditNotes = () => {
    const navigate = useNavigate();
    const { data: cnData } = useCreditNotes();
    const creditNotes = cnData?.data ?? [];
    const { data: srData } = useSalesReturns();
    const salesReturns = srData?.data ?? [];
    const { data: warehouses = [] } = useWarehouses();
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ settlementType: '' });
    const [activeCatalogTab, setActiveCatalogTab] = useState('credits');
    const [selectedDoc, setSelectedDoc] = useState(null); // { type: 'credit' | 'return', id: string }
    const [openDocKeys, setOpenDocKeys] = useState([]);
    const [detailTab, setDetailTab] = useState('summary');

    const getReturnTotal = (salesReturn) => {
        if (!salesReturn) return 0;
        const subtotal = (salesReturn.lines || []).reduce((sum, line) => {
            return sum + (Number(line.qtyReturn || 0) * Number(line.price || 0));
        }, 0);
        if (!salesReturn.applyTax) return subtotal;
        const rate = Number(salesReturn.taxRate || 0) / 100;
        if (salesReturn.taxIncluded) return subtotal;
        return subtotal + (subtotal * rate);
    };

    const openDoc = (type, id) => {
        const key = `${type}:${id}`;
        setOpenDocKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
        setSelectedDoc({ type, id });
        setDetailTab('summary');
    };

    const closeDoc = (keyToClose) => {
        setOpenDocKeys((prev) => {
            const idx = prev.indexOf(keyToClose);
            const next = prev.filter((key) => key !== keyToClose);
            if (selectedDoc && `${selectedDoc.type}:${selectedDoc.id}` === keyToClose) {
                if (next.length === 0) {
                    setSelectedDoc(null);
                } else {
                    const fallback = next[Math.max(0, idx - 1)] || next[0];
                    const [type, id] = fallback.split(':');
                    setSelectedDoc({ type, id });
                }
            }
            return next;
        });
    };

    const filteredCredits = useMemo(() => {
        return creditNotes.filter((item) => {
            const keyword = searchTerm.toLowerCase();
            const matchesSearch = item.customerName.toLowerCase().includes(keyword)
                || item.id.toLowerCase().includes(keyword)
                || item.sourceInvoiceId.toLowerCase().includes(keyword)
                || item.returnId.toLowerCase().includes(keyword);
            const matchesSettlement = filters.settlementType ? item.settlementType === filters.settlementType : true;
            return matchesSearch && matchesSettlement;
        });
    }, [searchTerm, filters.settlementType]);

    const filteredReturns = useMemo(() => {
        return salesReturns.filter((item) => {
            const keyword = searchTerm.toLowerCase();
            return item.customerName.toLowerCase().includes(keyword)
                || item.id.toLowerCase().includes(keyword)
                || item.invoiceId.toLowerCase().includes(keyword);
        });
    }, [searchTerm]);

    const selectedCredit = selectedDoc?.type === 'credit'
        ? creditNotes.find((item) => item.id === selectedDoc.id) || null
        : null;
    const selectedReturn = selectedDoc?.type === 'return'
        ? salesReturns.find((item) => item.id === selectedDoc.id) || null
        : null;

    const selectedCreditLines = useMemo(() => {
        if (!selectedCredit) return [];
        const linkedReturn = salesReturns.find((ret) => ret.id === selectedCredit.returnId);
        return linkedReturn?.lines || [];
    }, [selectedCredit]);

    const creditColumns = [
        { key: 'id', label: 'Credit Note #' },
        { key: 'returnId', label: 'Sales Return #' },
        { key: 'date', label: 'Date', sortable: true, render: (val) => formatDateID(val) },
        { key: 'customerName', label: 'Customer', sortable: true },
        { key: 'sourceInvoiceId', label: 'Source Invoice' },
        { key: 'amount', label: 'Amount', align: 'right', render: (val) => formatIDR(val) },
        {
            key: 'settlementType',
            label: 'Settlement',
            render: (val, row) => `${val}${row.settlementRef ? ` • ${row.settlementRef}` : ''}`
        },
        { key: 'status', label: 'Status', render: (val) => <StatusTag status={val === 'Applied' ? 'Success' : 'Info'} label={val} /> },
        {
            key: 'actions',
            label: '',
            render: (_, row) => (
                <div className="row-actions-end">
                    <Button text="View" size="small" variant="tertiary" onClick={(e) => { e.stopPropagation(); openDoc('credit', row.id); }} />
                    <Button text="Edit" size="small" variant="tertiary" onClick={(e) => { e.stopPropagation(); navigate('/ar/credits/edit', { state: { mode: 'edit', creditId: row.id } }); }} />
                </div>
            )
        }
    ];

    const returnColumns = [
        { key: 'id', label: 'Sales Return #' },
        { key: 'returnDate', label: 'Date', sortable: true, render: (val) => formatDateID(val) },
        { key: 'customerName', label: 'Customer', sortable: true },
        { key: 'invoiceId', label: 'Source Invoice' },
        { key: 'status', label: 'Status', render: (val) => <StatusTag status={val === 'Approved' ? 'Success' : 'Warning'} label={val} /> },
        {
            key: 'actions',
            label: '',
            render: (_, row) => (
                <Button
                    text="Open"
                    size="small"
                    variant="tertiary"
                    onClick={(e) => {
                        e.stopPropagation();
                        openDoc('return', row.id);
                    }}
                />
            )
        }
    ];

    const filterOptions = [
        {
            key: 'settlementType',
            label: 'Settlement Type',
            options: [
                { value: 'Apply to Invoice', label: 'Apply to Invoice' },
                { value: 'Refund', label: 'Refund' }
            ]
        }
    ];

    const renderOpenDocTab = (key) => {
        const [type, id] = key.split(':');
        const doc = type === 'credit'
            ? creditNotes.find((item) => item.id === id)
            : salesReturns.find((item) => item.id === id);
        if (!doc) return null;
        const isActive = selectedDoc && `${selectedDoc.type}:${selectedDoc.id}` === key;
        return (
            <button key={key} className={`workbench-doc-tab ${isActive ? 'active' : ''}`} onClick={() => setSelectedDoc({ type, id })}>
                {doc.id}
                <span className="workbench-doc-tab-close" onClick={(e) => { e.stopPropagation(); closeDoc(key); }}>
                    <X size={14} />
                </span>
            </button>
        );
    };

    const firstRowDynamicLimit = 3;
    const firstRowDocKeys = openDocKeys.slice(0, firstRowDynamicLimit);
    const remainingDocKeys = openDocKeys.slice(firstRowDynamicLimit);
    const extraRows = [];
    for (let i = 0; i < remainingDocKeys.length; i += 5) {
        extraRows.push(remainingDocKeys.slice(i, i + 5));
    }

    return (
        <div className="container ar-module container-full-width">
            <div className="workbench-doc-tabs">
                <div className="workbench-doc-tab-row">
                    <button
                        className="workbench-doc-tab workbench-doc-tab-catalog"
                        onClick={() => {
                            setSelectedDoc(null);
                        }}
                    >
                        <List size={16} />
                        Catalog
                    </button>
                    <button
                        className="workbench-doc-tab workbench-doc-tab-new"
                        onClick={() => navigate('/ar/returns/new', { state: { mode: 'create' } })}
                    >
                        <Plus size={16} />
                        New Sales Return
                    </button>
                    {firstRowDocKeys.map((key) => renderOpenDocTab(key))}
                    <div className="workbench-tab-count">Open tabs: {openDocKeys.length}</div>
                </div>
                {extraRows.map((row, rowIndex) => (
                    <div key={`credit-extra-row-${rowIndex}`} className="workbench-doc-tab-row secondary-row">
                        {row.map((key) => renderOpenDocTab(key))}
                    </div>
                ))}
            </div>

            {!selectedDoc && (
                <>
                    <div className="invoice-tabs module-tabs module-tabs-spaced">
                        <button className={`invoice-tab ${activeCatalogTab === 'credits' ? 'active' : ''}`} onClick={() => setActiveCatalogTab('credits')}>
                            Credit Notes
                        </button>
                        <button className={`invoice-tab ${activeCatalogTab === 'returns' ? 'active' : ''}`} onClick={() => setActiveCatalogTab('returns')}>
                            Sales Returns
                        </button>
                    </div>

                    <FilterBar
                        onSearch={setSearchTerm}
                        filters={activeCatalogTab === 'credits' ? filterOptions : []}
                        activeFilters={filters}
                        onFilterChange={(key, val) => setFilters((prev) => ({ ...prev, [key]: val }))}
                        placeholder={activeCatalogTab === 'credits' ? 'Search credit #, return #, customer...' : 'Search return #, customer, invoice...'}
                    />

                    <Card padding={false}>
                        {activeCatalogTab === 'credits' ? (
                            <Table
                                columns={creditColumns}
                                data={filteredCredits}
                                onRowClick={(row) => openDoc('credit', row.id)}
                                showCount
                                countLabel="credit notes"
                            />
                        ) : (
                            <Table
                                columns={returnColumns}
                                data={filteredReturns}
                                onRowClick={(row) => openDoc('return', row.id)}
                                showCount
                                countLabel="credit notes"
                            />
                        )}
                    </Card>
                </>
            )}

            {selectedCredit && (
                <div className="invoice-workbench-card dense-mode">
                    <div className="dense-topbar">
                        <div className="detail-header-title">
                            <h2 className="detail-header-h2">{selectedCredit.id}</h2>
                            <StatusTag status={selectedCredit.status === 'Applied' ? 'Success' : 'Info'} label={selectedCredit.status} />
                        </div>
                        <div className="detail-header-actions">
                            <Button text="Print" size="small" variant="secondary" onClick={() => alert('Print is not connected yet.')} />
                            <Button text="Edit" size="small" variant="primary" onClick={() => navigate('/ar/credits/edit', { state: { mode: 'edit', creditId: selectedCredit.id } })} />
                        </div>
                    </div>
                    <div className="dense-header-grid">
                        <div className="dense-field">
                            <label>Customer</label>
                            <div>{selectedCredit.customerName}</div>
                        </div>
                        <div className="dense-field">
                            <label>Credit Date</label>
                            <div>{formatDateID(selectedCredit.date)}</div>
                        </div>
                        <div className="dense-field">
                            <label>Source Invoice</label>
                            <div>{selectedCredit.sourceInvoiceId}</div>
                        </div>
                        <div className="dense-field">
                            <label>Settlement</label>
                            <div>{selectedCredit.settlementType}</div>
                        </div>
                        <div className="dense-amount">{formatIDR(selectedCredit.amount)}</div>
                    </div>

                    <div className="dense-body">
                        <div className="dense-main">
                            <div className="detail-tabs dense-tabs">
                                <button className={`detail-tab ${detailTab === 'summary' ? 'active' : ''}`} onClick={() => setDetailTab('summary')}>Summary</button>
                                <button className={`detail-tab ${detailTab === 'items' ? 'active' : ''}`} onClick={() => setDetailTab('items')}>Items</button>
                                <button className={`detail-tab ${detailTab === 'logistics' ? 'active' : ''}`} onClick={() => setDetailTab('logistics')}>Logistics</button>
                                <button className={`detail-tab ${detailTab === 'attachments' ? 'active' : ''}`} onClick={() => setDetailTab('attachments')}>Attachments</button>
                                <button className={`detail-tab ${detailTab === 'audit' ? 'active' : ''}`} onClick={() => setDetailTab('audit')}>Audit / Journal</button>
                            </div>
                            <div className="detail-tab-content dense-content">
                                {detailTab === 'summary' && (
                                    <div className="detail-grid">
                                        <div className="detail-field"><label>Credit #</label><strong>{selectedCredit.id}</strong></div>
                                        <div className="detail-field"><label>Status</label><StatusTag status={selectedCredit.status === 'Applied' ? 'Success' : 'Info'} label={selectedCredit.status} /></div>
                                        <div className="detail-field"><label>Sales Return</label><div>{selectedCredit.returnId}</div></div>
                                        <div className="detail-field"><label>Source Invoice</label><div>{selectedCredit.sourceInvoiceId}</div></div>
                                        <div className="detail-field"><label>Settlement Ref</label><div>{selectedCredit.settlementRef || '-'}</div></div>
                                        <div className="detail-field"><label>Amount</label><strong>{formatIDR(selectedCredit.amount)}</strong></div>
                                    </div>
                                )}
                                {detailTab === 'items' && (
                                    <div className="workbench-scroll-table">
                                        <table className="invoice-workbench-table">
                                            <thead>
                                                <tr>
                                                    <th>Item</th>
                                                    <th className="text-right">Qty Return</th>
                                                    <th>Unit</th>
                                                    <th className="text-right">Price</th>
                                                    <th className="text-right">Line Total</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {selectedCreditLines.length === 0 && (
                                                    <tr><td colSpan={5} className="table-empty-cell">No return lines.</td></tr>
                                                )}
                                                {selectedCreditLines.map((line, idx) => (
                                                    <tr key={`${line.itemId || line.id}-${idx}`}>
                                                        <td>{line.itemName}</td>
                                                        <td className="text-right">{line.qtyReturn}</td>
                                                        <td>{line.unit}</td>
                                                        <td className="text-right">{formatIDR(line.price)}</td>
                                                        <td className="text-right">{formatIDR(Number(line.qtyReturn || 0) * Number(line.price || 0))}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                {detailTab === 'logistics' && (
                                    <div className="detail-grid">
                                        <div className="detail-field"><label>Settlement Type</label><strong>{selectedCredit.settlementType}</strong></div>
                                        <div className="detail-field"><label>Settlement Ref</label><div>{selectedCredit.settlementRef || '-'}</div></div>
                                        <div className="detail-field"><label>Source Invoice</label><div>{selectedCredit.sourceInvoiceId}</div></div>
                                        <div className="detail-field"><label>Sales Return</label><div>{selectedCredit.returnId}</div></div>
                                    </div>
                                )}
                                {detailTab === 'attachments' && (
                                    <div className="attachment-empty">No attachments.</div>
                                )}
                                {detailTab === 'audit' && (
                                    <ul className="audit-list">
                                        <li>
                                            <div><strong>Credit note created</strong></div>
                                            <div>{formatDateID(selectedCredit.date)} • System</div>
                                        </li>
                                        <li>
                                            <div><strong>Linked to return {selectedCredit.returnId}</strong></div>
                                            <div>{formatDateID(selectedCredit.date)} • Auto process</div>
                                        </li>
                                    </ul>
                                )}
                            </div>
                        </div>
                        <div className="dense-side-actions">
                            <button className="dense-side-btn" title="Details"><FileText size={18} /></button>
                            <button className="dense-side-btn" title="Attachments"><Paperclip size={18} /></button>
                            <button className="dense-side-btn success" title="More"><MoreHorizontal size={18} /></button>
                            <button className="dense-side-btn danger" title="Delete"><Trash2 size={18} /></button>
                        </div>
                    </div>
                </div>
            )}

            {selectedReturn && (
                <div className="invoice-workbench-card dense-mode">
                    <div className="dense-topbar">
                        <div className="detail-header-title">
                            <h2 className="detail-header-h2">{selectedReturn.id}</h2>
                            <StatusTag status={selectedReturn.status === 'Approved' ? 'Success' : 'Warning'} label={selectedReturn.status} />
                        </div>
                        <div className="detail-header-actions">
                            <Button text="Print" size="small" variant="secondary" onClick={() => alert('Print is not connected yet.')} />
                            <Button text="Edit" size="small" variant="primary" onClick={() => navigate('/ar/returns/new', { state: { mode: 'edit', returnId: selectedReturn.id } })} />
                        </div>
                    </div>
                    <div className="dense-header-grid">
                        <div className="dense-field">
                            <label>Customer</label>
                            <div>{selectedReturn.customerName}</div>
                        </div>
                        <div className="dense-field">
                            <label>Return Date</label>
                            <div>{formatDateID(selectedReturn.returnDate)}</div>
                        </div>
                        <div className="dense-field">
                            <label>Source Invoice</label>
                            <div>{selectedReturn.invoiceId}</div>
                        </div>
                        <div className="dense-field">
                            <label>Warehouse</label>
                            <div>{warehouses.find((wh) => wh.id === selectedReturn.warehouseId)?.name || '-'}</div>
                        </div>
                        <div className="dense-amount">{formatIDR(getReturnTotal(selectedReturn))}</div>
                    </div>

                    <div className="dense-body">
                        <div className="dense-main">
                            <div className="detail-tabs dense-tabs">
                                <button className={`detail-tab ${detailTab === 'summary' ? 'active' : ''}`} onClick={() => setDetailTab('summary')}>Summary</button>
                                <button className={`detail-tab ${detailTab === 'items' ? 'active' : ''}`} onClick={() => setDetailTab('items')}>Items</button>
                                <button className={`detail-tab ${detailTab === 'logistics' ? 'active' : ''}`} onClick={() => setDetailTab('logistics')}>Logistics</button>
                                <button className={`detail-tab ${detailTab === 'attachments' ? 'active' : ''}`} onClick={() => setDetailTab('attachments')}>Attachments</button>
                                <button className={`detail-tab ${detailTab === 'audit' ? 'active' : ''}`} onClick={() => setDetailTab('audit')}>Audit / Journal</button>
                            </div>
                            <div className="detail-tab-content dense-content">
                                {detailTab === 'summary' && (
                                    <div className="detail-grid">
                                        <div className="detail-field"><label>Return #</label><strong>{selectedReturn.id}</strong></div>
                                        <div className="detail-field"><label>Status</label><StatusTag status={selectedReturn.status === 'Approved' ? 'Success' : 'Warning'} label={selectedReturn.status} /></div>
                                        <div className="detail-field"><label>Customer</label><div>{selectedReturn.customerName}</div></div>
                                        <div className="detail-field"><label>Source Invoice</label><div>{selectedReturn.invoiceId}</div></div>
                                        <div className="detail-field span-2"><label>Reason</label><div>{selectedReturn.reason || '-'}</div></div>
                                    </div>
                                )}
                                {detailTab === 'items' && (
                                    <div className="workbench-scroll-table">
                                        <table className="invoice-workbench-table">
                                            <thead>
                                                <tr>
                                                    <th>Item</th>
                                                    <th className="text-right">Qty Return</th>
                                                    <th>Unit</th>
                                                    <th className="text-right">Price</th>
                                                    <th className="text-right">Line Total</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(selectedReturn.lines || []).map((line, idx) => (
                                                    <tr key={`${line.itemId || line.id}-${idx}`}>
                                                        <td>{line.itemName}</td>
                                                        <td className="text-right">{line.qtyReturn}</td>
                                                        <td>{line.unit}</td>
                                                        <td className="text-right">{formatIDR(line.price)}</td>
                                                        <td className="text-right">{formatIDR(Number(line.qtyReturn || 0) * Number(line.price || 0))}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                {detailTab === 'logistics' && (
                                    <div className="detail-grid">
                                        <div className="detail-field"><label>Warehouse</label><strong>{warehouses.find((wh) => wh.id === selectedReturn.warehouseId)?.name || '-'}</strong></div>
                                        <div className="detail-field"><label>Source Invoice</label><strong>{selectedReturn.invoiceId}</strong></div>
                                        <div className="detail-field"><label>Apply Tax</label><div>{selectedReturn.applyTax ? 'Yes' : 'No'}</div></div>
                                        <div className="detail-field"><label>Total Includes Tax</label><div>{selectedReturn.taxIncluded ? 'Yes' : 'No'}</div></div>
                                        <div className="detail-field"><label>Tax Rate</label><div>{selectedReturn.taxRate || 0}%</div></div>
                                        <div className="detail-field"><label>Total</label><strong>{formatIDR(getReturnTotal(selectedReturn))}</strong></div>
                                    </div>
                                )}
                                {detailTab === 'attachments' && (
                                    <div className="attachment-empty">No attachments.</div>
                                )}
                                {detailTab === 'audit' && (
                                    <ul className="audit-list">
                                        <li>
                                            <div><strong>Sales return created</strong></div>
                                            <div>{formatDateID(selectedReturn.returnDate)} • System</div>
                                        </li>
                                        <li>
                                            <div><strong>Status updated to {selectedReturn.status}</strong></div>
                                            <div>{formatDateID(selectedReturn.returnDate)} • AR User</div>
                                        </li>
                                    </ul>
                                )}
                            </div>
                        </div>
                        <div className="dense-side-actions">
                            <button className="dense-side-btn" title="Details"><FileText size={18} /></button>
                            <button className="dense-side-btn" title="Attachments"><Paperclip size={18} /></button>
                            <button className="dense-side-btn success" title="More"><MoreHorizontal size={18} /></button>
                            <button className="dense-side-btn danger" title="Delete"><Trash2 size={18} /></button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CreditNotes;
