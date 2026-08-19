// Faltaê — PARCERIAS: gera um código/link de ativação NOMINAL (preso a um email).
// Só quem está na tabela `parceiros` consegue gerar. Publicar com Verify JWT LIGADO.
// O código expira em 30 dias se não for resgatado e só funciona na conta do email alvo —
// cupom compartilhado no grupo não ativa pra mais ninguém.
import { createClient } from 'npm:@supabase/supabase-js@2'

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })

const gerarCodigo = () => {
  const letras = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // sem 0/O/1/I/L
  let c = ''
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  for (const b of bytes) c += letras[b % letras.length]
  return 'ATV-' + c
}

Deno.serve(async (req) => {
  const supaUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
  })
  const { data: quem } = await supaUser.auth.getUser()
  if (!quem?.user) return resposta({ erro: 'Sessão inválida.' }, 401)

  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: parceiro } = await supa.from('parceiros').select('rotulo').eq('user_id', quem.user.id).maybeSingle()
  if (!parceiro) return resposta({ erro: 'Essa área é exclusiva das parcerias do Faltaê.' }, 403)

  let corpo: { email?: string; plano?: string } = {}
  try { corpo = await req.json() } catch { /* vazio */ }
  const email = String(corpo.email || '').trim().toLowerCase()
  const plano = corpo.plano === 'mensal' ? 'mensal' : 'semestral'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return resposta({ erro: 'Email inválido.' }, 400)

  // 1 ativação pendente por email — pediu de novo? invalida a anterior e emite outra
  await supa.from('ativacoes').update({ ativo: false }).eq('email_alvo', email).is('usado_em', null)

  const codigo = gerarCodigo()
  const expira = new Date(Date.now() + 30 * 864e5)
  const { error } = await supa.from('ativacoes').insert({
    codigo,
    email_alvo: email,
    plano_tipo: plano,                       // 'semestral' → Essencial até 31/12 · 'mensal' → +30 dias no resgate
    rotulo: parceiro.rotulo || 'parceria',
    criado_por: quem.user.id,
    expira_em: expira.toISOString(),
  })
  if (error) return resposta({ erro: 'Não consegui gerar agora — tente de novo.' }, 500)

  console.log(`Ativação ${codigo} (${plano}) gerada para ${email} por ${parceiro.rotulo}`)
  return resposta({
    ok: true,
    codigo,
    link: 'https://faltae.com.br/?ativar=' + codigo,
    email,
    plano,
    expira_em: expira.toISOString(),
  })
})
