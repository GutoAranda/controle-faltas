// Faltaê — resgata um código promocional (ex.: NA9MES, BOLSISTA26) e ativa o
// Essencial na conta de quem chamou, sem SQL manual no painel.
// Publicar com "Verify JWT" LIGADO — a identidade vem do token do usuário.
// Regras: código precisa estar ativo, dentro da validade e com usos disponíveis;
// não rebaixa ninguém (se o plano atual já cobre além, recusa educadamente).
import { createClient } from 'npm:@supabase/supabase-js@2'

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  // quem chama
  const supaUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
  })
  const { data: quem } = await supaUser.auth.getUser()
  if (!quem?.user) return resposta({ erro: 'Sessão inválida — entre de novo e tente outra vez.' }, 401)

  let codigo = ''
  try { codigo = String((await req.json())?.codigo || '').trim().toUpperCase() } catch { /* corpo vazio */ }
  if (!codigo || codigo.length > 24) return resposta({ erro: 'Digite o código.' }, 400)

  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: c } = await supa.from('codigos_resgate').select('*').eq('codigo', codigo).maybeSingle()
  if (!c || !c.ativo) return resposta({ erro: 'Código inválido — confere se digitou certinho.' }, 404)
  if (c.expira_em && new Date(c.expira_em) < new Date()) return resposta({ erro: 'Esse código expirou.' }, 410)
  if (c.max_usos != null && c.usos >= c.max_usos) return resposta({ erro: 'Esse código atingiu o limite de usos.' }, 410)

  // validade que o código concede
  const novaValidade = c.valido_ate_fixo
    ? new Date(c.valido_ate_fixo + 'T23:59:59-03:00')
    : new Date(Date.now() + (c.dias || 30) * 864e5)

  const { data: atual } = await supa.from('dados_usuario')
    .select('plano, plano_valido_ate').eq('user_id', quem.user.id).maybeSingle()
  if (atual?.plano && atual.plano !== 'gratis' && atual.plano_valido_ate &&
      new Date(atual.plano_valido_ate) >= novaValidade) {
    return resposta({ erro: 'Seu plano atual já cobre esse período — guarda o código 😉' }, 409)
  }

  const linha = {
    plano: 'essencial',
    plano_valido_ate: novaValidade.toISOString(),
    plano_origem: 'codigo:' + codigo,
  }
  const upd = await supa.from('dados_usuario').update(linha).eq('user_id', quem.user.id).select('user_id')
  if (!upd.data?.length) {
    const ins = await supa.from('dados_usuario').insert({
      user_id: quem.user.id,
      dados: { materias: [], aulas: [], faltas: [], eventos: [] },
      ...linha,
    })
    if (ins.error) return resposta({ erro: 'Não consegui ativar agora — tenta de novo em instantes.' }, 500)
  }

  await supa.from('codigos_resgate').update({ usos: (c.usos || 0) + 1 }).eq('codigo', codigo)

  console.log(`Código ${codigo} resgatado por ${quem.user.id} — Essencial até ${novaValidade.toISOString()}`)
  return resposta({ ok: true, valido_ate: novaValidade.toISOString(), descricao: c.descricao || null })
})
