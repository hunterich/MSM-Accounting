import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react';

export interface FileDropzoneProps {
  onFile: (file: File) => void;
  accept?: string;
  label?: string;
  selectedName?: string;
}

/**
 * Presentational dashed-border dropzone for picking a single file, either by
 * click-to-browse or drag-and-drop. Purely UI — the caller decides what to do
 * with the selected `File` (parse it, upload it, etc.) via `onFile`.
 */
const FileDropzone: React.FC<FileDropzoneProps> = ({
  onFile,
  accept = '.csv,.xlsx,.xls',
  label = 'Drop your Accurate export here, or click to browse',
  selectedName,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pickedName, setPickedName] = useState<string | undefined>(undefined);

  const displayName = selectedName ?? pickedName;

  const handleFile = (file: File | undefined | null): void => {
    if (!file) return;
    setPickedName(file.name);
    onFile(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    handleFile(e.target.files?.[0]);
    // Allow re-selecting the same file to fire another change event.
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setIsDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setIsDragOver(false);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
        isDragOver ? 'border-primary-500 bg-primary-50' : 'border-neutral-300 hover:border-primary-400'
      }`}
    >
      <Upload size={32} className="mx-auto text-neutral-400 mb-2" />
      <p className="text-neutral-600 font-medium">
        {displayName ? displayName : label}
      </p>
      {!displayName && (
        <p className="text-xs text-neutral-400 mt-1">Accepted formats: {accept}</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleInputChange}
      />
    </div>
  );
};

export default FileDropzone;
