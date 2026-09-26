export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-3xl font-semibold text-slate-900">PROJECT_NAME_PLACEHOLDER</h1>
      <p className="mt-3 text-slate-600">
        Projeto criado pelo setor de Desenvolvimento. Descreva uma página na aba “Gerar” do Studio, ou
        configure <code className="rounded bg-slate-100 px-1">src/lib/supabase.ts</code> com suas chaves e
        faça deploy em{" "}
        <a className="text-brand-500 underline" href="https://vercel.com/new">
          vercel.com/new
        </a>
        .
      </p>
    </main>
  );
}
