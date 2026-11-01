import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle, TextStyle, StyleProp, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, radius, spacing, type } from '@/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

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

export function Card({ children, style, onPress, padded = true }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; padded?: boolean }) {
  const { colors } = useTheme();
  const base = [{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }, padded && { padding: spacing.lg }, style];
  if (onPress) return <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.85 }]}>{children}</Pressable>;
  return <View style={base}>{children}</View>;
}

export function Button({ title, onPress, variant = 'primary', icon, disabled, loading, style, small }: { title: string; onPress?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'; icon?: IoniconName; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>; small?: boolean }) {
  const { colors } = useTheme();
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : variant === 'secondary' ? colors.primarySoft : 'transparent';
  const fg = variant === 'primary' || variant === 'danger' ? colors.primaryText : variant === 'secondary' ? colors.primary : colors.text;
  return (
    <Pressable disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [styles.btn, small && styles.btnSmall, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, variant === 'outline' && { borderWidth: 1, borderColor: colors.border }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {icon && <Ionicons name={icon} size={small ? 15 : 18} color={fg} style={{ marginRight: 6 }} />}
          <Text style={[{ color: fg, fontWeight: '700', fontSize: small ? 13 : 15 }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, color, size = 22, active, style, label, disabled }: { icon: IoniconName; onPress?: () => void; color?: string; size?: number; active?: boolean; style?: StyleProp<ViewStyle>; label?: string; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.iconBtn, active && { backgroundColor: colors.primarySoft }, pressed && { opacity: 0.6 }, disabled && { opacity: 0.35 }, style]}>
      <Ionicons name={icon} size={size} color={active ? colors.primary : color ?? colors.text} />
    </Pressable>
  );
}

export function Chip({ label, active, onPress, icon, color }: { label: string; active?: boolean; onPress?: () => void; icon?: IoniconName; color?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, { backgroundColor: active ? (color ?? colors.primary) : colors.surface, borderColor: active ? (color ?? colors.primary) : colors.border }, pressed && { opacity: 0.8 }]}>
      {icon && <Ionicons name={icon} size={14} color={active ? '#fff' : colors.textMuted} style={{ marginRight: 4 }} />}
      <Text style={{ color: active ? '#fff' : colors.text, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'danger' | 'info' | 'accent' | 'primary' }) {
  const { colors } = useTheme();
  const map = {
    neutral: [colors.surfaceAlt, colors.textMuted], success: [colors.successSoft, colors.success], danger: [colors.dangerSoft, colors.danger],
    info: [colors.infoSoft, colors.info], accent: ['#FDF1E0', colors.accent], primary: [colors.primarySoft, colors.primary],
  } as const;
  const [bg, fg] = map[tone];
  return <View style={[styles.badge, { backgroundColor: bg }]}><Text style={{ color: fg, fontSize: 11, fontWeight: '700' }}>{label}</Text></View>;
}

export function Input(props: TextInputProps & { label?: string; error?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: spacing.md }}>
      {props.label && <Text style={[type.label, { color: colors.textMuted, marginBottom: 6 }]}>{props.label}</Text>}
      <TextInput placeholderTextColor={colors.textFaint} {...props} style={[styles.input, { backgroundColor: colors.surface, borderColor: props.error ? colors.danger : colors.border, color: colors.text }, props.style]} />
      {props.error && <Text style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{props.error}</Text>}
    </View>
  );
}

export function Row({ children, style, gap = spacing.sm, align = 'center', justify }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number; align?: ViewStyle['alignItems']; justify?: ViewStyle['justifyContent'] }) {
  return <View style={[{ flexDirection: 'row', alignItems: align, justifyContent: justify, gap }, style]}>{children}</View>;
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const { colors } = useTheme();
  return (
    <Row justify="space-between" style={{ marginTop: spacing.xl, marginBottom: spacing.md }}>
      <T variant="h3">{title}</T>
      {action && <Pressable onPress={onAction} hitSlop={8}><Row gap={2}><Text style={{ color: colors.textMuted, fontSize: 13, fontWeight: '600' }}>{action}</Text><Ionicons name="chevron-forward" size={14} color={colors.textMuted} /></Row></Pressable>}
    </Row>
  );
}

