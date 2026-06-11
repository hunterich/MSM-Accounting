import React, { useRef, useEffect, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { X, Printer } from 'lucide-react';
import Button from './Button';

type PaperSize = 'A4' | 'A5';

interface PrintPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    documentTitle?: string;
    /** Initial paper size when no saved preference exists (default 'A4'). */
    defaultPaperSize?: PaperSize;
    children?: React.ReactNode;
}

// On-screen container dimensions per paper size (portrait).
const PAPER_DIMENSIONS: Record<PaperSize, { width: string; minHeight: string }> = {
    A4: { width: '210mm', minHeight: '297mm' },
    A5: { width: '148mm', minHeight: '210mm' },
};

const PAPER_PREF_KEY = 'msm-print-paper-size';

const readSavedPaperSize = (fallback: PaperSize): PaperSize => {
    try {
        const saved = localStorage.getItem(PAPER_PREF_KEY);
        return saved === 'A4' || saved === 'A5' ? saved : fallback;
    } catch {
        return fallback;
    }
};

/**
 * PrintPreviewModal displays a document in an A4/A5 sized container on screen,
 * and handles the actual printing via react-to-print when confirmed. The chosen
 * paper size drives both the on-screen preview and the printed @page size, and
 * is remembered across sessions.
 */
const PrintPreviewModal = ({ isOpen, onClose, title = "Print Preview", documentTitle = "Document", defaultPaperSize = 'A4', children }: PrintPreviewModalProps): React.ReactElement | null => {
    const printRef = useRef<HTMLDivElement>(null);
    const [paperSize, setPaperSize] = useState<PaperSize>(() => readSavedPaperSize(defaultPaperSize));

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: documentTitle,
        pageStyle: `@page { size: ${paperSize} portrait; margin: 0; } @media print { html, body { margin: 0 !important; padding: 0 !important; } }`,
    });

    const changePaperSize = (size: PaperSize) => {
        setPaperSize(size);
        try { localStorage.setItem(PAPER_PREF_KEY, size); } catch { /* ignore storage failures */ }
    };

    // Close on escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const dimensions = PAPER_DIMENSIONS[paperSize];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 backdrop-blur-sm p-4 sm:p-6 lg:p-8">
            <div className="bg-neutral-50 rounded-xl shadow-xl w-full max-w-5xl max-h-full flex flex-col overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-neutral-200">
                    <h2 className="text-lg font-bold text-neutral-800">{title}</h2>
                    <div className="flex items-center gap-2">
                        {/* Paper size toggle */}
                        <div className="flex items-center rounded-md border border-neutral-300 overflow-hidden mr-1" role="group" aria-label="Paper size">
                            {(['A4', 'A5'] as PaperSize[]).map((size) => (
                                <button
                                    key={size}
                                    type="button"
                                    aria-pressed={paperSize === size}
                                    onClick={() => changePaperSize(size)}
                                    className={`px-3 h-9 text-sm font-medium transition-colors ${paperSize === size ? 'bg-primary-600 text-neutral-0' : 'bg-neutral-0 text-neutral-700 hover:bg-neutral-100'}`}
                                >
                                    {size}
                                </button>
                            ))}
                        </div>
                        <Button
                            text="Cancel"
                            variant="secondary"
                            onClick={onClose}
                        />
                        <Button
                            text="Print Document"
                            variant="primary"
                            icon={<Printer size={16} />}
                            onClick={handlePrint}
                        />
                        <button
                            onClick={onClose}
                            className="ml-2 p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-md transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Preview Area - Scrollable */}
                <div className="flex-1 overflow-auto p-6 bg-neutral-100 flex justify-center print-preview-scroll-area">
                    {/* The paper-sized container */}
                    <div
                        className="bg-white shadow-md border border-neutral-200 shrink-0"
                        style={{
                            width: dimensions.width,
                            minHeight: dimensions.minHeight,
                        }}
                    >
                        {/* The actual content to print passes the ref */}
                        <div ref={printRef} className="w-full h-full">
                            {children}
                        </div>
                    </div>
                </div>

            </div>

            <style>{`
                .print-preview-scroll-area::-webkit-scrollbar {
                    width: 8px;
                    height: 8px;
                }
                .print-preview-scroll-area::-webkit-scrollbar-track {
                    background: transparent;
                }
                .print-preview-scroll-area::-webkit-scrollbar-thumb {
                    background: #cbd5e1;
                    border-radius: 4px;
                }
                .print-preview-scroll-area::-webkit-scrollbar-thumb:hover {
                    background: #94a3b8;
                }
            `}</style>
        </div>
    );
};

export default PrintPreviewModal;
