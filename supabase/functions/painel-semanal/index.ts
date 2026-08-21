// Faltaê — PAINEL DE NEGÓCIO por e-mail (diário, 08:00 BRT).
// Lê a função painel_semanal() no banco e manda um resumo pro fundador. Assim
// você não roda SQL: o painel chega no e-mail todo dia de manhã.
// Publicar com "Verify JWT" DESLIGADO — a proteção é o header x-painel-chave,
// que precisa bater com o segredo RELATORIO_CRON_CHAVE (reusado; nenhum segredo novo).
// Segredos necessários: RESEND_API_KEY, RELATORIO_CRON_CHAVE.
// Teste manual: POST com corpo {"teste": true} devolve o HTML sem enviar e-mail.
import { createClient } from 'npm:@supabase/supabase-js@2'

const DESTINO = 'contato.gustavoaranda@gmail.com'   // troque aqui se quiser outro inbox
const REMETENTE = 'Faltaê Painel <relatorio@faltae.com.br>'
const LOGO = 'https://cdn.jsdelivr.net/gh/GutoAranda/controle-faltas@main/icon-192.png'

const n = (v: unknown) => Number(v ?? 0)
const pct = (a: number, b: number) => b > 0 ? Math.round(100 * a / b) + '%' : '—'

function montarEmail(d: any): { assunto: string; html: string } {
  const funil = d.funil || {}, ret = d.ret || {}, conv = d.conv || {}
  const origem: any[] = d.origem || [], vencendo: any[] = d.vencendo || [], gatilhos: any[] = d.gatilhos || []
  const baseFunil = n(funil.nuvem)

  // um cartão grande do topo
  const cartao = (valor: string, rotulo: string, tom: 'i'|'v'|'g' = 'i') => {
    const c = { i: ['#EEF1FB','#26317E','#565C74'], v: ['#E8F4D5','#33520A','#4A6B14'], g: ['#F4F5F9','#14172B','#565C74'] }[tom]
    return `<td width="25%" style="padding:5px"><table width="100%" cellpadding="0" cellspacing="0" bgcolor="${c[0]}" style="background:${c[0]};border-radius:12px"><tr><td align="center" style="padding:14px 4px">
      <div style="font-size:26px;font-weight:800;color:${c[1]};font-family:'Bricolage Grotesque','DM Sans',Arial,sans-serif">${valor}</div>
      <div style="font-size:10px;font-weight:700;color:${c[2]};text-transform:uppercase;letter-spacing:.05em;margin-top:2px">${rotulo}</div>
    </td></tr></table></td>`
  }

  // linha do funil de ativação com barra
  const linhaFunil = (rot: string, val: number) => {
    const p = baseFunil > 0 ? Math.round(100 * val / baseFunil) : 0
    return `<tr>
      <td style="padding:7px 0;font-size:14px;color:#14172B;width:180px">${rot}</td>
      <td style="padding:7px 0;width:100%"><table cellpadding="0" cellspacing="0" width="100%"><tr>
        <td bgcolor="#EFF0F6" style="background:#EFF0F6;border-radius:6px"><table cellpadding="0" cellspacing="0" width="${Math.max(p,2)}%"><tr><td bgcolor="#4056C7" style="background:#4056C7;border-radius:6px;height:12px;font-size:0">&nbsp;</td></tr></table></td>
      </tr></table></td>
      <td style="padding:7px 0 7px 12px;font-size:14px;font-weight:700;color:#14172B;white-space:nowrap">${val} · ${p}%</td>
    </tr>`
  }

  const linhasOrigem = origem.length
    ? origem.map(o => `<tr><td style="padding:5px 0;font-size:13px;color:#14172B">${o.origem}</td><td align="right" style="padding:5px 0;font-size:13px;font-weight:700;color:#14172B">${o.contas}</td></tr>`).join('')
    : '<tr><td style="font-size:13px;color:#8A90AC;padding:5px 0">nenhum Essencial ainda</td></tr>'

  const linhasVencendo = vencendo.length
    ? vencendo.map(v => {
        const tom = v.origem === 'trial' ? '#965009' : (String(v.origem||'').startsWith('parceria') ? '#565C74' : '#B31138')
        const nota = v.origem === 'trial' ? 'teste → converter' : (String(v.origem||'').startsWith('parceria') ? 'cortesia → só avisar' : 'pagante → renovar')
        return `<tr><td style="padding:5px 0;font-size:13px;color:#14172B">${v.email}</td><td style="padding:5px 0;font-size:12px;color:${tom}">${v.dias}d · ${nota}</td></tr>`
      }).join('')
    : '<tr><td style="font-size:13px;color:#8A90AC;padding:5px 0">ninguém vencendo nos próximos 7 dias 👍</td></tr>'

  const linhasGatilhos = gatilhos.length
    ? gatilhos.map(g => `<tr><td style="padding:4px 0;font-size:13px;color:#14172B">${g.evento}</td><td align="right" style="padding:4px 0;font-size:13px;font-weight:700;color:#14172B">${g.n}</td></tr>`).join('')
    : '<tr><td style="font-size:13px;color:#8A90AC;padding:4px 0">sem gatilhos registrados nos últimos 7 dias</td></tr>'

  const intencao = pct(n(conv.tocou), n(conv.viu))

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<style>@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&family=DM+Sans:wght@400;500;700&display=swap');</style></head>
<body style="margin:0;padding:0;background:#E9EBF2">
<div style="background:#E9EBF2;padding:20px 8px;font-family:'DM Sans','Segoe UI',system-ui,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" style="max-width:600px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden">
    <tr><td bgcolor="#14172B" style="background:#14172B;padding:22px 26px">
      <table cellpadding="0" cellspacing="0"><tr>
        <td width="40" valign="middle"><img src="${LOGO}" width="40" height="40" alt="" style="display:block;border-radius:11px"></td>
        <td style="padding-left:13px">
          <div style="font-family:'Bricolage Grotesque',Arial,sans-serif;color:#FFFFFF;font-size:15px;font-weight:800">falta<span style="color:#A3E635">ê</span> · painel</div>
          <div style="color:#A6ABC2;font-size:12px">${d.gerado_em}</div>
        </td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:22px 22px 4px">
      <div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8A90AC;margin-bottom:8px">Pulso</div>
      <table cellpadding="0" cellspacing="0" width="100%"><tr>
        ${cartao(String(n(d.contas_total)), 'contas', 'g')}
        ${cartao('+' + n(d.novas_7d), 'novas 7d', 'g')}
        ${cartao(String(n(d.essencial)), 'essencial', 'i')}
        ${cartao(String(n(d.pagantes)), 'pagantes', n(d.pagantes) > 0 ? 'v' : 'g')}
      </tr></table>
    </td></tr>

    <tr><td style="padding:18px 22px 4px">
      <div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8A90AC;margin-bottom:6px">Ativação — de conta a uso real</div>
      <table cellpadding="0" cellspacing="0" width="100%">
        ${linhaFunil('Tem dados na nuvem', baseFunil)}
        ${linhaFunil('Montou a grade', n(funil.grade))}
        ${linhaFunil('Marcou ≥1 falta', n(funil.falta))}
        ${linhaFunil('Cadastrou prova', n(funil.prova))}
      </table>
    </td></tr>

    <tr><td style="padding:14px 22px 4px">
      <table cellpadding="0" cellspacing="0" width="100%"><tr>
        <td width="50%" valign="top" style="padding-right:8px">
          <div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8A90AC;margin-bottom:6px">Uso recente (Essencial)</div>
          <div style="font-size:13px;color:#14172B;line-height:1.7">
            Ontem: <b>${n(ret.d1)}</b><br>7 dias: <b>${n(ret.d7)}</b><br>30 dias: <b>${n(ret.d30)}</b> de ${n(ret.base)}
          </div>
        </td>
        <td width="50%" valign="top" style="padding-left:8px">
          <div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8A90AC;margin-bottom:6px">Intenção de compra (7d)</div>
          <div style="font-size:13px;color:#14172B;line-height:1.7">
            Viu o plano: <b>${n(conv.viu)}</b><br>Tocou num passe: <b>${n(conv.tocou)}</b><br>Taxa: <b style="color:#4056C7">${intencao}</b>
          </div>
        </td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:14px 22px 4px">
      <div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8A90AC;margin-bottom:6px">Essencial por origem</div>
      <table cellpadding="0" cellspacing="0" width="100%">${linhasOrigem}</table>
    </td></tr>

    <tr><td style="padding:14px 22px 4px">
      <div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8A90AC;margin-bottom:6px">⚡ Vencendo em 7 dias — janela de ação</div>
      <table cellpadding="0" cellspacing="0" width="100%">${linhasVencendo}</table>
    </td></tr>

    <tr><td style="padding:14px 22px 22px">
      <div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8A90AC;margin-bottom:6px">Gatilhos que levaram à oferta (7d)</div>
      <table cellpadding="0" cellspacing="0" width="100%">${linhasGatilhos}</table>
    </td></tr>

    <tr><td bgcolor="#F4F5F9" style="background:#F4F5F9;padding:14px 22px;font-size:11px;color:#8A90AC;line-height:1.5">
      Valores em R$ ficam no Mercado Pago (aqui é contagem). Uso recente só enxerga Essencial (o grátis não sincroniza).
      Painel completo em SQL: PAINEL-NEGOCIO.sql.
    </td></tr>
  </table>
</div></body></html>`

  return { assunto: `Faltaê · painel de ${d.gerado_em?.slice(0, 10) || 'hoje'}`, html }
}

Deno.serve(async (req) => {
  const corpo = await req.json().catch(() => ({}))
  const soTeste = corpo?.teste === true

  const chave = Deno.env.get('RELATORIO_CRON_CHAVE')
  if (!soTeste && (!chave || req.headers.get('x-painel-chave') !== chave)) {
    return new Response('não autorizado', { status: 401 })
  }
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return new Response('sem RESEND_API_KEY', { status: 503 })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await admin.rpc('painel_semanal')
  if (error) return new Response('erro ao ler painel: ' + error.message, { status: 500 })

  const { assunto, html } = montarEmail(data)

  // modo teste: devolve o HTML pra inspeção, não envia
  if (soTeste) return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: REMETENTE, to: DESTINO, subject: assunto, html }),
  })
  if (!r.ok) {
    const txt = await r.text()
    console.error('Resend recusou o painel:', r.status, txt)
    return new Response('falha no envio: ' + txt, { status: 502 })
  }
  console.log('Painel enviado para', DESTINO)
  return Response.json({ ok: true, enviado_para: DESTINO })
})
