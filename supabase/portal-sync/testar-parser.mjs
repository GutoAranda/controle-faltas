// Testa o parser do portal com os JSONs REAIS capturados em 17/08/2026
import { parseFaltasPortal, parseNotasPortal, planejarFusao, aplicarFusao, casarMateria } from './parser-portal.mjs';

const faltaAula = { data: { SFREQUENCIAALUNO: [
  { IDTURMADISC: 462220, AULA: 1, CODDISC: '030500', DISCIPLINA: 'FUNDAMENTOS DO DIREITO PÚBLICO I', DATAFALTA: '2026-08-07T00:00:00', HORAINICIAL: '07:30', HORAFINAL: '08:20', JUSTIFICADAPERSONALIZADO: 'Não', PRESENCA: 'A', SITUACAO: 'Não justificada' },
  { IDTURMADISC: 462220, AULA: 2, CODDISC: '030500', DISCIPLINA: 'FUNDAMENTOS DO DIREITO PÚBLICO I', DATAFALTA: '2026-08-07T00:00:00', HORAINICIAL: '08:20', HORAFINAL: '09:10', JUSTIFICADAPERSONALIZADO: 'Não', PRESENCA: 'A', SITUACAO: 'Não justificada' },
  { IDTURMADISC: 464142, AULA: 1, CODDISC: '032926', DISCIPLINA: 'EXTENSIONISTA - METODOLOGIA DE PESQUISA JURIMÉTRICA', DATAFALTA: '2026-08-07T00:00:00', HORAINICIAL: '10:15', HORAFINAL: '11:05', JUSTIFICADAPERSONALIZADO: 'Não', PRESENCA: 'A', SITUACAO: 'Não justificada' },
  { IDTURMADISC: 464142, AULA: 2, CODDISC: '032926', DISCIPLINA: 'EXTENSIONISTA - METODOLOGIA DE PESQUISA JURIMÉTRICA', DATAFALTA: '2026-08-07T00:00:00', HORAINICIAL: '11:05', HORAFINAL: '11:55', JUSTIFICADAPERSONALIZADO: 'Não', PRESENCA: 'A', SITUACAO: 'Não justificada' },
  { IDTURMADISC: 462220, AULA: 4, CODDISC: '030500', DISCIPLINA: 'FUNDAMENTOS DO DIREITO PÚBLICO I', DATAFALTA: '2026-08-14T00:00:00', HORAINICIAL: '07:30', HORAFINAL: '08:20', JUSTIFICADAPERSONALIZADO: 'Não', PRESENCA: 'A', SITUACAO: 'Não justificada' },
  { IDTURMADISC: 462220, AULA: 5, CODDISC: '030500', DISCIPLINA: 'FUNDAMENTOS DO DIREITO PÚBLICO I', DATAFALTA: '2026-08-14T00:00:00', HORAINICIAL: '08:20', HORAFINAL: '09:10', JUSTIFICADAPERSONALIZADO: 'Não', PRESENCA: 'A', SITUACAO: 'Não justificada' },
] } };

// grade de avaliações: amostra real (nulos) + cenário FUTURO com notas lançadas pra provar a fusão
const avaliacoes = { data: [
  { CODPROVA: null, PROVA: null, DTPROVA: null, MEDIA: null, CODETAPA: 1, ETAPA: 'Média Final', CODDISC: '007037', DISCIPLINA: 'DIREITO ADMINISTRATIVO V', NOTA: null },
  { PROVA: 'Prova Prática', DTPROVA: '2026-10-05T00:00:00', ETAPA: '1º Bimestre (Direito)', CODDISC: '006744', DISCIPLINA: 'DIREITO CIVIL IX', NOTA: 8.5 },
  { PROVA: 'Prova Teórica', DTPROVA: null, ETAPA: '1º Bimestre (Direito)', CODDISC: '006744', DISCIPLINA: 'DIREITO CIVIL IX', NOTA: 7.0 },
  { PROVA: 'Prova Substitutiva', DTPROVA: null, ETAPA: '1º Bimestre (Direito)', CODDISC: '006744', DISCIPLINA: 'DIREITO CIVIL IX', NOTA: null },
  { PROVA: 'Prova Teórica', DTPROVA: null, ETAPA: '2º Bimestre (Direito)', CODDISC: '006744', DISCIPLINA: 'DIREITO CIVIL IX', NOTA: null },
  { PROVA: 'Exame Final', DTPROVA: null, ETAPA: 'Exame (Direito)', CODDISC: '006744', DISCIPLINA: 'DIREITO CIVIL IX', NOTA: null },
  { PROVA: 'Prova Teórica', DTPROVA: null, ETAPA: '1º Bimestre (Direito)', CODDISC: '007011', DISCIPLINA: 'DIREITO INTERNACIONAL PÚBLICO II', NOTA: 6.5 },
] };

