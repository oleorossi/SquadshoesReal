-- Cria o padrão de capacidade da categoria "Plataforma"
--
-- Levantamento 03/08/2026: só 5 categorias são realmente usadas pelas 53 fichas —
-- Rasteirinha (27), Infantil (10), Sandália (8), Plataforma (5) e Bota (2).
-- Dessas, "Plataforma" era a ÚNICA sem linha em default_lead_times, apesar de ter
-- 2 ondas e 24 itens em production_wave_items. Sem linha de categoria e sem
-- capacidade própria na ficha, o motor cai nas constantes hard-coded do
-- SECTOR_CONFIG (1 a 2 dias por setor, independente da quantidade) — o volume
-- diário some do cálculo.
--
-- (No sentido inverso: Anabela, Mule, Sapatilha, Sapato, Scarpin, Tamanco e Tênis
-- têm padrão cadastrado mas NENHUMA ficha as usa — é config morta hoje.)
--
-- Valores: cópia da Rasteirinha, por decisão do dono (03/08/2026), como ponto de
-- partida editável na tela — números emprestados, NÃO medidos na Plataforma.
-- ⚠ Revisar em Produção → Tempos-Padrão por Setor com o número real da fábrica.
--
-- Idempotente: ON CONFLICT DO NOTHING preserva qualquer linha já existente.

INSERT INTO public.default_lead_times (
  shoe_category,
  sewing_capacity_per_day,
  cutting_capacity_per_day,
  costura_capacity_per_day,
  costura_cabedal_capacity_per_day,
  costura_palmilha_capacity_per_day,
  mesa_daily_capacity,
  silk_capacity_per_day,
  gluing_capacity_per_day,
  assembly_capacity_per_day,
  soling_capacity_per_day,
  finishing_capacity_per_day,
  expedition_capacity_per_day
)
SELECT
  'Plataforma',
  dlt.sewing_capacity_per_day,
  dlt.cutting_capacity_per_day,
  dlt.costura_capacity_per_day,
  dlt.costura_cabedal_capacity_per_day,
  dlt.costura_palmilha_capacity_per_day,
  dlt.mesa_daily_capacity,
  dlt.silk_capacity_per_day,
  dlt.gluing_capacity_per_day,
  dlt.assembly_capacity_per_day,
  dlt.soling_capacity_per_day,
  dlt.finishing_capacity_per_day,
  dlt.expedition_capacity_per_day
FROM public.default_lead_times dlt
WHERE dlt.shoe_category = 'Rasteirinha'
ON CONFLICT (shoe_category) DO NOTHING;
