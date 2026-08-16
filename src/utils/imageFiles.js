export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'heic']);

export function getExt(name = '') {
  return name.split('.').pop().toLowerCase();
}

export function mimeFromName(name = '') {
  const ext = getExt(name);
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'svg') return 'image/svg+xml';
  if (IMAGE_EXTS.has(ext)) return `image/${ext}`;
  return '';
}

export function isImageFile(file) {
  return file?.type?.startsWith('image/') || IMAGE_EXTS.has(getExt(file?.name || ''));
}

export function isSupportedImageUrl(url = '') {
  if (url.startsWith('data:image/')) return true;
  if (!/^https?:\/\//i.test(url)) return false;
  return IMAGE_EXTS.has(getExt(url.split('?')[0].split('#')[0]));
}

export function getClipboardImageFiles(clipboard) {
  const candidates = [
    ...Array.from(clipboard?.files || []),
    ...Array.from(clipboard?.items || [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean),
  ];
  const seen = new Set();

  return candidates.filter((file) => {
    if (!isImageFile(file)) return false;
    const key = `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
