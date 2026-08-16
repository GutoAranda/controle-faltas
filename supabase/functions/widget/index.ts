// Faltaê — dados da sequência para o widget Android (recurso Essencial).
// Mesma regra do app: semanas perfeitas acumulam; só a sequência reinicia ao faltar.
// Autenticação pelo token_calendario (o mesmo do feed de calendário).
// Publicar com "Verify JWT" DESLIGADO (quem chama é o widget, sem login).
import { createClient } from 'npm:@supabase/supabase-js@2'

const dataISO = (d: Date) => d.toISOString().slice(0, 10)
const somarDias = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return dataISO(d)
}
const inicioDaSemana = (iso: string) => {
  const d = new Date(iso + 'T12:00:00Z')
  const dif = (d.getUTCDay() + 6) % 7 // segunda = 0
  return somarDias(iso, -dif)
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token')
  if (!token || token.length < 32) return new Response('Não encontrado', { status: 404 })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const { data } = await supabase
    .from('dados_usuario')
    .select('dados, plano')
    .eq('token_calendario', token)
    .maybeSingle()
  if (!data || data.plano === 'gratis') return new Response('Não encontrado', { status: 404 })

  const aulas: any[] = data.dados?.aulas ?? []
  const faltas: any[] = (data.dados?.faltas ?? []).filter((f: any) => !f.abonada)

  // "hoje" no fuso de Brasília
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  const segAtual = inicioDaSemana(hoje)
  const primeira = aulas.length ? aulas.map(a => a.data).sort()[0] : hoje

  let total = 0
  let sequencia = 0
  let contando = true
  for (let i = 1; i <= 60; i++) {
    const seg = somarDias(segAtual, -7 * i)
    const dom = somarDias(seg, 6)
    if (dom < primeira) break
    const temAulas = aulas.some(a => a.data >= seg && a.data <= dom)
    const temFalta = faltas.some(f => f.data >= seg && f.data <= dom)
    if (temFalta) { contando = false; continue }
    if (temAulas) { total++; if (contando) sequencia++ }
  }
  const faltouNestaSemana = faltas.some(f => f.data >= segAtual && f.data <= somarDias(segAtual, 6))
  if (faltouNestaSemana) sequencia = 0

  const dias = ['seg', 'ter', 'qua', 'qui', 'sex'].map((rotulo, i) => {
    const data2 = somarDias(segAtual, i)
    const temAula = aulas.some(a => a.data === data2)
    const falta = faltas.some(f => f.data === data2)
    let estado
    if (falta) estado = 'falta'
    else if (data2 === hoje) estado = 'hoje'
    else if (data2 > hoje) estado = temAula ? 'futuro' : 'livre'
    else estado = temAula ? 'presente' : 'livre'
    return { rotulo, estado }
  })

  const restantes = dias.filter((d, i) => somarDias(segAtual, i) >= hoje && d.estado !== 'falta'
    && aulas.some(a => a.data === somarDias(segAtual, i))).length
  let mensagem
  if (faltouNestaSemana) mensagem = 'A sequência reiniciou — o total segue valendo.'
  else if (!dias.some((d, i) => aulas.some(a => a.data === somarDias(segAtual, i)))) mensagem = 'Semana sem aulas no plano.'
  else if (restantes > 0) mensagem = `Mais ${restantes} dia${restantes === 1 ? '' : 's'} e a semana fecha perfeita.`
  else mensagem = 'Semana perfeita garantida! 🎉'

  return Response.json(
    { sequencia, total, dias, mensagem, atualizado: hoje },
    { headers: { 'Cache-Control': 'public, max-age=300' } },
  )
})
