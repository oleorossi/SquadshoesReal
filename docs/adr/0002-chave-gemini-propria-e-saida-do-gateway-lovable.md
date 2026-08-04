# 0002. Centralizar as chamadas de IA numa chave Gemini própria e sair do gateway Lovable

- **Data:** 04/08/2026
- **Status:** aceita

## Contexto

Quatro edge functions chamam o Gemini, por **três caminhos diferentes**, resultado
de uma sequência de trocas emergenciais registradas nos próprios cabeçalhos dos
arquivos (Lovable → direto em 06/05, OpenAI → Gemini em 02/08, e duas correções de
nome de modelo em maio):

| Função | Autenticação | Modelo |
|---|---|---|
| `suggest-ncm` | `GEMINI_API_KEY` direto | `gemini-2.0-flash` fixo |
| `extract-clients` | `GEMINI_API_KEY` direto | cascata de 3 nomes |
| `generate-catalog-photo` | `GEMINI_API_KEY` direto | secret `GEMINI_IMAGE_MODEL` |
| `recolor-image` | **`LOVABLE_API_KEY`** | `google/gemini-3.1-flash-image-preview` |

O `recolor-image` é o único que ainda fala com `ai.gateway.lovable.dev`. A Lovable
foi o editor/deploy do projeto até mai/2026, quando migrou para Vercel + Claude Code;
essa chamada é o último ponto vivo daquela fase.

Duas restrições delimitam a decisão:

1. **A chave em uso era de plano Free.** A cascata de modelos do `extract-clients`
   não existe por robustez de arquitetura — existe porque chaves do AI Studio sem
   faturamento retornam `429` imediato. O comentário no arquivo diz isso literalmente.
   O dono passou a dispor de uma chave em projeto Cloud **com billing ativo**.
2. **As guardas de autorização são desiguais.** As duas funções de imagem checam
   `user_roles` (admin/manager) porque "gastam créditos de IA"; as duas de texto
   aceitam qualquer usuário aprovado. Sob plano Free, o pior caso desse desequilíbrio
   era um `429`. Sob billing, é fatura.

## Decisão

Todas as quatro funções passam a usar **uma única credencial**: a `GEMINI_API_KEY`
do projeto Google Cloud do dono, com faturamento ativo, contra
`generativelanguage.googleapis.com`.

Decorrem disto quatro escolhas:

- **`recolor-image` migra para chamada direta** e a `LOVABLE_API_KEY` deixa de ser
  usada. Não é reescrita: o `generate-catalog-photo` já contém o caminho de imagem
  direto (request com `inlineData`, resposta em `candidates[0].content.parts[]`), que
  é portado.
- **A lógica de chamada vive em `supabase/functions/_shared/gemini.ts`**, seguindo a
  convenção já estabelecida pelo `_shared/cors.ts`.
- **`404` cascateia; `429` falha alto.** São falhas de natureza distinta: `404` é o
  Google tendo renomeado um modelo — um nome alternativo resolve. `429` num projeto
  pago é cota real, e mascará-lo com um modelo alternativo esconde do dono a única
  informação que ele precisa ver.
- **O teto de gasto é orçamento no Google Cloud Billing**, não restrição por papel.
  As funções de texto continuam abertas a qualquer usuário aprovado.

O modelo de imagem das duas funções fica no mesmo secret `GEMINI_IMAGE_MODEL`.

## Alternativas consideradas

- **Manter o `recolor-image` no gateway Lovable** — escopo ficaria só em configuração,
  sem tocar código. Descartado: mantém duas contas e duas faturas vivas para o mesmo
  provedor final, e deixa a função dependendo de uma credencial de uma plataforma que
  o projeto já abandonou — ela quebra no dia em que aquela chave expirar, por um motivo
  que ninguém vai lembrar.
- **Migrar para Vertex AI** — autenticação por service account em vez de chave, mais
  robusto para produção. Descartado por ora: exige reescrever as quatro funções e
  montar credencial de serviço, para resolver um problema (rotação de chave) que ainda
  não doeu.
- **Alinhar as quatro funções à guarda de admin/manager** — fecharia a exposição de
  custo no código. Descartado: sugerir NCM e importar clientes é trabalho de quem
  cadastra, não de gestor. A restrição protegeria a fatura quebrando o fluxo de
  exatamente quem usa a função.
- **Fixar um modelo único, sem cascata** — mais simples de ler e de operar. Descartado:
  o histórico registrado nos comentários mostra o Google renomeando modelos ao menos
  duas vezes em três meses, cada uma derrubando a feature até alguém editar o código.

## Consequências

Uma credencial passa a valer para toda a IA do sistema. Trocar de chave vira uma
operação só, e some a classe de bug em que uma função funciona e outra não porque
as chaves divergiram.

Em troca, **o dono assume a cota e a fatura**. Não há mais teto imposto de fora:
o `429` deixa de ser um limite de plano gratuito e passa a ser sinal de cota
estourada de verdade — por isso ele falha alto. Quem for depurar um `429` no futuro
não deve "consertá-lo" reintroduzindo fallback; isso reverteria esta decisão
silenciosamente.

O gasto das funções de texto continua acessível a qualquer usuário aprovado, e a
**única** guarda é o orçamento configurado no Google Cloud. Se esse teto não for
criado, a decisão fica sem a proteção que a sustenta.

Uma edição em `_shared/gemini.ts` afeta as quatro funções de uma vez: ganha-se
consistência da política de erro, perde-se o isolamento entre deploys.

O pacote `lovable-tagger` segue em `devDependencies` por compatibilidade de lockfile
(ver `CLAUDE.md`) — esta decisão remove a última dependência **de runtime** da
Lovable, não a de build.
