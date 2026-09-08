// REST snapshots and optimistic echoes do not inherit Firebase query ordering.
// Always order by creation time, never by arrival time or streaming updates.
export function orderMessages(messages = []) {
  return [...messages].sort((a, b) => {
    const left = Number(a.timestamp);
    const right = Number(b.timestamp);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
    return left - right || (a.role === b.role ? 0 : a.role === 'user' ? -1 : b.role === 'user' ? 1 : 0);
  });
}
