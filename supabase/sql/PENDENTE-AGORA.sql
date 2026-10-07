-- ================================================================
-- FALTAE - SO O QUE FALTA (medido no banco em 19/08/2026)
-- Cole tudo de uma vez no SQL Editor e rode. Idempotente.
--
-- COMO EU SEI: sondei o banco pelo proprio app. PGRST205 = a tabela nao
-- existe; 42501 = existe (so nao tenho permissao de ler). Resultado:
--
--   JA ESTA NO BANCO, nao repito aqui:
--     push_inscricoes . parceiros . ativacoes
--     dados_usuario: plano_origem, plano_valido_ate, assinatura_id
--
--   FALTA (confirmado):
--     [A] pagamentos_processados  - trava anti-cobranca-duplicada
--     [B] metricas_diarias + registrar_metrica() - medicao
--     [C] eventos_compartilhados  - compartilhar provas (o erro de hoje)
--     [D] dados_usuario.relatorio_em - fila do relatorio quinzenal
--
--   NAO DA PRA VERIFICAR DAQUI (crons e defaults): estao na secao [E].
--     Recriar cron nao quebra nada - o proprio bloco desagenda antes.
--
-- DE PROPOSITO FORA DESTE ARQUIVO: o "update auth.users set
-- email_confirmed_at = now()" da secao 0 do arquivo antigo. Aquilo foi
-- remendo de emergencia de quando o email nao saia. Agora que o Resend
-- funciona, rodar de novo confirmaria a conta de quem NUNCA clicou no
-- link - ou seja, desligaria a confirmacao de email na marra. Nao rode.
-- ================================================================


-- [A] TRAVA ANTI-COBRANCA-DUPLICADA -----------------------------
-- O Mercado Pago reenvia a mesma notificacao (retry, ou payment +
-- merchant_order do mesmo Pix). Sem esta tabela o mesmo dinheiro
-- credita dias DUAS vezes. A chave primaria e o id do pagamento:
-- repetido = conflito = o webhook ignora.
create table if not exists public.pagamentos_processados (
  pagamento_id text primary key,
  user_id      uuid references auth.users(id) on delete set null,
  criado_em    timestamptz not null default now()
);
alter table public.pagamentos_processados enable row level security;
-- sem policies: so o webhook (service role) acessa


-- [B] MEDICAO DE CONVERSAO (anonima e agregada) -----------------
-- Guarda SO contadores por dia+evento. Nao ha user_id: nao da pra
-- reconstruir quem fez o que. E a base pra decidir push x email com
-- numero em vez de chute.
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


-- [C] COMPARTILHAR PROVAS/ATIVIDADES ----------------------------
-- E a tabela que faltava e derrubava o botao Compartilhar da Agenda.
-- Some sozinha: o app recusa na leitura depois de 7 dias e a faxina
-- apaga da base. Sem dado pessoal - so titulo, tipo, data, peso e nome
-- da materia (nunca faltas, notas ou o "feita" de ninguem).
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


-- [D] FILA DO RELATORIO QUINZENAL -------------------------------
-- Antes o relatorio saia nos dias 1 e 15, todos de uma vez, e a rajada
-- estourava o teto de 100 emails/dia do Resend levando junto os emails
-- de CADASTRO - que sao os que deixam um aluno novo entrar. Agora o cron
-- roda todo dia e a funcao manda so pra quem esta ha 14+ dias sem receber,
-- do mais antigo pro mais novo, ate um teto diario. Esta coluna e a
-- memoria dessa fila. So o servidor escreve nela (o app nao tem grant),
-- entao ninguem adianta a propria vez.
alter table public.dados_usuario add column if not exists relatorio_em timestamptz;
create index if not exists dados_usuario_relatorio_idx
  on public.dados_usuario (relatorio_em nulls first) where plano <> 'gratis';

do $$ begin perform cron.unschedule('faltae-relatorio-quinzenal'); exception when others then null; end $$;
select cron.schedule('faltae-relatorio-quinzenal', '40 11 * * *',
  $cron$
  select net.http_post(
    url := 'https://ejdvolbpqrvtuemunzto.supabase.co/functions/v1/enviar-relatorios',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-relatorio-chave', (select decrypted_secret from vault.decrypted_secrets where name = 'relatorio_cron_chave')
    ),
    body := '{}'::jsonb
  );
  $cron$);


