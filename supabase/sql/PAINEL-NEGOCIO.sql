-- ═══════════════════════════════════════════════════════════════════════════
-- FALTAÊ · PAINEL DE NEGÓCIO
-- Cole no SQL Editor do Supabase e rode um BLOCO por vez (cada um entre as linhas
-- ───). Roda como service role, então enxerga tudo (ignora RLS). Nada aqui ESCREVE
-- — é tudo leitura, menos os dois helpers de ativação no fim, que estão comentados.
--
-- COMO LER: cada bloco começa com PERGUNTA (o que ele responde) e DECISÃO (o que
-- fazer com a resposta). Comece pelo [A]; ele diz onde vale se aprofundar hoje.
--
-- LIMITE HONESTO: o valor em R$ de cada pagamento NÃO fica no banco, fica no
-- painel do Mercado Pago (Atividade/Vendas). Aqui dá pra contar transações e saber
-- de quem são, não somar receita. Onde isso aparece, está avisado.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- [A] PULSO DO DIA — a olhada de 10 segundos
-- PERGUNTA: como o negócio está agora, num cartão só?
-- DECISÃO: se "ativaram_de_fato" for baixo perto de "contas_total", o problema é
--          ONBOARDING (gente cria conta e não usa) — some features não resolvem.
--          Se for alto e "pagantes" for 0, o problema é PREÇO/OFERTA, não produto.
-- ───────────────────────────────────────────────────────────────────────────
select
  (select count(*) from auth.users)                                                          as contas_total,
  (select count(*) from auth.users where created_at >= now() - interval '24 hours')          as novas_24h,
  (select count(*) from auth.users where created_at >= now() - interval '7 days')            as novas_7d,
  (select count(*) from public.dados_usuario
     where jsonb_typeof(dados->'materias') = 'array'
       and jsonb_array_length(dados->'materias') > 0)                                         as ativaram_de_fato,
  (select count(*) from public.dados_usuario
     where atualizado_em >= now() - interval '7 days')                                        as usaram_7d,
  (select count(*) from public.push_inscricoes)                                              as aparelhos_com_push,
  (select count(*) from public.dados_usuario where plano <> 'gratis')                        as essencial_ativos,
  (select count(distinct user_id) from public.pagamentos_processados)                        as pagantes_reais;


-- ───────────────────────────────────────────────────────────────────────────
-- [B] FUNIL DE ATIVAÇÃO — o aluno chega a USAR, ou só cria conta e some?
-- PERGUNTA: de cada 100 que criam conta, quantos montam grade, marcam falta,
--           cadastram prova, lançam nota? Onde eles desistem?
-- DECISÃO: o maior tombo entre uma linha e a seguinte é o que consertar primeiro.
--          Ex.: se caem muito de "montou grade" pra "marcou 1 falta", o gesto
--          central do app não está óbvio — é onde mexer, não em recurso novo.
-- ───────────────────────────────────────────────────────────────────────────
with base as (select count(*)::numeric as n from public.dados_usuario),
c as (
  select
    count(*) filter (where jsonb_typeof(dados->'materias')='array' and jsonb_array_length(dados->'materias')>0) as montou_grade,
    count(*) filter (where jsonb_typeof(dados->'faltas')='array'   and jsonb_array_length(dados->'faltas')>0)   as marcou_falta,
    count(*) filter (where jsonb_typeof(dados->'eventos')='array'  and jsonb_array_length(dados->'eventos')>0)  as tem_prova_agenda
  from public.dados_usuario
)
select 'contas com dados na nuvem' as etapa, (select n from base)::int as alunos, '100%' as do_total
union all select 'montou a grade', c.montou_grade, round(100*c.montou_grade/nullif((select n from base),0))||'%' from c
union all select 'marcou ao menos 1 falta', c.marcou_falta, round(100*c.marcou_falta/nullif((select n from base),0))||'%' from c
union all select 'cadastrou prova/atividade', c.tem_prova_agenda, round(100*c.tem_prova_agenda/nullif((select n from base),0))||'%' from c;


-- ───────────────────────────────────────────────────────────────────────────
-- [C] RETENÇÃO — quem voltou? (sincronizar = usou o app com conta)
-- PERGUNTA: o app vira hábito ou é aberto uma vez e esquecido?
-- DECISÃO: "usaram_ontem" perto de "usaram_7d" = hábito diário (ótimo, invista em
--          push/streak). "usaram_30d" muito maior que "usaram_7d" = as pessoas
--          somem depois da novidade — o gancho de volta (lembrete) é a prioridade.
--          OBS: só conta plano Essencial — o grátis não sincroniza, então não
--          aparece aqui. É um proxy de retenção dos pagantes/trials, não de todos.
-- ───────────────────────────────────────────────────────────────────────────
select
  count(*) filter (where atualizado_em >= now() - interval '24 hours') as usaram_ontem,
  count(*) filter (where atualizado_em >= now() - interval '7 days')   as usaram_7d,
  count(*) filter (where atualizado_em >= now() - interval '30 days')  as usaram_30d,
  count(*)                                                             as base_com_sync
