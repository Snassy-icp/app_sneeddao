import React from 'react';

// --- Lamp states ---
export const LAMP_OFF = 'off';
export const LAMP_OK = 'ok';
export const LAMP_ACTIVE = 'active';
export const LAMP_WARN = 'warn';
export const LAMP_ERROR = 'error';
export const LAMP_CB = 'cb'; // Circuit breaker triggered

export const LAMP_COLORS = {
    off:    '#6b7280',
    ok:     '#22c55e',
    active: '#22c55e',
    warn:   '#f59e0b',
    error:  '#ef4444',
    cb:     '#e67e22', // Orange for circuit breaker
};

export const LAMP_LABELS = {
    off:    'Off',
    ok:     'Healthy',
    active: 'Running',
    warn:   'Attention needed',
    error:  'Error',
    cb:     'Circuit breaker triggered',
};

// --- Chore-specific hard deadlines ---
export const CHORE_DEADLINES = {
    'confirm-following': {
        deadlineSeconds: 182 * 24 * 60 * 60,
        deadlineLabel: 'NNS 6-month followee confirmation deadline',
    },
};

// --- Derive lamp state for each timer level ---

export function getSchedulerLampState(chore, cbEvents) {
    if (!chore.enabled) {
        // Check if stopped by a circuit breaker
        if (cbEvents?.length > 0) {
            const choreId = chore.choreId || chore.instanceId;
            const cbMatch = cbEvents.find(e =>
                e.actionsTaken?.some(a =>
                    a.includes(choreId) && (a.includes('Stopped') || a.includes('stopped'))
                )
            );
            if (cbMatch) return { state: LAMP_CB, label: `Stopped by CB rule: ${cbMatch.ruleName}` };
        }
        return { state: LAMP_OFF, label: 'Stopped' };
    }
    if (chore.paused) {
        // Check if paused by a circuit breaker
        if (cbEvents?.length > 0) {
            const choreId = chore.choreId || chore.instanceId;
            const cbMatch = cbEvents.find(e =>
                e.actionsTaken?.some(a =>
                    a.includes(choreId) && (a.includes('Paused') || a.includes('paused'))
                )
            );
            if (cbMatch) return { state: LAMP_CB, label: `Paused by CB rule: ${cbMatch.ruleName}` };
        }
        return { state: LAMP_OFF, label: 'Paused' };
    }
    if (chore.stopRequested) return { state: LAMP_ERROR, label: 'Stop requested' };

    const isScheduled = 'Scheduled' in chore.schedulerStatus;
    const nowMs = Date.now();

    if (isScheduled) {
        const lastRunMs = (chore.lastCompletedRunAt?.length > 0)
            ? Number(chore.lastCompletedRunAt[0]) / 1_000_000
            : 0;
        const nextRunMs = (chore.nextScheduledRunAt?.length > 0)
            ? Number(chore.nextScheduledRunAt[0]) / 1_000_000
            : 0;
        const intervalMs = Number(chore.intervalSeconds) * 1000;

        const deadline = CHORE_DEADLINES[chore.choreId];
        if (deadline && lastRunMs > 0 && nextRunMs > 0) {
            const deadlineMs = lastRunMs + deadline.deadlineSeconds * 1000;
            if (nextRunMs > deadlineMs) {
                const daysLeft = Math.round((deadlineMs - nowMs) / (24 * 60 * 60 * 1000));
                const label = daysLeft > 0
                    ? `Next run is after ${deadline.deadlineLabel} (${daysLeft} days left)`
                    : `${deadline.deadlineLabel} has passed!`;
                return { state: LAMP_WARN, label };
            }
        }
        if (deadline && lastRunMs === 0 && nextRunMs > 0) {
            if (intervalMs > deadline.deadlineSeconds * 1000) {
                return { state: LAMP_WARN, label: `Interval exceeds ${deadline.deadlineLabel}` };
            }
        }

        if (lastRunMs > 0 && intervalMs > 0 && (nowMs - lastRunMs) > intervalMs * 3) {
            return { state: LAMP_WARN, label: 'Overdue — last run was over 3 intervals ago' };
        }
        if (nextRunMs > 0 && nowMs > nextRunMs + 5 * 60 * 1000) {
            return { state: LAMP_WARN, label: 'Overdue — scheduled time has passed' };
        }
        return { state: LAMP_OK, label: 'Scheduled' };
    }

    const conductorActive = !('Idle' in chore.conductorStatus);
    if (conductorActive) return { state: LAMP_OK, label: 'Conductor active' };

    return { state: LAMP_WARN, label: 'Enabled but no timer set' };
}

