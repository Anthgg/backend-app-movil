const { runJob } = require('../../jobs');

const handleJobExecution = (jobName, jobFunction) => async (req, res, next) => {
    try {
        const targetDate = req.body.date;
        const result = await jobFunction(req.tenantId, targetDate, req.user.id);
        res.json({
            job_name: jobName,
            status: 'success',
            message: `Job '${jobName}' ejecutado exitosamente.`,
            details: result
        });
    } catch (error) {
        res.status(500).json({
            job_name: jobName,
            status: 'failed',
            message: `Falló la ejecución del job '${jobName}'.`,
            details: {
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            }
        });
    }
};

exports.generateAbsences = handleJobExecution('generate-absences', runJob('generateAbsences'));
exports.closeIncomplete = handleJobExecution('close-incomplete', runJob('closeIncompleteAttendances'));
exports.detectSuspicious = handleJobExecution('detect-suspicious', runJob('detectSuspiciousActivities'));
exports.recalculateDaily = handleJobExecution('recalculate-daily', runJob('recalculateDailySummaries'));

exports.runAll = async (req, res, next) => {
    const jobsToRun = [
        { name: 'close-incomplete', func: runJob('closeIncompleteAttendances') },
        { name: 'generate-absences', func: runJob('generateAbsences') },
        { name: 'recalculate-daily', func: runJob('recalculateDailySummaries') },
        { name: 'detect-suspicious', func: runJob('detectSuspiciousActivities') },
    ];

    const results = [];
    const targetDate = req.body.date;

    for (const job of jobsToRun) {
        try {
            const result = await job.func(req.tenantId, targetDate, req.user.id);
            results.push({
                job_name: job.name,
                status: 'success',
                message: `Job '${job.name}' ejecutado exitosamente.`,
                details: result
            });
        } catch (error) {
            results.push({
                job_name: job.name,
                status: 'failed',
                message: `Falló la ejecución del job '${job.name}'.`,
                details: { error: error.message }
            });
        }
    }

    res.json(results);
};
