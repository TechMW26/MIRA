const VERSION = 'v3';

function sequenceForPlatform(platform) {
  const shared = ['notifications', 'microphone', 'camera', 'location', 'screen-capture'];
  if (platform === 'darwin') return [...shared, 'accessibility', 'full-disk-access'];
  if (platform === 'win32') return [...shared, 'full-disk-access'];
  return shared;
}

function statusKey(permission) {
  return ({
    accessibility: 'accessibility',
    'full-disk-access': 'fullDiskAccess',
    'screen-capture': 'screenCapture',
    camera: 'camera',
    microphone: 'microphone',
    location: 'location',
    notifications: 'notifications',
  })[permission];
}

function isGranted(permission, status = {}) {
  const value = status[statusKey(permission)];
  if (permission === 'accessibility') return value === true || value === 'not-required';
  if (permission === 'screen-capture') return ['granted', 'available', 'not-required'].includes(value);
  return value === true || value === 'granted' || value === 'not-required';
}

async function runSequentialPermissionQueue({
  platform,
  getStatus,
  request,
  waitForSettingsReturn = async () => {},
  attempts = 2,
} = {}) {
  const unresolved = [];
  const completed = [];
  for (const permission of sequenceForPlatform(platform)) {
    let status = await getStatus();
    if (isGranted(permission, status)) {
      completed.push(permission);
      continue;
    }
    let acknowledgedSettings = false;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const result = await request(permission, attempt).catch((error) => ({
        permissionError: error?.message || String(error || 'Permission request failed.'),
      }));
      if (result?.settingsOpened) {
        acknowledgedSettings = permission === 'full-disk-access';
        await waitForSettingsReturn(permission);
      }
      const refreshedStatus = await getStatus().catch(() => ({}));
      status = { ...refreshedStatus, ...(result || {}) };
      if (isGranted(permission, status) || acknowledgedSettings) break;
    }
    if (isGranted(permission, status) || acknowledgedSettings) completed.push(permission);
    else unresolved.push(permission);
  }
  return { completed, unresolved };
}

module.exports = { VERSION, isGranted, runSequentialPermissionQueue, sequenceForPlatform };
