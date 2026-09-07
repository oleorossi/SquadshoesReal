-- O calendário do CFO usa datas ISO com quatro dígitos no ano. PostgreSQL
-- aceita anos maiores e a.C.; restringir no banco evita registros ilegíveis
-- para o motor mesmo quando o lançamento vem direto da API.
ALTER TABLE public.cfo_planos
  ADD CONSTRAINT cfo_planos_datas_iso CHECK (
    data_inicio BETWEEN date '0001-01-01' AND date '9999-12-31'
    AND data_fim BETWEEN date '0001-01-01' AND date '9999-12-31'
  );

ALTER TABLE public.cfo_pedidos
  ADD CONSTRAINT cfo_pedidos_entrega_iso CHECK (
    entrega_em BETWEEN date '0001-01-01' AND date '9999-12-31'
  );

ALTER TABLE public.cfo_lancamentos
  ADD CONSTRAINT cfo_lancamentos_datas_iso CHECK (
    data_prevista BETWEEN date '0001-01-01' AND date '9999-12-31'
    AND (data_realizada IS NULL OR data_realizada BETWEEN date '0001-01-01' AND date '9999-12-31')
  );
