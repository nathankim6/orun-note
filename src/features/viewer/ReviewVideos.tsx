import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, View, Text, Pressable, StyleSheet, Image, ScrollView, TextInput, ActivityIndicator, useWindowDimensions, Platform, Animated, Easing, PanResponder } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Rect, Path, Circle, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ReviewVideo } from '@/lib/api';
import { useSession } from '@/store/session';
import { YouTubeStage, StageHandle, StageStatus, EMPTY_STATUS } from './YouTubeStage';
import { normalizeReviewVideos } from './reviewVideoSafety';
export type { StageStatus } from './YouTubeStage';

// Thumbnail of the video (never shown as text). hqdefault is 4:3 with letterbox bars; a 16:9 cover crop removes them.
const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const INK = '#1C1C1E', SUB = '#8E8E93', FAINT = '#AEAEB2', ACCENT = '#5B5BF0';
const TILE: [string, string] = ['#8B7CFF', '#5B5BF0'];

let cache: { key: string; at: number; videos: ReviewVideo[] } | null = null;

const mmss = (s: number) => { const v = Math.max(0, Math.floor(s || 0)); const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), x = v % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
function dayLabel(iso: string) {
  const d = new Date(iso); if (isNaN(d.getTime())) return '';
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86400000);
  if (diff <= 0) return '오늘'; if (diff === 1) return '어제'; if (diff < 7) return `${diff}일 전`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
const isNew = (iso: string) => Date.now() - new Date(iso).getTime() < 3 * 86400000;
const passageLine = (v: ReviewVideo) => !v.passages.length ? '' : v.passages.length === 1 ? v.passages[0].title : `${v.passages[0].title} 외 ${v.passages.length - 1}개`;

function VideoTile({ size = 44 }: { size?: number }) {
  return (
    <LinearGradient colors={TILE} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: size * 0.28, alignItems: 'center', justifyContent: 'center', shadowColor: '#5B5BF0', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 }}>
      <MaterialCommunityIcons name="play-box-multiple" size={size * 0.56} color="#fff" />
    </LinearGradient>
  );
}

/** Empty-state illustration: a soft stage with a play card and sparkles (vector, brand colors). */
function EmptyArt() {
  return (
    <Svg width={168} height={124} viewBox="0 0 168 124">
      <Defs>
        <SvgGradient id="ev" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#8B7CFF" /><Stop offset="1" stopColor="#5B5BF0" /></SvgGradient>
        <SvgGradient id="eb" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#EEF0FF" /><Stop offset="1" stopColor="#F7F7FC" /></SvgGradient>
      </Defs>
      <Circle cx={84} cy={64} r={56} fill="url(#eb)" />
      <Rect x={40} y={50} width={88} height={56} rx={12} fill="#DCDDF8" />
      <Rect x={30} y={34} width={108} height={64} rx={14} fill="url(#ev)" />
      <Rect x={38} y={88} width={92} height={4} rx={2} fill="#FFFFFF" opacity={0.35} />
      <Rect x={38} y={88} width={34} height={4} rx={2} fill="#FFFFFF" />
      <Circle cx={84} cy={62} r={16} fill="#FFFFFF" />
      <Path d="M79 54.5 L92 62 L79 69.5 Z" fill="#5B5BF0" />
      <Path d="M140 26 l2.6 6 6 2.6 -6 2.6 -2.6 6 -2.6 -6 -6 -2.6 6 -2.6z" fill="#FFC145" />
      <Path d="M24 22 l1.8 4.2 4.2 1.8 -4.2 1.8 -1.8 4.2 -1.8 -4.2 -4.2 -1.8 4.2 -1.8z" fill="#FFC145" opacity={0.8} />
      <Circle cx={148} cy={96} r={3} fill="#C7C9F7" />
    </Svg>
  );
}

