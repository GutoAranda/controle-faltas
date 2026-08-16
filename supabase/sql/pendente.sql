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

-- ── 2b. Widget Android: vínculo aparelho → conta ──────────────────────────
-- O widget gera um identificador aleatório e o app conecta esse aparelho à
-- conta do aluno com um toque (sem código). Quem lê é a função `widget`
-- (service role); clientes só escrevem o próprio vínculo.
create table if not exists public.widget_aparelhos (
  device_id text primary key check (char_length(device_id) between 32 and 128),
  user_id uuid not null references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);
alter table public.widget_aparelhos enable row level security;
drop policy if exists "conectar aparelho" on public.widget_aparelhos;
create policy "conectar aparelho" on public.widget_aparelhos
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "reconectar aparelho" on public.widget_aparelhos;
create policy "reconectar aparelho" on public.widget_aparelhos
  for update to authenticated using (true) with check (user_id = auth.uid());
drop policy if exists "desconectar aparelho" on public.widget_aparelhos;
create policy "desconectar aparelho" on public.widget_aparelhos
  for delete to authenticated using (user_id = auth.uid());
revoke all on public.widget_aparelhos from anon, authenticated;
-- (permissões de coluna e de tabela têm que ir em comandos separados no Postgres)
grant insert (device_id, user_id) on public.widget_aparelhos to authenticated;
grant update (user_id) on public.widget_aparelhos to authenticated;
grant delete on public.widget_aparelhos to authenticated;

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
