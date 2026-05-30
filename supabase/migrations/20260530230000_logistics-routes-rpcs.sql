-- Item #8 do roadmap (auditoria 30/05). Logística mínima operacional.
-- Tabelas vehicles/drivers/delivery_routes/delivery_route_stops já existiam
-- (todas 0 registros) com policies USING(true) liberais. Esta migration:
-- 1. Restringe WRITE pra admin/gerente/expedicao
-- 2. Cria view de dashboard + RPC pra marcar parada como entregue

DROP POLICY IF EXISTS p_vehicles_all ON public.vehicles;
CREATE POLICY p_vehicles_select ON public.vehicles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY p_vehicles_write ON public.vehicles
  FOR INSERT TO authenticated WITH CHECK (user_has_any_role(ARRAY['admin','gerente','expedicao']));
CREATE POLICY p_vehicles_update ON public.vehicles
  FOR UPDATE TO authenticated USING (user_has_any_role(ARRAY['admin','gerente','expedicao']))
  WITH CHECK (user_has_any_role(ARRAY['admin','gerente','expedicao']));
CREATE POLICY p_vehicles_delete ON public.vehicles
  FOR DELETE TO authenticated USING (user_has_any_role(ARRAY['admin','gerente']));

DROP POLICY IF EXISTS p_drivers_all ON public.drivers;
CREATE POLICY p_drivers_select ON public.drivers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY p_drivers_write ON public.drivers
  FOR INSERT TO authenticated WITH CHECK (user_has_any_role(ARRAY['admin','gerente','expedicao']));
CREATE POLICY p_drivers_update ON public.drivers
  FOR UPDATE TO authenticated USING (user_has_any_role(ARRAY['admin','gerente','expedicao']))
  WITH CHECK (user_has_any_role(ARRAY['admin','gerente','expedicao']));
CREATE POLICY p_drivers_delete ON public.drivers
  FOR DELETE TO authenticated USING (user_has_any_role(ARRAY['admin','gerente']));

DROP POLICY IF EXISTS p_delivery_routes_all ON public.delivery_routes;
CREATE POLICY p_routes_select ON public.delivery_routes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY p_routes_write ON public.delivery_routes
  FOR INSERT TO authenticated WITH CHECK (user_has_any_role(ARRAY['admin','gerente','expedicao']));
CREATE POLICY p_routes_update ON public.delivery_routes
  FOR UPDATE TO authenticated USING (user_has_any_role(ARRAY['admin','gerente','expedicao']))
  WITH CHECK (user_has_any_role(ARRAY['admin','gerente','expedicao']));
CREATE POLICY p_routes_delete ON public.delivery_routes
  FOR DELETE TO authenticated USING (user_has_any_role(ARRAY['admin','gerente']));

DROP POLICY IF EXISTS p_delivery_route_stops_all ON public.delivery_route_stops;
CREATE POLICY p_stops_select ON public.delivery_route_stops
  FOR SELECT TO authenticated USING (true);
CREATE POLICY p_stops_write ON public.delivery_route_stops
  FOR INSERT TO authenticated WITH CHECK (user_has_any_role(ARRAY['admin','gerente','expedicao']));
CREATE POLICY p_stops_update ON public.delivery_route_stops
  FOR UPDATE TO authenticated USING (user_has_any_role(ARRAY['admin','gerente','expedicao']))
  WITH CHECK (user_has_any_role(ARRAY['admin','gerente','expedicao']));
CREATE POLICY p_stops_delete ON public.delivery_route_stops
  FOR DELETE TO authenticated USING (user_has_any_role(ARRAY['admin','gerente','expedicao']));

CREATE OR REPLACE VIEW public.v_delivery_routes_summary AS
SELECT
  dr.id, dr.name, dr.scheduled_date, dr.status, dr.total_distance_km,
  dr.estimated_duration_min, dr.fuel_cost_brl, dr.wear_cost_brl, dr.total_cost_brl,
  dr.cost_per_pair, dr.notes, dr.created_at, dr.updated_at,
  dr.vehicle_id, v.plate AS vehicle_plate, v.model AS vehicle_model,
  dr.driver_id, d.name AS driver_name,
  (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = dr.id) AS total_stops,
  (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = dr.id AND s.status = 'delivered') AS delivered_stops,
  (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = dr.id AND s.status = 'pending') AS pending_stops
FROM public.delivery_routes dr
LEFT JOIN public.vehicles v ON v.id = dr.vehicle_id
LEFT JOIN public.drivers d ON d.id = dr.driver_id
ORDER BY dr.scheduled_date DESC NULLS LAST, dr.created_at DESC;

ALTER VIEW public.v_delivery_routes_summary SET (security_invoker = on);
GRANT SELECT ON public.v_delivery_routes_summary TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_stop_delivered(
  p_stop_id uuid,
  p_receiver_name text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_route_id uuid;
  v_remaining int;
BEGIN
  IF NOT is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  UPDATE public.delivery_route_stops
     SET status = 'delivered',
         delivered_at = now(),
         receiver_name = COALESCE(p_receiver_name, receiver_name),
         notes = COALESCE(p_notes, notes),
         latitude = COALESCE(p_latitude, latitude),
         longitude = COALESCE(p_longitude, longitude)
   WHERE id = p_stop_id AND status <> 'delivered'
   RETURNING route_id INTO v_route_id;

  IF v_route_id IS NULL THEN
    RAISE EXCEPTION 'Parada % não encontrada ou já entregue', p_stop_id;
  END IF;

  SELECT COUNT(*) INTO v_remaining FROM public.delivery_route_stops
   WHERE route_id = v_route_id AND status <> 'delivered';

  IF v_remaining = 0 THEN
    UPDATE public.delivery_routes
       SET status = 'completed', updated_at = now()
     WHERE id = v_route_id AND status <> 'completed';
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_stop_delivered(uuid, text, text, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_stop_delivered(uuid, text, text, numeric, numeric) TO authenticated;
