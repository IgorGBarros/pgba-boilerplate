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

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
