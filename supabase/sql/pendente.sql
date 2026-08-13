-- Faltaê — SQL pendente (rodar UMA vez no painel do Supabase → SQL Editor → Run)
-- Reúne tudo que ainda não foi aplicado: sugestões in-app + colunas de cobrança + rebaixamento automático.

-- ── 1. Sugestões dentro do app ─────────────────────────────────────────────
-- Caixa de entrada só-escrita: qualquer um envia, ninguém lê pela API (você lê no painel).
create table if not exists public.sugestoes (
  id uuid primary key default gen_random_uuid(),
  mensagem text not null check (char_length(mensagem) between 5 and 2000),
  email text,
  criado_em timestamptz not null default now()
);
alter table public.sugestoes enable row level security;
drop policy if exists "qualquer um envia sugestao" on public.sugestoes;
create policy "qualquer um envia sugestao" on public.sugestoes
  for insert to anon, authenticated with check (true);
revoke all on public.sugestoes from anon, authenticated;
grant insert (mensagem, email) on public.sugestoes to anon, authenticated;

-- ── 2. Cobrança: validade do plano ─────────────────────────────────────────
-- O webhook do Mercado Pago escreve aqui (30 dias por pagamento).
-- Testers têm plano_valido_ate nulo = nunca vencem. Usuário comum NÃO tem grant
-- nessa coluna (os grants existentes são por coluna), então ninguém se auto-promove.
alter table public.dados_usuario add column if not exists plano_valido_ate timestamptz;

-- ── 3. Rebaixamento automático de planos vencidos (roda todo dia às 03:15) ─
create extension if not exists pg_cron;
select cron.unschedule('rebaixar-planos-vencidos')
  where exists (select 1 from cron.job where jobname = 'rebaixar-planos-vencidos');
select cron.schedule(
  'rebaixar-planos-vencidos',
  '15 3 * * *',
  $$ update public.dados_usuario
       set plano = 'gratis'
     where plano <> 'gratis'
       and plano_valido_ate is not null
       and plano_valido_ate < now() $$
);
