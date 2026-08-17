// Faltaê — cancela a renovação automática do próprio usuário no Mercado Pago.
// Os dias já pagos continuam valendo até o fim; só param as cobranças futuras.
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
  if (!mpToken) return Response.json({ erro: 'pagamento ainda não configurado' }, { status: 503, headers: cors })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401, headers: cors })

  // a assinatura do usuário fica guardada pelo webhook em dados_usuario.assinatura_id
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const { data: linha } = await admin
    .from('dados_usuario')
    .select('assinatura_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!linha?.assinatura_id) {
    return Response.json({ erro: 'nenhuma renovação automática ativa' }, { status: 404, headers: cors })
  }

  const resposta = await fetch(`https://api.mercadopago.com/preapproval/${linha.assinatura_id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${mpToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'cancelled' }),
  })

  if (!resposta.ok) {
    console.error('Mercado Pago recusou o cancelamento:', resposta.status, await resposta.text())
    return Response.json({ erro: 'não foi possível cancelar agora' }, { status: 502, headers: cors })
  }

  await admin.from('dados_usuario').update({ assinatura_id: null }).eq('user_id', user.id)
  return Response.json({ ok: true }, { headers: cors })
})
