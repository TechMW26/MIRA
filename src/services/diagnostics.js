const PREFIX = 'MIRA';

export function diagnosticLog(channel, event, details = {}) {
  console.info(`[${PREFIX}:${channel}] ${event}`, details);
}

export function diagnosticWarn(channel, event, details = {}) {
  console.warn(`[${PREFIX}:${channel}] ${event}`, details);
}

export function diagnosticError(channel, event, details = {}) {
  console.error(`[${PREFIX}:${channel}] ${event}`, details);
}