-- [E] O QUE NAO DA PRA VERIFICAR DAQUI --------------------------
-- Crons e defaults nao aparecem pra sonda do app. Rodar de novo e
-- inofensivo: cada bloco desagenda antes de agendar, e os defaults
-- apenas reafirmam o valor.

-- lembrete de prova (push) todo dia
do $$ begin perform cron.unschedule('faltae-push-provas'); exception when others then null; end $$;
select cron.schedule('faltae-push-provas', '30 10 * * *', $cron$
  select net.http_post(
    url := 'https://ejdvolbpqrvtuemunzto.supabase.co/functions/v1/enviar-push',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-push-chave', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_chave')),
    body := '{}'::jsonb)
$cron$);

-- faxina das ativacoes de parceria vencidas ha mais de 30 dias
do $$ begin perform cron.unschedule('faltae-faxina-ativacoes'); exception when others then null; end $$;
select cron.schedule('faltae-faxina-ativacoes', '15 7 * * *',
  $cron$ delete from public.ativacoes where expira_em < now() - interval '30 days' $cron$);

-- teste gratis de 7 dias em conta nova: quem concede e o DEFAULT do banco,
-- porque o app nao tem permissao de escrever nas colunas de plano
alter table public.dados_usuario alter column plano set default 'essencial';
alter table public.dados_usuario alter column plano_valido_ate set default (now() + interval '7 days');
alter table public.dados_usuario alter column plano_origem set default 'trial';

-- o que faz o teste acabar: quem venceu volta pro gratis, 03:15 todo dia
do $$ begin perform cron.unschedule('rebaixar-planos-vencidos'); exception when others then null; end $$;
select cron.schedule('rebaixar-planos-vencidos', '15 3 * * *',
  $cron$ update public.dados_usuario set plano = 'gratis'
         where plano <> 'gratis' and plano_valido_ate is not null and plano_valido_ate < now() $cron$);

-- VOCE COMO PARCEIRO: troque pelo email da SUA conta do Faltae se nao for este.
-- Sem esta linha a tela ?parcerias responde "area exclusiva das parcerias".
insert into public.parceiros (user_id, rotulo)
select id, 'fundador' from auth.users where email = 'contato.gustavoaranda@gmail.com'
on conflict (user_id) do nothing;


-- ================================================================
-- CONFERE SE DEU CERTO (rode isto depois; tem que voltar 4 linhas 'ok')
-- ================================================================
select 'pagamentos_processados' as item,
       case when to_regclass('public.pagamentos_processados') is null then 'FALTA' else 'ok' end as situacao
union all select 'metricas_diarias',
       case when to_regclass('public.metricas_diarias') is null then 'FALTA' else 'ok' end
union all select 'eventos_compartilhados',
       case when to_regclass('public.eventos_compartilhados') is null then 'FALTA' else 'ok' end
union all select 'dados_usuario.relatorio_em',
       case when not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'dados_usuario' and column_name = 'relatorio_em')
            then 'FALTA' else 'ok' end;

-- e os crons agendados:
-- select jobname, schedule from cron.job order by jobname;


-- [F] FECHAR A METRICA PRO ANONIMO ------------------------------
-- Descoberto na sonda: 'revoke all from public' nao tirou o anon, e um
-- visitante deslogado conseguia chamar registrar_metrica e inflar os
-- contadores. Nao vaza nada (a tabela so tem dia+evento+total), mas
-- suja o unico numero que vai embasar decisao de produto. O app so
-- chama a funcao com usuario logado, entao revogar nao quebra nada.
revoke execute on function public.registrar_metrica(text) from anon;


-- [G] SEGUNDA CAMADA EM dados_usuario ---------------------------
-- Achado numa sondagem com a chave publica: um DELETE anonimo em
-- dados_usuario NAO era barrado no nivel de permissao (voltava sucesso
-- com 0 linhas). Nada foi apagado, porque a trava de linha (RLS) filtrou
-- tudo - mas a protecao estava dependendo de UMA camada so, enquanto
-- INSERT e UPDATE eram barrados por DUAS (permissao + RLS).
-- Nem o app nem as funcoes de borda apagam essa tabela pelo cliente:
-- a exclusao de conta roda com service role, que ignora grant. Entao
-- revogar nao tira funcionalidade nenhuma e devolve a segunda camada.
revoke delete on public.dados_usuario from anon, authenticated;
