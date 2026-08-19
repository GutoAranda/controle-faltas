-- ================================================================
-- FALTAE - SETUP UNICO (cole TUDO de uma vez no SQL Editor e rode)
-- Idempotente: rodar 2x nao quebra nada.
-- Cobre TODO o SQL pendente ate 19/08/2026:
--   [1] Push (tabela + RLS + cron das 07:30)
--   [2] Origem do plano (pagamento x parceria x promo manual)
--   [3] Parcerias: ativacoes nominais + tabela de parceiros
--   [4] Faxinas automaticas (ativacoes vencidas)
--   [5] Voce como primeiro parceiro
-- DEPOIS de rodar, faltam 3 coisas que SQL nao faz (checklist no fim).
-- ================================================================

-- [0] DESTRAVA O CADASTRO (bug 'muitas tentativas') ------------
-- Confirma os emails de quem criou conta mas nunca recebeu o email
-- de confirmacao (o servidor embutido tem limite de ~2/hora e travou
-- no lancamento). Essas contas nao conseguiam logar.
-- PLANO: a confirmacao de email VOLTA a ficar LIGADA assim que o SMTP do
-- Resend estiver configurado (checklist abaixo) - o problema nunca foi a
-- confirmacao, era o servidor embutido de ~2 emails/hora. O toggle esta
-- desligado só como medida de emergencia do lancamento.
-- Este update confirma retroativamente quem ficou preso no limbo.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

-- [1] PUSH ------------------------------------------------------
create table if not exists public.push_inscricoes (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  dados      jsonb not null,
  criado_em  timestamptz not null default now()
);
alter table public.push_inscricoes enable row level security;
drop policy if exists push_sel on public.push_inscricoes;
drop policy if exists push_ins on public.push_inscricoes;
drop policy if exists push_upd on public.push_inscricoes;
drop policy if exists push_del on public.push_inscricoes;
create policy push_sel on public.push_inscricoes for select to authenticated using (auth.uid() = user_id);
create policy push_ins on public.push_inscricoes for insert to authenticated with check (auth.uid() = user_id);
create policy push_upd on public.push_inscricoes for update to authenticated using (auth.uid() = user_id);
create policy push_del on public.push_inscricoes for delete to authenticated using (auth.uid() = user_id);
grant select, insert, update, delete on public.push_inscricoes to authenticated;

do $$ begin perform cron.unschedule('faltae-push-provas'); exception when others then null; end $$;
select cron.schedule('faltae-push-provas', '30 10 * * *', $cron$
  select net.http_post(
    url := 'https://ejdvolbpqrvtuemunzto.supabase.co/functions/v1/enviar-push',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-push-chave', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_chave')),
    body := '{}'::jsonb)
$cron$);

-- [2] ORIGEM DO PLANO ------------------------------------------
alter table public.dados_usuario add column if not exists plano_origem text;
update public.dados_usuario set plano_origem = 'promo-manual'
 where plano <> 'gratis' and plano_origem is null;

-- [3] PARCERIAS: ativacoes nominais ----------------------------
create table if not exists public.parceiros (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  rotulo    text not null,             -- ex.: 'da-ponte-pra-ca', 'fundador'
  criado_em timestamptz not null default now()
);
alter table public.parceiros enable row level security;
-- sem policies: usuarios nao leem; so as funcoes (service role) acessam

create table if not exists public.ativacoes (
  codigo     text primary key,          -- ATV-XXXXXX
  email_alvo text not null,
  plano_tipo text not null default 'semestral',  -- 'semestral' (ate 31/12) | 'mensal' (+30d no resgate)
  rotulo     text,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em  timestamptz not null default now(),
  expira_em  timestamptz not null,
  usado_em   timestamptz,
  usado_por  uuid,
  ativo      boolean not null default true
);
create index if not exists ativacoes_email on public.ativacoes (email_alvo);
alter table public.ativacoes enable row level security;
-- sem policies: so as funcoes acessam

-- [4] FAXINA DIARIA (ativacoes vencidas ha mais de 30 dias) ----
do $$ begin perform cron.unschedule('faltae-faxina-ativacoes'); exception when others then null; end $$;
select cron.schedule('faltae-faxina-ativacoes', '15 7 * * *',
  $cron$ delete from public.ativacoes where expira_em < now() - interval '30 days' $cron$);

-- [5] VOCE COMO PRIMEIRO PARCEIRO ------------------------------
insert into public.parceiros (user_id, rotulo)
select id, 'fundador' from auth.users where email = 'contato.gustavoaranda@gmail.com'
on conflict (user_id) do nothing;

-- ================================================================
-- CHECKLIST DO QUE O SQL NAO FAZ (painel, uma vez so):
-- ( ) Secrets em Edge Functions > Secrets: VAPID_PUBLIC_KEY,
--     VAPID_PRIVATE_KEY (do arquivo SEGREDOS-PUSH.txt) e PUSH_CRON_CHAVE
--     (invente uma senha) + Vault: crie o segredo 'push_cron_chave' com o MESMO valor
-- ( ) Publicar 3 funcoes (Edge Functions > Deploy):
--     enviar-push (Verify JWT OFF) · gerar-ativacao (JWT ON) · resgatar-ativacao (JWT ON)
-- ( ) Re-publicar mercadopago-webhook (agora grava plano_origem='pagamento')
-- ( ) Auth > SMTP: configurar Resend (host smtp.resend.com, porta 465,
--     usuario 'resend', senha = API key do Resend, remetente suporte@faltae.com.br)
-- ( ) Auth > Rate Limits: subir emails para 100/hora (so libera com SMTP proprio)
-- ( ) Auth > Sign In / Providers > Email: RELIGAR 'Confirm email'
--     (cadastro volta a exigir confirmacao - agora com email que chega)
-- Para adicionar um coletivo parceiro depois:
--   insert into public.parceiros (user_id, rotulo)
--   select id, 'da-ponte-pra-ca' from auth.users where email = 'EMAIL_DO_COLETIVO';
-- ================================================================