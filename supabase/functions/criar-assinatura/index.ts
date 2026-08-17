// Faltaê — cria uma assinatura com renovação automática (R$ 15/mês no cartão)
// no Mercado Pago e devolve o link de aprovação. O aluno aprova UMA vez;
// cada cobrança mensal aprovada chega no mercadopago-webhook e soma +30 dias.
// Publicar com "Verify JWT" LIGADO (o app chama com o usuário logado).
// Segredo necessário: MP_ACCESS_TOKEN.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
  if (!mpToken) {
    return Response.json({ erro: 'pagamento ainda não configurado' }, { status: 503, headers: cors })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401, headers: cors })

  const resposta = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: { Authorization: `Bearer ${mpToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reason: 'Faltaê Essencial — renovação automática mensal',
      external_reference: user.id, // é assim que o webhook sabe de quem é a assinatura
      payer_email: user.email,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: 15,
        currency_id: 'BRL',
      },
      back_url: 'https://faltae.com.br/?assinatura=ok',
      status: 'pending', // o aluno aprova na página do Mercado Pago
    }),
  })

  if (!resposta.ok) {
    console.error('Mercado Pago recusou a assinatura:', resposta.status, await resposta.text())
    return Response.json({ erro: 'não foi possível criar a assinatura' }, { status: 502, headers: cors })
  }

  const pre = await resposta.json()
  return Response.json({ url: pre.init_point }, { headers: cors })
})
