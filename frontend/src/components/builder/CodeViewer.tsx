// frontend/src/components/builder/CodeViewer.tsx
import { useEffect, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Loader2 } from "lucide-react";
import { fetchFileContent } from "@/lib/devserver";

const LANG_MAP: Record<string, string> = {
  tsx: "typescript",
  ts: "typescript",
  jsx: "javascript",
  js: "javascript",
  css: "css",
  json: "json",
  md: "markdown",
};

interface CodeViewerProps {
  filePath: string;
  workspace?: string;
}

export default function CodeViewer({ filePath, workspace }: CodeViewerProps) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const ext = filePath.split(".").pop() ?? "";
  const language = LANG_MAP[ext] ?? "plaintext";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCode(null);

    fetchFileContent(filePath, workspace).then((text) => {
      if (!cancelled) {
        setCode(text);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [filePath, workspace]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#282c34]">
        <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-[#282c34]">
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        showLineNumbers
        customStyle={{ margin: 0, padding: "12px", fontSize: "12px", lineHeight: "1.5", background: "transparent", minHeight: "100%" }}
        lineNumberStyle={{ color: "#636d83", fontSize: "11px", paddingRight: "16px" }}
      >
        {code || ""}
      </SyntaxHighlighter>
    </div>
  );
}
