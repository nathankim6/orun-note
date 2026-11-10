export type UpdateChannel = 'ios' | 'android-apk' | 'android-play' | 'windows' | 'mac';
export type PublishedUpdate = { version: string; url: string; publishedAt: string };
const versionPattern = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
export function compareVersions(a: string, b: string): number | null {
  if (!versionPattern.test(a) || !versionPattern.test(b)) return null;
  const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1;
  return 0;
}
/** Never send Play-installed apps outside Google Play for updates. Ordinary browser previews do not gate. */
export function updateChannel(os: string, userAgent = '', installer: string | null = null): UpdateChannel | null {
  if (os === 'ios') return 'ios';
  if (os === 'android') return installer === 'com.android.vending' || installer === 'unknown' ? 'android-play' : 'android-apk';
  if (os === 'web' && /Electron|OrunNoteDesktop/i.test(userAgent)) {
    if (/Windows/i.test(userAgent)) return 'windows';
    if (/Macintosh|Mac OS X/i.test(userAgent)) return 'mac';
  }
  return null;
}
/** Validate network AND persisted responses before showing an un-dismissable prompt. */
export function validateUpdate(channel: UpdateChannel, value: unknown): PublishedUpdate | null {
  const r = value as Partial<PublishedUpdate> | null;
  if (!r || typeof r.version !== 'string' || !versionPattern.test(r.version) || typeof r.url !== 'string' || typeof r.publishedAt !== 'string' || !Number.isFinite(Date.parse(r.publishedAt))) return null;
  // Do not enforce staged/future releases accidentally returned by a source.
  if (Date.parse(r.publishedAt) > Date.now() + 5 * 60_000) return null;
  let u: URL; try { u = new URL(r.url); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.hash) return null;
  let allowed = false;
  if (channel === 'ios') allowed = u.hostname === 'apps.apple.com' && /\/id6829351204$/.test(u.pathname);
  else if (channel === 'android-play') allowed = u.hostname === 'play.google.com' && u.pathname === '/store/apps/details' && u.searchParams.get('id') === 'com.paperly.study';
  else {
    const suffix = channel === 'android-apk' ? 'android' : channel;
    const file = channel === 'android-apk' ? 'orun-note-galaxytab-arm64.apk' : channel === 'windows' ? `OrunNote-Setup-${r.version}.exe` : `OrunNote-${r.version}-mac.dmg`;
    allowed = u.hostname === 'github.com' && u.pathname === `/nathankim6/orun-note/releases/download/v${r.version}-${suffix}/${file}` && !u.search;
  }
  return allowed ? { version: r.version, url: r.url, publishedAt: r.publishedAt } : null;
}
export function requiresUpdate(current: string, release: PublishedUpdate | null): boolean {
  return !!release && compareVersions(current, release.version) === -1;
}
