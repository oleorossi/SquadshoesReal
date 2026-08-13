import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  useWorkSchedules, useHolidays, useSwapSets, useTimeRecords, useImportBatches,
  calculateDaySummary, WorkSchedule,
} from '@/hooks/useTimesheet';
import { useEmployees } from '@/hooks/useEmployees';
import { useMemo } from 'react';
import { computePeriodFolha } from '@/lib/salaryPayroll';
import { findEmployeeMatch } from '@/lib/employeeMatching';
import { resolveHolidaysForPayrollRange } from '@/lib/ponto/periodDates';

interface TimeAnalyticsParams {
  date_from: string;
  date_to: string;
}

interface TimeAnalyticsResult {
  total_employees: number;
  attendance_rate: number;
  punctuality_rate: number;
  avg_overtime_hours: number;
  total_exceptions: number;
  data_quality_score: number;
}

export function useTimeAnalytics(params: TimeAnalyticsParams) {
  const { data: schedules = [] } = useWorkSchedules();
  const { data: holidays = [] } = useHolidays();
  const { swapWorkedSet, swapOffSet, swapModeFor } = useSwapSets();
  const { data: records = [], isLoading: recordsLoading } = useTimeRecords(
    undefined,
    params.date_from,
    params.date_to,
  );
  const { data: employees = [] } = useEmployees();
  const { data: exceptions = [] } = useQuery({
    queryKey: ['time_exceptions_count', params.date_from, params.date_to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_exceptions')
        .select('id, status')
        .gte('record_date', params.date_from)
        .lte('record_date', params.date_to);
      if (error) throw error;
      return data || [];
    },
  });

  const defaultSchedule: WorkSchedule = schedules.find(s => s.is_default) || schedules[0] || {
    id: '', name: 'Default', entry_time: '08:00', lunch_start: '12:00', lunch_end: '13:00',
    exit_time: '17:48', saturday_entry: '08:00', saturday_exit: '12:00', weekly_hours: 44,
    overtime_multiplier: 1.5, night_overtime_multiplier: 1.7, holiday_multiplier: 1.5,
    tolerance_minutes: 10, minimum_overtime_minutes: 0, is_default: true, works_sunday: false, works_monday: true, works_tuesday: true, works_wednesday: true, works_thursday: true, works_friday: true, works_saturday: true, created_at: '', updated_at: '',
  };

  const analytics = useMemo<TimeAnalyticsResult>(() => {
    if (records.length === 0) {
      return {
        total_employees: employees.filter(e => e.active).length,
        attendance_rate: 0,
        punctuality_rate: 0,
        avg_overtime_hours: 0,
        total_exceptions: exceptions.filter(e => e.status === 'pending').length,
        data_quality_score: 0,
      };
    }

    // Agrupa exclusivamente pelo ID do relógio resolvido na vigência do registro.
    const employeeRecordGroups = new Map<string, typeof records>();
    records.forEach(record => {
      const emp = findEmployeeMatch(employees, record.employee_name, record.employee_external_id, {
        linkedOnly: true, recordDate: record.record_date, allowNameFallback: false,
      });
      if (!emp) return;
      const group = employeeRecordGroups.get(emp.id) || [];
      group.push(record);
      employeeRecordGroups.set(emp.id, group);
    });
    const totalEmployees = employeeRecordGroups.size;

    let totalDaysExpected = 0;
    let totalDaysPresent = 0;
    let totalDaysPunctual = 0;
    let totalOvertimeMinutes = 0;
    let totalCompleteDays = 0;
    let totalDaysProcessed = 0;

    employeeRecordGroups.forEach(empRecords => {
      // Escala INDIVIDUAL do funcionário (fallback default) — KPIs do hub
      // divergiam das demais telas quando a escala não era a padrão.
      const empRec = findEmployeeMatch(employees, empRecords[0].employee_name, empRecords[0].employee_external_id, {
        linkedOnly: true, recordDate: empRecords[0].record_date, allowNameFallback: false,
      });
      const empSchedule = ((empRec as any)?.work_schedule_id && schedules.find(s => s.id === (empRec as any).work_schedule_id)) || defaultSchedule;
      const punchesByDate = new Map<string, string[]>();

      empRecords.forEach(rec => {
        const date = new Date(rec.record_date + 'T12:00:00');
        const dayOfWeek = date.getDay();
        const swapMode = swapModeFor(rec.record_date);
        const isHol = !swapMode && holidays.some(h => {
          // is_working_day = sábado produtivo da fábrica, sinal OPOSTO a feriado
          if (h.is_working_day === true || h.optional === true) return false;
          if (h.recurring) return h.holiday_date.slice(5) === rec.record_date.slice(5);
          return h.holiday_date === rec.record_date;
        });
        const punches = rec.punches as string[];
        const summary = calculateDaySummary(punches, dayOfWeek, empSchedule, isHol, swapMode);

        if (summary.expectedMinutes > 0) {
          totalDaysExpected++;
          if (punches.length > 0) totalDaysPresent++;
          if (punches.length >= 2 && summary.workedMinutes >= summary.expectedMinutes - (empSchedule.tolerance_minutes ?? 10)) {
            totalDaysPunctual++;
          }
        }
        if (punches.length > 0 && punches.length % 2 === 0) totalCompleteDays++;
        if (punches.length > 0) totalDaysProcessed++;

        punchesByDate.set(rec.record_date, punches);
      });
      const period = computePeriodFolha({
        salary: Number(empRec?.salary) || 0, from: params.date_from, to: params.date_to,
        schedule: empSchedule, holidaysSet: resolveHolidaysForPayrollRange(holidays, params.date_from, params.date_to), punchesByDate,
        payRegime: (String(empRec?.payment_type || 'mensalista').toLowerCase() as 'mensalista' | 'remoto' | 'diarista' | 'producao'),
        dailyRate: Number(empRec?.daily_rate) || 0, heNormalRate: Number(empRec?.he_normal_rate) || 0,
        heSundayHolidayRate: Number(empRec?.he_sunday_holiday_rate) || 0,
        activeFrom: empRec?.admission_date || undefined, activeTo: empRec?.termination_date || undefined,
      });
      totalOvertimeMinutes += period.he_minutes;
    });

    const attendanceRate = totalDaysExpected > 0 ? (totalDaysPresent / totalDaysExpected) * 100 : 0;
    const punctualityRate = totalDaysPresent > 0 ? (totalDaysPunctual / totalDaysPresent) * 100 : 0;
    const avgOvertimeHours = totalEmployees > 0 ? (totalOvertimeMinutes / 60) / totalEmployees : 0;
    const dataQualityScore = totalDaysProcessed > 0 ? (totalCompleteDays / totalDaysProcessed) * 100 : 0;

    return {
      total_employees: totalEmployees,
      attendance_rate: Math.round(attendanceRate * 10) / 10,
      punctuality_rate: Math.round(punctualityRate * 10) / 10,
      avg_overtime_hours: Math.round(avgOvertimeHours * 10) / 10,
      total_exceptions: exceptions.filter(e => e.status === 'pending').length,
      data_quality_score: Math.round(dataQualityScore * 10) / 10,
    };
  }, [records, employees, holidays, swapWorkedSet, swapOffSet, swapModeFor, defaultSchedule, schedules, exceptions]);

  return { data: analytics, isLoading: recordsLoading };
}