// matérias como estão no APP dele (nomes do catálogo, alguns encurtados — teste do casamento fuzzy)
const db = {
  materias: [
    { id: 'm1', nome: 'Fundamentos do Direito Público I' },
    { id: 'm2', nome: 'Extensionista Jurimétrica' },
    { id: 'm3', nome: 'Direito Civil IX', notasPUC: { b1: { pr: 8.5, te: null, su: null }, b2: { pr: null, te: null, su: null }, exame: null } },
    { id: 'm4', nome: 'Internacional Público II' },
    { id: 'm5', nome: 'Internacional Público I' }, // armadilha: numeral romano diferente NÃO pode casar
    { id: 'm6', nome: 'Direito Administrativo V' },
  ],
  faltas: [
    { id: 'f1', materiaId: 'm1', data: '2026-08-07', qtd: 1, abonada: false },            // manual desatualizada (portal diz 2)
    { id: 'f2', materiaId: 'm3', data: '2026-08-15', qtd: 1, abonada: false },            // manual que o portal não tem: mantém
    { id: 'f3', materiaId: 'm2', data: '2026-08-07', qtd: 2, abonada: false, origem: 'portal' }, // já sincronizada: não repete
  ],
};

const faltas = parseFaltasPortal(faltaAula);
const notas = parseNotasPortal(avaliacoes);
const plano = planejarFusao(db, faltas, notas);

const chk = (nome, cond) => console.log((cond ? '✓' : '✗ FALHOU'), nome);

chk('agrupou 6 registros-aula em 3 faltas-dia', faltas.length === 3);
chk('FDP I 07/08 com qtd 2', faltas.some(f => f.coddisc === '030500' && f.data === '2026-08-07' && f.qtd === 2));
chk('casamento fuzzy: EXTENSIONISTA METODOLOGIA... → Extensionista Jurimétrica', casarMateria('EXTENSIONISTA - METODOLOGIA DE PESQUISA JURIMÉTRICA', db.materias)?.id === 'm2');
chk('casamento numeral: INTERNACIONAL PÚBLICO II → m4 (nunca m5)', casarMateria('DIREITO INTERNACIONAL PÚBLICO II', db.materias)?.id === 'm4');
chk('manual desatualizada vira substituir-manual (qtd 1→2)', plano.faltas.some(f => f.materiaId === 'm1' && f.acao === 'substituir-manual' && f.qtd === 2 && f.anterior.qtd === 1));
chk('falta já sincronizada não gera ação', !plano.faltas.some(f => f.materiaId === 'm2' && f.data === '2026-08-07'));
chk('manual do dia 15 preservada', plano.resumo.mantidasManuais === 1);
chk('nota igual à do app não gera mudança (Civil pr 8,5)', !plano.notas.some(n => n.materiaId === 'm3' && n.campo === 'b1.pr'));
chk('nota nova detectada (Civil te 7,0)', plano.notas.some(n => n.materiaId === 'm3' && n.campo === 'b1.te' && n.para === 7.0));
chk('nota de outra turma casa certo (Internacional II te 6,5 → m4)', plano.notas.some(n => n.materiaId === 'm4' && n.campo === 'b1.te' && n.para === 6.5));
chk('nenhuma disciplina COM NOTA ficou sem casa', plano.semCasa.filter(s => s.tipo === 'nota').length === 0);
chk('data de prova capturada pra agenda (Civil 05/10)', notas.find(n => n.coddisc === '006744')?.provasDatadas.some(p => p.data === '2026-10-05'));

aplicarFusao(db, plano);
chk('após aplicar: FDP I tem falta origem portal qtd 2', db.faltas.some(f => f.materiaId === 'm1' && f.data === '2026-08-07' && f.qtd === 2 && f.origem === 'portal'));
chk('após aplicar: manual do dia 15 continua viva', db.faltas.some(f => f.id === 'f2'));
chk('após aplicar: Civil te = 7,0 no notasPUC', db.materias.find(m => m.id === 'm3').notasPUC.b1.te === 7.0);

console.log('\nresumo do plano:', JSON.stringify(plano.resumo));
