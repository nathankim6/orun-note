import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle, TextStyle, StyleProp, Modal, ScrollView, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, radius, spacing, type, ios } from '@/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
const HAIR = StyleSheet.hairlineWidth;
const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null;

export function Screen({ children, style, scroll = true, padded = true }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; scroll?: boolean; padded?: boolean }) {
  const { colors } = useTheme();
  if (!scroll) return <View style={[{ flex: 1, backgroundColor: colors.bg }, padded && { padding: spacing.lg }, style]}>{children}</View>;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={[padded && { padding: spacing.lg, paddingBottom: 48 }, style]} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function T({ children, variant = 'body', color, style, numberOfLines, center }: { children: React.ReactNode; variant?: keyof typeof type; color?: string; style?: StyleProp<TextStyle>; numberOfLines?: number; center?: boolean }) {
  const { colors } = useTheme();
  return <Text numberOfLines={numberOfLines} style={[type[variant], { color: color ?? colors.text }, center && { textAlign: 'center' }, style]}>{children}</Text>;
}

export function Muted(props: Omit<React.ComponentProps<typeof T>, 'color'>) {
  const { colors } = useTheme();
  return <T {...props} color={colors.textMuted} />;
}

/** White rounded surface on the grouped background (iOS inset-grouped look: no border, no heavy shadow). */
export function Card({ children, style, onPress, padded = true }: { children: React.ReactNode; style?: any; onPress?: () => void; padded?: boolean }) {
  const { colors } = useTheme();
  const body = <View style={[{ borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.surface, padding: padded ? spacing.lg : 0 }, style]}>{children}</View>;
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>{body}</Pressable> : body;
}

/**
 * iOS buttons. primary = filled blue, secondary = tinted, ghost = plain blue text, outline = gray "bordered", danger = filled red.
 */
export function Button({ title, onPress, variant = 'primary', icon, disabled, loading, style, small, accessibilityLabel }: { title: string; onPress?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'; icon?: IoniconName; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>; small?: boolean; accessibilityLabel?: string }) {
  const map = {
    primary: { bg: ios.blue, pressed: ios.bluePressed, fg: '#FFFFFF' },
    danger: { bg: ios.red, pressed: '#D70015', fg: '#FFFFFF' },
    secondary: { bg: 'rgba(0,122,255,0.12)', pressed: 'rgba(0,122,255,0.22)', fg: ios.blue },
    ghost: { bg: 'transparent', pressed: 'rgba(0,122,255,0.08)', fg: ios.blue },
    outline: { bg: ios.tertiaryFill, pressed: ios.fill, fg: ios.blue },
  }[variant];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled || loading} onPress={onPress}
      style={({ pressed }) => [small ? styles.btnSmall : styles.btn, { backgroundColor: pressed ? map.pressed : map.bg, opacity: disabled ? 0.4 : 1 }, style]}>
      {loading ? <ActivityIndicator color={map.fg} /> : (
        <>
          {icon && <Ionicons name={icon} size={small ? 16 : 19} color={map.fg} style={{ marginRight: 6 }} />}
          <Text style={[type.bodyBold, { color: map.fg, fontSize: small ? 15 : 17 }]} numberOfLines={1}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

/** Plain tinted text button (iOS bar button / "완료", "선택"). */
export function TextButton({ title, onPress, color, bold, icon, disabled, accessibilityLabel, style, size = 17 }: { title: string; onPress?: () => void; color?: string; bold?: boolean; icon?: IoniconName; disabled?: boolean; accessibilityLabel?: string; style?: StyleProp<ViewStyle>; size?: number }) {
  const c = color ?? ios.blue;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} disabled={disabled} onPress={onPress} hitSlop={8}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, minHeight: 36, opacity: disabled ? 0.35 : pressed ? 0.4 : 1 }, style]}>
      {icon && <Ionicons name={icon} size={size + 3} color={c} />}
      <Text style={[type.body, { fontSize: size, color: c, fontWeight: bold ? '600' : '400' }]}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, color, size = 22, active, style, label, disabled }: { icon: IoniconName; onPress?: () => void; color?: string; size?: number; active?: boolean; style?: StyleProp<ViewStyle>; label?: string; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.iconBtn, active && { backgroundColor: colors.primarySoft }, pressed && { opacity: 0.4 }, disabled && { opacity: 0.3 }, style]}>
      <Ionicons name={icon} size={size} color={active ? colors.primary : color ?? colors.text} />
    </Pressable>
  );
}

