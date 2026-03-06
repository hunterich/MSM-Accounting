import React, { useEffect } from 'react';
import { X } from 'lucide-react';

const sizeClasses = {
    sm: 'max-w-[400px]',
    md: 'max-w-[600px]',
    lg: 'max-w-[800px]',
};

const Modal = ({ isOpen, onClose, title, children, size = 'md' }) => {
    if (!isOpen) return null;

    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] backdrop-blur-[2px]" onClick={onClose}>
            <div
                className={`bg-neutral-0 rounded-xl w-[90%] max-h-[90vh] flex flex-col shadow-lg animate-modal-slide-in ${sizeClasses[size] || sizeClasses.md}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-6 py-5 border-b border-neutral-200 flex justify-between items-center">
                    <h2 className="text-xl font-semibold m-0">{title}</h2>
                    <button
                        onClick={onClose}
                        className="bg-transparent border-none cursor-pointer text-neutral-600 p-1 rounded inline-flex items-center justify-center hover:bg-neutral-100 transition-colors duration-200"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto">
                    {children}
                </div>
            </div>
        </div>
    );
};

export default Modal;
