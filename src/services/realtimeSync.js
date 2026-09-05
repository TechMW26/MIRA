export function createThrottledRealtimeWriter(write, {
  intervalMs = 250,
  onError = () => {},
} = {}) {
  const interval = Math.max(25, Number(intervalMs) || 250);
  let pending = null;
  let timer = null;
  let inFlight = null;
  let lastWriteAt = 0;
  let closed = false;

  const safeWrite = async (payload) => {
    try {
      await write(payload);
    } catch (error) {
      onError(error);
    }
  };

  const schedule = () => {
    if (closed || timer || !pending) return;
    const delay = Math.max(0, interval - (Date.now() - lastWriteAt));
    timer = setTimeout(flush, delay);
  };

  const flush = async () => {
    timer = null;
    if (closed || !pending) return;
    if (inFlight) {
      schedule();
      return;
    }
    const payload = pending;
    pending = null;
    lastWriteAt = Date.now();
    inFlight = safeWrite(payload);
    await inFlight;
    inFlight = null;
    schedule();
  };

  return {
    push(payload) {
      if (closed) return;
      pending = payload;
      schedule();
    },
    async finish() {
      if (closed && !pending && !inFlight) return;
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (inFlight) await inFlight;
      inFlight = null;
      if (pending) {
        const payload = pending;
        pending = null;
        await safeWrite(payload);
      }
    },
    async cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
      if (inFlight) await inFlight;
      inFlight = null;
    },
  };
}
