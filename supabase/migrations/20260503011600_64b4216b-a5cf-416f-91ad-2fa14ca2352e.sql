-- Tabela de Folha de Pagamento
CREATE TABLE public.employee_payroll (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id UUID NOT NULL REFERENCES auth.users(id),
    period_date DATE NOT NULL,
    base_salary NUMERIC(15,2) NOT NULL DEFAULT 0,
    overtime_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    deductions_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    net_salary NUMERIC(15,2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de Banco de Horas
CREATE TABLE public.employee_bank_hours (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id UUID NOT NULL REFERENCES auth.users(id),
    date DATE NOT NULL,
    hours_added NUMERIC(5,2) NOT NULL DEFAULT 0,
    hours_removed NUMERIC(5,2) NOT NULL DEFAULT 0,
    balance_after NUMERIC(10,2) NOT NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de Faltas/Absenteísmo
CREATE TABLE public.employee_absences (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id UUID NOT NULL REFERENCES auth.users(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    absence_type TEXT NOT NULL,
    justified BOOLEAN DEFAULT false,
    document_url TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.employee_payroll ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_bank_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_absences ENABLE ROW LEVEL SECURITY;

-- Políticas para Folha de Pagamento
CREATE POLICY "Users can view their own payroll" ON public.employee_payroll
    FOR SELECT USING (auth.uid() = employee_id);

CREATE POLICY "Admins can manage all payroll" ON public.employee_payroll
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND approved = true
        )
    );

-- Políticas para Banco de Horas
CREATE POLICY "Users can view their own bank hours" ON public.employee_bank_hours
    FOR SELECT USING (auth.uid() = employee_id);

CREATE POLICY "Admins can manage all bank hours" ON public.employee_bank_hours
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND approved = true
        )
    );

-- Políticas para Faltas
CREATE POLICY "Users can view their own absences" ON public.employee_absences
    FOR SELECT USING (auth.uid() = employee_id);

CREATE POLICY "Admins can manage all absences" ON public.employee_absences
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND approved = true
        )
    );

-- Trigger para updated_at na folha de pagamento
CREATE TRIGGER update_employee_payroll_updated_at
BEFORE UPDATE ON public.employee_payroll
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger para updated_at nas faltas
CREATE TRIGGER update_employee_absences_updated_at
BEFORE UPDATE ON public.employee_absences
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
