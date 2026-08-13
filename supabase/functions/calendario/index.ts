// Faltaê — feed de calendário por assinatura (ICS)
// O aluno assina a URL no Google Calendar / Apple Calendar e as provas
// aparecem e se atualizam sozinhas. Recurso do plano Essencial.
import { createClient } from 'npm:@supabase/supabase-js@2'

const esc = (s: unknown) =>
  String(s ?? '').replace(/([,;\\])/g, '\\$1').replace(/\r?\n/g, '\\n')

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

  const eventos: any[] = data.dados?.eventos ?? []
  const materias = new Map<string, string>(
    (data.dados?.materias ?? []).map((m: any) => [m.id, m.nome]),
  )

  const linhas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Faltae//Agenda//PT-BR',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Faltaê — provas e atividades',
    'X-WR-TIMEZONE:America/Sao_Paulo',
  ]

  for (const e of eventos) {
    if (!e?.data || !e?.titulo) continue
    const dia = String(e.data).replaceAll('-', '')
    const materia = materias.get(e.materiaId) ?? ''
    linhas.push(
      'BEGIN:VEVENT',
      `UID:faltae-${esc(e.id)}@faltae.app`,
      `DTSTART;VALUE=DATE:${dia}`,
      `SUMMARY:${esc((e.tipo === 'prova' ? '📝 ' : '📌 ') + e.titulo)}`,
      `DESCRIPTION:${esc(materia + (e.descricao ? ' — ' + e.descricao : ''))}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }

  linhas.push('END:VCALENDAR')

  return new Response(linhas.join('\r\n'), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
})
