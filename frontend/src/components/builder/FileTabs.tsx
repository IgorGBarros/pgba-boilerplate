// frontend/src/components/builder/FileTabs.tsx
import { X, FileCode2, Globe } from "lucide-react";

interface FileTabsProps {
  openFiles: string[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  showPreview: boolean;
  onSelectPreview: () => void;
}

export default function FileTabs({ openFiles, activeFile, onSelectFile, onCloseFile, showPreview, onSelectPreview }: FileTabsProps) {
  const getFileName = (path: string) => path.split("/").pop() ?? path;

  return (
    <div className="flex items-center overflow-x-auto border-b border-white/10 bg-surface">
      <div
        className={`group flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-white/10 px-3 py-1.5 text-[11px] transition ${
          showPreview ? "border-b-2 border-b-brand-500 bg-surface-raised text-slate-100" : "text-slate-500 hover:bg-white/5 hover:text-slate-100"
        }`}
        onClick={onSelectPreview}
      >
        <Globe className="h-3 w-3 shrink-0 text-green-500" />
        <span className="truncate">Preview</span>
      </div>

      {openFiles.map((file) => (
        <div
          key={file}
          className={`group flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-white/10 px-3 py-1.5 text-[11px] transition ${
            !showPreview && activeFile === file
              ? "border-b-2 border-b-brand-500 bg-surface-raised text-slate-100"
              : "text-slate-500 hover:bg-white/5 hover:text-slate-100"
          }`}
          onClick={() => onSelectFile(file)}
        >
          <FileCode2 className="h-3 w-3 shrink-0" />
          <span className="max-w-[120px] truncate">{getFileName(file)}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCloseFile(file);
            }}
            className="ml-0.5 flex h-4 w-4 items-center justify-center rounded opacity-0 transition-opacity hover:bg-white/10 group-hover:opacity-100"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
