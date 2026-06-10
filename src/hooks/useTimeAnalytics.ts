import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  useWorkSchedules, useHolidays, useTimeRecords, useImportBatches,
  calculateDaySummary, WorkSchedule,
} from '@/hooks/useTimesheet';
import { useEmployees } from '@/hooks/useEmployees';
import { useMemo } from 'react';
import { calculateWeeklyPeriod } from '@/lib/weeklyTimeCalculation';

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
    overtime_multiplier: 1.5, night_overtime_multiplier: 1.7, holiday_multiplier: 2.0,
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

    // Group by employee
    const empNames = new Set(records.map(r => r.employee_name));
    const totalEmployees = empNames.size;

    let totalDaysExpected = 0;
    let totalDaysPresent = 0;
    let totalDaysPunctual = 0;
    let totalOvertimeMinutes = 0;
    let totalCompleteDays = 0;
    let totalDaysProcessed = 0;

    empNames.forEach(name => {
      const empRecords = records.filter(r => r.employee_name === name);
      const empDays: Parameters<typeof calculateWeeklyPeriod>[0] = [];

      empRecords.forEach(rec => {
        const date = new Date(rec.record_date + 'T12:00:00');
        const dayOfWeek = date.getDay();
        const isHol = holidays.some(h => {
          if (h.recurring) return h.holiday_date.slice(5) === rec.record_date.slice(5);
          return h.holiday_date === rec.record_date;
        });
        const punches = rec.punches as string[];
        const summary = calculateDaySummary(punches, dayOfWeek, defaultSchedule, isHol);

        if (summary.expectedMinutes > 0) {
          totalDaysExpected++;
          if (punches.length > 0) totalDaysPresent++;
          if (punches.length >= 2 && summary.workedMinutes >= summary.expectedMinutes - (defaultSchedule.tolerance_minutes || 10)) {
            totalDaysPunctual++;
          }
        }
        if (punches.length > 0 && punches.length % 2 === 0) totalCompleteDays++;
        if (punches.length > 0) totalDaysProcessed++;

        empDays.push({
          date: rec.record_date,
          dayOfWeek,
          workedMinutes: summary.workedMinutes,
          expectedMinutes: summary.expectedMinutes,
          overtimeMinutes: 0,
          isHoliday: isHol,
          isAbsent: summary.isAbsent,
          status: summary.status,
          punches,
        });
      });

      // Weekly calculation is the correct source of overtime (per-day value is always 0)
      const period = calculateWeeklyPeriod(empDays, defaultSchedule);
      totalOvertimeMinutes += period.totalOvertimeMinutes;
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
  }, [records, employees, holidays, defaultSchedule, exceptions]);

  return { data: analytics, isLoading: recordsLoading };
}
