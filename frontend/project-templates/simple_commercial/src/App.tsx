import { useEffect, useState } from "react";
import { routes } from "@/generated-config/routes";

// Navegação mínima por hash (#/pagina) entre as páginas de src/pages —
// sem dependência de roteamento. O preview do Studio abre direto numa
// página por esse hash. Troque por react-router quando o projeto crescer.
function currentPath() {
  return window.location.hash.replace(/^#/, "") || "/home";
}

export default function App() {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const onHash = () => setPath(currentPath());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const current = routes.find((r) => r.path === path) ?? routes[0];
  const Page = current?.component;

  return (
    <div className="min-h-screen">
      {routes.length > 1 && (
        <nav className="flex flex-wrap gap-2 border-b border-slate-200 bg-white px-4 py-2">
          {routes.map((r) => (
            <a
              key={r.path}
              href={`#${r.path}`}
              className={`rounded-card px-3 py-1 text-sm ${
                r.path === current?.path ? "bg-brand-500 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {r.name}
            </a>
          ))}
        </nav>
      )}
      {Page ? <Page /> : null}
    </div>
  );
}