/** Capsule filter (Photos / Music style). */
export function Chip({ label, active, onPress, icon, color }: { label: string; active?: boolean; onPress?: () => void; icon?: IoniconName; color?: string }) {
  const { colors } = useTheme(); const on = color ?? ios.blue;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!active }} onPress={onPress} style={({ pressed }) => [styles.chip, { backgroundColor: active ? on : '#FFFFFF' }, !active && styles.chipShadow, pressed && { opacity: 0.6 }]}>
      {icon && <Ionicons name={icon} size={15} color={active ? '#fff' : color ?? colors.textMuted} style={{ marginRight: 5 }} />}
      <Text style={[type.subhead, { color: active ? '#fff' : colors.text, fontWeight: active ? '600' : '500' }]}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'danger' | 'info' | 'accent' | 'primary' }) {
  const { colors } = useTheme();
  const map = {
    neutral: [ios.tertiaryFill, colors.textMuted], success: [colors.successSoft, '#248A3D'], danger: [colors.dangerSoft, '#D70015'],
    info: [colors.infoSoft, ios.blue], accent: ['rgba(255,149,0,0.14)', '#C93400'], primary: [colors.primarySoft, ios.blue],
  } as const;
  const [bg, fg] = map[tone];
  return <View style={[styles.badge, { backgroundColor: bg }]}><Text style={[type.caption2, { color: fg, fontWeight: '600' }]}>{label}</Text></View>;
}

/** iOS text field: gray fill, no border, 10pt corners. */
export function Input(props: TextInputProps & { label?: string; error?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: spacing.md }}>
      {props.label && <Text style={[type.footnote, { color: colors.textMuted, marginBottom: 6, marginLeft: 4 }]}>{props.label}</Text>}
      <TextInput placeholderTextColor={ios.gray} {...props} style={[styles.input, { backgroundColor: ios.tertiaryFill, color: colors.text, borderColor: props.error ? colors.danger : 'transparent' }, webNoOutline, props.style]} />
      {props.error && <Text style={[type.footnote, { color: colors.danger, marginTop: 4, marginLeft: 4 }]}>{props.error}</Text>}
    </View>
  );
}

/** iOS search field (magnifier, gray fill, clear button). */
export function SearchField({ value, onChangeText, placeholder = '검색', style, autoFocus, onSubmitEditing }: { value: string; onChangeText: (t: string) => void; placeholder?: string; style?: StyleProp<ViewStyle>; autoFocus?: boolean; onSubmitEditing?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.search, style]}>
      <Ionicons name="search" size={17} color={ios.gray} />
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={ios.gray} autoFocus={autoFocus} onSubmitEditing={onSubmitEditing} returnKeyType="search" autoCorrect={false} autoCapitalize="none"
        style={[type.body, { flex: 1, height: 36, paddingHorizontal: 6, paddingVertical: 0, color: colors.text }, webNoOutline]} />
      {!!value && <Pressable accessibilityLabel="검색어 지우기" onPress={() => onChangeText('')} hitSlop={10}><Ionicons name="close-circle" size={17} color={ios.gray2} /></Pressable>}
    </View>
  );
}

