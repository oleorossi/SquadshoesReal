# PV System — preparo da integração Supabase no CI

O workflow `weekly-units.yml` executa suítes que criam e removem fixtures. Ele
aceita somente um projeto Supabase isolado de CI e recusa explicitamente o
projeto de produção `ssvxfoybzmjlypnipqzn`.

## Pré-requisitos

1. Provisionar um projeto Supabase exclusivo de CI. O project ref deve ser
   diferente do project ref de produção.
2. Aplicar nesse projeto, por um processo externo aprovado, todas as migrations
   do repositório em ordem — inclusive todas as versões posteriores ao cutover
   `20270101009300` — antes de disparar o cron.
3. Carregar o seed sanitizado e versionado exigido pela suíte de paridade real
   (detalhes abaixo), depois das migrations e antes de disparar o cron.
4. Cadastrar estes GitHub Actions secrets:
   - `SUPABASE_CI_URL`: `https://<project-ref-ci>.supabase.co`;
   - `SUPABASE_CI_PROJECT_ID`: o mesmo `<project-ref-ci>` da URL;
   - `SUPABASE_CI_SERVICE_ROLE_KEY`: service role apenas do projeto de CI.

O workflow deliberadamente não recebe access token nem senha de banco e não
executa `db push`. Migração de schema e execução de fixtures permanecem etapas
separadas. A service role é injetada somente no step de integração e nunca usa
prefixo `VITE_`.

## Dataset obrigatório da paridade TS × SQL

`consumptionParity.integration.test.ts` não é autocontido: ele busca as fichas
`CF 09 ` (com o espaço final), `DS21` e `S-039`, além de seus produtos, grupos,
fichas de componente, specs por numeração, BOM e uma cor recente de OP. Um
projeto criado somente com migrations não possui esse catálogo e deve falhar
com a lista de fixtures ausentes — não pode ficar verde por skip ou por zero
linhas.

Antes de habilitar o cron, é obrigatório disponibilizar no repositório um seed
sanitizado e versionado, revisado como código e determinístico, que crie apenas
o recorte mínimo dessas três referências e remova qualquer dado pessoal ou
comercial. Hoje não existe seed versionado com esse recorte; portanto um projeto
CI limpo ainda é um pré-requisito pendente e o workflow deve permanecer vermelho
até o provisionamento ser concluído. Não copie catálogo nem dump de produção e
não substitua a falta do seed por `skip`, tolerância maior ou retorno vazio.

O seed deve ser aplicado por processo externo aprovado, depois das migrations.
O workflow deliberadamente não recebe credenciais de DDL e não tenta aplicar
esse dataset por conta própria.

## Verificação

O runner exige `CI=true` e `GITHUB_ACTIONS=true`, valida que o hostname é exatamente
`<SUPABASE_CI_PROJECT_ID>.supabase.co` e aborta se o ref for o de produção. O
teste local do gate, sem credenciais reais, é:

```bash
bunx vitest run src/__tests__/pvSystemCiReport.test.ts
```

Depois de sincronizar as migrations e cadastrar os secrets, dispare a prova
viva sem copiar a service role para a máquina local:

```bash
gh workflow run weekly-units.yml --ref main
gh run list --workflow weekly-units.yml --limit 1
```

O run só fica verde quando cada arquivo obrigatório executa pelo menos um caso,
nenhum caso fica `skipped`/`todo`, os guards SQL retornam casos e o relatório
`pv-system-integration.json` é publicado como artifact. No log, confirme a linha
`Projeto Supabase CI validado: <project-ref-ci>` e que esse ref não é
`ssvxfoybzmjlypnipqzn`.
