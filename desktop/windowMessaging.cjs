function canSendToWindow(window) {
  try {
    if (!window || typeof window.isDestroyed !== 'function' || window.isDestroyed()) return false;
    const contents = window.webContents;
    return Boolean(contents && typeof contents.isDestroyed === 'function' && !contents.isDestroyed());
  } catch {
    return false;
  }
}

function sendToWindow(window, channel, payload) {
  if (!canSendToWindow(window)) return false;
  try {
    window.webContents.send(channel, payload);
    return true;
  } catch {
    return false;
  }
}

module.exports = { canSendToWindow, sendToWindow };