function Shimmer({ style }: { style: any }) {
  const a = useRef(new Animated.Value(0.55)).current;
  useEffect(() => { const l = Animated.loop(Animated.sequence([Animated.timing(a, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }), Animated.timing(a, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' })])); l.start(); return () => l.stop(); }, []);
  return <Animated.View style={[{ backgroundColor: '#E5E5EA', opacity: a }, style]} />;
}

function VideoCard({ v, width, onPress }: { v: ReviewVideo; width: number; onPress: () => void }) {
  const h = (width - 20) * 9 / 16;
  return (
    <Pressable testID={`review-video-card-${v.id}`} accessibilityRole="button" accessibilityLabel={`${v.title} 재생`} onPress={onPress} style={({ pressed }) => [styles.card, { width }, pressed && { transform: [{ scale: 0.98 }], opacity: 0.94 }]}>
      <View style={[styles.thumb, { height: h }]}>
        <Image source={{ uri: thumb(v.videoId) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']} style={[StyleSheet.absoluteFill, { top: '45%' }]} />
        <View style={styles.cardPlay}><Ionicons name="play" size={22} color="#1C1C1E" style={{ marginLeft: 3 }} /></View>
        {isNew(v.assignedAt) && <View style={styles.newBadge}><Text style={styles.newText}>NEW</Text></View>}
        <View style={styles.chip}><MaterialCommunityIcons name="book-open-page-variant" size={12} color="#fff" /><Text style={styles.chipText}>지문 {v.passages.length}개</Text></View>
      </View>
      <View style={{ paddingHorizontal: 4, paddingTop: 10, paddingBottom: 2, gap: 3 }}>
        <Text numberOfLines={2} style={styles.cardTitle}>{v.title}</Text>
        {!!passageLine(v) && <Text numberOfLines={1} style={styles.cardMeta}>{passageLine(v)}</Text>}
        {!!dayLabel(v.assignedAt) && <Text style={styles.cardDate}>{dayLabel(v.assignedAt)} 배정</Text>}
      </View>
    </Pressable>
  );
}

/** Seek bar for the dark player: drag previews the position, release seeks once. */
function Scrubber({ time, duration, loaded, onSeek, onScrub }: { time: number; duration: number; loaded: number; onSeek: (t: number) => void; onScrub?: (active: boolean) => void }) {
  const [w, setW] = useState(1); const [drag, setDrag] = useState<number | null>(null); const wRef = useRef(1); const dRef = useRef(duration); dRef.current = duration;
  const cb = useRef({ onSeek, onScrub }); cb.current = { onSeek, onScrub };
  const at = (x: number) => Math.max(0, Math.min(1, x / Math.max(1, wRef.current))) * (dRef.current || 0);
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true, onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { cb.current.onScrub?.(true); setDrag(at(e.nativeEvent.locationX)); },
    onPanResponderMove: (e) => setDrag(at(e.nativeEvent.locationX)),
    onPanResponderRelease: (e) => { const t = at(e.nativeEvent.locationX); setDrag(null); cb.current.onScrub?.(false); cb.current.onSeek(t); },
    onPanResponderTerminate: () => { setDrag(null); cb.current.onScrub?.(false); },
  }), []);
  const cur = drag ?? time; const frac = duration > 0 ? Math.min(1, cur / duration) : 0;
  return (
    <View style={{ flex: 1 }}>
      <View {...pan.panHandlers} onLayout={(e) => { wRef.current = e.nativeEvent.layout.width; setW(e.nativeEvent.layout.width); }} style={{ height: 28, justifyContent: 'center' }} accessibilityRole="adjustable" accessibilityLabel="재생 위치">
        <View pointerEvents="none" style={{ height: drag != null ? 6 : 4, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' }}>
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(Math.min(1, loaded) * 100)}%`, backgroundColor: 'rgba(255,255,255,0.35)' }} />
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${frac * 100}%`, backgroundColor: '#FFFFFF' }} />
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', left: frac * w - (drag != null ? 9 : 7), width: drag != null ? 18 : 14, height: drag != null ? 18 : 14, borderRadius: 9, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3 }} />
      </View>
      {drag != null && <Text style={[styles.timeTxt, { position: 'absolute', bottom: 30, left: Math.max(0, Math.min(w - 52, frac * w - 26)), width: 52, textAlign: 'center' }]}>{mmss(drag)}</Text>}
    </View>
  );
}

function RoundBtn({ icon, lib = 'ion', size = 52, onPress, label, solid, iconSize, disabled, testID }: { icon: any; lib?: 'ion' | 'mci'; size?: number; onPress: () => void; label: string; solid?: boolean; iconSize?: number; disabled?: boolean; testID?: string }) {
  const I: any = lib === 'mci' ? MaterialCommunityIcons : Ionicons;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={6}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: solid ? 'rgba(255,255,255,0.96)' : 'rgba(18,18,22,0.58)', borderWidth: solid ? 0 : 1, borderColor: 'rgba(255,255,255,0.22)', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 }, pressed && { transform: [{ scale: 0.92 }] }, disabled && { opacity: 0.4 }]}>
      <I name={icon} size={iconSize ?? size * 0.46} color={solid ? '#111' : '#fff'} style={icon === 'play' ? { marginLeft: size * 0.06 } : undefined} />
    </Pressable>
  );
}

