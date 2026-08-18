// Faltaê — envia notificação push (web push) com os lembretes de prova do dia
// para todos os aparelhos inscritos. Aviso: provas de HOJE e de AMANHÃ.
// Disparo: pg_cron todo dia 07:30 BRT (seção 2f do pendente.sql) ou manualmente.
// Publicar com "Verify JWT" DESLIGADO — a proteção é o cabeçalho
// x-push-chave, que precisa bater com o segredo PUSH_CRON_CHAVE.
// Segredos necessários: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_CRON_CHAVE.
// Modo de teste: POST com corpo {"teste":"email@exemplo.com"} manda uma
// notificação de teste só pros aparelhos dessa conta (mesmo sem prova hoje).
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const fdata = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7)

// hoje no fuso do Brasil (BRT, UTC-3, sem horário de verão)
function hojeBRT(mais = 0): string {
  return new Date(Date.now() - 3 * 3600e3 + mais * 864e5).toISOString().slice(0, 10)
}

function montarMensagem(dados: any): { titulo: string; corpo: string } | null {
  const hoje = hojeBRT(), amanha = hojeBRT(1)
  const mats = new Map((dados.materias || []).map((m: any) => [m.id, m.nome]))
  const pendentes = (dados.eventos || [])
    .filter((e: any) => !e.feita && (e.data === hoje || e.data === amanha))
    .sort((a: any, b: any) => a.data.localeCompare(b.data))
  if (!pendentes.length) return null
  if (pendentes.length === 1) {
    const e = pendentes[0]
    return {
      titulo: (e.tipo === 'prova' ? 'Prova' : 'Atividade') + (e.data === hoje ? ' HOJE' : ' amanhã') + ': ' + e.titulo,
      corpo: [mats.get(e.materiaId), fdata(e.data)].filter(Boolean).join(' · '),
    }
  }
  return {
    titulo: pendentes.length + ' avaliações chegando 📚',
    corpo: pendentes.map((e: any) => (e.data === hoje ? 'HOJE' : 'amanhã') + ': ' + e.titulo).slice(0, 4).join('\n'),
  }
}

Deno.serve(async (req) => {
  if (req.headers.get('x-push-chave') !== Deno.env.get('PUSH_CRON_CHAVE')) {
    return new Response(JSON.stringify({ erro: 'não autorizado' }), { status: 401 })
  }
  webpush.setVapidDetails(
    'mailto:suporte@faltae.com.br',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  )
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let teste: string | null = null
  try { teste = (await req.json())?.teste || null } catch { /* corpo vazio no cron */ }

  const { data: inscricoes, error } = await supa.from('push_inscricoes').select('endpoint, user_id, dados')
  if (error) return new Response(JSON.stringify({ erro: error.message }), { status: 500 })

  // agrupa aparelhos por usuário
  const porUsuario = new Map<string, any[]>()
  for (const i of inscricoes || []) {
    if (!porUsuario.has(i.user_id)) porUsuario.set(i.user_id, [])
    porUsuario.get(i.user_id)!.push(i)
  }

  let enviadas = 0, semProva = 0, mortas = 0
  for (const [userId, aparelhos] of porUsuario) {
    let msg: { titulo: string; corpo: string } | null

    if (teste) {
      const { data: u } = await supa.auth.admin.getUserById(userId)
      if (!u?.user || (u.user.email || '').toLowerCase() !== teste.toLowerCase()) continue
      msg = { titulo: 'Teste do Faltaê 🔔', corpo: 'As notificações estão funcionando neste aparelho!' }
    } else {
      const { data: du } = await supa.from('dados_usuario').select('dados').eq('user_id', userId).maybeSingle()
      msg = du?.dados ? montarMensagem(du.dados) : null
      if (!msg) { semProva++; continue }
    }

    const payload = JSON.stringify({ titulo: msg.titulo, corpo: msg.corpo, tag: 'faltae-prova-' + hojeBRT(), url: 'https://faltae.com.br/' })
    for (const ap of aparelhos) {
      try {
        await webpush.sendNotification({ endpoint: ap.endpoint, keys: ap.dados }, payload)
        enviadas++
      } catch (e: any) {
        // 404/410 = inscrição morta (app desinstalado, permissão revogada): limpa
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          await supa.from('push_inscricoes').delete().eq('endpoint', ap.endpoint)
          mortas++
        }
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, enviadas, usuariosSemProva: semProva, inscricoesLimpas: mortas }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
