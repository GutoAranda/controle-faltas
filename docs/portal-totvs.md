# Integração com o portal TOTVS (PUC-SP) — documentação e post-mortem

**Status: ABORTADO em 17/08/2026** (decisão do Gustavo: UX complexa demais pro usuário final).
Recurso removido do app na v47. Último commit com o recurso vivo: `c16abb8` (v46).

---

## 1. O que era

"Puxar do portal": trazer **faltas e notas oficiais** do portal acadêmico da PUC-SP
(TOTVS RM Educacional) pro Faltaê, sem digitação manual.

## 2. O que foi tentado, em ordem

### 2a. Sincronização pelo servidor (senha guardada) — FALHOU
- Edge Function `supabase/functions/sincronizar-portal/index.ts` (commit `1e9b468`, nunca publicada).
- O login no portal **funciona** (200, cookie `.ASPXAUTH` emitido), mas os endpoints de dados
  respondem **403 "Usuário não está autenticado"**.
- Causa: depois do login o portal exige um handshake extra (`Contexto`/`Selecao`) com um token
  ofuscado `IdContextoAluno` que **não vem na resposta do login** — é montado por JavaScript
  no navegador. O portal resiste a replay headless por design.
- Conclusão: acesso servidor-a-servidor é inviável sem engenharia reversa frágil, e guardar
  senha de aluno no nosso banco era o pior cenário jurídico (LGPD) e de segurança.

### 2b. Bookmarklet on-device ("Puxar pro Faltaê") — FUNCIONOU, mas foi abortado
- Um favorito especial (`javascript:`) que o aluno toca **estando logado no portal**.
- Roda na origem do portal (same-origin), aproveitando a sessão viva do próprio aluno:
  - `GET /FrameHTML/RM/API/TOTVSEducacional/Aluno/Falta/Aula?tipoFrequencia=A` → faltas
  - `GET /FrameHTML/RM/API/TOTVSEducacional/AvaliacaoAlunoPeriodoLetivo` → notas
- Agrega, monta `{ faltae: 1, faltas: [...], notas: [...] }` e copia pro clipboard.
- O aluno colava no app (Menu → Puxar do portal), via uma **prévia** e confirmava.
- **A senha nunca saía do navegador do aluno; nada era armazenado em servidor nosso.**
- Testado ponta a ponta no preview: funcionou.
- **Por que morreu:** criar o favorito manualmente (copiar código → criar favorito → editar →
  colar no campo de endereço) é complexo demais pro usuário final, especialmente no iPhone
  (maioria da PUC). "Ficou muito ruim" — G., 17/08/2026.

## 3. Decisões de produto que valem pra qualquer retomada

1. **Modelo por DIA: 1 dia com falta = 1 falta no app**, não importa se o portal registrou
   2/3/4 aulas naquele dia. O limite de 25% em dias equivale a 25% em aulas para matérias
   semanais da PUC. (Decisão do Gustavo; reverteu o modelo anterior de multiplicação por aula.)
2. **Fusão com prévia obrigatória**: nunca aplicar direto. Mostrar "X faltas novas, Y confirmadas,
   Z mantidas (portal ainda não registrou), N notas atualizadas" e só aplicar com confirmação.
3. **Faltas manuais nunca são apagadas pelo portal** — falta com `origem !== 'portal'` sem
   correspondente oficial é *mantida* (o portal demora a registrar).
4. **Casamento fuzzy de nomes de matéria**: normalizar acentos, ignorar stopwords,
   prefixo ≥ 3 letras casa, algarismos romanos (I–X) só casam exatos, e prefixos
   "eletiva/extensionista/estudos orientados/optativa" são descartáveis.
5. Notas do portal entram em `materia.notasPUC = { b1: {pr,te,su}, b2: {pr,te,su}, exame }`;
   slots por texto ("prática"→pr, "teórica"→te, "substitutiva"→su), etapa por "1º/2º bimestre"/"exame".
6. Faltas do portal gravadas com `origem: 'portal'` (o modelo de dados continua aceitando
   esse campo — dados antigos não quebram nada com o recurso removido).

## 4. Onde o código está guardado

| Peça | Onde |
|---|---|
| Bookmarklet legível (fonte) | `supabase/portal-sync/bookmarklet-fonte.js` |
| Parser/experimentos de referência | `supabase/portal-sync/parser-portal.mjs` |
| Edge function servidor (não funciona, referência) | `supabase/functions/sincronizar-portal/index.ts` |
| UI + fusão no app (última versão viva) | `index.html` no commit `c16abb8`: seção `#menu-portal`, funções `pNorm/pTokens/pNomesCasam/pCasarMateria/planejarPortal/aplicarPortal`, bookmarklet URL-encoded na IIFE `portal-instrucoes` |

Para restaurar: `git show c16abb8:index.html` e recuperar os dois blocos
(HTML `<details id="menu-portal">` e o bloco JS entre os marcadores
`/* ─── puxar do portal ─── */` e `function renderSeguindo`).

## 5. Caminhos se um dia voltarmos

1. **Atalho do iOS (melhor custo/benefício)**: app Atalhos roda "Executar JavaScript em página web"
   pelo botão Compartilhar. Distribuição por link do iCloud = instalação em 1 toque
   (precisa ser criado e compartilhado a partir de um iPhone). Resolve a dor do favorito no Safari.
2. **Link arrastável no desktop**: `<a href="javascript:...">` que o usuário arrasta pra barra
   de favoritos — isso o navegador permite.
3. **Extensão de navegador** (Chrome/Edge): instala da loja, roda sozinha no portal. Mais atrito
   de publicação, melhor UX recorrente. Não cobre iPhone.
4. **API/acordo oficial com a TOTVS ou a PUC** — único caminho 100% automático.

## 6. Segurança / LGPD (por que a abordagem era defensável)

- Nenhuma credencial coletada, transmitida ou armazenada por nós.
- Dados trafegam do portal → clipboard do aluno → app local. Processamento no aparelho.
- O aluno vê e confirma tudo antes de aplicar (transparência + controle do titular).
