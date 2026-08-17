// Faltaê — envia o relatório quinzenal (frequência + notas) por email
// para todos os assinantes Essencial que não desligaram o recebimento.
// Disparo: pg_cron nos dias 1 e 15 (seção 2e do pendente.sql) ou manualmente.
// Publicar com "Verify JWT" DESLIGADO — a proteção é o cabeçalho
// x-relatorio-chave, que precisa bater com o segredo RELATORIO_CRON_CHAVE.
// Segredos necessários: RESEND_API_KEY, RELATORIO_CRON_CHAVE.
// Modo de teste: POST com corpo {"teste":"email@exemplo.com"} envia só pra essa conta.
import { createClient } from 'npm:@supabase/supabase-js@2'

const REMETENTE = 'Faltaê <relatorio@faltae.com.br>'

/* ── cálculos portados do app (mesmas regras da PUC) ── */
const arred1 = (v: number) => Math.round(v * 10) / 10
const nf = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const fdata = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4)

function resumoFreq(mat: any, faltas: any[]) {
  const maxFaltas = Math.max(1, Math.floor((mat.totalAulas || 1) * (mat.limitePct || 25) / 100))
  const usadas = faltas.filter(f => f.materiaId === mat.id && !f.abonada).reduce((s, f) => s + (f.qtd || 1), 0)
  const pct = usadas / maxFaltas
  const rotulo = pct > 1 ? 'Limite estourado' : (pct >= 0.85 ? 'Risco de reprovação' : (pct >= 0.6 ? 'Atenção' : 'Tranquilo'))
  const nivel = pct > 0.85 || pct > 1 ? 'danger' : (pct >= 0.6 ? 'warn' : 'ok')
  return { maxFaltas, usadas, restam: Math.max(0, maxFaltas - usadas), nivel, rotulo }
}

function mbDe(b: any) {
  if (!b) return null
  let pr = b.pr, te = b.te
  if (b.su != null) { if (te == null) te = b.su; else if (pr == null) pr = b.su }
  if (pr == null || te == null) return null
  return arred1((pr * 3 + te * 7) / 10)
}

function resumoNotas(mat: any) {
  const n = mat.notasPUC || {}
  const mb1 = mbDe(n.b1), mb2 = mbDe(n.b2)
  const mf = mb1 != null && mb2 != null ? arred1((mb1 + mb2) / 2) : null
  return { mb1, mb2, mf }
}

