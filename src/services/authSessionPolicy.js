export function isPermanentSessionError(error) {
  return error?.status === 401 || error?.status === 403;
}

export async function restoreSessionWithRetry(operation, {
  attempts = 3,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (isPermanentSessionError(error) || !error?.retryable || attempt === attempts) throw error;
      await wait(250 * attempt);
    }
  }
  throw lastError;
}
