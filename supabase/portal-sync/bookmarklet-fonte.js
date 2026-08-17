// Atalho "Puxar pro Faltaê" — roda DENTRO do portal da PUC, na aba já logada.
// Mesma origem = a sessão do aluno (login + contexto) é usada automaticamente.
// Não manda nada pra servidor nenhum: busca, processa e copia pro clipboard.
(async function () {
  const BASE = '/FrameHTML/RM/API/TOTVSEducacional';
  const j = (r) => r.ok ? r.json() : null;
  try {
    const hoje = new Date().toISOString();
    const umAno = new Date(Date.now() - 370 * 86400000).toISOString();
    const [fa, av] = await Promise.all([
      fetch(`${BASE}/Aluno/Falta/Aula?dataAte=${hoje}&dataDe=${umAno}&tipoFrequencia=A`, { credentials: 'include' }).then(j),
      fetch(`${BASE}/AvaliacaoAlunoPeriodoLetivo`, { credentials: 'include' }).then(j),
    ]);

    // faltas: 1 dia = 1 falta (não importa quantas aulas o portal contou naquele dia)
    const mF = new Map();
    for (const r of (fa?.data?.SFREQUENCIAALUNO || [])) {
      if (r.PRESENCA !== 'A') continue;
      const data = String(r.DATAFALTA || r.DATA || '').slice(0, 10);
      if (!data) continue;
      const k = r.CODDISC + '|' + data;
      const a = mF.get(k) || { disciplina: r.DISCIPLINA, data, qtd: 1, abonada: false };
      if (r.JUSTIFICADAPERSONALIZADO === 'Sim') a.abonada = true;
      mF.set(k, a);
    }
    const faltas = [...mF.values()];

    // notas: grade de avaliações -> pr/te/su por bimestre + exame (sem depender de acento)
    const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const slot = (n) => { const s = norm(n); return s.includes('pratic') ? 'pr' : (s.includes('teoric') ? 'te' : (s.includes('substitutiva') ? 'su' : null)); };
    const bim = (e) => { const s = norm(e); return s.includes('1') && s.includes('bimestre') ? 'b1' : (s.includes('2') && s.includes('bimestre') ? 'b2' : (s.includes('exame') ? 'exame' : null)); };
    const mN = new Map();
    for (const r of (Array.isArray(av?.data) ? av.data : [])) {
      const d = mN.get(r.CODDISC) || { disciplina: r.DISCIPLINA, notasPUC: { b1: { pr: null, te: null, su: null }, b2: { pr: null, te: null, su: null }, exame: null } };
      const b = bim(r.ETAPA), nota = r.NOTA != null ? Number(r.NOTA) : null;
      if (b === 'exame') { if (nota != null) d.notasPUC.exame = nota; }
      else if (b === 'b1' || b === 'b2') { const s = slot(r.PROVA); if (s && nota != null) d.notasPUC[b][s] = nota; }
      mN.set(r.CODDISC, d);
    }
    const notas = [...mN.values()];

    const payload = JSON.stringify({ faltae: 1, faltas, notas });
    await navigator.clipboard.writeText(payload);
    alert('Pronto! ' + faltas.length + ' dia(s) de falta e ' + notas.length + ' disciplina(s) copiados.\n\nAbra o Faltaê > Menu > Puxar do portal e cole.');
  } catch (e) {
    alert('Não consegui puxar os dados. Confira se você está logado no portal e tente de novo.\n\n(' + e + ')');
  }
})();