/* ── email em HTML de tabela (compatível com Gmail/Outlook) ── */
function montarEmail(nome: string, dados: any) {
  const hoje = new Date().toISOString().slice(0, 10)
  const mats = [...(dados.materias || [])].sort((a, b) => String(a.nome).localeCompare(String(b.nome)))
  const faltas = dados.faltas || []
  const eventos = dados.eventos || []
  const aulas = dados.aulas || []
  const presencas: number[] = []
  let usadasTotal = 0, restamTotal = 0, emRisco = 0
  const mbs: number[] = []

  const linhas = mats.map(mat => {
    const r = resumoFreq(mat, faltas)
    const rn = resumoNotas(mat)
    const dadas = aulas.filter((a: any) => a.materiaId === mat.id && a.data <= hoje).length
    if (dadas >= 5) presencas.push(Math.max(0, Math.round((dadas - r.usadas) / dadas * 100)))
    usadasTotal += r.usadas; restamTotal += r.restam
    if (r.nivel === 'danger') emRisco++
    if (rn.mb1 != null) mbs.push(rn.mb1)
    if (rn.mb2 != null) mbs.push(rn.mb2)
    const cor = r.nivel === 'ok' ? '#3F5F0A' : (r.nivel === 'warn' ? '#8A4A08' : '#A30F33')
    const fundo = r.nivel === 'ok' ? '#EFF7DC' : (r.nivel === 'warn' ? '#FCEEDC' : '#FBE3E8')
    return `<tr>
      <td style="padding:9px 8px 9px 0; border-bottom:1px solid #EDEFF6; font-size:13px"><strong>${mat.nome}</strong></td>
      <td align="center" style="padding:9px 8px; border-bottom:1px solid #EDEFF6; font-size:13px">${r.usadas} de ${r.maxFaltas}</td>
      <td align="center" style="padding:9px 8px; border-bottom:1px solid #EDEFF6; font-size:13px">${rn.mb1 != null ? nf(rn.mb1) : '—'}</td>
      <td align="center" style="padding:9px 8px; border-bottom:1px solid #EDEFF6; font-size:13px">${rn.mb2 != null ? nf(rn.mb2) : '—'}</td>
      <td align="center" style="padding:9px 0 9px 8px; border-bottom:1px solid #EDEFF6"><span style="background:${fundo}; color:${cor}; border-radius:99px; padding:3px 10px; font-size:11px; font-weight:700; white-space:nowrap">${r.rotulo}</span></td>
    </tr>`
  }).join('')

  const mediaPres = presencas.length ? Math.round(presencas.reduce((s, p) => s + p, 0) / presencas.length) + '%' : '—'
  const mediaNotas = mbs.length ? nf(arred1(mbs.reduce((s, v) => s + v, 0) / mbs.length)) : '—'
  const provas = eventos.filter((e: any) => e.tipo === 'prova' && e.data >= hoje).length
  const cartao = (valor: string, rotulo: string) =>
    `<td width="33%" style="padding:6px"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7F0; border-radius:12px"><tr><td style="padding:12px 14px">
      <div style="font-size:22px; font-weight:800; color:#14172B">${valor}</div>
      <div style="font-size:10px; color:#666C81; text-transform:uppercase; letter-spacing:.06em; font-weight:700">${rotulo}</div>
    </td></tr></table></td>`

  const agora = new Date()
  const quinzena = agora.toLocaleDateString('pt-BR')
  return {
    assunto: `Seu relatório do semestre — ${quinzena}`,
    html: `<div style="background:#EDEFF4; padding:18px 8px; font-family:'Segoe UI',system-ui,Arial,sans-serif">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px; margin:0 auto; background:#FFF; border-radius:16px; overflow:hidden">
      <tr><td style="background:#4056C7; padding:24px 28px">
        <div style="color:#FFF; font-size:14px; font-weight:800">falta<span style="color:#A3E635">ê</span></div>
        <div style="color:#FFF; font-size:24px; font-weight:800; margin-top:6px">Relatório do semestre</div>
        <div style="color:rgba(255,255,255,.85); font-size:13px; margin-top:2px">${nome} · ${quinzena}</div>
      </td></tr>
      <tr><td style="padding:18px 22px 4px">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          ${cartao(mediaPres, 'Presença média')}${cartao(mediaNotas, 'Média das notas')}${cartao(String(emRisco), 'Matérias em atenção')}
        </tr><tr>
          ${cartao(String(usadasTotal), 'Faltas usadas')}${cartao(String(restamTotal), 'Faltas disponíveis')}${cartao(String(provas), 'Provas pela frente')}
        </tr></table>
      </td></tr>
      <tr><td style="padding:14px 28px 6px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <th align="left" style="font-size:10px; text-transform:uppercase; letter-spacing:.07em; color:#666C81; padding-bottom:6px; border-bottom:2px solid #14172B">Matéria</th>
            <th align="center" style="font-size:10px; text-transform:uppercase; letter-spacing:.07em; color:#666C81; padding-bottom:6px; border-bottom:2px solid #14172B">Faltas</th>
            <th align="center" style="font-size:10px; text-transform:uppercase; letter-spacing:.07em; color:#666C81; padding-bottom:6px; border-bottom:2px solid #14172B">MB1</th>
            <th align="center" style="font-size:10px; text-transform:uppercase; letter-spacing:.07em; color:#666C81; padding-bottom:6px; border-bottom:2px solid #14172B">MB2</th>
            <th align="center" style="font-size:10px; text-transform:uppercase; letter-spacing:.07em; color:#666C81; padding-bottom:6px; border-bottom:2px solid #14172B">Situação</th>
          </tr>
          ${linhas}
        </table>
      </td></tr>
      <tr><td align="center" style="padding:20px 28px 8px">
        <a href="https://faltae.com.br/" style="background:#4056C7; color:#FFF; text-decoration:none; border-radius:12px; padding:12px 26px; font-size:14px; font-weight:700; display:inline-block">Abrir o Faltaê</a>
        <div style="font-size:11px; color:#8A90A6; margin-top:8px">O relatório completo, com datas de cada falta, sai em Menu → Relatório do semestre.</div>
      </td></tr>
      <tr><td style="padding:16px 28px 22px; border-top:1px solid #E5E7F0">
        <div style="font-size:10px; color:#8A90A6; line-height:1.6">Você recebe este resumo a cada 15 dias por ser assinante Essencial. Para parar de receber, abra <a href="https://faltae.com.br/?relatorio=sair" style="color:#4056C7">este link</a> ou desligue em Menu → Conta. Este relatório é gerado a partir dos seus registros pessoais e não substitui os documentos oficiais da instituição.</div>
      </td></tr>
    </table></div>`,
  }
}

Deno.serve(async (req) => {
  const chave = Deno.env.get('RELATORIO_CRON_CHAVE')
  if (!chave || req.headers.get('x-relatorio-chave') !== chave) {
    return new Response('não autorizado', { status: 401 })
  }
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return new Response('sem RESEND_API_KEY', { status: 503 })

  const corpo = await req.json().catch(() => ({}))
  const soTeste: string | null = corpo?.teste || null

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: linhas, error } = await admin
    .from('dados_usuario')
    .select('user_id, dados, plano')
    .eq('plano', 'essencial')
  if (error) return new Response('erro ao ler assinantes: ' + error.message, { status: 500 })

  let enviados = 0, pulados = 0, falhas = 0
  for (const linha of linhas || []) {
    const { data: u } = await admin.auth.admin.getUserById(linha.user_id)
    const usuario = u?.user
    if (!usuario?.email) { pulados++; continue }
    if (soTeste && usuario.email !== soTeste) continue
    const meta = usuario.user_metadata || {}
    if (meta.receber_relatorio === false) { pulados++; continue }
    if (!linha.dados?.materias?.length) { pulados++; continue }

    const { assunto, html } = montarEmail(meta.nome || usuario.email, linha.dados)
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: REMETENTE, to: usuario.email, subject: assunto, html }),
    })
    if (r.ok) enviados++
    else { falhas++; console.error('falha ao enviar pra', usuario.email, r.status, await r.text()) }
  }

  console.log(`Relatórios: ${enviados} enviados, ${pulados} pulados, ${falhas} falhas${soTeste ? ' (modo teste)' : ''}`)
  return Response.json({ enviados, pulados, falhas })
})
