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

-- [2b] TRAVA ANTI-COBRANCA-DUPLICADA ---------------------------
-- O Mercado Pago reenvia a mesma notificacao (retry / payment+merchant_order).
-- Sem esta tabela, um pagamento credita dias 2x (prejuizo). O id do pagamento
-- e a chave primaria: repetido = conflito = webhook ignora.
create table if not exists public.pagamentos_processados (
  pagamento_id text primary key,
  user_id      uuid references auth.users(id) on delete set null,
  criado_em    timestamptz not null default now()
);
alter table public.pagamentos_processados enable row level security;
-- sem policies: so o webhook (service role) acessa

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


-- [6] MEDICAO DE CONVERSAO (anonima e agregada) ----------------
-- Guarda SO contadores por dia+evento. Nao ha user_id, nao ha como
-- reconstruir quem fez o que. RPC com SECURITY DEFINER para o app somar 1.
create table if not exists public.metricas_diarias (
  dia    date not null default (now() at time zone 'America/Sao_Paulo')::date,
  evento text not null,
  total  int  not null default 0,
  primary key (dia, evento)
);
alter table public.metricas_diarias enable row level security;
-- sem policies: ninguem le nem escreve direto; so a funcao abaixo

create or replace function public.registrar_metrica(p_evento text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_evento is null or length(p_evento) > 40 then return; end if;
  insert into public.metricas_diarias (dia, evento, total)
  values ((now() at time zone 'America/Sao_Paulo')::date, p_evento, 1)
  on conflict (dia, evento) do update set total = public.metricas_diarias.total + 1;
end $fn$;
revoke all on function public.registrar_metrica(text) from public;
grant execute on function public.registrar_metrica(text) to authenticated;

-- [7] TRIAL DE 7 DIAS EM CONTA NOVA ---------------------------
-- O app so consegue inserir (user_id, dados) - nao tem grant nas colunas de
-- plano - entao o DEFAULT do banco e quem concede o teste. Seguro por construcao.
alter table public.dados_usuario alter column plano set default 'essencial';
alter table public.dados_usuario alter column plano_valido_ate set default (now() + interval '7 days');
alter table public.dados_usuario alter column plano_origem set default 'trial';

-- [8] REBAIXAMENTO DE PLANO VENCIDO (o que faz o trial acabar) -
-- roda 03:15 todo dia: quem venceu volta pro gratis
do $$ begin perform cron.unschedule('rebaixar-planos-vencidos'); exception when others then null; end $$;
select cron.schedule('rebaixar-planos-vencidos', '15 3 * * *',
  $cron$ update public.dados_usuario set plano = 'gratis'
          where plano <> 'gratis' and plano_valido_ate is not null and plano_valido_ate < now() $cron$);


-- [9] COMPARTILHAR PROVAS/ATIVIDADES (codigo de 7 dias) --------
-- Pacote de eventos que um aluno manda pro grupo. Some sozinho: o app recusa
-- na leitura depois de 7 dias e a faxina apaga da base. Sem dado pessoal:
-- so titulo, tipo, data, peso e nome da materia (nunca faltas, notas ou "feita").
create table if not exists public.eventos_compartilhados (
  codigo     text primary key,
  dados      jsonb not null,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em  timestamptz not null default now(),
  expira_em  timestamptz not null default (now() + interval '7 days')
);
alter table public.eventos_compartilhados enable row level security;
drop policy if exists ev_leitura on public.eventos_compartilhados;
drop policy if exists ev_criar on public.eventos_compartilhados;
-- leitura publica (quem recebe o link pode nao ter conta ainda) mas so no prazo
create policy ev_leitura on public.eventos_compartilhados for select to anon, authenticated
  using (expira_em > now());
create policy ev_criar on public.eventos_compartilhados for insert to authenticated
  with check (auth.uid() = criado_por);
grant select on public.eventos_compartilhados to anon, authenticated;
grant insert (codigo, dados, criado_por) on public.eventos_compartilhados to authenticated;

do $$ begin perform cron.unschedule('faltae-faxina-eventos'); exception when others then null; end $$;
select cron.schedule('faltae-faxina-eventos', '20 7 * * *',
  $cron$ delete from public.eventos_compartilhados where expira_em < now() $cron$);
-- CONSULTAS UTEIS (rode quando quiser ver o funil)
-- select * from public.metricas_diarias order by dia desc, total desc;
-- select plano_origem, count(*) from public.dados_usuario where plano <> 'gratis' group by 1;
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