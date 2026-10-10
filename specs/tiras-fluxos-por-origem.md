# Tiras — fluxo por origem (Revisão 3, grill de 10/10/2026, noite)

> **Vence** `tiras-redesenho.md` (Revisão 2, R1–R14) onde divergir.
> Já em produção: E1 (cópia de PV), E2 (consumo/Setor de Tiras) e Fatia 1 (origem no PV).

## Três origens, padrão por tipo no catálogo (Q28)

| Tipo de tira | Origem padrão | Estoque |
|---|---|---|
| **TIRA OVERLOCK 5MM** | **Fábrica** | A napa sai do estoque **só** pelo botão "Debitar napa" no Ateliê |
| Demais tiras de napa | **Prestador**: compra a napa e envia ao prestador | **Nenhum movimento**: nem napa, nem tira |
| Strass | **Comprar pronto** | OC da tira (Revisão 2, R9–R11) |

O PV troca a origem só na exceção (R2 continua valendo).

## Decisões

| # | Decisão |
|---|---|
| Q29 | A Overlock 5 mm aparece na aba **Tiras** do Ateliê (não vira etapa da OP). |
| Q35 | **Sem processo automático** para a Overlock: ela só aparece no Ateliê. |
| Q36 | A napa da Overlock só sai do estoque quando o usuário clica **"Debitar napa"** no Ateliê. **A OP deixa de reservar e de debitar napa de qualquer tira.** |
| Q30 | Prestador: o sistema gera **em rascunho** a **OC da napa** (fornecedor de napa, entrega no prestador) e a **OS de mão de obra** do prestador. Nenhuma das duas mexe em estoque. |
| Q31 | A tira que volta do prestador **não entra no estoque**: só marca "recebida" naquele PV. |
| Q32 | Custo do par = napa comprada + mão de obra do prestador (R$/m). |
| Q33 | As reservas de napa de tiras nos PVs abertos são **liberadas** (a napa de prestador nunca sai do estoque, e a Overlock só sai pelo Ateliê). |
| Q34 | As 38 OS de prestador antigas (mai–jul/2026) **já foram pagas**: viram **Concluída só como registro**, sem conta a pagar (pular `tg_create_ap_for_service_order`) e sem movimentar estoque. |

### Assumido (confirmar com o dono)
- Para respeitar "nenhum processo automático", a OC da napa e a OS do prestador
  são geradas por um **botão no Ateliê** ("Gerar OC da napa e OS"), por PV, e
  não sozinhas na aprovação do PV.

## Fatias (substitui as da Revisão 2)
2. **Aba Tiras no Ateliê:**
   - lista por PV, a partir do PV Aprovado, de: Overlock (botão Debitar napa), Prestador (botão Gerar OC da napa e OS; marcar Recebida) e Comprar pronto (só leitura);
   - a OP para de reservar e debitar napa de tira, e as reservas abertas são liberadas;
   - as 38 OS antigas são fechadas.
3. **OC automática do Comprar pronto** + reserva da tira pronta na OP.
4. **Limpeza.**
