export const DESKTOP_PERMISSION_ONBOARDING_VERSION = 'v2';

const PERMISSIONS = Object.freeze({
  microphone: { id: 'microphone', title: 'Microphone', description: 'Required for voice conversations. MIRA releases the microphone when voice mode stops.' },
  camera: { id: 'camera', title: 'Camera', description: 'Allows camera-assisted features only while you actively use them.' },
  location: { id: 'location', title: 'Location', description: 'Enables location-aware answers such as local weather and nearby information.' },
  'screen-capture': { id: 'screen-capture', title: 'Screen recording and capture', description: 'Allows screen sharing, screenshots, and visual assistance after operating-system approval.' },
  accessibility: { id: 'accessibility', title: 'Accessibility', description: 'Allows approved desktop automation and interaction with other applications.' },
  'full-disk-access': { id: 'full-disk-access', title: 'Files and protected folders', description: 'Allows selected workspaces to include folders protected by the operating system.', requiresConfirmation: true },
});

export function getDesktopPermissionSequence(platform = '') {
  const shared = ['microphone', 'camera', 'location', 'screen-capture'];
  const platformPermissions = platform === 'darwin'
    ? ['accessibility', 'full-disk-access']
    : platform === 'win32' ? ['full-disk-access'] : [];
  return [...shared, ...platformPermissions].map((id) => PERMISSIONS[id]);
}

export function desktopPermissionStorageKeys() {
  return {
    completed: `mira-desktop-permissions-completed-${DESKTOP_PERMISSION_ONBOARDING_VERSION}`,
    retry: `mira-desktop-permissions-retry-${DESKTOP_PERMISSION_ONBOARDING_VERSION}`,
  };
}
