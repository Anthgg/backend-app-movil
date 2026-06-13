const { query } = require('../../../config/database');
const moment = require('moment-timezone');
const logger = require('../../../shared/utils/logger');
const scheduleService = require('../../schedule-service/services/laborSchedule.service');

function normalizeDate(value, timezone) {
  return scheduleService.normalizeDate(value || moment().tz(timezone).format('YYYY-MM-DD'), timezone);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

class AbsenceService {
  async getActiveWorkers(companyId) {
    const workersRes = await query(`
      SELECT w.id,
             w.user_id,
             w.company_id,
             u.is_active AS user_active,
             w.hire_date,
             active_contract.end_date AS contract_end_date
      FROM workers w
      JOIN users u ON w.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT wc.end_date
        FROM worker_contracts wc
        WHERE wc.worker_id = w.id
          AND LOWER(COALESCE(wc.status, 'active')) = 'active'
        ORDER BY wc.start_date DESC NULLS LAST
        LIMIT 1
      ) active_contract ON true
      WHERE w.company_id = $1
        AND COALESCE(w.is_active, true) = true
        AND w.deleted_at IS NULL
    `, [companyId]);

    return workersRes.rows;
  }

  async hasAttendance(workerId, companyId, targetDate) {
    const attRes = await query(`
      SELECT id
      FROM attendance_records
      WHERE worker_id = $1
        AND company_id = $2
        AND date = $3::date
      LIMIT 1
    `, [workerId, companyId, targetDate]);

    return attRes.rows.length > 0;
  }

  async hasApprovedRequest(workerId, targetDate) {
    const reqRes = await query(`
      SELECT id
      FROM employee_requests
      WHERE worker_id = $1
        AND status = 'approved'
        AND $2::date >= start_date
        AND $2::date <= end_date
      LIMIT 1
    `, [workerId, targetDate]);

    return reqRes.rows.length > 0;
  }

  async insertAbsence(worker, companyId, targetDate, schedule) {
    const metrics = scheduleService.calculateAttendanceMetrics({
      schedule,
      status: 'absent'
    });

    const result = await query(`
      INSERT INTO attendance_records (
        worker_id,
        user_id,
        company_id,
        shift_id,
        labor_policy_id,
        date,
        status,
        late_minutes,
        scheduled_check_in,
        scheduled_check_out,
        tolerance_minutes,
        expected_minutes,
        effective_worked_minutes,
        break_minutes,
        break_paid,
        calculation_details,
        incomplete_reason,
        auto_closed,
        auto_closed_at,
        auto_absence_generated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6::date, 'absent', 0, $7, $8, $9, $10, 0, $11, $12, $13,
        'No registro asistencia', true, NOW(), NOW()
      )
      ON CONFLICT (worker_id, date) DO NOTHING
      RETURNING id
    `, [
      worker.id,
      worker.user_id,
      companyId,
      schedule.shift?.id || null,
      schedule.policy?.id || null,
      targetDate,
      metrics.scheduledCheckIn,
      metrics.scheduledCheckOut,
      metrics.toleranceMinutes,
      metrics.expectedMinutes,
      metrics.breakMinutes,
      metrics.breakPaid,
      metrics.calculationDetails
    ]);

    return result.rows[0] || null;
  }

  async generateDailyAbsences(companyId, targetDate, triggeredBy = null) {
    const startTime = Date.now();
    let totalProcessed = 0;
    let absencesGenerated = 0;
    let skippedNonWorkingDay = 0;
    let skippedWithoutShift = 0;
    let skippedJustified = 0;

    const policy = await scheduleService.getPolicy(companyId);
    const date = normalizeDate(targetDate, policy.timezone);

    try {
      if (!policy.autoAbsenceEnabled) {
        return { success: true, absencesGenerated: 0, skipped: 'auto_absence_disabled' };
      }

      const workers = await this.getActiveWorkers(companyId);
      totalProcessed = workers.length;

      for (const worker of workers) {
        if (!worker.user_active) continue;

        if (worker.hire_date && moment(date).isBefore(moment(worker.hire_date), 'day')) {
          continue;
        }

        if (worker.contract_end_date && moment(date).isAfter(moment(worker.contract_end_date), 'day')) {
          continue;
        }

        const schedule = await scheduleService.resolveWorkerSchedule(worker.id, companyId, date);
        if (!schedule.shift) {
          skippedWithoutShift += 1;
          continue;
        }

        if (!schedule.isWorkingDay) {
          skippedNonWorkingDay += 1;
          continue;
        }

        if (await this.hasAttendance(worker.id, companyId, date)) {
          continue;
        }

        if (await this.hasApprovedRequest(worker.id, date)) {
          skippedJustified += 1;
          continue;
        }

        const inserted = await this.insertAbsence(worker, companyId, date, schedule);
        if (inserted) {
          absencesGenerated += 1;
        }
      }

      const durationMs = Date.now() - startTime;

      await query(`
        INSERT INTO job_runs (
          company_id, job_name, status, started_at, finished_at, duration_ms, triggered_by,
          trigger_type, target_date, total_processed, total_success, metadata
        )
        VALUES ($1, 'generateDailyAbsencesJob', 'success', TO_TIMESTAMP($2 / 1000.0), NOW(), $3, $4, $5, $6, $7, $8, $9)
      `, [
        companyId,
        startTime,
        durationMs,
        triggeredBy,
        triggeredBy ? 'manual' : 'automatic',
        date,
        totalProcessed,
        absencesGenerated,
        {
          skippedNonWorkingDay,
          skippedWithoutShift,
          skippedJustified
        }
      ]);

      logger.logChange('ATTENDANCE_JOB', 'Faltas generadas exitosamente', { companyId, date, absencesGenerated });
      return {
        success: true,
        absencesGenerated,
        totalProcessed,
        skippedNonWorkingDay,
        skippedWithoutShift,
        skippedJustified
      };
    } catch (error) {
      logger.logError('ATTENDANCE_JOB', 'Error generando faltas', error);

      await query(`
        INSERT INTO job_runs (
          company_id, job_name, status, started_at, finished_at, duration_ms, triggered_by,
          trigger_type, target_date, total_processed, error_message
        )
        VALUES ($1, 'generateDailyAbsencesJob', 'failed', TO_TIMESTAMP($2 / 1000.0), NOW(), $3, $4, $5, $6, $7, $8)
      `, [companyId, startTime, Date.now() - startTime, triggeredBy, triggeredBy ? 'manual' : 'automatic', date, totalProcessed, error.message]);

      throw error;
    }
  }

  async closeIncompleteAttendances(companyId, targetDate, triggeredBy = null) {
    const startTime = Date.now();
    const policy = await scheduleService.getPolicy(companyId);
    const date = normalizeDate(targetDate, policy.timezone);

    const res = await query(`
      UPDATE attendance_records
      SET status = 'incomplete',
          incomplete_reason = 'No registro salida',
          auto_closed = true,
          auto_closed_at = NOW(),
          updated_at = NOW()
      WHERE company_id = $1
        AND date = $2::date
        AND check_in_time IS NOT NULL
        AND check_out_time IS NULL
        AND status NOT IN ('absent', 'rejected')
      RETURNING id
    `, [companyId, date]);

    const closedCount = res.rows.length;
    const durationMs = Date.now() - startTime;

    await query(`
      INSERT INTO job_runs (
        company_id, job_name, status, started_at, finished_at, duration_ms, triggered_by,
        trigger_type, target_date, total_success
      )
      VALUES ($1, 'closeIncompleteAttendancesJob', 'success', TO_TIMESTAMP($2 / 1000.0), NOW(), $3, $4, $5, $6, $7)
    `, [companyId, startTime, durationMs, triggeredBy, triggeredBy ? 'manual' : 'automatic', date, closedCount]);

    return { success: true, closedCount };
  }

  async detectSuspiciousActivities(companyId, targetDate, triggeredBy = null) {
    const policy = await scheduleService.getPolicy(companyId);
    const date = normalizeDate(targetDate, policy.timezone);
    const result = await query(`
      UPDATE attendance_records
      SET is_suspicious = true,
          suspicious_reason = COALESCE(suspicious_reason, 'Marcacion con mock location o fuera de rango'),
          updated_at = NOW()
      WHERE company_id = $1
        AND date = $2::date
        AND (
          COALESCE(check_in_is_mock_location, false) = true
          OR COALESCE(check_out_is_mock_location, false) = true
          OR COALESCE(check_in_out_of_range, false) = true
          OR COALESCE(check_out_out_of_range, false) = true
        )
      RETURNING id
    `, [companyId, date]);

    return { success: true, detected: result.rows.length, flagged: result.rows.length, triggeredBy };
  }

  async recalculateDailyAttendance(companyId, targetDate, triggeredBy = null) {
    const startTime = Date.now();
    const policy = await scheduleService.getPolicy(companyId);
    const date = normalizeDate(targetDate, policy.timezone);
    const recordsRes = await query(`
      SELECT *
      FROM attendance_records
      WHERE company_id = $1
        AND date = $2::date
    `, [companyId, date]);

    const affectedWorkers = new Set();

    for (const record of recordsRes.rows) {
      const schedule = await scheduleService.resolveWorkerSchedule(record.worker_id, companyId, date);
      const metrics = scheduleService.calculateAttendanceMetrics({
        schedule,
        checkInTime: record.check_in_time,
        checkOutTime: record.check_out_time,
        status: record.status
      });

      const status = record.status === 'absent' || record.status === 'rejected'
        ? record.status
        : metrics.status;

      await query(`
        UPDATE attendance_records
        SET shift_id = COALESCE($2, shift_id),
            labor_policy_id = $3,
            scheduled_check_in = $4,
            scheduled_check_out = $5,
            tolerance_minutes = $6,
            expected_minutes = $7,
            effective_worked_minutes = $8,
            break_minutes = $9,
            break_paid = $10,
            late_minutes = $11,
            overtime_minutes = $12,
            early_leave_minutes = $13,
            status = $14,
            calculation_details = $15,
            updated_at = NOW()
        WHERE id = $1
      `, [
        record.id,
        schedule.shift?.id || null,
        schedule.policy?.id || null,
        metrics.scheduledCheckIn,
        metrics.scheduledCheckOut,
        metrics.toleranceMinutes,
        metrics.expectedMinutes,
        metrics.effectiveWorkedMinutes ?? (status === 'absent' ? 0 : record.effective_worked_minutes),
        metrics.breakMinutes,
        metrics.breakPaid,
        metrics.lateMinutes,
        metrics.overtimeMinutes,
        metrics.earlyLeaveMinutes,
        status,
        metrics.calculationDetails
      ]);

      affectedWorkers.add(record.worker_id);
    }

    for (const workerId of affectedWorkers) {
      await this.recalculateWeeklySummary(companyId, workerId, date);
    }

    const durationMs = Date.now() - startTime;
    await query(`
      INSERT INTO job_runs (
        company_id, job_name, status, started_at, finished_at, duration_ms, triggered_by,
        trigger_type, target_date, total_processed, total_success
      )
      VALUES ($1, 'recalculateDailyAttendanceJob', 'success', TO_TIMESTAMP($2 / 1000.0), NOW(), $3, $4, $5, $6, $7, $7)
    `, [companyId, startTime, durationMs, triggeredBy, triggeredBy ? 'manual' : 'automatic', date, recordsRes.rows.length]);

    return {
      success: true,
      recalculated_days: 1,
      records_recalculated: recordsRes.rows.length,
      workers_affected: affectedWorkers.size
    };
  }

  async getWorkerSalarySnapshot(companyId, workerId, startDate, endDate) {
    const result = await query(`
      SELECT w.hire_date,
             COALESCE(contract.agreed_salary, jp.base_salary, 1500)::numeric AS base_salary,
             contract.end_date AS contract_end_date
      FROM workers w
      LEFT JOIN job_positions jp ON jp.id = w.job_position_id
      LEFT JOIN LATERAL (
        SELECT wc.agreed_salary, wc.end_date
        FROM worker_contracts wc
        WHERE wc.worker_id = w.id
          AND LOWER(COALESCE(wc.status, 'active')) = 'active'
          AND (wc.start_date IS NULL OR wc.start_date <= $4::date)
          AND (wc.end_date IS NULL OR wc.end_date >= $3::date)
        ORDER BY wc.start_date DESC NULLS LAST
        LIMIT 1
      ) contract ON true
      WHERE w.id = $1
        AND w.company_id = $2
      LIMIT 1
    `, [workerId, companyId, startDate, endDate]);

    return result.rows[0] || { base_salary: 1500 };
  }

  async calculateExpectedWeekMinutes(companyId, worker, weekStart, weekEnd, policy) {
    let expectedMinutes = 0;
    const start = moment.max(moment(weekStart), worker.hire_date ? moment(worker.hire_date) : moment(weekStart));
    const end = worker.contract_end_date
      ? moment.min(moment(weekEnd), moment(worker.contract_end_date))
      : moment(weekEnd);

    if (end.isBefore(start, 'day')) {
      return 0;
    }

    const cursor = start.clone();
    while (cursor.isSameOrBefore(end, 'day')) {
      const day = cursor.format('YYYY-MM-DD');
      const schedule = await scheduleService.resolveWorkerSchedule(worker.id || worker.worker_id, companyId, day);
      if (schedule.shift && schedule.isWorkingDay) {
        expectedMinutes += schedule.expectedMinutes || policy.defaultEffectiveMinutes || 0;
      }
      cursor.add(1, 'day');
    }

    return expectedMinutes;
  }

  async recalculateWeeklySummary(companyId, workerId, targetDate) {
    const policy = await scheduleService.getPolicy(companyId);
    const date = normalizeDate(targetDate, policy.timezone);
    const weekStart = moment.tz(date, 'YYYY-MM-DD', policy.timezone).startOf('isoWeek').format('YYYY-MM-DD');
    const weekEnd = moment.tz(date, 'YYYY-MM-DD', policy.timezone).endOf('isoWeek').format('YYYY-MM-DD');
    const salary = await this.getWorkerSalarySnapshot(companyId, workerId, weekStart, weekEnd);
    const expectedMinutes = await this.calculateExpectedWeekMinutes(
      companyId,
      { id: workerId, hire_date: salary.hire_date, contract_end_date: salary.contract_end_date },
      weekStart,
      weekEnd,
      policy
    );

    const aggRes = await query(`
      SELECT COALESCE(SUM(COALESCE(worked_minutes, 0)), 0)::int AS worked_minutes,
             COALESCE(SUM(COALESCE(effective_worked_minutes, worked_minutes, 0)), 0)::int AS effective_worked_minutes,
             COALESCE(SUM(COALESCE(late_minutes, 0)), 0)::int AS late_minutes,
             COALESCE(SUM(CASE WHEN status = 'absent' THEN COALESCE(expected_minutes, 0) ELSE 0 END), 0)::int AS absent_minutes,
             COUNT(*) FILTER (WHERE status = 'absent')::int AS absent_days
      FROM attendance_records
      WHERE company_id = $1
        AND worker_id = $2
        AND date >= $3::date
        AND date <= $4::date
    `, [companyId, workerId, weekStart, weekEnd]);

    const aggregate = aggRes.rows[0] || {};
    const baseSalary = toNumber(salary.base_salary, 1500);
    const monthlyTargetHours = Math.max((policy.weeklyTargetMinutes || 2880) / 60 * 4.333333, 1);
    const hourlyRate = baseSalary / monthlyTargetHours;
    const proportionalFactor = policy.weeklyTargetMinutes > 0 ? expectedMinutes / policy.weeklyTargetMinutes : 0;
    const absenceDiscount = toNumber(aggregate.absent_minutes, 0) / 60 * hourlyRate;
    const lateDiscount = toNumber(aggregate.late_minutes, 0) / 60 * hourlyRate;
    const grossAmount = expectedMinutes / 60 * hourlyRate;
    const netEstimatedAmount = Math.max(grossAmount - absenceDiscount - lateDiscount, 0);

    const calculationDetails = {
      policyId: policy.id,
      weeklyTargetMinutes: policy.weeklyTargetMinutes,
      expectedMinutes,
      baseSalary,
      monthlyTargetHours,
      calculatedAt: new Date().toISOString()
    };

    const result = await query(`
      INSERT INTO attendance_weekly_summaries (
        company_id,
        worker_id,
        week_start,
        week_end,
        expected_minutes,
        worked_minutes,
        effective_worked_minutes,
        late_minutes,
        absent_days,
        proportional_factor,
        salary_base,
        hourly_rate,
        absence_discount,
        late_discount,
        gross_amount,
        net_estimated_amount,
        calculation_details,
        recalculated_at,
        updated_at
      )
      VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())
      ON CONFLICT (company_id, worker_id, week_start)
      DO UPDATE SET
        week_end = EXCLUDED.week_end,
        expected_minutes = EXCLUDED.expected_minutes,
        worked_minutes = EXCLUDED.worked_minutes,
        effective_worked_minutes = EXCLUDED.effective_worked_minutes,
        late_minutes = EXCLUDED.late_minutes,
        absent_days = EXCLUDED.absent_days,
        proportional_factor = EXCLUDED.proportional_factor,
        salary_base = EXCLUDED.salary_base,
        hourly_rate = EXCLUDED.hourly_rate,
        absence_discount = EXCLUDED.absence_discount,
        late_discount = EXCLUDED.late_discount,
        gross_amount = EXCLUDED.gross_amount,
        net_estimated_amount = EXCLUDED.net_estimated_amount,
        calculation_details = EXCLUDED.calculation_details,
        recalculated_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `, [
      companyId,
      workerId,
      weekStart,
      weekEnd,
      expectedMinutes,
      toNumber(aggregate.worked_minutes, 0),
      toNumber(aggregate.effective_worked_minutes, 0),
      toNumber(aggregate.late_minutes, 0),
      toNumber(aggregate.absent_days, 0),
      proportionalFactor,
      baseSalary,
      hourlyRate,
      absenceDiscount,
      lateDiscount,
      grossAmount,
      netEstimatedAmount,
      calculationDetails
    ]);

    return result.rows[0];
  }
}

module.exports = new AbsenceService();