export function getConductorLampState(chore) {
    const isIdle = 'Idle' in chore.conductorStatus;
    if (isIdle) return { state: LAMP_OFF, label: 'Idle' };

    if (chore.stopRequested) return { state: LAMP_ERROR, label: 'Stop requested' };

    const isPolling = 'Polling' in chore.conductorStatus;
    const statusLabel = isPolling ? 'Polling for task' : 'Running';

    if (chore.conductorStartedAt && chore.conductorStartedAt.length > 0) {
        const startedMs = Number(chore.conductorStartedAt[0]) / 1_000_000;
        const elapsedMin = (Date.now() - startedMs) / (60 * 1000);
        if (startedMs > 0 && elapsedMin > 60) {
            return { state: LAMP_WARN, label: `${statusLabel} — running for ${Math.round(elapsedMin)} min` };
        }
    }

    return { state: LAMP_ACTIVE, label: statusLabel };
}

export function getTaskLampState(chore) {
    const isRunning = !('Idle' in chore.taskStatus);

    if (isRunning) {
        if (chore.taskStartedAt && chore.taskStartedAt.length > 0) {
            const startedMs = Number(chore.taskStartedAt[0]) / 1_000_000;
            const elapsedSec = (Date.now() - startedMs) / 1000;
            const timeoutSec = Number(chore.taskTimeoutSeconds);
            if (startedMs > 0 && timeoutSec > 0 && elapsedSec > timeoutSec) {
                return { state: LAMP_WARN, label: 'Stale — exceeded timeout' };
            }
        }
        const taskId = chore.currentTaskId?.[0] || '';
        return { state: LAMP_ACTIVE, label: taskId ? `Running: ${taskId}` : 'Running' };
    }

    if (chore.lastTaskSucceeded && chore.lastTaskSucceeded.length > 0 && !chore.lastTaskSucceeded[0]) {
        const errMsg = chore.lastTaskError?.[0] || 'Unknown error';
        return { state: LAMP_ERROR, label: `Last task failed: ${errMsg}` };
    }

    return { state: LAMP_OFF, label: 'Idle' };
}

// --- Summary rollup ---
export function summarizeLampStates(...states) {
    let has = { error: false, warn: false, active: false, ok: false, cb: false };
    for (const s of states) {
        if (s === LAMP_ERROR) has.error = true;
        else if (s === LAMP_CB) has.cb = true;
        else if (s === LAMP_WARN) has.warn = true;
        else if (s === LAMP_ACTIVE) has.active = true;
        else if (s === LAMP_OK) has.ok = true;
    }
    if (has.error) return LAMP_ERROR;
    if (has.cb) return LAMP_CB;
    if (has.warn) return LAMP_WARN;
    if (has.active) return LAMP_ACTIVE;
    if (has.ok) return LAMP_OK;
    return LAMP_OFF;
}

export function getChoreSummaryLamp(chore, cbEvents) {
    const s = getSchedulerLampState(chore, cbEvents).state;
    const c = getConductorLampState(chore).state;
    const t = getTaskLampState(chore).state;
    return summarizeLampStates(s, c, t);
}

export function getAllChoresSummaryLamp(choreStatuses, cbEvents) {
    if (!choreStatuses || choreStatuses.length === 0) return LAMP_OFF;
    return summarizeLampStates(...choreStatuses.map(c => getChoreSummaryLamp(c, cbEvents)));
}

export function getSummaryLabel(state, context) {
    switch (state) {
        case LAMP_ERROR: return `${context}: Error`;
        case LAMP_CB: return `${context}: Circuit breaker triggered`;
        case LAMP_WARN: return `${context}: Attention needed`;
        case LAMP_ACTIVE: return `${context}: Active`;
        case LAMP_OK: return `${context}: Healthy`;
        default: return `${context}: Idle`;
    }
}

// --- StatusLamp component ---
const StatusLamp = ({ state, size = 10, label, style: extraStyle, showLabel = false }) => {
    const color = LAMP_COLORS[state] || LAMP_COLORS.off;
    const isActive = state === LAMP_ACTIVE;
    const isCB = state === LAMP_CB;

    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', ...extraStyle }} title={label}>
            <span
                style={{
                    display: 'inline-block',
                    width: `${size}px`,
                    height: `${size}px`,
                    borderRadius: '50%',
                    backgroundColor: color,
                    boxShadow: state !== LAMP_OFF
                        ? `0 0 ${Math.round(size * 0.5)}px ${color}80`
                        : `inset 0 1px 2px rgba(0,0,0,0.2)`,
                    animation: isActive ? 'lampPulse 2s ease-in-out infinite' : isCB ? 'lampPulse 1.5s ease-in-out infinite' : 'none',
                    '--lamp-color': color,
                    flexShrink: 0,
                    border: state === LAMP_OFF ? '1px solid #9ca3af40' : 'none',
                }}
            />
            {showLabel && (
                <span style={{ fontSize: `${Math.max(size - 1, 10)}px`, color, fontWeight: '500' }}>
                    {label || LAMP_LABELS[state]}
                </span>
            )}
        </span>
    );
};

export default StatusLamp;
