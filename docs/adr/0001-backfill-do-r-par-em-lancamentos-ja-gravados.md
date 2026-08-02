# 0001. Preencher o R$/par de lançamentos antigos que ficaram zerados

- **Data:** 02/08/2026
- **Status:** aceita

## Contexto

O R$/par de um lançamento é gravado **no próprio lançamento** no momento do
apontamento, e é deliberadamente imutável: reajustar o cadastro não pode
reescrever produção já apontada nem folha já calculada. Esse é o contrato do
"R$/par gravado" (ver `CONTEXT.md`).

Só que 33 dos 50 lançamentos existentes — 7.116 dos 10.140 pares, 70% — foram
gravados com R$/par **zero**. Três pessoas são afetadas: Antonio Gordinho
(3.468 pares, 100% zerados), Edson Coelho (2.268, 100%) e Valmir - Pretão
(1.380 de 2.364). São exatamente os lançamentos anteriores ao modelo atual, que
entraram sem detalhe por tamanho e sem valor.

A causa está fechada: durante um período o snapshot só era escrito quando o
funcionário já estava marcado como regime por par, e ninguém estava. Mas o
estrago ficou: valorados como estão, esses 7.116 pares valem R$ 0,00 na folha,
e qualquer relatório novo imprimiria zero para eles.

Duas restrições delimitam a decisão:

1. **Nada foi pago.** Todos os 50 lançamentos têm `pago_em` e `payroll_run_id`
   nulos, e as 19 folhas gravadas dessas pessoas estão em rascunho.
2. **Não há registro do valor da época.** O R$/par nunca foi capturado nesses
   lançamentos, então não existe fonte histórica para reconstruir — só o
   cadastro de hoje.

## Decisão

Preencher o R$/par das 33 linhas zeradas com o valor **cadastrado hoje** para
cada pessoa, uma única vez, e passar a **bloquear** o salvamento de um
apontamento de quem é regime por par sem R$/par médio cadastrado.

O R$/par de Edson Coelho, que não tinha nenhum valor cadastrado, foi definido
pelo dono como R$ 0,80 médio e R$ 1,00 difícil — a mesma tabela dos outros
montadores.

## Alternativas consideradas

- **Deixar zerado e sinalizar em vermelho** — preserva a imutabilidade sem
  exceção, mas obriga a relançar 33 dias já trabalhados à mão para que três
  pessoas recebam o que produziram em junho e julho. O custo cai sobre quem não
  errou.
- **Recalcular sempre pelo cadastro atual, abandonando o snapshot** — resolveria
  este caso e todos os futuros, mas destrói a garantia que existe justamente
  para proteger folha fechada: um reajuste passaria a reescrever pagamento
  passado.
- **Backfill sem a trava** — conserta hoje e reabre o mesmo buraco no próximo
  cadastro incompleto. Foi assim que se chegou aos 33.

## Consequências

A produção de junho e julho passa a valer o que deveria valer, e a folha
desses três deixa de sair zerada — sem ninguém redigitar nada.

Em troca, abre-se **um** precedente de escrita em lançamento já gravado. Ele só
se sustenta porque nenhuma linha havia sido paga; **repetir isso sobre
lançamento já quitado quebra o contrato e não é autorizado por esta decisão.**

O bloqueio no salvamento torna impossível apontar produção sem valor, ao custo
de o cadastro do funcionário virar pré-requisito do lançamento: quem esquecer de
preencher o R$/par não consegue lançar o dia até preencher.

Os valores de Edson são um arbitramento por analogia, não um registro. Ficam
sujeitos a correção enquanto a folha dele estiver em rascunho.
