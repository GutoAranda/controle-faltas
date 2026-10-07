// Faltaê — webhook do Mercado Pago: quando um pagamento é aprovado,
// promove o usuário a Essencial pelos dias do passe pago — 30 (mensal)
// ou 180 (semestral) — sempre somando ao saldo que ainda resta.
// Publicar com "Verify JWT" DESLIGADO (quem chama é o Mercado Pago).
// Segredo necessário: MP_ACCESS_TOKEN.
// Segurança: nunca confiamos no corpo da notificação — buscamos o pagamento
// direto na API do Mercado Pago com a nossa credencial. Notificação forjada não promove ninguém.
import { createClient } from 'npm:@supabase/supabase-js@2'

const admin = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

/* Credita dias ao usuário, somando ao saldo que ainda resta.
   A chave de idempotência é o id do pagamento: o Mercado Pago reenvia a mesma
   notificação (retry, ou payment + merchant_order do mesmo Pix) e sem esta trava
   o mesmo dinheiro creditaria dias duas vezes. */
async function creditar(userId: string, dias: number, chave: string) {
  const supabase = admin()

  const marca = await supabase.from('pagamentos_processados')
    .insert({ pagamento_id: chave, user_id: userId })
  if (marca.error) {
    if (marca.error.code === '23505') {
      console.log(`Pagamento ${chave} já creditado — notificação repetida, ignorando`)
      return
    }
    // tabela ausente (SQL não rodado) não pode travar o crédito de quem pagou —
    // segue creditando e deixa o rastro no log pra auditoria
    console.log(`Aviso: sem trava de idempotência (${marca.error.code}) — creditando ${chave}`)
  }

  const { data: atual } = await supabase
    .from('dados_usuario')
    .select('plano_valido_ate')
    .eq('user_id', userId)
    .maybeSingle()

  const base = atual?.plano_valido_ate && new Date(atual.plano_valido_ate) > new Date()
    ? new Date(atual.plano_valido_ate)
    : new Date()
  base.setDate(base.getDate() + dias)

  const { error } = await supabase
    .from('dados_usuario')
    .update({ plano: 'essencial', plano_valido_ate: base.toISOString(), plano_origem: 'pagamento' })
    .eq('user_id', userId)

  if (error) {
    // linha ainda não existe (pagou antes do primeiro sync) — cria já promovido
    await supabase.from('dados_usuario').insert({
      user_id: userId,
      dados: { materias: [], aulas: [], faltas: [], eventos: [] },
      plano: 'essencial',
      plano_valido_ate: base.toISOString(),
      plano_origem: 'pagamento',
    })
  }

  console.log(`Pagamento ${chave} aprovado — ${userId} é Essencial até ${base.toISOString()}`)
}

/* De quem é esta assinatura: perguntamos ao próprio Mercado Pago, que devolve o
   external_reference que gravamos na criação. Não depende de o aviso anterior ter chegado. */
async function donoDaAssinatura(preapprovalId: string, mpToken: string): Promise<string | null> {
  const r = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
    headers: { Authorization: `Bearer ${mpToken}` },
  })
  if (!r.ok) return null
  const pre = await r.json()
  return pre?.external_reference || null
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // o Mercado Pago avisa de dois jeitos: query (?topic=payment&id=...) ou corpo JSON
  let pagamentoId = url.searchParams.get('id') || url.searchParams.get('data.id')
  let topico = url.searchParams.get('topic') || url.searchParams.get('type')
  if (!pagamentoId) {
    try {
      const corpo = await req.json()
      topico = topico || corpo?.type || corpo?.topic
      pagamentoId = corpo?.data?.id ? String(corpo.data.id) : null
    } catch { /* corpo vazio ou não-JSON — segue */ }
  }
  if (!pagamentoId) return new Response('ok')

  const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
  if (!mpToken) return new Response('sem configuração', { status: 503 })

  // aviso de ASSINATURA (renovação automática): guarda ou limpa o vínculo do usuário
  if (topico === 'preapproval' || topico === 'subscription_preapproval') {
    const r = await fetch(`https://api.mercadopago.com/preapproval/${pagamentoId}`, {
      headers: { Authorization: `Bearer ${mpToken}` },
    })
    if (!r.ok) return new Response('ok')
    const pre = await r.json()
    const uid = pre?.external_reference
    if (!uid) return new Response('ok')
    if (pre.status === 'authorized') {
      await admin().from('dados_usuario').update({ assinatura_id: pre.id }).eq('user_id', uid)
    } else if (pre.status === 'cancelled' || pre.status === 'paused') {
      await admin().from('dados_usuario').update({ assinatura_id: null }).eq('user_id', uid)
    }
    console.log(`Assinatura ${pre.id} → ${pre.status} (usuário ${uid})`)
    return new Response('ok')
  }

  /* COBRANÇA MENSAL DA ASSINATURA. Este aviso é o que renova quem assinou, e ele NÃO
     aponta para /v1/payments — o id é de outro recurso (/authorized_payments). Tratar
     como pagamento comum devolvia 404 e o mês seguinte nunca era creditado. */
  if (topico === 'subscription_authorized_payment') {
    const r = await fetch(`https://api.mercadopago.com/authorized_payments/${pagamentoId}`, {
      headers: { Authorization: `Bearer ${mpToken}` },
    })
    if (!r.ok) return new Response('ok')
    const ap = await r.json()
    const statusPg = ap?.payment?.status || ap?.status
    if (statusPg !== 'approved' && statusPg !== 'processed') {
      console.log(`Cobrança de assinatura ${pagamentoId} em "${statusPg}" — nada a creditar`)
      return new Response('ok')
    }
    const preId = ap?.preapproval_id
    const uid = preId ? await donoDaAssinatura(String(preId), mpToken) : null
    if (!uid) {
      console.error(`Cobrança de assinatura ${pagamentoId} aprovada sem dono identificável (preapproval ${preId})`)
      return new Response('ok')
    }
    // a chave usa o id do pagamento real, que é o mesmo que chega no aviso "payment"
    const chave = String(ap?.payment?.id || pagamentoId)
    await creditar(uid, 30, chave)
    return new Response('ok')
  }

  // daqui pra baixo, só interessam PAGAMENTOS avulsos (passes mensal e semestral)
  if (topico && topico !== 'payment') return new Response('ok')

  const resposta = await fetch(`https://api.mercadopago.com/v1/payments/${pagamentoId}`, {
    headers: { Authorization: `Bearer ${mpToken}` },
  })
  if (!resposta.ok) return new Response('ok') // id desconhecido/forjado — ignora

  const pagamento = await resposta.json()
  if (pagamento?.status !== 'approved') return new Response('ok')

  // parcela de assinatura também chega por aqui: nela o dono vem pelo vínculo, não pelo external_reference
  let userId = pagamento?.external_reference
  if (!userId && pagamento?.metadata?.preapproval_id) {
    userId = await donoDaAssinatura(String(pagamento.metadata.preapproval_id), mpToken)
  }
  if (!userId) {
    console.error(`Pagamento ${pagamentoId} aprovado sem dono identificável — ninguém foi promovido`)
    return new Response('ok')
  }

  // quantos dias creditar: vem da metadata da cobrança; se faltar (cobrança antiga),
  // deduz pelo valor pago — R$ 50+ só existe no passe semestral
  let dias = Number(pagamento?.metadata?.dias)
  if (!Number.isFinite(dias) || dias < 1 || dias > 366) {
    dias = Number(pagamento?.transaction_amount) >= 50 ? 180 : 30
  }

  await creditar(String(userId), dias, String(pagamentoId))
  return new Response('ok')
})