from public.dados_usuario
where plano <> 'gratis';


-- ───────────────────────────────────────────────────────────────────────────
-- [D] MONETIZAÇÃO — de onde vem cada Essencial e quanto é dinheiro de verdade
-- PERGUNTA: quantos são pagantes vs. cortesia vs. teste grátis?
-- DECISÃO: separa vaidade de receita. "pagamento" é dinheiro; "trial/parceria/
--          promo-manual" não é. Se a base Essencial é toda cortesia, você tem
--          adoção mas não tem negócio ainda — hora de testar conversão paga.
-- R$: o valor está no Mercado Pago. Aqui é a CONTAGEM de transações e pessoas.
-- ───────────────────────────────────────────────────────────────────────────
select
  coalesce(plano_origem, 'sem registro') as origem,
  count(*)                               as contas,
  count(*) filter (where plano_valido_ate > now() or plano_valido_ate is null) as ainda_valido
from public.dados_usuario
where plano <> 'gratis'
group by 1 order by 2 desc;

-- transações de pagamento reais (uma linha por pagamento confirmado pelo MP)
select
  count(*)                                                   as pagamentos_confirmados,
  count(distinct user_id)                                    as pessoas_que_pagaram,
  count(*) filter (where criado_em >= now() - interval '30 days') as pagamentos_30d,
  min(criado_em)::date                                       as primeiro_pagamento,
  max(criado_em)::date                                       as ultimo_pagamento
from public.pagamentos_processados;


-- ───────────────────────────────────────────────────────────────────────────
-- [E] FUNIL DE CONVERSÃO — do interesse ao toque de pagar (métricas anônimas)
-- PERGUNTA: quem vê a tela de plano chega a tocar num passe? Quem bate no limite
--           de 6 matérias vai ver os planos?
-- DECISÃO: "tocou_num_passe / viu_tela_plano" é sua taxa de intenção de compra.
--          Baixa (<10%) = a tela de venda não convence (copy/preço). O passe mais
--          tocado diz qual oferta ancora — reforce ela no marketing.
-- Período: últimos 30 dias. Só há dado a partir de quando a métrica entrou no ar.
-- ───────────────────────────────────────────────────────────────────────────
with m as (
  select evento, sum(total) as n
  from public.metricas_diarias
  where dia >= current_date - 30
  group by evento
)
select
  coalesce((select n from m where evento='plano_tela_gratis'),0)     as viu_tela_plano_gratis,
  coalesce((select n from m where evento='plano_tela_essencial'),0)  as viu_tela_ja_essencial,
  coalesce((select n from m where evento='passe_toque_semestral'),0) as tocou_semestral,
  coalesce((select n from m where evento='passe_toque_mensal'),0)    as tocou_mensal,
  coalesce((select n from m where evento='passe_toque_recorrente'),0)as tocou_recorrente,
  round(100.0 *
    (coalesce((select n from m where evento='passe_toque_semestral'),0)
    +coalesce((select n from m where evento='passe_toque_mensal'),0)
    +coalesce((select n from m where evento='passe_toque_recorrente'),0))
    / nullif((select n from m where evento='plano_tela_gratis'),0), 1) as pct_intencao_de_compra;


-- ───────────────────────────────────────────────────────────────────────────
-- [F] O QUE EMPURRA PRA OFERTA — quais gatilhos levam o aluno à tela de plano
-- PERGUNTA: o limite de 6 matérias, o "momento-aha" e os bloqueios estão
--           convertendo em cliques pra ver o plano?
-- DECISÃO: o gatilho com mais "→ upgrade" é o seu motor de conversão; destaque-o.
--          "aha_clique / aha_mostrado" baixo = o momento-aha caiu no vazio, reescreva.
-- ───────────────────────────────────────────────────────────────────────────
select evento, sum(total) as vezes, max(dia) as ultimo_dia
from public.metricas_diarias
where dia >= current_date - 30
  and (evento like 'bloqueio_%' or evento like '%_upgrade' or evento like 'aha_%'
       or evento like 'ativas_%' or evento like 'troca_%' or evento = 'trial_iniciado')
group by evento order by vezes desc;


-- ───────────────────────────────────────────────────────────────────────────
-- [G] LOOP VIRAL — o compartilhar de provas está trazendo gente de graça?
-- PERGUNTA: quantos pacotes de prova foram gerados e quantos foram ABERTOS por
--           outros alunos? Cada pacote aberto é um aluno tocado sem custo.
-- DECISÃO: "pacote_aberto" alto = o app se espalha sozinho na turma; vale investir
--          no fluxo de quem RECEBE sem conta (virar cadastro). Perto de zero = o
--          recurso existe mas ninguém usa; não gaste mais energia nele agora.
-- ───────────────────────────────────────────────────────────────────────────
with m as (select evento, sum(total) n from public.metricas_diarias where dia >= current_date-30 group by evento)
select
  coalesce((select n from m where evento='compartilhar_abriu'),0) as abriu_compartilhar,
  coalesce((select n from m where evento='compartilhar_gerou'),0) as gerou_link,
  coalesce((select n from m where evento='pacote_aberto'),0)      as pacotes_abertos_por_outros,
  coalesce((select n from m where evento='pacote_aplicado'),0)    as pacotes_aplicados,
  (select count(*) from public.eventos_compartilhados where expira_em > now()) as pacotes_vivos_agora;


