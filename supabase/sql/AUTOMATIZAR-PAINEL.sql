-- ═══════════════════════════════════════════════════════════════════════════
-- FALTAÊ · AUTOMATIZAR O PAINEL DE NEGÓCIO (e-mail diário, sem rodar SQL)
-- Cole tudo no SQL Editor e rode uma vez. Cria:
--   1. a função painel_semanal() que devolve TODO o painel como um JSON
--   2. o cron que dispara a função de borda 'painel-semanal' TODO DIA às 08:00 BRT
-- Depois falta só publicar a função de borda (passo no PLANO). Reusa o segredo
-- relatorio_cron_chave que você já criou — nenhum segredo novo.
-- Idempotente: rodar 2x não quebra.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.painel_semanal()
returns jsonb
language sql
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'gerado_em', to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),

    -- [A] pulso
    'contas_total',    (select count(*) from auth.users),
    'novas_7d',        (select count(*) from auth.users where created_at >= now() - interval '7 days'),
    'novas_24h',       (select count(*) from auth.users where created_at >= now() - interval '24 hours'),
    'ativaram',        (select count(*) from dados_usuario
                          where jsonb_typeof(dados->'materias')='array' and jsonb_array_length(dados->'materias')>0),
    'push',            (select count(*) from push_inscricoes),
    'essencial',       (select count(*) from dados_usuario where plano <> 'gratis'),
    'pagantes',        (select count(distinct user_id) from pagamentos_processados),
    'pagamentos_7d',   (select count(*) from pagamentos_processados where criado_em >= now() - interval '7 days'),

    -- [B] funil de ativação (do jsonb)
    'funil', (select jsonb_build_object(
        'nuvem', count(*),
        'grade', count(*) filter (where jsonb_typeof(dados->'materias')='array' and jsonb_array_length(dados->'materias')>0),
        'falta', count(*) filter (where jsonb_typeof(dados->'faltas')='array'   and jsonb_array_length(dados->'faltas')>0),
        'prova', count(*) filter (where jsonb_typeof(dados->'eventos')='array'  and jsonb_array_length(dados->'eventos')>0)
      ) from dados_usuario),

    -- [C] retenção (só Essencial sincroniza)
    'ret', (select jsonb_build_object(
        'd1',   count(*) filter (where atualizado_em >= now() - interval '24 hours'),
        'd7',   count(*) filter (where atualizado_em >= now() - interval '7 days'),
        'd30',  count(*) filter (where atualizado_em >= now() - interval '30 days'),
        'base', count(*)
      ) from dados_usuario where plano <> 'gratis'),

    -- [D] monetização por origem
    'origem', (select coalesce(jsonb_agg(jsonb_build_object('origem', origem, 'contas', contas) order by contas desc), '[]'::jsonb)
      from (select coalesce(plano_origem,'sem registro') as origem, count(*) as contas
            from dados_usuario where plano <> 'gratis' group by 1) o),

    -- [E] intenção de compra (métricas dos últimos 7 dias)
    'conv', (select jsonb_build_object(
        'viu',   coalesce(sum(total) filter (where evento='plano_tela_gratis'),0),
        'tocou', coalesce(sum(total) filter (where evento like 'passe_toque_%'),0)
      ) from metricas_diarias where dia >= current_date - 7),

    -- [I] janela: vencendo nos próximos 7 dias
    'vencendo', (select coalesce(jsonb_agg(jsonb_build_object(
          'email', u.email,
          'origem', d.plano_origem,
          'dias', (d.plano_valido_ate::date - current_date)
        ) order by d.plano_valido_ate), '[]'::jsonb)
      from dados_usuario d join auth.users u on u.id = d.user_id
      where d.plano <> 'gratis' and d.plano_valido_ate is not null
        and d.plano_valido_ate between now() and now() + interval '7 days'),

    -- gatilhos que mais levaram à oferta (7 dias)
    'gatilhos', (select coalesce(jsonb_agg(jsonb_build_object('evento', evento, 'n', n) order by n desc), '[]'::jsonb)
      from (select evento, sum(total) as n from metricas_diarias
            where dia >= current_date - 7
              and (evento like '%_upgrade' or evento like 'bloqueio_%' or evento='trial_iniciado')
            group by evento order by n desc limit 5) g)
  );
$fn$;

revoke all on function public.painel_semanal() from public, anon, authenticated;
-- só o service role (função de borda) executa; ninguém acessa pela API pública

-- cron: todo dia às 08:00 BRT (11:00 UTC)
do $$ begin perform cron.unschedule('faltae-painel-diario'); exception when others then null; end $$;
select cron.schedule('faltae-painel-diario', '0 11 * * *',
  $cron$
  select net.http_post(
    url := 'https://ejdvolbpqrvtuemunzto.supabase.co/functions/v1/painel-semanal',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-painel-chave', (select decrypted_secret from vault.decrypted_secrets where name = 'relatorio_cron_chave')
    ),
    body := '{}'::jsonb
  );
  $cron$);

-- pra testar agora: rode e veja o JSON completo
-- select public.painel_semanal();
