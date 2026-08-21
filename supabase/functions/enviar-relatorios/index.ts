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

/* ── email em HTML de tabela, blindado contra o modo escuro do Gmail:
   toda cor de texto é forte e explícita, todo fundo é declarado em bgcolor
   E em style, e o logo é o PNG oficial servido por CDN com certificado válido ── */
const LOGO = 'https://cdn.jsdelivr.net/gh/GutoAranda/controle-faltas@main/icon-192.png'

function montarEmail(nome: string, dados: any) {
  const hoje = new Date().toISOString().slice(0, 10)
  const mats = [...(dados.materias || [])].sort((a, b) => String(a.nome).localeCompare(String(b.nome)))
  const faltas = dados.faltas || []
  const eventos = dados.eventos || []
  const aulas = dados.aulas || []
  let aulasDadasTotal = 0
  let usadasTotal = 0, restamTotal = 0, emRisco = 0
  const mbs: number[] = []

  const nota = (v: number | null) => v == null
    ? '<span style="color:#8A90A6">—</span>'
    : `<span style="font-weight:700; color:${v < 6 ? '#B3123B' : '#111111'}">${nf(v)}</span>`

  const linhas = mats.map((mat, i) => {
    const r = resumoFreq(mat, faltas)
    const rn = resumoNotas(mat)
    const dadas = aulas.filter((a: any) => a.materiaId === mat.id && a.data <= hoje).length
    aulasDadasTotal += dadas
    usadasTotal += r.usadas; restamTotal += r.restam
    if (r.nivel === 'danger') emRisco++
    if (rn.mb1 != null) mbs.push(rn.mb1)
    if (rn.mb2 != null) mbs.push(rn.mb2)
    const pill = r.nivel === 'ok' ? ['#E8F4D5', '#33520A'] : (r.nivel === 'warn' ? ['#FCEBD2', '#7A4306'] : ['#F9DEE4', '#8F0E2E'])
    const zebra = i % 2 ? ' bgcolor="#F6F7FB" style="background:#F6F7FB"' : ''
    return `<tr${zebra}>
      <td style="padding:10px; font-size:13px; font-weight:700; color:#111111; border-bottom:1px solid #E2E5F0">${mat.nome}</td>
      <td align="center" style="font-size:13px; color:#111111; border-bottom:1px solid #E2E5F0">${r.usadas}/${r.maxFaltas}</td>
      <td align="center" style="font-size:13px; border-bottom:1px solid #E2E5F0">${nota(rn.mb1)}</td>
      <td align="center" style="font-size:13px; border-bottom:1px solid #E2E5F0">${nota(rn.mb2)}</td>
      <td align="center" style="border-bottom:1px solid #E2E5F0"><span style="background:${pill[0]}; color:${pill[1]}; border-radius:99px; padding:3px 10px; font-size:11px; font-weight:700; white-space:nowrap">${r.rotulo}</span></td>
    </tr>`
  }).join('')

  /* Presenca sobre o TOTAL de aulas dadas, nao media dos percentuais por materia.
     O corte antigo (>=5 aulas POR MATERIA) deixava o cartao vazio durante todo o
     primeiro mes de aula: 11 materias x 2 aulas = 22 aulas dadas, e nenhuma materia
     chegando a 5. Somar percentuais de materias com contagens diferentes tambem
     estava errado estatisticamente - o certo e ponderar pelo numero de aulas. */
  const mediaPres = aulasDadasTotal >= 5
    ? Math.round(Math.max(0, aulasDadasTotal - usadasTotal) / aulasDadasTotal * 100) + '%'
    : (aulasDadasTotal > 0 ? Math.max(0, aulasDadasTotal - usadasTotal) + ' de ' + aulasDadasTotal : '—')
  const mediaNotas = mbs.length ? nf(arred1(mbs.reduce((s, v) => s + v, 0) / mbs.length)) : '—'
  const provas = eventos.filter((e: any) => e.tipo === 'prova' && e.data >= hoje).length
  const primeirAula = aulas.length ? aulas.map((a: any) => a.data).sort()[0] : hoje
  const semestre = primeirAula.slice(0, 4) + '/' + (Number(primeirAula.slice(5, 7)) <= 6 ? '1' : '2')

  const cartao = (valor: string, rotulo: string, tom: 'indigo' | 'verde' | 'vermelho' = 'indigo') => {
    const cores = { indigo: ['#EEF1FB', '#26317E', '#565C74'], verde: ['#E8F4D5', '#33520A', '#4A6B14'], vermelho: ['#F9DEE4', '#8F0E2E', '#A8365A'] }
    const [bg, fg, sub] = cores[tom]
    return `<td width="33%" style="padding:5px"><table width="100%" cellpadding="0" cellspacing="0" bgcolor="${bg}" style="background:${bg}; border-radius:12px"><tr><td align="center" style="padding:13px 6px">
      <div style="font-size:23px; font-weight:800; color:${fg}">${valor}</div>
      <div style="font-size:10px; font-weight:700; color:${sub}; text-transform:uppercase; letter-spacing:.05em">${rotulo}</div>
    </td></tr></table></td>`
  }

  const th = (texto: string, extra = '') =>
    `<th align="${texto === 'Matéria' ? 'left' : 'center'}" style="color:#FFFFFF; font-size:10px; text-transform:uppercase; letter-spacing:.06em; padding:8px ${texto === 'Matéria' || texto === 'Situação' ? '10px' : '6px'};${extra}">${texto}</th>`

  const agora = new Date()
  const quinzena = agora.toLocaleDateString('pt-BR')
  return {
    assunto: `Seu relatório do semestre — ${quinzena}`,
    html: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<style>@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&family=DM+Sans:wght@400;500;700&display=swap');</style></head>
<body style="margin:0; padding:0; background:#E9EBF2">
<div style="background:#E9EBF2; padding:20px 8px; font-family:'DM Sans','Segoe UI',system-ui,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" style="max-width:600px; margin:0 auto; background:#FFFFFF; border-radius:16px; overflow:hidden">
    <tr><td bgcolor="#4056C7" style="background:#4056C7; padding:26px 28px">
      <table cellpadding="0" cellspacing="0"><tr>
        <td width="48" valign="middle"><img src="${LOGO}" width="48" height="48" alt="Faltaê" style="display:block; border-radius:13px"></td>
        <td style="padding-left:14px">
          <div style="font-family:'Bricolage Grotesque','DM Sans','Segoe UI',Arial,sans-serif; color:#FFFFFF; font-size:15px; font-weight:800">falta<span style="color:#A3E635">ê</span></div>
          <div style="font-family:'Bricolage Grotesque','DM Sans','Segoe UI',Arial,sans-serif; color:#FFFFFF; font-size:23px; font-weight:800; margin-top:2px">Relatório do semestre</div>
          <div style="color:#C9D2F5; font-size:13px; margin-top:2px">${nome} · ${quinzena} · ${semestre}</div>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:20px 20px 6px">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        ${cartao(mediaPres, 'Presença média')}${cartao(mediaNotas, 'Média das notas')}${cartao(String(emRisco), 'Em atenção', emRisco ? 'vermelho' : 'verde')}
      </tr><tr>
        ${cartao(String(usadasTotal), 'Faltas usadas')}${cartao(String(restamTotal), 'Faltas de folga', 'verde')}${cartao(String(provas), 'Provas à frente')}
      </tr></table>
    </td></tr>
    <tr><td style="padding:16px 26px 4px">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr bgcolor="#26317E" style="background:#26317E">
          ${th('Matéria', ' border-radius:8px 0 0 8px')}${th('Faltas')}${th('MB1')}${th('MB2')}${th('Situação', ' border-radius:0 8px 8px 0')}
        </tr>
        ${linhas}
      </table>
    </td></tr>
    <tr><td align="center" style="padding:18px 28px 6px">
      <a href="https://faltae.com.br/" style="background:#4056C7; color:#FFFFFF; text-decoration:none; border-radius:12px; padding:13px 30px; font-size:14px; font-weight:700; display:inline-block">Abrir o Faltaê</a>
      <div style="font-size:11px; color:#6B7089; margin-top:8px">O relatório completo, com as datas de cada falta, sai em Menu → Relatório do semestre.</div>
    </td></tr>
    <tr><td style="padding:16px 28px 22px">
      <div style="border-top:1px solid #E2E5F0; padding-top:12px; font-size:10px; color:#8A90A6; line-height:1.6">Você recebe este resumo a cada 15 dias por ser assinante Essencial. Para parar, <a href="https://faltae.com.br/?relatorio=sair" style="color:#4056C7">clique aqui</a> ou desligue em Menu → Conta. Gerado a partir dos seus registros pessoais — não substitui os documentos oficiais da instituição.</div>
    </td></tr>
  </table>
</div>
</body></html>`,
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

  /* FILA EM VEZ DE RAJADA (roda todo dia)
     TETO: quanto o relatório pode gastar por dia. O resto da cota do Resend fica
     reservado pros emails de cadastro e senha — sem eles um aluno novo não entra,
     enquanto um relatório que chega amanhã não machuca ninguém.
     ESPERA: só entra na fila quem está há 14+ dias sem receber.
     INATIVIDADE: quem não abre o app há semanas não recebe — não adianta gastar
     cota (e reputação de domínio) com email que ninguém abre. Volta sozinho ao
     usar o app, porque a sincronização atualiza a data. */
  const TETO_DIARIO = 60
  const ESPERA_DIAS = 14
  const INATIVO_DIAS = 21

  const agora = new Date()
  const desde = (d: number) => new Date(agora.getTime() - d * 86400000).toISOString()

  let consulta = admin
    .from('dados_usuario')
    .select('user_id, dados, plano, relatorio_em, atualizado_em')
    .eq('plano', 'essencial')

  if (!soTeste) {
    consulta = consulta
      .or(`relatorio_em.is.null,relatorio_em.lt.${desde(ESPERA_DIAS)}`)
      .gte('atualizado_em', desde(INATIVO_DIAS))
      .order('relatorio_em', { ascending: true, nullsFirst: true })
      .limit(TETO_DIARIO)
  }

  const { data: linhas, error } = await consulta
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
    if (r.ok) {
      enviados++
      // marca a vez dele na fila; sem isto ele voltaria amanhã e os outros nunca chegariam
      if (!soTeste) {
        await admin.from('dados_usuario')
          .update({ relatorio_em: agora.toISOString() })
          .eq('user_id', linha.user_id)
      }
    } else {
      falhas++
      console.error('falha ao enviar pra', usuario.email, r.status, await r.text())
    }
  }

  /* quantos ficaram esperando: sem este número, um teto que corta metade da base
     parece "tudo enviado" no log */
  let naFila = 0
  if (!soTeste) {
    const { count } = await admin
      .from('dados_usuario')
      .select('user_id', { count: 'exact', head: true })
      .eq('plano', 'essencial')
      .or(`relatorio_em.is.null,relatorio_em.lt.${desde(ESPERA_DIAS)}`)
      .gte('atualizado_em', desde(INATIVO_DIAS))
    naFila = count || 0
  }

  console.log(`Relatórios: ${enviados} enviados, ${pulados} pulados, ${falhas} falhas, ${naFila} ainda na fila (teto ${TETO_DIARIO}/dia)${soTeste ? ' (modo teste)' : ''}`)
  return Response.json({ enviados, pulados, falhas, naFila })
})
