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

  /* apaga tudo que é do titular antes da conta em si. As tabelas com "on delete cascade"
     sairiam sozinhas, mas limpar explicitamente é o que garante que uma tabela nova sem
     cascade não derrube a exclusão inteira lá na frente. Tabela que não existe é ignorada. */
  const limpar = async (tabela: string, coluna: string) => {
    const { error } = await admin.from(tabela).delete().eq(coluna, user.id)
    if (error && error.code !== '42P01') console.log(`aviso ao limpar ${tabela}: ${error.message}`)
  }
  await limpar('dados_usuario', 'user_id')
  await limpar('grades_compartilhadas', 'criado_por')
  await limpar('push_inscricoes', 'user_id')
  await limpar('widget_aparelhos', 'user_id')
  await limpar('eventos_compartilhados', 'criado_por')
  await limpar('parceiros', 'user_id')

  const { error } = await admin.auth.admin.deleteUser(user.id)
  if (error) {
    console.error('Falha ao excluir conta', user.id, error.message)
    // devolve a razão: sem ela o app só consegue dizer "tente mais tarde" e ninguém diagnostica
    return Response.json({ erro: error.message }, { status: 500, headers: cors })
  }

  console.log(`Conta ${user.id} excluída a pedido do titular (LGPD)`)
  return Response.json({ ok: true }, { headers: cors })
})
