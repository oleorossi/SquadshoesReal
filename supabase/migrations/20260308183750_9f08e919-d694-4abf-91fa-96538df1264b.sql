
-- Work schedule templates (CLT standard configs)
CREATE TABLE public.work_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Padrão CLT',
  entry_time TIME NOT NULL DEFAULT '08:00',
  lunch_start TIME NOT NULL DEFAULT '12:00',
  lunch_end TIME NOT NULL DEFAULT '13:00',
  exit_time TIME NOT NULL DEFAULT '17:48',
  saturday_entry TIME DEFAULT '08:00',
  saturday_exit TIME DEFAULT '12:00',
  weekly_hours NUMERIC NOT NULL DEFAULT 44,
  overtime_multiplier NUMERIC NOT NULL DEFAULT 1.5,
  night_overtime_multiplier NUMERIC NOT NULL DEFAULT 1.7,
  holiday_multiplier NUMERIC NOT NULL DEFAULT 2.0,
  tolerance_minutes INTEGER NOT NULL DEFAULT 10,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.work_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can view work_schedules" ON public.work_schedules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can insert work_schedules" ON public.work_schedules FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth users can update work_schedules" ON public.work_schedules FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth users can delete work_schedules" ON public.work_schedules FOR DELETE TO authenticated USING (true);

-- Holidays table
CREATE TABLE public.holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  holiday_date DATE NOT NULL,
  recurring BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can view holidays" ON public.holidays FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can insert holidays" ON public.holidays FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth users can update holidays" ON public.holidays FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth users can delete holidays" ON public.holidays FOR DELETE TO authenticated USING (true);

-- Time records (imported from xlsx)
CREATE TABLE public.time_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_name TEXT NOT NULL,
  employee_external_id TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  record_date DATE NOT NULL,
  punches JSONB NOT NULL DEFAULT '[]',
  import_batch TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.time_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can view time_records" ON public.time_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can insert time_records" ON public.time_records FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth users can update time_records" ON public.time_records FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth users can delete time_records" ON public.time_records FOR DELETE TO authenticated USING (true);