-- ───────────────────────────────────────────────────────────────────────────
-- [H] PARCERIAS — quantos códigos você emitiu e quantos viraram aluno ativo
-- PERGUNTA: a parceria (DPPC, NA9…) está convertendo? Código gerado que ninguém
--           resgata é esforço no vácuo.
-- DECISÃO: "usados / gerados" por rótulo mostra qual parceria funciona. Baixo =
--          o problema é distribuição do código (o coletivo não repassou), não o app.
-- ───────────────────────────────────────────────────────────────────────────
select
  coalesce(rotulo, 'sem rótulo')                              as parceria,
  count(*)                                                    as codigos_gerados,
  count(*) filter (where usado_em is not null)                as resgatados,
  count(*) filter (where usado_em is null and expira_em > now() and ativo) as ainda_valem,
  count(*) filter (where usado_em is null and expira_em <= now())          as expiraram_sem_uso
from public.ativacoes
group by 1 order by 2 desc;


-- ───────────────────────────────────────────────────────────────────────────
-- [I] JANELA DE AÇÃO — quem está prestes a vencer (retenção e cobrança)
-- PERGUNTA: quais teste-grátis vencem nos próximos dias (janela pra converter em
--           pago) e quais Essencial pagos vencem (hora de lembrar de renovar)?
-- DECISÃO: trials vencendo em 1-3 dias são seu público mais quente pra empurrar o
--          passe — vale um push/e-mail direcionado. Cortesia (parceria) vencendo
--          NÃO se cobra; é só aviso, como já combinamos.
-- ───────────────────────────────────────────────────────────────────────────
select
  u.email,
  d.plano_origem,
  d.plano_valido_ate::date as vence_em,
  (d.plano_valido_ate::date - current_date) as dias_restantes,
  case
    when d.plano_origem = 'trial'      then 'teste grátis → alvo de conversão paga'
    when d.plano_origem = 'pagamento'  then 'pagante → lembrar de renovar'
    when d.plano_origem like 'parceria%' then 'cortesia → só avisar, não cobrar'
    else d.plano_origem
  end as leitura
from public.dados_usuario d
join auth.users u on u.id = d.user_id
where d.plano <> 'gratis'
  and d.plano_valido_ate is not null
  and d.plano_valido_ate between now() and now() + interval '7 days'
order by d.plano_valido_ate;


-- ───────────────────────────────────────────────────────────────────────────
-- [J] AQUISIÇÃO — de onde e a que ritmo as contas chegam
-- PERGUNTA: a curva de cadastro reage às divulgações? De qual curso/instituição
--           vem quem chega? Quantos aceitaram receber marketing?
-- DECISÃO: picos na curva marcam o que funcionou (poste do DPPC, indicação). O
--          curso dominante diz onde focar a próxima grade/parceria.
-- ───────────────────────────────────────────────────────────────────────────
-- curva dos últimos 21 dias
select created_at::date as dia, count(*) as contas
from auth.users
where created_at >= now() - interval '21 days'
group by 1 order by 1 desc;

-- perfil de quem chega (curso / instituição / opt-in de marketing)
select
  coalesce(raw_user_meta_data->>'instituicao', '—') as instituicao,
  coalesce(raw_user_meta_data->>'curso', '—')       as curso,
  count(*)                                           as contas,
  count(*) filter (where raw_user_meta_data->>'aceita_marketing' = 'true') as aceitam_marketing
from auth.users
group by 1,2 order by 3 desc limit 15;


-- ───────────────────────────────────────────────────────────────────────────
-- [K] ÚLTIMOS CADASTROS — a lista operacional (pra ativar cortesia à mão)
-- PERGUNTA: quem chegou agora? (você ativa promoção manualmente)
-- ───────────────────────────────────────────────────────────────────────────
select u.email, u.created_at::date as dia,
       coalesce(d.plano,'—') as plano,
       coalesce(d.plano_origem,'—') as origem,
       raw_user_meta_data->>'curso' as curso
from auth.users u
left join public.dados_usuario d on d.user_id = u.id
order by u.created_at desc limit 25;


-- ═══════════════════════════════════════════════════════════════════════════
-- HELPERS DE ATIVAÇÃO MANUAL (descomente e troque o email pra usar)
-- ═══════════════════════════════════════════════════════════════════════════
-- Bolsista — Essencial até 31/12 (cortesia da parceria):
-- update public.dados_usuario set plano='essencial',
--   plano_valido_ate='2026-12-31T23:59:59-03:00', plano_origem='parceria:manual'
-- where user_id = (select id from auth.users where email = 'EMAIL_AQUI');

-- Aluno pagante — 30 dias de cortesia:
-- update public.dados_usuario set plano='essencial',
--   plano_valido_ate = now() + interval '30 days', plano_origem='promo-manual'
-- where user_id = (select id from auth.users where email = 'EMAIL_AQUI');
