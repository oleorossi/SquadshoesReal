// Extended types for the timesheet module – exceptions & analytics

export interface TimeException {
  id: string;
  employee_name: string;
  employee_external_id: string | null;
  record_date: string;
  type: 'missing_entry' | 'missing_exit' | 'duplicate' | 'invalid_sequence' | 'overtime_excess' | 'incomplete';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'investigating' | 'resolved' | 'ignored';
  assigned_to: string | null;
  resolution_notes: string | null;
  import_batch: string | null;
  created_at: string;
  updated_at: string;
}

export type TimeExceptionForm = Omit<TimeException, 'id' | 'created_at' | 'updated_at'>;

export interface WorkDaySummary {
  employee_name: string;
  date: string;
  punches: string[];
  planned_hours: number;
  worked_hours: number;
  overtime_hours: number;
  break_minutes: number;
  is_complete: boolean;
  exceptions: string[];
  status: 'complete' | 'incomplete' | 'absent' | 'holiday' | 'weekend';
}

export interface TimeAnalytics {
  period: string;
  total_employees: number;
  attendance_rate: number;
  punctuality_rate: number;
  avg_overtime_hours: number;
  total_exceptions: number;
  data_quality_score: number;
  trends: {
    late_arrivals: Array<{ date: string; count: number }>;
    overtime_by_department: Array<{ department: string; hours: number }>;
    exceptions_by_type: Array<{ type: string; count: number }>;
  };
}
