// frontend/src/components/builder/FileExplorer.tsx
import { useState, useMemo } from "react";
import {
  ChevronRight, ChevronDown, FileCode2, FileJson, FileText,
  FolderOpen, Folder, Plus, Trash2, FilePlus, FolderPlus,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { createFile, deleteFile } from "@/lib/devserver";
import { toast } from "sonner";
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
  onDelete: (path: string, isFolder: boolean) => void;
  onCreateInFolder: (folderPath: string) => void;
}

function FileTreeItem({ node, depth, activeFile, onSelect, onDelete, onCreateInFolder }: FileTreeItemProps) {
  const [isOpen, setIsOpen] = useState(depth < 1);

  if (node.type === "folder") {
    return (
      <div>
        <div
          className="group flex w-full items-center gap-1 rounded px-1 py-0.5 text-xs text-slate-400 transition hover:bg-white/5 hover:text-slate-100"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          <button className="flex flex-1 items-center gap-1 truncate" onClick={() => setIsOpen(!isOpen)}>
            {isOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
            {isOpen ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-brand-500" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-brand-500" />}
            <span className="truncate">{node.name}</span>
          </button>
          <button
            className="hidden h-4 w-4 shrink-0 items-center justify-center rounded text-slate-500 group-hover:flex hover:text-green-400"
            title="Novo arquivo nesta pasta"
            onClick={(e) => { e.stopPropagation(); onCreateInFolder(node.path); }}
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            className="hidden h-4 w-4 shrink-0 items-center justify-center rounded text-slate-500 group-hover:flex hover:text-red-400"
            title="Remover pasta"
            onClick={(e) => { e.stopPropagation(); onDelete(node.path, true); }}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        <AnimatePresence>
          {isOpen && node.children && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }}>
              {node.children.map((child) => (
                <FileTreeItem key={child.path} node={child} depth={depth + 1} activeFile={activeFile} onSelect={onSelect} onDelete={onDelete} onCreateInFolder={onCreateInFolder} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const Icon = getFileIcon(node.name);
  return (
    <div
      className={`group flex w-full items-center gap-1 rounded px-1 py-0.5 text-xs transition ${
        activeFile === node.path ? "bg-brand-500/10 text-brand-500" : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
      }`}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
    >
      <button className="flex flex-1 items-center gap-1.5 truncate" onClick={() => onSelect(node.path)}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
      <button
        className="hidden h-4 w-4 shrink-0 items-center justify-center rounded text-slate-500 group-hover:flex hover:text-red-400"
        title="Remover arquivo"
        onClick={(e) => { e.stopPropagation(); onDelete(node.path, false); }}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
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
  onRefreshFiles?: () => void;
  workspace?: string;
  localPath?: string;
}

type CreateMode = { folderPath: string; type: "file" | "folder" } | null;

export default function FileExplorer({ files = [], activeFile, onSelectFile, onRefreshFiles, workspace, localPath }: FileExplorerProps) {
  const fileTree = useMemo(() => buildFileTree(files), [files]);
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [newName, setNewName] = useState("");

  async function handleDelete(filePath: string, isFolder: boolean) {
    const label = isFolder ? "pasta" : "arquivo";
    if (!confirm(`Remover ${label} "${filePath}"? Esta ação não pode ser desfeita.`)) return;
    const result = await deleteFile(filePath, workspace, localPath);
    if (result.ok) {
      toast.success(`${label.charAt(0).toUpperCase() + label.slice(1)} removido`);
      onRefreshFiles?.();
    } else {
      toast.error(result.error ?? `Erro ao remover ${label}`);
    }
  }

  async function handleCreate(type: "file" | "folder", folderPath = "src") {
    setCreateMode({ folderPath, type });
    setNewName("");
  }

  async function confirmCreate() {
    if (!createMode || !newName.trim()) { setCreateMode(null); return; }
    const relPath = `${createMode.folderPath}/${newName.trim()}`;
    const result = await createFile(relPath, createMode.type === "folder", "", workspace, localPath);
    if (result.ok) {
      toast.success(`${createMode.type === "folder" ? "Pasta" : "Arquivo"} criado`);
      onRefreshFiles?.();
      if (createMode.type === "file") onSelectFile(relPath);
    } else {
      toast.error(result.error ?? "Erro ao criar");
    }
    setCreateMode(null);
  }

  return (
    <div className="flex h-full w-full flex-col border-r border-white/10 bg-surface">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Explorer</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleCreate("file", files[0]?.path?.split("/")[0] ?? "src")}
            className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-white/5 hover:text-green-400"
            title="Novo arquivo"
          >
            <FilePlus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => handleCreate("folder", files[0]?.path?.split("/")[0] ?? "src")}
            className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-white/5 hover:text-blue-400"
            title="Nova pasta"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {createMode && (
        <div className="shrink-0 border-b border-white/10 bg-black/30 px-3 py-2">
          <p className="mb-1 text-[10px] text-slate-400">
            Novo {createMode.type === "folder" ? "pasta" : "arquivo"} em <span className="text-brand-400">{createMode.folderPath}/</span>
          </p>
          <div className="flex gap-1">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmCreate(); if (e.key === "Escape") setCreateMode(null); }}
              placeholder={createMode.type === "folder" ? "nome-da-pasta" : "arquivo.tsx"}
              className="flex-1 rounded border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600 outline-none focus:border-brand-500/50"
            />
            <button onClick={confirmCreate} className="rounded bg-brand-500/20 px-2 py-0.5 text-[10px] text-brand-400 hover:bg-brand-500/30">OK</button>
            <button onClick={() => setCreateMode(null)} className="rounded px-2 py-0.5 text-[10px] text-slate-500 hover:bg-white/5">✕</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1">
        {fileTree.length === 0 ? (
          <div className="p-4 text-center text-xs text-slate-500">Nenhum arquivo ainda.</div>
        ) : (
          fileTree.map((node) => (
            <FileTreeItem
              key={node.path}
              node={node}
              depth={0}
              activeFile={activeFile}
              onSelect={onSelectFile}
              onDelete={handleDelete}
              onCreateInFolder={(fp) => { setCreateMode({ folderPath: fp, type: "file" }); setNewName(""); }}
            />
          ))
        )}
      </div>
    </div>
  );
}