/** Full-screen dark player with custom controls. Rendered in the normal screen tree. */
function Player({ video, onClose, onPlaybackStatus }: { video: ReviewVideo; onClose: () => void; onPlaybackStatus?: (status: StageStatus) => void }) {
  const { width: W, height: H } = useWindowDimensions(); const insets = useSafeAreaInsets();
  const stage = useRef<StageHandle>(null);
  const [st, setSt] = useState<StageStatus>(EMPTY_STATUS); const [attempt, setAttempt] = useState(0);
  const [chrome, setChrome] = useState(true); const [full, setFull] = useState(false); const [scrubbing, setScrubbing] = useState(false);
  const started = useRef(false); if (st.playing || st.time > 0.5) started.current = true;
  const hide = useRef<any>(null);
  const poke = () => { setChrome(true); clearTimeout(hide.current); hide.current = setTimeout(() => setChrome(false), 2800); };
  useEffect(() => { if (st.playing && !scrubbing) poke(); else { clearTimeout(hide.current); setChrome(true); } return () => clearTimeout(hide.current); }, [st.playing, scrubbing]);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; clearTimeout(hide.current); }; }, []);
  const closePlayer = useCallback(() => {
    if (!active.current) return;
    // Pause only while the live ref still exists; unmount cleanup never calls a dead renderer.
    try { stage.current?.pause(); } catch {}
    active.current = false; clearTimeout(hide.current); onClose();
  }, [onClose]);
  const onStatus = useCallback((p: Partial<StageStatus>) => { if (active.current) setSt((s) => ({ ...s, ...p })); }, []);
  useEffect(() => { onPlaybackStatus?.(st); }, [st, onPlaybackStatus]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { if (full) setFull(false); else closePlayer(); return true; });
    return () => subscription.remove();
  }, [full, closePlayer]);
  const toggle = () => { if (!st.ready) return; if (st.playing) stage.current?.pause(); else { if (st.ended) stage.current?.seek(0); stage.current?.play(); } poke(); };
  const skip = (d: number) => { if (!st.ready) return; const t = Math.max(0, Math.min(st.duration || 0, st.time + d)); stage.current?.seek(t); setSt((s) => ({ ...s, time: t, ended: false })); poke(); };
  const retry = () => { started.current = false; setSt(EMPTY_STATUS); setAttempt((n) => n + 1); };
  // desktop keyboard: space / arrows / esc
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === ' ') { e.preventDefault(); toggle(); } else if (e.key === 'ArrowLeft') skip(-10); else if (e.key === 'ArrowRight') skip(10); else if (e.key === 'Escape') { if (full) setFull(false); else closePlayer(); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  const maxW = full ? W : Math.min(W - 40, 1040);
  const maxH = full ? H : H - insets.top - insets.bottom - (W >= 700 ? 250 : 300);
  const stageW = Math.max(240, Math.min(maxW, maxH * 16 / 9)); const stageH = stageW * 9 / 16;
  const showChrome = chrome || !st.playing || !!st.error;
  return (
    <View testID="review-video-player" style={[StyleSheet.absoluteFill, { backgroundColor: '#05060A' }]} accessibilityViewIsModal>
      <Text testID="review-video-playback-status" accessibilityLabel={st.error ? '영상 오류' : st.playing ? '재생 중' : st.ready ? '재생 준비 완료' : '영상 준비 중'} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>{st.error ? 'error' : st.playing ? 'playing' : st.ready ? 'ready' : 'loading'}</Text>
      <StatusBar hidden={full} style="light" />
      {!full && (
        <View style={[styles.pTop, { paddingTop: insets.top + 10, width: Math.min(W, stageW + 8) }]}>
          <VideoTile size={34} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600' }}>보강영상</Text>
            <Text numberOfLines={1} style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{video.title}</Text>
          </View>
          <RoundBtn testID="review-video-player-close" icon="close" size={44} label="닫기" onPress={closePlayer} iconSize={22} />
        </View>
      )}
      <View style={{ flex: full ? 1 : undefined, alignItems: 'center', justifyContent: 'center', marginTop: full ? 0 : 6 }}>
        <View style={{ width: stageW, height: stageH, borderRadius: full ? 0 : 18, overflow: 'hidden', backgroundColor: '#000' }}>
          {!st.error && <YouTubeStage key={attempt} ref={stage} videoId={video.videoId} onStatus={onStatus} />}
          {/* poster until playback starts, and over YouTube's end screen */}
          {(!started.current || st.ended) && !st.error && <Image source={{ uri: thumb(video.videoId) }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={st.ended ? 12 : 0} />}
          {/* touch layer: the player itself never receives touches */}
          <Pressable accessibilityLabel={st.playing ? '컨트롤 표시' : '재생'} onPress={() => { if (st.playing) { if (chrome) setChrome(false); else poke(); } else toggle(); }} style={StyleSheet.absoluteFill} />
          {showChrome && (
            <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              <LinearGradient pointerEvents="none" colors={st.playing ? ['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'] : ['rgba(0,0,0,0.94)', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0)']} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: st.playing ? 90 : 130 }} />
              <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 120 }} />
              {!st.playing && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: st.ended ? 'rgba(0,0,0,0.58)' : 'rgba(0,0,0,0.4)' }]} />}
              {full && (
                <View style={{ position: 'absolute', top: 12 + insets.top, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text numberOfLines={1} style={{ flex: 1, color: '#fff', fontSize: 16, fontWeight: '700' }}>{video.title}</Text>
                  <RoundBtn testID="review-video-player-close" icon="close" size={44} label="닫기" onPress={closePlayer} iconSize={22} />
                </View>
              )}
              <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: stageW < 420 ? 22 : 40 }]}>
                {st.error ? (
                  <View style={{ alignItems: 'center', gap: 12, paddingHorizontal: 24 }}>
                    <Ionicons name="alert-circle-outline" size={40} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' }}>{st.error}</Text>
                    <Pressable testID="review-video-player-retry" accessibilityRole="button" accessibilityLabel="영상 다시 시도" onPress={retry} style={({ pressed }) => [styles.pill, pressed && { opacity: 0.7 }]}><Ionicons name="refresh" size={16} color="#111" /><Text style={styles.pillText}>다시 시도</Text></Pressable>
                  </View>
                ) : !st.ready ? (
                  <View style={{ alignItems: 'center', gap: 10 }}><ActivityIndicator color="#fff" size="large" /><Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600' }}>영상을 준비하고 있어요</Text></View>
                ) : st.ended ? (
                  <Pressable onPress={toggle} style={({ pressed }) => [styles.pill, { paddingHorizontal: 20, height: 46 }, pressed && { opacity: 0.7 }]}><Ionicons name="reload" size={18} color="#111" /><Text style={[styles.pillText, { fontSize: 15 }]}>다시 보기</Text></Pressable>
                ) : (
                  <>
                    <RoundBtn icon="rewind-10" lib="mci" label="10초 뒤로" onPress={() => skip(-10)} size={stageW < 420 ? 46 : 56} />
                    <RoundBtn icon={st.playing ? 'pause' : 'play'} solid label={st.playing ? '일시정지' : '재생'} onPress={toggle} size={stageW < 420 ? 64 : 78} />
                    <RoundBtn icon="fast-forward-10" lib="mci" label="10초 앞으로" onPress={() => skip(10)} size={stageW < 420 ? 46 : 56} />
                  </>
                )}
              </View>
              {st.ready && !st.error && (
                <View style={[styles.pBar, full && { paddingBottom: 14 + insets.bottom }]}>
                  <Text style={styles.timeTxt}>{mmss(st.time)}</Text>
                  <Scrubber time={st.time} duration={st.duration} loaded={st.loaded} onScrub={(a) => { setScrubbing(a); if (a) setChrome(true); }} onSeek={(t) => { stage.current?.seek(t); setSt((s) => ({ ...s, time: t, ended: false })); poke(); }} />
                  <Text style={styles.timeTxt}>{mmss(st.duration)}</Text>
                  <Pressable accessibilityLabel={full ? '전체화면 끝내기' : '전체화면'} onPress={() => { setFull((f) => !f); poke(); }} hitSlop={8} style={({ pressed }) => [{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 }, pressed && { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
                    <MaterialCommunityIcons name={full ? 'fullscreen-exit' : 'fullscreen'} size={26} color="#fff" />
                  </Pressable>
                </View>
              )}
              {st.buffering && st.playing && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color="#fff" /></View>}
            </View>
          )}
        </View>
      </View>
      {!full && (
        <ScrollView style={{ alignSelf: 'center', width: stageW, marginTop: 18 }} contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 10 }}>
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: -0.3 }}>{video.title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {!!dayLabel(video.assignedAt) && <View style={styles.darkChip}><Ionicons name="calendar-outline" size={13} color="rgba(255,255,255,0.8)" /><Text style={styles.darkChipText}>{dayLabel(video.assignedAt)} 배정</Text></View>}
            <View style={styles.darkChip}><MaterialCommunityIcons name="book-open-page-variant" size={13} color="rgba(255,255,255,0.8)" /><Text style={styles.darkChipText}>연결된 지문 {video.passages.length}개</Text></View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            {video.passages.map((p) => <View key={p.id} style={styles.passage}><Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.92)', fontSize: 13, fontWeight: '600' }}>{p.title}</Text></View>)}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

export type ReviewVideosScreenProps = {
  onClose: () => void;
  loadVideos?: (credential: string | null) => Promise<{ videos: ReviewVideo[] }>;
  onPlaybackStatus?: (status: StageStatus) => void;
};
const defaultLoadVideos = (credential: string | null) => api.reviewVideos(credential);

/** JS errors are recoverable here; native SIGSEGVs cannot be caught by this boundary. */
class ReviewVideosBoundary extends React.Component<React.PropsWithChildren<{ onClose: () => void }>, { failed: boolean; generation: number }> {
  state = { failed: false, generation: 0 };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <View testID="review-videos-boundary-error" style={[styles.center, { backgroundColor: '#F2F2F7' }]}>
      <Text style={styles.emptyTitle}>영상을 표시하지 못했어요</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="다시 시도" onPress={() => this.setState((s) => ({ failed: false, generation: s.generation + 1 }))}><Text style={styles.emptyTitle}>다시 시도</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={this.props.onClose}><Text style={styles.emptySub}>닫기</Text></Pressable>
    </View>;
    return <React.Fragment key={this.state.generation}>{this.props.children}</React.Fragment>;
  }
}

export function ReviewVideosScreen(props: ReviewVideosScreenProps) {
  return <ReviewVideosBoundary onClose={props.onClose}><ReviewVideosContent {...props} /></ReviewVideosBoundary>;
}

function ReviewVideosContent({ onClose, loadVideos = defaultLoadVideos, onPlaybackStatus }: ReviewVideosScreenProps) {
  const { width: W } = useWindowDimensions(); const insets = useSafeAreaInsets();
  const cred = useSession((s) => s.adminCode); const who = useSession((s) => s.student?.id ?? s.role ?? '');
  const key = `${who}|${cred ?? ''}`;
  const canCache = loadVideos === defaultLoadVideos;
  const [videos, setVideos] = useState<ReviewVideo[] | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(''); const [playing, setPlaying] = useState<ReviewVideo | null>(null);
  const request = useRef(0); const mounted = useRef(false);
  const load = useCallback(async (force = false) => {
    const id = ++request.current;
    if (!force && canCache && cache?.key === key && Date.now() - cache.at < 3 * 60000) { setVideos(cache.videos); setLoading(false); setError(null); return; }
    setLoading(true); setError(null); setVideos(null);
    try {
      const result = await loadVideos(cred);
      if (!mounted.current || id !== request.current) return;
      const normalized = normalizeReviewVideos(result?.videos);
      if (canCache) cache = { key, at: Date.now(), videos: normalized };
      setVideos(normalized);
    } catch (e: unknown) {
      if (mounted.current && id === request.current) setError(e instanceof Error ? e.message : '목록을 불러오지 못했어요');
    } finally { if (mounted.current && id === request.current) setLoading(false); }
  }, [key, cred, loadVideos, canCache]);
  useEffect(() => {
    mounted.current = true; setQ(''); setPlaying(null); void load();
    return () => { mounted.current = false; ++request.current; };
  }, [load]);
  const close = () => { mounted.current = false; ++request.current; setPlaying(null); onClose(); };
  useEffect(() => {
    if (playing) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => subscription.remove();
  }, [playing, onClose]);
  const panelW = W;
  const cols = panelW >= 760 ? 3 : panelW >= 520 ? 2 : 1;
  const gap = 14, pad = 18; const cardW = (panelW - pad * 2 - gap * (cols - 1)) / cols;
  const list = useMemo(() => { const k = q.trim().toLowerCase(); if (!videos || !k) return videos ?? []; return videos.filter((v) => v.title.toLowerCase().includes(k) || v.passages.some((p) => p.title.toLowerCase().includes(k))); }, [videos, q]);
  return (
    <View testID="review-videos-screen" style={{ flex: 1, backgroundColor: '#F2F2F7' }} {...(Platform.OS === 'web' ? { onContextMenu: (e: any) => e.preventDefault() } : {})}>
        <View testID="review-videos-list" aria-hidden={!!playing} accessibilityElementsHidden={!!playing} importantForAccessibility={playing ? 'no-hide-descendants' : 'auto'} style={{ flex: 1, width: panelW, paddingTop: insets.top, paddingBottom: insets.bottom }}>
          <View style={[styles.header, { paddingHorizontal: pad }]}>
            <VideoTile />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.hTitle}>보강영상</Text>
              <Text numberOfLines={1} style={styles.hSub}>{videos == null ? '숙제 지문과 연결된 영상을 불러오는 중' : videos.length ? `숙제 지문과 연결된 영상 ${videos.length}개` : '숙제 지문과 연결된 영상'}</Text>
            </View>
            <Pressable testID="review-videos-list-close" accessibilityRole="button" accessibilityLabel="닫기" onPress={close} hitSlop={6} style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}><Ionicons name="close" size={22} color="#3A3A3C" /></Pressable>
          </View>
          {(videos?.length ?? 0) > 6 && (
            <View style={[styles.search, { marginHorizontal: pad }]}>
              <Ionicons name="search" size={16} color={SUB} />
              <TextInput value={q} onChangeText={setQ} placeholder="영상 제목이나 지문으로 찾기" placeholderTextColor={FAINT} style={{ flex: 1, fontSize: 15, color: INK, paddingVertical: 0 }} returnKeyType="search" />
              {!!q && <Pressable onPress={() => setQ('')} hitSlop={8}><Ionicons name="close-circle" size={17} color={FAINT} /></Pressable>}
            </View>
          )}
          <ScrollView contentContainerStyle={{ padding: pad, paddingTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap, flexGrow: 1 }}>
            {videos == null && loading && Array.from({ length: cols * 2 }).map((_, i) => (
              <View key={i} style={[styles.card, { width: cardW }]}><Shimmer style={{ height: (cardW - 20) * 9 / 16, borderRadius: 12 }} /><Shimmer style={{ height: 14, borderRadius: 7, marginTop: 12, width: '70%' }} /><Shimmer style={{ height: 11, borderRadius: 6, marginTop: 8, width: '45%' }} /></View>
            ))}
            {videos == null && !loading && error && (
              <View style={styles.center}>
                <Ionicons name="cloud-offline-outline" size={44} color={FAINT} />
                <Text style={styles.emptyTitle}>영상 목록을 불러오지 못했어요</Text>
                <Text style={styles.emptySub}>{error}</Text>
                <Pressable testID="review-videos-list-retry" accessibilityRole="button" accessibilityLabel="목록 다시 시도" onPress={() => void load(true)} style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]}><Ionicons name="refresh" size={16} color="#fff" /><Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>다시 시도</Text></Pressable>
              </View>
            )}
            {videos != null && videos.length === 0 && (
              <View style={styles.center}>
                <EmptyArt />
                <Text style={styles.emptyTitle}>아직 연결된 보강영상이 없어요</Text>
                <Text style={styles.emptySub}>선생님이 숙제 지문에 보강영상을 연결하면{'\n'}여기에서 바로 볼 수 있어요.</Text>
              </View>
            )}
            {videos != null && videos.length > 0 && list.length === 0 && (
              <View style={styles.center}><Ionicons name="search" size={36} color={FAINT} /><Text style={styles.emptyTitle}>'{q}'에 맞는 영상이 없어요</Text></View>
            )}
            {list.map((v) => <VideoCard key={v.id} v={v} width={cardW} onPress={() => setPlaying(v)} />)}
          </ScrollView>
        </View>
        {playing && <Player key={playing.id} video={playing} onClose={() => setPlaying(null)} onPlaybackStatus={onPlaybackStatus} />}
    </View>
  );
}

