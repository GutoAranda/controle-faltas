-- ============================================================
-- PAINEL DO LANCAMENTO - cole no SQL Editor e rode quando quiser
-- ============================================================

-- 1. Numeros do dia (1 linha)
select
  (select count(*) from auth.users)                                                        as contas_total,
  (select count(*) from auth.users where created_at >= now() - interval '24 hours')        as contas_24h,
  (select count(*) from auth.users where created_at >= now() - interval '7 days')          as contas_7d,
  (select count(*) from auth.users where raw_user_meta_data->>'aceita_marketing' = 'true') as optin_marketing,
  (select count(*) from public.dados_usuario where plano <> 'gratis')                      as essencial_ativos,
  (select count(*) from public.dados_usuario where atualizado_em >= now() - interval '24 hours') as sincronizaram_24h,
  (select count(*) from public.push_inscricoes)                                            as aparelhos_com_push;

-- 2. Quem chegou (ultimos 20 cadastros - pra ativar o mes gratis da NA9)
select email, created_at::date as dia,
       raw_user_meta_data->>'curso' as curso,
       raw_user_meta_data->>'instituicao' as instituicao,
       raw_user_meta_data->>'aceita_marketing' as optin
from auth.users order by created_at desc limit 20;

-- 3. Cadastros por dia (curva do lancamento)
select created_at::date as dia, count(*) as contas
from auth.users group by 1 order by 1 desc limit 14;

-- 4. Ativar o MES GRATIS da NA9 (troque o email):
-- update public.dados_usuario set plano = 'essencial',
--   plano_valido_ate = now() + interval '30 days'
-- where user_id = (select id from auth.users where email = 'EMAIL_AQUI');

-- 5. Ativar o SEMESTRE do bolsista (troque o email):
-- update public.dados_usuario set plano = 'essencial',
--   plano_valido_ate = '2026-12-31'
-- where user_id = (select id from auth.users where email = 'EMAIL_AQUI');
-- 6. De onde vem cada Essencial (pagamento x codigo x promo manual)
select coalesce(plano_origem, 'sem registro') as origem, count(*) as contas
from public.dados_usuario where plano <> 'gratis' group by 1 order by 2 desc;

-- 7. Uso dos codigos promocionais
select codigo, descricao, usos, max_usos, ativo, expira_em::date
from public.codigos_resgate order by usos desc;