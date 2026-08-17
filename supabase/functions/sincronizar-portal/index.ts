// Faltaê — sincroniza notas e faltas do portal TOTVS (Fundasp/PUC-SP).
// FASE 1 (esta): login → busca → devolve processado. NÃO guarda senha nenhuma.
// A senha vem no corpo da chamada, é usada em memória e descartada ao fim.
// Guardar credencial (Vault) + agendamento vêm só na FASE 2, com aviso ao aluno.
// Publicar com "Verify JWT" LIGADO (só o app logado chama).
//
// Auth confirmada em 17/08/2026: POST /Login com JSON {user, password, alias},
// alias = "CorporeRM-prd"; a sessão volta no cookie .ASPXAUTH (HttpOnly).

const BASE = 'https://portal.fundasp.org.br/FrameHTML/RM/API/TOTVSEducacional';
const ALIAS = 'CorporeRM-prd';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
};

/* ── parser (portado de supabase/portal-sync/parser-portal.mjs, 15/15 testes) ── */
const arred1 = (v: number) => Math.round(v * 10) / 10;

function parseFaltas(json: any) {
  const regs = json?.data?.SFREQUENCIAALUNO || [];
  const porChave = new Map<string, any>();
  for (const r of regs) {
    if (r.PRESENCA !== 'A') continue;
    const data = String(r.DATAFALTA || r.DATA || '').slice(0, 10);
    if (!data) continue;
    const chave = r.CODDISC + '|' + data;
    const a = porChave.get(chave) || { coddisc: r.CODDISC, disciplina: r.DISCIPLINA, data, qtd: 0, abonada: false };
    a.qtd += 1;
    if (r.JUSTIFICADAPERSONALIZADO === 'Sim') a.abonada = true;
    porChave.set(chave, a);
  }
  return [...porChave.values()].sort((a, b) => a.data.localeCompare(b.data));
}

function mbDe(b: any) {
  if (!b) return null;
  let pr = b.pr, te = b.te;
  if (b.su != null) { if (te == null) te = b.su; else if (pr == null) pr = b.su; }
  if (pr == null || te == null) return null;
  return arred1((pr * 3 + te * 7) / 10);
}
function slotDaProva(n: string) {
  const s = String(n || '').toLowerCase();
  if (s.includes('prátic') || s.includes('pratic')) return 'pr';
  if (s.includes('teóric') || s.includes('teoric')) return 'te';
  if (s.includes('substitutiva')) return 'su';
  return null;
}
function bimestreDaEtapa(e: string) {
  const s = String(e || '').toLowerCase();
  if (s.includes('1') && s.includes('bimestre')) return 'b1';
  if (s.includes('2') && s.includes('bimestre')) return 'b2';
  if (s.includes('exame')) return 'exame';
  if (s.includes('média final') || s.includes('media final')) return 'mf';
  return null;
}
function parseNotas(json: any) {
  const lista = json?.data || json || [];
  const arr = Array.isArray(lista) ? lista : [];
  const porDisc = new Map<string, any>();
  for (const r of arr) {
    const d = porDisc.get(r.CODDISC) || {
      coddisc: r.CODDISC, disciplina: r.DISCIPLINA,
      notasPUC: { b1: { pr: null, te: null, su: null }, b2: { pr: null, te: null, su: null }, exame: null },
      provasDatadas: [] as any[],
    };
    const bim = bimestreDaEtapa(r.ETAPA);
    const nota = r.NOTA != null ? Number(r.NOTA) : null;
    if (bim === 'exame') { if (nota != null) d.notasPUC.exame = nota; }
    else if (bim === 'b1' || bim === 'b2') {
      const slot = slotDaProva(r.PROVA);
      if (slot && nota != null) d.notasPUC[bim][slot] = nota;
      if (slot && r.DTPROVA) d.provasDatadas.push({ data: String(r.DTPROVA).slice(0, 10), titulo: r.PROVA });
    }
    porDisc.set(r.CODDISC, d);
  }
  return [...porDisc.values()];
}

/* ── captura o cookie de sessão da resposta de login ── */
function extrairSessao(res: Response): string | null {
  const cookies = (res.headers as any).getSetCookie?.() || [];
  const bruto = cookies.length ? cookies.join('; ') : (res.headers.get('set-cookie') || '');
  const m = bruto.match(/\.ASPXAUTH=([^;]+)/);
  return m ? '.ASPXAUTH=' + m[1] : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const { user, password } = await req.json().catch(() => ({}));
  if (!user || !password) {
    return Response.json({ erro: 'informe user e password' }, { status: 400, headers: cors });
  }

  // 1) login — a senha é usada aqui e não é guardada em lugar nenhum
  const login = await fetch(`${BASE}/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=utf-8' },
    body: JSON.stringify({ user, password, alias: ALIAS }),
    redirect: 'manual',
  });
  const sessao = extrairSessao(login);
  if (!sessao) {
    return Response.json({ erro: 'login falhou — verifique usuário e senha', status: login.status }, { status: 401, headers: cors });
  }

  // 2) busca reusando o cookie de sessão
  const hoje = new Date();
  const umAno = new Date(hoje.getTime() - 370 * 86400000);
  const iso = (d: Date) => d.toISOString();
  const buscar = (caminho: string) => fetch(`${BASE}/${caminho}`, { headers: { Cookie: sessao } }).then(r => r.ok ? r.json() : null);

  const [faltaAula, avaliacoes] = await Promise.all([
    buscar(`Aluno/Falta/Aula?dataAte=${iso(hoje)}&dataDe=${iso(umAno)}&tipoFrequencia=A`),
    buscar('AvaliacaoAlunoPeriodoLetivo'),
  ]);

  // 3) processa e devolve — SEM guardar nada
  const faltas = faltaAula ? parseFaltas(faltaAula) : [];
  const notas = avaliacoes ? parseNotas(avaliacoes) : [];

  return Response.json({
    ok: true,
    faltas,
    notas,
    resumo: { faltas: faltas.length, disciplinasComNota: notas.filter(n =>
      n.notasPUC.exame != null || ['b1', 'b2'].some(b => Object.values(n.notasPUC[b]).some((v: any) => v != null))).length },
  }, { headers: cors });
});
