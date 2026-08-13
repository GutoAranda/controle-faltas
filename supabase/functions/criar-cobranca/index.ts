// Faltaê — cria uma cobrança de R$ 15 (Pix/cartão) no Mercado Pago
// e devolve o link de pagamento. 1 pagamento = 30 dias de Essencial.
// Publicar com "Verify JWT" LIGADO (o app chama com o usuário logado).
// Segredo necessário: MP_ACCESS_TOKEN (painel do Mercado Pago → Suas integrações → credenciais de produção).
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

  // identifica quem está pedindo a cobrança pelo token de login do app
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401, headers: cors })

  const resposta = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: { Authorization: `Bearer ${mpToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{
        title: 'Faltaê Essencial — 30 dias',
        description: 'Sincronização na nuvem, matérias ilimitadas e calendário automático',
        quantity: 1,
        currency_id: 'BRL',
        unit_price: 15,
      }],
      external_reference: user.id, // é assim que o webhook sabe quem pagou
      payer: { email: user.email },
      statement_descriptor: 'FALTAE',
      back_urls: {
        success: 'https://gutoaranda.github.io/controle-faltas/?pagamento=ok',
        pending: 'https://gutoaranda.github.io/controle-faltas/?pagamento=pendente',
        failure: 'https://gutoaranda.github.io/controle-faltas/?pagamento=erro',
      },
      auto_return: 'approved',
      notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/mercadopago-webhook`,
    }),
  })

  if (!resposta.ok) {
    console.error('Mercado Pago recusou:', resposta.status, await resposta.text())
    return Response.json({ erro: 'não foi possível criar a cobrança' }, { status: 502, headers: cors })
  }

  const pref = await resposta.json()
  return Response.json({ url: pref.init_point }, { headers: cors })
})
