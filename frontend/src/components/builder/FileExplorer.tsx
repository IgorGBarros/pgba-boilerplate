// frontend/src/components/builder/FileExplorer.tsx
import { useState, useMemo } from "react";
import { ChevronRight, ChevronDown, FileCode2, FileJson, FileText, FolderOpen, Folder } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { FileNode } from "@/types/builder";

function getFileIcon(name: string) {
  if (name.endsWith(".tsx") || name.endsWith(".ts")) return FileCode2;
  if (name.endsWith(".json")) return FileJson;
  return FileText;
}

interface FileTreeItemProps {
  node: FileNode;
  depth: number;
  activeFile: string | null;
  onSelect: (path: string) => void;
}

function FileTreeItem({ node, depth, activeFile, onSelect }: FileTreeItemProps) {
  const [isOpen, setIsOpen] = useState(depth < 1);

  if (node.type === "folder") {
    return (
      <div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-xs text-slate-400 transition hover:bg-white/5 hover:text-slate-100"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          {isOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          {isOpen ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-brand-500" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-brand-500" />}
          <span className="truncate">{node.name}</span>
        </button>
        <AnimatePresence>
          {isOpen && node.children && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }}>
              {node.children.map((child) => (
                <FileTreeItem key={child.path} node={child} depth={depth + 1} activeFile={activeFile} onSelect={onSelect} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const Icon = getFileIcon(node.name);
  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-xs transition ${
        activeFile === node.path ? "bg-brand-500/10 text-brand-500" : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
      }`}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

function buildFileTree(files: { name: string; path: string; type: string }[]): FileNode[] {
  const root: FileNode[] = [];

  const sorted = [...files].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1));

  sorted.forEach((file) => {
    const parts = file.path.split("/");
    let currentLevel = root;
    let currentPath = "";

    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let existing = currentLevel.find((n) => n.name === part);
      if (!existing) {
        const isFile = index === parts.length - 1 && file.type === "file";
        existing = { name: part, path: currentPath, type: isFile ? "file" : "folder", children: isFile ? undefined : [] };
        currentLevel.push(existing);
      }
      if (existing.type === "folder") currentLevel = existing.children!;
    });
  });

  return root;
}

interface FileExplorerProps {
  files: { name: string; path: string; type: string }[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
}

export default function FileExplorer({ files = [], activeFile, onSelectFile }: FileExplorerProps) {
  const fileTree = useMemo(() => buildFileTree(files), [files]);

  return (
    <div className="flex h-full w-60 shrink-0 flex-col border-r border-white/10 bg-surface">
      <div className="border-b border-white/10 bg-white/5 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Explorer</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {fileTree.length === 0 ? (
          <div className="p-4 text-center text-xs text-slate-500">Nenhum arquivo ainda.</div>
        ) : (
          fileTree.map((node) => <FileTreeItem key={node.path} node={node} depth={0} activeFile={activeFile} onSelect={onSelectFile} />)
        )}
      </div>
    </div>
  );
}
