// Faltaê — exclusão de conta (LGPD): apaga tudo do usuário que pediu.
// Publicar com "Verify JWT" LIGADO (só o próprio usuário logado consegue chamar).
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return new Response('método não permitido', { status: 405, headers: cors })

  // quem pede a exclusão é identificado pelo próprio token de login — ninguém apaga conta alheia
  const comoUsuario = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  )
  const { data: { user } } = await comoUsuario.auth.getUser()
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401, headers: cors })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // apaga na ordem: dados sincronizados, grades publicadas, e por fim a conta em si
  await admin.from('dados_usuario').delete().eq('user_id', user.id)
  await admin.from('grades_compartilhadas').delete().eq('criado_por', user.id)
  const { error } = await admin.auth.admin.deleteUser(user.id)
  if (error) {
    console.error('Falha ao excluir conta', user.id, error.message)
    return Response.json({ erro: 'não foi possível concluir agora' }, { status: 500, headers: cors })
  }

  console.log(`Conta ${user.id} excluída a pedido do titular (LGPD)`)
  return Response.json({ ok: true }, { headers: cors })
})
