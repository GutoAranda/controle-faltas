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

-- ── 2c. Seguir a turma: curador atualiza a grade no MESMO código ────────────
-- Antes, cada publicação gerava código novo (a importação era uma fotografia).
-- Agora o app atualiza a linha existente quando o mesmo curador publica com o
-- mesmo nome, e quem importou recebe as novidades sozinho ao abrir o app
-- (checagem leve do atualizado_em). Só o dono da grade pode atualizá-la, e
-- apenas título/dados/data — o código e o dono são imutáveis.
alter table public.grades_compartilhadas add column if not exists atualizado_em timestamptz not null default now();
drop policy if exists "curador atualiza a propria grade" on public.grades_compartilhadas;
create policy "curador atualiza a propria grade" on public.grades_compartilhadas
  for update to authenticated using (criado_por = auth.uid()) with check (criado_por = auth.uid());
grant update (titulo, dados, atualizado_em) on public.grades_compartilhadas to authenticated;

-- ── 2d. Renovação automática opcional (assinatura Mercado Pago) ─────────────
-- O webhook guarda aqui o vínculo da assinatura do usuário (pra exibir o estado
-- no app e permitir o cancelamento em 1 toque). O usuário só LÊ; quem escreve
-- é o servidor (service role). plano_valido_ate ganha leitura pro app mostrar
-- "vence em X dias" — continua sem grant de escrita (ninguém se auto-estende).
alter table public.dados_usuario add column if not exists assinatura_id text;
grant select (plano_valido_ate) on public.dados_usuario to authenticated;
grant select (assinatura_id) on public.dados_usuario to authenticated;

-- ── 2e. Relatório quinzenal por email (dias 1 e 15, 10h de Brasília) ────────
-- Chama a função enviar-relatorios, que monta e envia o resumo de frequência
-- e notas de cada assinante Essencial via Resend. TROQUE o texto
-- COLE_AQUI_A_CHAVE pela mesma senha salva no segredo RELATORIO_CRON_CHAVE.
create extension if not exists pg_net;
select cron.unschedule('relatorios-quinzenais')
  where exists (select 1 from cron.job where jobname = 'relatorios-quinzenais');
select cron.schedule(
  'relatorios-quinzenais',
  '0 13 1,15 * *',
  $$ select net.http_post(
       url := 'https://ejdvolbpqrvtuemunzto.supabase.co/functions/v1/enviar-relatorios',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-relatorio-chave', 'COLE_AQUI_A_CHAVE'),
       body := '{}'::jsonb
     ) $$
);

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
