// Faltaê — parser e fusão dos dados do portal TOTVS (RM Educacional / Fundasp)
// Entrada: JSONs crus dos endpoints do portal. Saída: estruturas do app + plano de fusão.
// Regra de ouro: portal manda no oficial, manual manda no tempo real, nada some em silêncio.

/* ── normalização e casamento de nomes de disciplina ── */
const ROMANOS = new Set(['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x']);
const RUIDO = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'o', 'a', 'em', 'para']);

export function normalizar(nome) {
  return String(nome || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[-–—:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(nome) {
  return normalizar(nome).split(' ').filter(t => t && !RUIDO.has(t));
}

// casa se TODOS os tokens do nome mais curto aparecem no mais longo
// (numerais romanos exigem igualdade exata; os demais aceitam prefixo ≥3 letras)
export function nomesCasam(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  const [curto, longo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return curto.every(tc => longo.some(tl => {
    if (ROMANOS.has(tc) || ROMANOS.has(tl)) return tc === tl;
    if (tc === tl) return true;
    const [p, g] = tc.length <= tl.length ? [tc, tl] : [tl, tc];
    return p.length >= 3 && g.startsWith(p);
  }));
}

export function casarMateria(nomePortal, materiasApp) {
  // 1º: casamento completo; 2º: ignorando prefixos de categoria do portal
  const semPrefixo = normalizar(nomePortal).replace(/^(eletiva|extensionista|estudos orientados|optativa)\s+/, '');
  return materiasApp.find(m => nomesCasam(nomePortal, m.nome))
      || materiasApp.find(m => nomesCasam(semPrefixo, m.nome))
      || null;
}

/* ── faltas: agrupa os registros aula-a-aula do portal em (disciplina, dia) ── */
export function parseFaltasPortal(jsonFaltaAula) {
  const regs = jsonFaltaAula?.data?.SFREQUENCIAALUNO || [];
  const porChave = new Map();
  for (const r of regs) {
    if (r.PRESENCA !== 'A') continue; // A = ausência
    const data = String(r.DATAFALTA || r.DATA || '').slice(0, 10);
    if (!data) continue;
    const chave = r.CODDISC + '|' + data;
    const atual = porChave.get(chave) || {
      coddisc: r.CODDISC,
      disciplina: r.DISCIPLINA,
      data,
      qtd: 0,
      abonada: false,
      horarios: [],
    };
    atual.qtd += 1;
    atual.horarios.push(r.HORAINICIAL + '–' + r.HORAFINAL);
    // justificada/abonada no portal → abonada no app
    if (r.JUSTIFICADAPERSONALIZADO === 'Sim' || /justificada$/i.test(String(r.SITUACAO || '')) && !/n[ãa]o/i.test(String(r.SITUACAO || ''))) {
      atual.abonada = true;
    }
    porChave.set(chave, atual);
  }
  return [...porChave.values()].sort((a, b) => a.data.localeCompare(b.data) || a.coddisc.localeCompare(b.coddisc));
}

/* ── notas: da grade de avaliações pro modelo notasPUC do app ── */
function slotDaProva(nomeProva) {
  const n = normalizar(nomeProva);
  if (/pratica/.test(n)) return 'pr';
  if (/teorica/.test(n)) return 'te';
  if (/substitutiva/.test(n)) return 'su';
  return null;
}

function bimestreDaEtapa(etapa) {
  const n = normalizar(etapa);
  if (/1\s*º?\s*bimestre|^2\s/.test(n) || /1o? bimestre/.test(n)) return 'b1';
  if (/2\s*º?\s*bimestre/.test(n)) return 'b2';
  if (/exame/.test(n)) return 'exame';
  if (/media final/.test(n)) return 'mf';
  return null;
}

export function parseNotasPortal(jsonAvaliacoes) {
  const regs = jsonAvaliacoes?.data || jsonAvaliacoes || [];
  const lista = Array.isArray(regs) ? regs : (regs.Avaliacoes || regs.SAVALIACAO || []);
  const porDisc = new Map();
  for (const r of lista) {
    const d = porDisc.get(r.CODDISC) || {
      coddisc: r.CODDISC,
      disciplina: r.DISCIPLINA,
      notasPUC: { b1: { pr: null, te: null, su: null }, b2: { pr: null, te: null, su: null }, exame: null },
      mediaFinal: null,
      provasDatadas: [], // datas de prova agendadas viram eventos na agenda
    };
    const bim = bimestreDaEtapa(r.ETAPA);
    const nota = r.NOTA != null ? Number(r.NOTA) : null;
    if (bim === 'mf') {
      if (nota != null) d.mediaFinal = nota;
      else if (r.MEDIA != null) d.mediaFinal = Number(r.MEDIA);
    } else if (bim === 'exame') {
      if (r.PROVA == null || /exame/i.test(String(r.PROVA))) {
        if (nota != null) d.notasPUC.exame = nota;
      }
    } else if (bim && r.PROVA) {
      const slot = slotDaProva(r.PROVA);
      if (slot && nota != null) d.notasPUC[bim][slot] = nota;
      if (r.DTPROVA) d.provasDatadas.push({ data: String(r.DTPROVA).slice(0, 10), titulo: r.PROVA, bim });
    }
    porDisc.set(r.CODDISC, d);
  }
  return [...porDisc.values()];
}

/* ── fusão: portal manda no oficial, manual manda no tempo real ── */
// db: banco do app { materias, faltas, ... }. Retorna plano de mudanças SEM aplicar,
// pra prévia conferível (mesmo padrão do leitor de plano de ensino).
export function planejarFusao(db, faltasPortal, notasPortal) {
  const plano = { faltas: [], notas: [], semCasa: [], resumo: { novas: 0, substituidas: 0, mantidasManuais: 0, notasNovas: 0 } };

  for (const fp of faltasPortal) {
    const mat = casarMateria(fp.disciplina, db.materias);
    if (!mat) { plano.semCasa.push({ tipo: 'falta', disciplina: fp.disciplina, data: fp.data }); continue; }
    const manualMesmoDia = db.faltas.find(f => f.materiaId === mat.id && f.data === fp.data && f.origem !== 'portal');
    const portalJaTem = db.faltas.find(f => f.materiaId === mat.id && f.data === fp.data && f.origem === 'portal');
    if (portalJaTem && portalJaTem.qtd === fp.qtd && !!portalJaTem.abonada === fp.abonada) continue; // nada mudou
    plano.faltas.push({
      acao: manualMesmoDia ? 'substituir-manual' : (portalJaTem ? 'atualizar-portal' : 'nova'),
      materiaId: mat.id, materiaNome: mat.nome,
      data: fp.data, qtd: fp.qtd, abonada: fp.abonada,
      anterior: manualMesmoDia ? { qtd: manualMesmoDia.qtd, abonada: manualMesmoDia.abonada } : null,
    });
    if (manualMesmoDia) plano.resumo.substituidas++; else plano.resumo.novas++;
  }
  // faltas manuais que o portal não conhece: mantidas (janela do "faltei hoje")
  plano.resumo.mantidasManuais = db.faltas.filter(f => f.origem !== 'portal' &&
    !faltasPortal.some(fp => { const m = casarMateria(fp.disciplina, db.materias); return m && m.id === f.materiaId && fp.data === f.data; })).length;

  for (const np of notasPortal) {
    const mat = casarMateria(np.disciplina, db.materias);
    if (!mat) {
      const temNota = np.mediaFinal != null || ['b1', 'b2'].some(b => Object.values(np.notasPUC[b]).some(v => v != null)) || np.notasPUC.exame != null;
      if (temNota) plano.semCasa.push({ tipo: 'nota', disciplina: np.disciplina });
      continue;
    }
    const atual = mat.notasPUC || { b1: { pr: null, te: null, su: null }, b2: { pr: null, te: null, su: null }, exame: null };
    for (const bim of ['b1', 'b2']) {
      for (const slot of ['pr', 'te', 'su']) {
        const oficial = np.notasPUC[bim][slot];
        if (oficial != null && atual[bim][slot] !== oficial) {
          plano.notas.push({ materiaId: mat.id, materiaNome: mat.nome, campo: `${bim}.${slot}`, de: atual[bim][slot], para: oficial });
          plano.resumo.notasNovas++;
        }
      }
    }
    if (np.notasPUC.exame != null && atual.exame !== np.notasPUC.exame) {
      plano.notas.push({ materiaId: mat.id, materiaNome: mat.nome, campo: 'exame', de: atual.exame, para: np.notasPUC.exame });
      plano.resumo.notasNovas++;
    }
  }
  return plano;
}

// aplica o plano: faltas do portal ganham origem:'portal'; manuais substituídas saem
export function aplicarFusao(db, plano) {
  for (const f of plano.faltas) {
    db.faltas = db.faltas.filter(x => !(x.materiaId === f.materiaId && x.data === f.data));
    db.faltas.push({ id: 'p' + Math.random().toString(36).slice(2, 9), materiaId: f.materiaId, data: f.data, qtd: f.qtd, abonada: f.abonada, recuperada: false, origem: 'portal' });
  }
  for (const n of plano.notas) {
    const mat = db.materias.find(m => m.id === n.materiaId);
    if (!mat) continue;
    if (!mat.notasPUC) mat.notasPUC = { b1: { pr: null, te: null, su: null }, b2: { pr: null, te: null, su: null }, exame: null };
    if (n.campo === 'exame') mat.notasPUC.exame = n.para;
    else { const [bim, slot] = n.campo.split('.'); mat.notasPUC[bim][slot] = n.para; }
    mat.notasOrigem = 'portal';
  }
  return db;
}
