import React, { useRef, useEffect } from 'react';
import { useReactToPrint } from 'react-to-print';
import { X, Printer } from 'lucide-react';
import Button from './Button';

/**
 * PrintPreviewModal displays a document in an A4 sized container on screen,
 * and handles the actual printing via react-to-print when confirmed.
 */
const PrintPreviewModal = ({ isOpen, onClose, title = "Print Preview", documentTitle = "Document", children }) => {
    const printRef = useRef(null);

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: documentTitle,
    });

    // Close on escape key
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 backdrop-blur-sm p-4 sm:p-6 lg:p-8">
            <div className="bg-neutral-50 rounded-xl shadow-xl w-full max-w-5xl max-h-full flex flex-col overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-neutral-200">
                    <h2 className="text-lg font-bold text-neutral-800">{title}</h2>
                    <div className="flex items-center gap-2">
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
                    {/* The A4 Container */}
                    <div
                        className="bg-white shadow-md border border-neutral-200"
                        style={{
                            width: '210mm',
                            minHeight: '297mm',
                            // Add a little padding visually, but the actual print content will be controlled by react-to-print
                        }}
                    >
                        {/* The actual content to print passes the ref */}
                        <div ref={printRef} className="w-full h-full">
                            {children}
                        </div>
                    </div>
                </div>

            </div>

            <style jsx>{`
                /* Hide scrollbar for a cleaner look if desired, or keep it */
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
