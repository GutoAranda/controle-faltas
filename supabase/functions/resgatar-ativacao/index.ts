// Faltaê — resgata uma ativação NOMINAL de parceria (código ATV-XXXXXX).
// Publicar com Verify JWT LIGADO. Regras: código ativo, dentro dos 30 dias,
// nunca usado, e o email da conta TEM que ser o email pra quem foi emitido.
import { createClient } from 'npm:@supabase/supabase-js@2'

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const supaUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
  })
  const { data: quem } = await supaUser.auth.getUser()
  if (!quem?.user) return resposta({ erro: 'Entre na sua conta primeiro.' }, 401)

  let codigo = ''
  try { codigo = String((await req.json())?.codigo || '').trim().toUpperCase() } catch { /* vazio */ }
  if (!codigo) return resposta({ erro: 'Digite o código.' }, 400)
  if (!codigo.startsWith('ATV-')) codigo = 'ATV-' + codigo

  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: a } = await supa.from('ativacoes').select('*').eq('codigo', codigo).maybeSingle()
  if (!a || !a.ativo) return resposta({ erro: 'Código inválido — confere com quem te passou.' }, 404)
  if (a.usado_em) return resposta({ erro: 'Esse código já foi usado.' }, 410)
  if (a.expira_em && new Date(a.expira_em) < new Date()) return resposta({ erro: 'Esse código expirou — peça um novo.' }, 410)
  const emailConta = String(quem.user.email || '').trim().toLowerCase()
  if (emailConta !== a.email_alvo) {
    return resposta({ erro: 'Esse código é pessoal — foi emitido para outro email. Confere se você entrou com a conta certa.' }, 403)
  }

  const novaValidade = a.plano_tipo === 'mensal'
    ? new Date(Date.now() + 30 * 864e5)
    : new Date('2026-12-31T23:59:59-03:00')

  const { data: atual } = await supa.from('dados_usuario')
    .select('plano, plano_valido_ate').eq('user_id', quem.user.id).maybeSingle()
  if (atual && atual.plano && atual.plano !== 'gratis' && atual.plano_valido_ate &&
      new Date(atual.plano_valido_ate) >= novaValidade) {
    return resposta({ erro: 'Seu plano atual já cobre esse período. 😉' }, 409)
  }

  const linha = {
    plano: 'essencial',
    plano_valido_ate: novaValidade.toISOString(),
    plano_origem: 'parceria:' + (a.rotulo || 'parceria'),
  }
  const upd = await supa.from('dados_usuario').update(linha).eq('user_id', quem.user.id).select('user_id')
  if (!upd.data?.length) {
    const ins = await supa.from('dados_usuario').insert({
      user_id: quem.user.id,
      dados: { materias: [], aulas: [], faltas: [], eventos: [] },
      ...linha,
    })
    if (ins.error) return resposta({ erro: 'Não consegui ativar agora — tente em instantes.' }, 500)
  }

  await supa.from('ativacoes').update({ usado_em: new Date().toISOString(), usado_por: quem.user.id }).eq('codigo', codigo)

  console.log(`Ativação ${codigo} resgatada por ${emailConta} — Essencial até ${novaValidade.toISOString()}`)
  return resposta({ ok: true, valido_ate: novaValidade.toISOString(), plano: a.plano_tipo })
})
