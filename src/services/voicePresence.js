// Stable presence, not face recognition. One arrival per continuous presence.
export function createPresenceGate({ arriveMs = 900, leaveMs = 5000 } = {}) {
  let present = false, since = null, absentSince = null;
  return (detected, now) => {
    if (detected) {
      absentSince = null;
      since ??= now;
      if (!present && now - since >= arriveMs) { present = true; return 'arrived'; }
    } else {
      since = null;
      absentSince ??= now;
      if (present && now - absentSince >= leaveMs) { present = false; return 'left'; }
    }
    return null;
  };
}
