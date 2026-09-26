// src/lib/supabase.ts
// Cliente único do Supabase — nunca instancie createClient em outro lugar.
// Preencha as variáveis abaixo no .env (Vercel: em Project Settings > Environment Variables).
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY não configurados — configure no .env antes de usar o Supabase.",
  );
}

// Sem as chaves, cria o cliente com um endereço de exemplo em vez de
// quebrar o import: a página abre, e cada chamada falha com erro tratável.
export const supabase = createClient(
  supabaseUrl || "https://exemplo.supabase.co",
  supabaseAnonKey || "chave-anon-nao-configurada",
);
