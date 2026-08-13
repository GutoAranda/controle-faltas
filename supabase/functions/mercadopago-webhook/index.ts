// Faltaê — webhook do Mercado Pago: quando um pagamento é aprovado,
// promove o usuário a Essencial por 30 dias (renova somando ao saldo).
// Publicar com "Verify JWT" DESLIGADO (quem chama é o Mercado Pago).
// Segredo necessário: MP_ACCESS_TOKEN.
// Segurança: nunca confiamos no corpo da notificação — buscamos o pagamento
// direto na API do Mercado Pago com a nossa credencial. Notificação forjada não promove ninguém.
import { createClient } from 'npm:@supabase/supabase-js@2'

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
  // respondemos 200 pra tudo que não interessa, senão o MP fica reenviando
  if (!pagamentoId || (topico && topico !== 'payment')) return new Response('ok')

  const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
  if (!mpToken) return new Response('sem configuração', { status: 503 })

  const resposta = await fetch(`https://api.mercadopago.com/v1/payments/${pagamentoId}`, {
    headers: { Authorization: `Bearer ${mpToken}` },
  })
  if (!resposta.ok) return new Response('ok') // id desconhecido/forjado — ignora

  const pagamento = await resposta.json()
  const userId = pagamento?.external_reference
  if (pagamento?.status !== 'approved' || !userId) return new Response('ok')

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // 30 dias a partir de agora, ou somando ao que ainda resta (renovação antecipada não perde dias)
  const { data: atual } = await supabase
    .from('dados_usuario')
    .select('plano_valido_ate')
    .eq('user_id', userId)
    .maybeSingle()

  const base = atual?.plano_valido_ate && new Date(atual.plano_valido_ate) > new Date()
    ? new Date(atual.plano_valido_ate)
    : new Date()
  base.setDate(base.getDate() + 30)

  const { error } = await supabase
    .from('dados_usuario')
    .update({ plano: 'essencial', plano_valido_ate: base.toISOString() })
    .eq('user_id', userId)

  if (error) {
    // linha ainda não existe (pagou antes do primeiro sync) — cria já promovido
    await supabase.from('dados_usuario').insert({
      user_id: userId,
      dados: { materias: [], aulas: [], faltas: [], eventos: [] },
      plano: 'essencial',
      plano_valido_ate: base.toISOString(),
    })
  }

  console.log(`Pagamento ${pagamentoId} aprovado — ${userId} é Essencial até ${base.toISOString()}`)
  return new Response('ok')
})
