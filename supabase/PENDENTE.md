# Faltaê — checklist do painel (o que só o Gustavo pode fazer)

O código está pronto e publicado no app. Falta apertar estes botões — nesta ordem, ~20 minutos no total.

## 1. Rodar o SQL pendente (5 min)

Painel do Supabase → **SQL Editor** → cole o conteúdo de `supabase/sql/pendente.sql` → **Run**.

Cria a tabela de sugestões, a coluna `plano_valido_ate`, o rebaixamento automático de planos vencidos (todo dia às 03:15) e o **seguir a turma** (seção 2c: curador atualiza a grade no mesmo código e quem importou recebe sozinho). O script é idempotente — pode rodar de novo por inteiro mesmo se já rodou antes.

## 2. Pegar a credencial do Mercado Pago (5 min)

1. [mercadopago.com.br/developers](https://www.mercadopago.com.br/developers) → **Suas integrações** → criar uma aplicação (nome: Faltaê) se ainda não tiver.
2. Dentro da aplicação: **Credenciais de produção** → copie o **Access Token** (começa com `APP_USR-`).
3. Painel do Supabase → **Edge Functions** → **Secrets** (ou Settings → Secrets) → adicione:
   - Nome: `MP_ACCESS_TOKEN`
   - Valor: o token copiado

⚠️ Esse token movimenta sua conta Mercado Pago — não cole em mais lugar nenhum.

## 3. Publicar as 3 funções (10 min)

Painel do Supabase → **Edge Functions** → **Deploy new function** (pelo editor do painel, igual fez com a `calendario`). Para cada uma, cole o conteúdo do arquivo correspondente:

| Função (nome exato) | Arquivo | Verify JWT |
|---|---|---|
| `criar-cobranca` | `supabase/functions/criar-cobranca/index.ts` | **LIGADO** (padrão) |
| `mercadopago-webhook` | `supabase/functions/mercadopago-webhook/index.ts` | **DESLIGADO** (quem chama é o Mercado Pago) |
| `criar-assinatura` | `supabase/functions/criar-assinatura/index.ts` | **LIGADO** (padrão) |
| `cancelar-assinatura` | `supabase/functions/cancelar-assinatura/index.ts` | **LIGADO** (padrão) |
| `excluir-conta` | `supabase/functions/excluir-conta/index.ts` | **LIGADO** (padrão) |
| `widget` | `supabase/functions/widget/index.ts` | **DESLIGADO** (quem chama é o widget Android) |
| `enviar-relatorios` | `supabase/functions/enviar-relatorios/index.ts` | **DESLIGADO** (quem chama é o agendador; protegida pelo segredo RELATORIO_CRON_CHAVE) |

📬 Relatório quinzenal (17/08): requer domínio verificado no Resend + segredos `RESEND_API_KEY` e `RELATORIO_CRON_CHAVE` + rodar a seção 2e do pendente.sql (trocando COLE_AQUI_A_CHAVE pela mesma senha do segredo). Teste antes do primeiro disparo real: painel → Edge Functions → enviar-relatorios → Test/Invoke com header `x-relatorio-chave: (a chave)` e corpo `{"teste":"seu@email.com"}` — envia só pra você.

⚠️ Renovação automática (17/08): além de publicar `criar-assinatura` e `cancelar-assinatura`, é preciso **repastar a `mercadopago-webhook`** (ganhou o tratamento de assinaturas) e **rodar a seção 2d do pendente.sql** (coluna `assinatura_id` + leitura do vencimento).

A função `widget` alimenta o widget de sequência do celular (Android) e não depende do Mercado Pago — pode publicar antes das outras se quiser testar o widget primeiro.

## 3b. Autorizar o link de "Esqueci minha senha" (2 min)

O app agora tem redefinição de senha — o email de redefinição precisa voltar pra URL do app, e o Supabase só redireciona pra URLs autorizadas:

Painel do Supabase → **Authentication** → **URL Configuration**:
- **Site URL**: `https://faltae.com.br/`
- **Redirect URLs** → adicione: `https://faltae.com.br/` (pode manter a antiga `https://gutoaranda.github.io/controle-faltas/` na lista durante a transição)

Sem isso, o link do email cai numa página errada e o aluno não consegue trocar a senha.

## 4. Testar o fluxo inteiro (5 min)

1. No app, entre com a conta de teste → Menu → Conta → **Assinar o Essencial — R$ 15**.
2. Pague R$ 15 via Pix **pra você mesmo** (o dinheiro sai de uma conta sua e entra na sua conta MP — teste real, custo zero líquido, menos a taxa do MP ~R$ 0,15).
3. Volte no app → **Já paguei — atualizar** → deve virar "Plano Essencial ativo".

Enquanto o passo 2 e 3 não acontecem, o app se comporta bem: o botão de assinar mostra "fale com o suporte" e o de excluir conta mostra "tente mais tarde". Nada quebra.

## O que isso destrava

- **Receita**: qualquer aluno paga R$ 15 via Pix e vira Essencial sozinho, por 30 dias. Renovou, soma +30 dias (renovar antes não perde saldo).
- **LGPD**: botão "Excluir minha conta" no Menu → Conta apaga tudo na hora (promessa da política de privacidade cumprida com folga).
- **Sugestões**: o formulário do Menu passa a cair direto na tabela `sugestoes` (leia no painel → Table Editor).

## Lembrete pré-lançamento (não é pra agora)

- Religar a confirmação de email: Authentication → Providers → Email → "Confirm email" ON.


## Notificacoes push (lembrete de prova com o app fechado) — NOVO
1. **SQL**: rode a secao 2f do `supabase/sql/pendente.sql` (troque `COLE_AQUI_A_CHAVE_PUSH` pela chave que voce inventar no passo 2).
2. **Segredos** (Edge Functions > Secrets): `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` (estao em `supabase/SEGREDOS-PUSH.txt` — NAO commitar nem colar em chat) e `PUSH_CRON_CHAVE` (invente uma senha longa, a mesma do SQL).
3. **Publicar a funcao** `enviar-push` (copie de `supabase/functions/enviar-push/index.ts`) com **Verify JWT DESLIGADO**.
4. **Testar**: no painel, Invoke da funcao com header `x-push-chave: SUA_CHAVE` e corpo `{"teste":"seu@email.com"}` — antes disso, toque em "Ativar lembretes" (aba Agenda) no seu celular com o app instalado e logado. A notificacao de teste deve chegar.
5. iPhone: so recebe com o app **instalado na tela de inicio** (iOS 16.4+). Android: navegador ou app, ambos funcionam.
## Resgatar codigo + origem do plano — NOVO
1. **SQL**: rode a secao 2g do `pendente.sql` (coluna plano_origem + tabela codigos_resgate + codigos NA9MES e BOLSISTA26).
2. **Publicar a funcao** `resgatar-codigo` (copie de `supabase/functions/resgatar-codigo/index.ts`) com **Verify JWT LIGADO**.
3. **Repastar** `mercadopago-webhook` (agora grava plano_origem='pagamento').
4. Testar: no app logado com conta gratis, Menu > Conta > "Tenho um codigo promocional" > NA9MES.
5. Dai em diante: nada de SQL manual — manda o codigo pro aluno. Criar codigos novos = insert em codigos_resgate.