/** iOS segmented control. */
export function Segmented<K extends string>({ items, value, onChange, style, size = 'regular' }: { items: { k: K; label: string }[]; value: K; onChange: (k: K) => void; style?: StyleProp<ViewStyle>; size?: 'small' | 'regular' }) {
  const { colors } = useTheme(); const h = size === 'small' ? 28 : 32;
  return (
    <View style={[{ flexDirection: 'row', backgroundColor: ios.tertiaryFill, borderRadius: 9, padding: 2 }, style]}>
      {items.map((it, i) => {
        const on = it.k === value; const prevOn = i > 0 && items[i - 1].k === value;
        return (
          <Pressable key={it.k} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(it.k)}
            style={({ pressed }) => [{ flex: 1, minHeight: h, paddingHorizontal: 10, borderRadius: 7, alignItems: 'center', justifyContent: 'center' }, on && styles.segOn, !on && pressed && { opacity: 0.55 }]}>
            {i > 0 && !on && !prevOn && <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 7, bottom: 7, width: 1, backgroundColor: 'rgba(60,60,67,0.16)' }} />}
            <Text numberOfLines={1} style={[type.footnote, { color: colors.text, fontWeight: on ? '600' : '500', fontSize: size === 'small' ? 12 : 13 }]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Row({ children, style, gap = spacing.sm, align = 'center', justify }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number; align?: ViewStyle['alignItems']; justify?: ViewStyle['justifyContent'] }) {
  return <View style={[{ flexDirection: 'row', alignItems: align, justifyContent: justify, gap }, style]}>{children}</View>;
}

/** Grouped-list section header (small gray text, Settings style); `large` = bold content-section title. */
export function SectionHeader({ title, action, onAction, large }: { title: string; action?: string; onAction?: () => void; large?: boolean }) {
  const { colors } = useTheme();
  return (
    <Row justify="space-between" style={{ marginTop: large ? 26 : 22, marginBottom: large ? 10 : 7, paddingHorizontal: large ? 0 : 16 }}>
      <Text style={large ? [type.title3, { color: colors.text, fontWeight: '700' }] : [type.footnote, { color: colors.textMuted }]}>{title}</Text>
      {action && <TextButton title={action} onPress={onAction} size={large ? 17 : 13} />}
    </Row>
  );
}

/** Flattens fragments so Group can tell rows apart. */
function flat(children: React.ReactNode, prefix = ''): React.ReactElement[] {
  const out: React.ReactElement[] = [];
  React.Children.toArray(children).forEach((c, i) => {
    if (!React.isValidElement(c)) return;
    if (c.type === React.Fragment) out.push(...flat((c.props as any).children, `${prefix}${c.key ?? i}.`));
    else out.push(prefix ? React.cloneElement(c, { key: `${prefix}${c.key ?? i}` }) : c);
  });
  return out;
}
/**
 * Inset-grouped section (iPadOS Settings): optional gray header, white rounded block, rows separated by inset hairlines, optional footer.
 * Rows that understand grouping (ListItem, Cell) get `grouped` and `separator` automatically.
 */
export function Group({ children, header, footer, style, headerRight }: { children: React.ReactNode; header?: string; footer?: React.ReactNode; style?: StyleProp<ViewStyle>; headerRight?: React.ReactNode }) {
  const { colors } = useTheme(); const items = flat(children);
  return (
    <View style={[{ marginBottom: 8 }, style]}>
      {(header || headerRight) ? <Row justify="space-between" style={{ marginTop: 18, marginBottom: 7, paddingHorizontal: 16 }}><Text style={[type.footnote, { color: colors.textMuted, flex: 1 }]}>{header}</Text>{headerRight}</Row> : null}
      <View style={{ backgroundColor: colors.surface, borderRadius: 12, overflow: 'hidden' }}>
        {items.map((c, i) => ((c.type as any)?.acceptsGroupProps ? React.cloneElement(c as React.ReactElement<any>, { key: c.key ?? i, grouped: true, separator: i < items.length - 1 }) : c))}
      </View>
      {footer ? (typeof footer === 'string' ? <Text style={[type.footnote, { color: colors.textMuted, paddingHorizontal: 16, marginTop: 7 }]}>{footer}</Text> : footer) : null}
    </View>
  );
}

/** Free-form row inside a Group (keeps the inset separator). */
export function Cell({ children, style, grouped, separator, inset = 0, onPress }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; grouped?: boolean; separator?: boolean; inset?: number; onPress?: () => void }) {
  const { colors } = useTheme(); const padH = grouped ? 16 : 4;
  const body = (pressed: boolean) => (
    <View style={[{ paddingHorizontal: padH, paddingVertical: 11, backgroundColor: pressed ? colors.cellPressed : 'transparent' }, style]}>
      {children}
      {separator ? <View pointerEvents="none" style={{ position: 'absolute', left: padH + inset, right: 0, bottom: 0, height: HAIR, backgroundColor: colors.separator }} /> : null}
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{({ pressed }) => body(pressed)}</Pressable> : body(false);
}
(Cell as any).acceptsGroupProps = true;

/**
 * Settings-style row. `iconColor` → white glyph in a 29pt rounded colored square; otherwise a tinted glyph.
 * Outside a Group it renders as a plain list row (used by sheets/menus).
 */
export function ListItem({ title, subtitle, icon, iconColor, right, onPress, danger, value, grouped, separator = true, chevron, tint, accessibilityLabel }: { title: string; subtitle?: string; icon?: IoniconName; iconColor?: string; right?: React.ReactNode; onPress?: () => void; danger?: boolean; value?: string; grouped?: boolean; separator?: boolean; chevron?: boolean; tint?: string; accessibilityLabel?: string }) {
  const { colors } = useTheme();
  const padH = grouped ? 16 : 4; const textLeft = padH + (icon ? 29 + 14 : 0);
  const glyph = icon ? (iconColor
    ? <View style={{ width: 29, height: 29, borderRadius: 7, backgroundColor: danger ? ios.red : iconColor, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={17} color="#fff" /></View>
    : <View style={{ width: 29, alignItems: 'center' }}><Ionicons name={icon} size={22} color={danger ? ios.red : colors.primary} /></View>) : null;
  const showChevron = chevron ?? (!!onPress && right === undefined);
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={accessibilityLabel} onPress={onPress} disabled={!onPress}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', minHeight: subtitle ? 58 : 46, paddingHorizontal: padH, paddingVertical: 9, gap: 14 }, pressed && { backgroundColor: grouped ? colors.cellPressed : 'rgba(0,0,0,0.05)', borderRadius: grouped ? 0 : 8 }]}>
      {glyph}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={[type.body, { color: danger ? ios.red : tint ?? colors.text }]}>{title}</Text>
        {subtitle ? <Text style={[type.footnote, { color: colors.textMuted, marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {value ? <Text numberOfLines={2} style={[type.body, { color: colors.textMuted, maxWidth: '55%', textAlign: 'right' }]}>{value}</Text> : null}
      {right === undefined ? null : right}
      {showChevron ? <Ionicons name="chevron-forward" size={17} color={ios.gray3} /> : null}
      {separator ? <View pointerEvents="none" style={{ position: 'absolute', left: textLeft, right: 0, bottom: 0, height: HAIR, backgroundColor: colors.separator }} /> : null}
    </Pressable>
  );
}
(ListItem as any).acceptsGroupProps = true;

/** iOS switch (green when on). */
export function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const a = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => { Animated.timing(a, { toValue: value ? 1 : 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(); }, [value]);
  const bg = a.interpolate({ inputRange: [0, 1], outputRange: ['rgba(120,120,128,0.22)', ios.green] });
  const tx = a.interpolate({ inputRange: [0, 1], outputRange: [2, 22] });
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} disabled={disabled} onPress={() => onChange(!value)} hitSlop={8}>
      <Animated.View style={[styles.toggle, { backgroundColor: bg, opacity: disabled ? 0.45 : 1 }]}>
        <Animated.View style={[styles.knob, { transform: [{ translateX: tx }] }]} />
      </Animated.View>
    </Pressable>
  );
}

/**
 * Sheet. Phones: bottom sheet with a grabber. Wide screens (≥ 700 pt): centered form sheet (iPadOS).
 * Header: centered title + "완료". `grouped` = gray grouped background for Group content.
 */
export function Sheet({ visible, onClose, children, title, height, grouped, presentation = 'auto', left, doneLabel = '완료' }: { visible: boolean; onClose: () => void; children: React.ReactNode; title?: string; height?: number | string; grouped?: boolean; presentation?: 'auto' | 'bottom' | 'center'; left?: React.ReactNode; doneLabel?: string }) {
  const { colors } = useTheme(); const { width } = useWindowDimensions(); const insets = useSafeAreaInsets();
  const center = presentation === 'center' || (presentation === 'auto' && width >= 700);
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => { if (visible) { a.setValue(0); Animated.timing(a, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start(); } }, [visible]);
  const bg = grouped ? colors.bg : colors.surface;
  const anim = center
    ? { opacity: a, transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }
    : { transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }], opacity: a.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }) };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[StyleSheet.absoluteFill, center && { alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={onClose} />
        <Animated.View style={[center ? { width: Math.min(560, width - 48), maxHeight: (height as any) ?? '86%', borderRadius: 14 } : { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: (height as any) ?? '88%', borderTopLeftRadius: 14, borderTopRightRadius: 14, paddingBottom: Math.max(insets.bottom, 10) }, { backgroundColor: bg, overflow: 'hidden' }, styles.sheetShadow, anim as any]}>
          {!center && <View style={styles.grabber} />}
          {!!title && (
            <View style={[styles.sheetHeader, { borderBottomColor: grouped ? 'transparent' : colors.separator }]}>
              <View style={{ width: 72, alignItems: 'flex-start' }}>{left}</View>
              <Text numberOfLines={1} style={[type.h3, { flex: 1, textAlign: 'center', color: colors.text }]}>{title}</Text>
              <View style={{ width: 72, alignItems: 'flex-end' }}><TextButton title={doneLabel} bold onPress={onClose} /></View>
            </View>
          )}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, paddingTop: title ? 12 : 4 }}>{children}</ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** iOS alert. */
export function Dialog({ visible, title, message, onClose, actions }: { visible: boolean; title: string; message?: string; onClose: () => void; actions: { label: string; onPress: () => void; variant?: 'primary' | 'danger' | 'ghost' | 'outline' }[] }) {
  const { colors } = useTheme(); const row = actions.length === 2;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.center, { backgroundColor: 'rgba(0,0,0,0.22)' }]}>
        <View style={[styles.alert, styles.sheetShadow]}>
          <View style={{ paddingTop: 20, paddingBottom: 18, paddingHorizontal: 18, alignItems: 'center' }}>
            <Text style={[type.h3, { color: colors.text, textAlign: 'center' }]}>{title}</Text>
            {message ? <Text style={[type.footnote, { color: colors.text, textAlign: 'center', marginTop: 4 }]}>{message}</Text> : null}
          </View>
          <View style={{ flexDirection: row ? 'row' : 'column', borderTopWidth: HAIR, borderTopColor: 'rgba(60,60,67,0.29)' }}>
            {actions.map((a, i) => (
              <Pressable key={a.label} accessibilityRole="button" onPress={a.onPress} style={({ pressed }) => [{ flex: row ? 1 : undefined, minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }, i > 0 && (row ? { borderLeftWidth: HAIR, borderLeftColor: 'rgba(60,60,67,0.29)' } : { borderTopWidth: HAIR, borderTopColor: 'rgba(60,60,67,0.29)' }), pressed && { backgroundColor: 'rgba(0,0,0,0.06)' }]}>
                <Text style={[type.body, { fontSize: 17, color: a.variant === 'danger' ? ios.red : ios.blue, fontWeight: a.variant === 'primary' || a.variant === 'danger' ? '600' : '400' }]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Content-unavailable view. */
export function Empty({ icon = 'file-tray-outline', title, message, action, onAction }: { icon?: IoniconName; title: string; message?: string; action?: string; onAction?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 36, paddingHorizontal: 20 }}>
      <Ionicons name={icon} size={46} color={ios.gray2} />
      <Text style={[type.h3, { color: colors.text, marginTop: 12, textAlign: 'center' }]}>{title}</Text>
      {message && <Text style={[type.subhead, { color: colors.textMuted, marginTop: 4, textAlign: 'center', maxWidth: 380 }]}>{message}</Text>}
      {action && <Button small variant="secondary" title={action} onPress={onAction} style={{ marginTop: 14 }} />}
    </View>
  );
}

export function ProgressBar({ value, color, height = 4 }: { value: number; color?: string; height?: number }) {
  const { colors } = useTheme();
  return <View style={{ height, backgroundColor: ios.fill, borderRadius: height, overflow: 'hidden' }}><View style={{ width: `${Math.max(0, Math.min(100, value * 100))}%`, height, borderRadius: height, backgroundColor: color ?? colors.primary }} /></View>;
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return <View pointerEvents="none" style={styles.toast}><View style={[styles.toastPill, styles.sheetShadow]}><Text style={[type.subhead, { color: '#fff', fontWeight: '500', textAlign: 'center' }]}>{message}</Text></View></View>;
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 50, paddingHorizontal: 20, borderRadius: 12 },
  btnSmall: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 34, paddingHorizontal: 14, borderRadius: 9 },
  iconBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', height: 34, paddingHorizontal: 14, borderRadius: 999, marginRight: 8 },
  chipShadow: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignSelf: 'flex-start' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, paddingVertical: 10, fontSize: 16 },
  search: { flexDirection: 'row', alignItems: 'center', height: 36, borderRadius: 10, backgroundColor: 'rgba(118,118,128,0.12)', paddingLeft: 8, paddingRight: 8 },
  segOn: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  toggle: { width: 51, height: 31, borderRadius: 16, justifyContent: 'center' },
  knob: { width: 27, height: 27, borderRadius: 14, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  grabber: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: 6, marginBottom: 2, backgroundColor: '#C7C7CC' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetShadow: { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  alert: { width: 300, maxWidth: '100%', borderRadius: 14, backgroundColor: 'rgba(250,250,252,0.98)', overflow: 'hidden' },
  toast: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center', zIndex: 100, paddingHorizontal: 24 },
  toastPill: { backgroundColor: 'rgba(28,28,30,0.92)', paddingHorizontal: 18, paddingVertical: 11, borderRadius: 999, maxWidth: 560 },
});
