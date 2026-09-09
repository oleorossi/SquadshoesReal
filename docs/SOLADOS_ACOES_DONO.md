# Ações do dono — cadastro de solados (pós-auditoria 2026-09-07)

O software **não inventa** dm² nem limites de lab. Estas pendências aparecem em:

- `/solados` → painel **Specs faltando na faixa vendida**
- `/system-diagnostics` → aba **Consumo** → mesmo painel + guards vivos

## 1. Preencher specs na faixa vendida (P0)

**Problema:** solados que dirigem consumo (ex.: INFANTIL) têm specs só em 34–40;
fichas infantis vendem 25–34. Pares sem linha em `sole_technical_specs` caem no
escalar (muitas vezes 0) → forro de palmilha não debita.

**O que fazer:**

1. Abra `/solados` e use o CTA **Preencher em Consumos** na linha do solado.
2. Em **Consumos → Consumo Padrão**, cadastre os papéis Forração / Palmilha /
   Forração Palmilha / Fachete com valor por numeração (ou escalar + variação).
3. Confira a aba **Numerações** (espelho) — a linha da numeração vendida tem que
   existir.
4. Atualize o painel até zerar o badge vermelho.

**Não** copie dm² do adulto para o infantil sem medir — a forma é outra.

## 2. Completar fachete nos solados `is_fachetado`

**Problema:** produto marcado fachetado sem dm² de fachete → motor emite 0.

1. No mesmo painel, seção **Fachetado sem dm² de fachete**.
2. CTA **Cadastrar fachete** → Consumo Padrão → papel Fachete.
3. Informe o consumo real (engenharia).

## 3. Plano de inspeção por família (qualidade)

Em **Cadastro** do solado, bloco **Plano de inspeção (família)**:

- Shore, abrasão (ISO 20871), flexão (ISO 17707), rasgo, atrito, delaminação,
  encolhimento — só preencha com a especificação **aprovada** com fornecedor/lab.
- `Bloquear lote sem ensaio` fica desligado até o fluxo de quarentena estar
  alinhado (gate automático ainda não corta recebimento nesta entrega).

## 4. Pendências de estorno com grade

Se `/system-diagnostics` → Consumo listar linhas em **Pendências de estorno com
grade**, o cancelamento/resync **não** inventa numeração. Resolver:

- restaurar via `restore_sole_grade_for_order` quando houver reserva
  `kind='sole_grade'`, ou
- ajuste manual de grade no Hub → Estoque, com inventário conferido.

Referência: `specs/resync-estorno-unificado.md`.

## 5. Padronização Forração / Fibra (lembrete)

| Papel no Consumo Padrão | Quantidade | Material (ficha) | Débito |
|---|---|---|---|
| `forro_cabedal` | dm²/par no solado | `lining_material` | soft → Forração |
| `placa_palmilha` (fibra) | dm²/par no solado | `insole_material` | soft → Palmilha (Corte Fibra) |
| `forracao_palmilha` | dm²/par no solado | mesmo forro resolvido | soft → Forração Palmilha |
| `fachete` | dm²/par no solado | grupo fachete do solado | soft → Fachete |

A ficha **não** deve guardar mapa `*_per_size` desses papéis quando o solado dirige
o consumo — “Puxar do Solado” só sincroniza o escalar e limpa o mapa da ficha.
Cadastre numeração em **Hub → Solados → Consumos → Consumo Padrão**.