/** Compatibility only: ordinary view overlay, never a native Modal. Hidden means disposed. */
export function ReviewVideosSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  if (!visible) return null;
  return <View style={[StyleSheet.absoluteFill, { zIndex: 1000, elevation: 24 }]}><ReviewVideosScreen onClose={onClose} /></View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: '#F2F2F7', overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 24 },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: 'rgba(60,60,67,0.3)', marginTop: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 16, paddingBottom: 6 },
  hTitle: { fontSize: 22, fontWeight: '800', color: INK, letterSpacing: -0.4 },
  hSub: { fontSize: 13, color: SUB, marginTop: 1 },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(118,118,128,0.14)', alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, borderRadius: 12, backgroundColor: 'rgba(118,118,128,0.12)', paddingHorizontal: 12, marginTop: 8 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 10, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  thumb: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' },
  cardPlay: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.93)', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  newBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: '#FF3B30', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2 },
  newText: { color: '#fff', fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4 },
  chip: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { color: '#fff', fontSize: 11.5, fontWeight: '700' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: INK, letterSpacing: -0.2 },
  cardMeta: { fontSize: 13, color: SUB },
  cardDate: { fontSize: 12, color: FAINT },
  center: { flex: 1, width: '100%', minHeight: 300, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 30 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: INK, marginTop: 6 },
  emptySub: { fontSize: 14, color: SUB, textAlign: 'center', lineHeight: 20 },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: ACCENT, paddingHorizontal: 18, height: 40, borderRadius: 20, marginTop: 6 },
  pTop: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4, paddingBottom: 10 },
  pBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 8 },
  timeTxt: { color: '#fff', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.95)', paddingHorizontal: 16, height: 40, borderRadius: 20 },
  pillText: { color: '#111', fontWeight: '700', fontSize: 14 },
  darkChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  darkChipText: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5, fontWeight: '600' },
  passage: { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7, maxWidth: '100%' },
});
