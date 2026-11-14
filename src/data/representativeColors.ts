/** Shared initial palette for the header and the stylus dial, in user-requested order. */
export const DEFAULT_REPRESENTATIVE_COLORS = ['#000000', '#FDE68A', '#BFDBFE', '#FCA5A5', '#BBF7D0'] as const;
const OLD_DEFAULT = ['#172033', '#DC2626', '#2F6FED', '#22C55E', '#F59E0B'];
/** Upgrade untouched defaults only. Never overwrite a user's custom colors, ordering, duplicates or empty palette. */
export function upgradeRepresentativeColors(colors: unknown): string[] {
  if (!Array.isArray(colors) || (colors.length === OLD_DEFAULT.length && colors.every((c, i) => typeof c === 'string' && c.toUpperCase() === OLD_DEFAULT[i]))) return [...DEFAULT_REPRESENTATIVE_COLORS];
  return [...colors];
}
