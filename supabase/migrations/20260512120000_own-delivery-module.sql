-- ════════════════════════════════════════════════════════════════════
-- Módulo de Entregas com Frete Próprio (aplicada via MCP em 2026-05-12)
-- (1) branch_code/branch_name em clients
-- (2) own_delivery em sale_orders
-- (3) drivers, vehicles, fuel_prices
-- (4) delivery_routes, delivery_route_stops
-- (5) RPC recalc_delivery_route_costs
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS branch_code text,
  ADD COLUMN IF NOT EXISTS branch_name text;
COMMENT ON COLUMN clients.branch_code IS 'Código da filial fornecido pelo cliente (ex: "Loja 12", "SP-03")';
COMMENT ON COLUMN clients.branch_name IS 'Nome amigável da filial (ex: "Loja Botafogo")';

ALTER TABLE sale_orders
  ADD COLUMN IF NOT EXISTS own_delivery boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN sale_orders.own_delivery IS 'Quando true, pedido entra no planejamento de rota em /entregas com cálculo de combustível e desgaste';

CREATE TABLE IF NOT EXISTS drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  cnh text,
  phone text,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate text NOT NULL UNIQUE,
  model text,
  type text,
  capacity_kg numeric(10,2),
  capacity_m3 numeric(10,3),
  fuel_type text NOT NULL DEFAULT 'diesel',
  fuel_consumption_km_l numeric(6,2) NOT NULL,
  wear_cost_per_km numeric(8,4) NOT NULL DEFAULT 0,
  default_driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicles_fuel_type_chk CHECK (fuel_type IN ('gasolina','diesel','etanol','flex')),
  CONSTRAINT vehicles_consumption_pos_chk CHECK (fuel_consumption_km_l > 0)
);

CREATE TABLE IF NOT EXISTS fuel_prices (
  fuel_type text PRIMARY KEY,
  price_per_liter numeric(8,3) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT fuel_prices_type_chk CHECK (fuel_type IN ('gasolina','diesel','etanol'))
);
INSERT INTO fuel_prices(fuel_type, price_per_liter) VALUES
  ('gasolina', 6.20), ('diesel', 6.50), ('etanol', 4.30)
ON CONFLICT (fuel_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS delivery_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  scheduled_date date NOT NULL,
  vehicle_id uuid REFERENCES vehicles(id),
  driver_id  uuid REFERENCES drivers(id),
  origin_address jsonb,
  total_distance_km numeric(10,2),
  estimated_duration_min int,
  fuel_cost_brl numeric(10,2),
  wear_cost_brl numeric(10,2),
  total_cost_brl numeric(10,2),
  cost_per_pair numeric(10,4),
  status text NOT NULL DEFAULT 'draft',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_routes_status_chk CHECK (status IN ('draft','planned','in_progress','completed','cancelled'))
);

CREATE TABLE IF NOT EXISTS delivery_route_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES delivery_routes(id) ON DELETE CASCADE,
  sale_order_id uuid REFERENCES sale_orders(id) ON DELETE SET NULL,
  stop_order int NOT NULL,
  address_snapshot jsonb NOT NULL,
  latitude numeric(10,7),
  longitude numeric(10,7),
  distance_from_previous_km numeric(8,2),
  eta_minutes_from_start int,
  status text NOT NULL DEFAULT 'pending',
  delivered_at timestamptz,
  receiver_name text,
  notes text,
  CONSTRAINT delivery_route_stops_status_chk CHECK (status IN ('pending','delivered','refused','skipped'))
);
CREATE INDEX IF NOT EXISTS idx_delivery_route_stops_route_order ON delivery_route_stops(route_id, stop_order);
CREATE INDEX IF NOT EXISTS idx_delivery_route_stops_sale_order ON delivery_route_stops(sale_order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_routes_date_status ON delivery_routes(scheduled_date, status);

CREATE OR REPLACE FUNCTION recalc_delivery_route_costs(p_route_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle vehicles%ROWTYPE;
  v_dist numeric;
  v_fuel_price numeric;
  v_pairs numeric;
  v_fuel_cost numeric;
  v_wear_cost numeric;
  v_total numeric;
BEGIN
  SELECT v.* INTO v_vehicle
  FROM vehicles v
  JOIN delivery_routes r ON r.vehicle_id = v.id
  WHERE r.id = p_route_id;

  IF v_vehicle.id IS NULL THEN
    SELECT COALESCE(SUM(distance_from_previous_km),0)
      INTO v_dist
      FROM delivery_route_stops WHERE route_id = p_route_id;
    UPDATE delivery_routes SET
      total_distance_km = v_dist,
      fuel_cost_brl = NULL, wear_cost_brl = NULL, total_cost_brl = NULL, cost_per_pair = NULL,
      updated_at = now()
    WHERE id = p_route_id;
    RETURN;
  END IF;

  SELECT price_per_liter INTO v_fuel_price
  FROM fuel_prices WHERE fuel_type = v_vehicle.fuel_type;

  SELECT COALESCE(SUM(distance_from_previous_km),0) INTO v_dist
  FROM delivery_route_stops WHERE route_id = p_route_id;

  -- Pares vêm de sale_order_items.quantity (sale_orders não tem total_pairs)
  SELECT COALESCE(SUM(soi.quantity),0) INTO v_pairs
  FROM delivery_route_stops s
  LEFT JOIN sale_order_items soi ON soi.sale_order_id = s.sale_order_id
  WHERE s.route_id = p_route_id;

  v_fuel_cost := ROUND( (v_dist / NULLIF(v_vehicle.fuel_consumption_km_l,0)) * COALESCE(v_fuel_price,0), 2);
  v_wear_cost := ROUND( v_dist * v_vehicle.wear_cost_per_km, 2);
  v_total     := COALESCE(v_fuel_cost,0) + COALESCE(v_wear_cost,0);

  UPDATE delivery_routes SET
    total_distance_km = v_dist,
    fuel_cost_brl     = v_fuel_cost,
    wear_cost_brl     = v_wear_cost,
    total_cost_brl    = v_total,
    cost_per_pair     = CASE WHEN v_pairs > 0 THEN ROUND(v_total / v_pairs, 4) ELSE NULL END,
    updated_at        = now()
  WHERE id = p_route_id;
END $$;

CREATE OR REPLACE FUNCTION tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS tg_drivers_updated_at ON drivers;
CREATE TRIGGER tg_drivers_updated_at BEFORE UPDATE ON drivers
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

DROP TRIGGER IF EXISTS tg_vehicles_updated_at ON vehicles;
CREATE TRIGGER tg_vehicles_updated_at BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

DROP TRIGGER IF EXISTS tg_delivery_routes_updated_at ON delivery_routes;
CREATE TRIGGER tg_delivery_routes_updated_at BEFORE UPDATE ON delivery_routes
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_route_stops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_drivers_all ON drivers;
CREATE POLICY p_drivers_all ON drivers FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS p_vehicles_all ON vehicles;
CREATE POLICY p_vehicles_all ON vehicles FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS p_fuel_prices_all ON fuel_prices;
CREATE POLICY p_fuel_prices_all ON fuel_prices FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS p_delivery_routes_all ON delivery_routes;
CREATE POLICY p_delivery_routes_all ON delivery_routes FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS p_delivery_route_stops_all ON delivery_route_stops;
CREATE POLICY p_delivery_route_stops_all ON delivery_route_stops FOR ALL TO authenticated USING (true) WITH CHECK (true);