export function ListItem({ title, subtitle, icon, right, onPress, danger, value }: { title: string; subtitle?: string; icon?: IoniconName; right?: React.ReactNode; onPress?: () => void; danger?: boolean; value?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.listItem, { borderBottomColor: colors.border }, pressed && { backgroundColor: colors.surfaceAlt }]}>
      {icon && <View style={[styles.listIcon, { backgroundColor: colors.surfaceAlt }]}><Ionicons name={icon} size={18} color={danger ? colors.danger : colors.text} /></View>}
      <View style={{ flex: 1 }}>
        <Text style={{ color: danger ? colors.danger : colors.text, fontSize: 15, fontWeight: '600' }}>{title}</Text>
        {subtitle && <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>{subtitle}</Text>}
      </View>
      {value && <Text style={{ color: colors.textMuted, fontSize: 13, marginRight: 4 }}>{value}</Text>}
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textFaint} /> : null)}
    </Pressable>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={() => onChange(!value)} style={[styles.toggle, { backgroundColor: value ? colors.primary : colors.border }]}>
      <View style={[styles.knob, { alignSelf: value ? 'flex-end' : 'flex-start' }]} />
    </Pressable>
  );
}

export function Sheet({ visible, onClose, children, title, height }: { visible: boolean; onClose: () => void; children: React.ReactNode; title?: string; height?: number | string }) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.surface, maxHeight: (height as any) ?? '85%' }]}>
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        {!!title && <Row justify="space-between" style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}><T variant="h3">{title}</T><IconButton icon="close" onPress={onClose} /></Row>}
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: 0 }}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

export function Dialog({ visible, title, message, onClose, actions }: { visible: boolean; title: string; message?: string; onClose: () => void; actions: { label: string; onPress: () => void; variant?: 'primary' | 'danger' | 'ghost' | 'outline' }[] }) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.center, { backgroundColor: colors.overlay }]}>
        <View style={[styles.dialog, { backgroundColor: colors.surface }]}>
          <T variant="h3">{title}</T>
          {message && <Muted style={{ marginTop: 8 }}>{message}</Muted>}
          <Row style={{ marginTop: 20, justifyContent: 'flex-end' }}>
            {actions.map((a) => <Button key={a.label} small title={a.label} variant={a.variant ?? 'ghost'} onPress={a.onPress} />)}
          </Row>
        </View>
      </View>
    </Modal>
  );
}

export function Empty({ icon = 'file-tray-outline', title, message, action, onAction }: { icon?: IoniconName; title: string; message?: string; action?: string; onAction?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', padding: 32 }}>
      <Ionicons name={icon} size={40} color={colors.textFaint} />
      <T variant="bodyBold" style={{ marginTop: 12 }}>{title}</T>
      {message && <Muted variant="caption" style={{ marginTop: 4, textAlign: 'center' }}>{message}</Muted>}
      {action && <Button small title={action} onPress={onAction} style={{ marginTop: 14 }} />}
    </View>
  );
}

export function ProgressBar({ value, color, height = 6 }: { value: number; color?: string; height?: number }) {
  const { colors } = useTheme();
  return <View style={{ height, backgroundColor: colors.surfaceAlt, borderRadius: height, overflow: 'hidden' }}><View style={{ width: `${Math.max(0, Math.min(100, value * 100))}%`, height, backgroundColor: color ?? colors.primary }} /></View>;
}

export function Toast({ message }: { message: string | null }) {
  const { colors } = useTheme();
  if (!message) return null;
  return <View pointerEvents="none" style={styles.toast}><View style={{ backgroundColor: colors.text, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 }}><Text style={{ color: colors.bg, fontWeight: '600' }}>{message}</Text></View></View>;
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 13, paddingHorizontal: 18, borderRadius: radius.md },
  btnSmall: { paddingVertical: 8, paddingHorizontal: 12 },
  iconBtn: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, marginRight: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: 'flex-start' },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  listItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  listIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  toggle: { width: 46, height: 28, borderRadius: 14, padding: 3, justifyContent: 'center' },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  backdrop: { ...StyleSheet.absoluteFill },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8, paddingBottom: 24 },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 400, borderRadius: 18, padding: 22 },
  toast: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center', zIndex: 100 },
});
