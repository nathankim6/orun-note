import 'react-native-gesture-handler';
import React, { useState } from 'react';
import { registerRootComponent } from 'expo';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ReviewVideosScreen } from '../src/features/viewer/ReviewVideos';
import type { StageStatus } from '../src/features/viewer/YouTubeStage';
import { useContentProtection } from '../src/lib/security';
import { loadVideos } from './fixtures/videos';
import { pdfSmoke } from './pdf-smoke';
import { marker, telemetry, subscribe } from './telemetry';

let reportJS = () => {};
const errorUtils = (globalThis as any).ErrorUtils;
const previous = errorUtils?.getGlobalHandler?.();
errorUtils?.setGlobalHandler?.((error: unknown, fatal: boolean) => {
  marker('js_error', { fatal: !!fatal }); reportJS(); previous?.(error, fatal);
});
class Boundary extends React.Component<{children: React.ReactNode}, {failed: boolean}> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { marker('js_error', { fatal: true }); }
  render() { return this.state.failed ? <Text>qa-js-error</Text> : this.props.children; }
}
function QA() {
  const { hidden } = useContentProtection();
  const [open, setOpen] = useState(false), [cycle, setCycle] = useState(0);
  const [flags, setFlags] = useState('qa-boot'), [jsError, setJSError] = useState(false);
  const [, refresh] = useState(0);
  React.useEffect(() => subscribe(() => refresh(n => n + 1)), []);
  const [pdf, setPDF] = useState('idle');
  const observed = React.useRef(new Set<string>());
  reportJS = () => setJSError(true);
  const status = React.useCallback((s: StageStatus) => {
    const events = [s.ready && 'ready', s.playing && 'playing', s.ready && !s.playing && observed.current.has('playing') && 'paused', !!s.error && 'unavailable'].filter(Boolean) as string[];
    for (const event of events) if (!observed.current.has(event)) {
      observed.current.add(event); marker('player_' + event, { cycle });
    }
    setFlags([...observed.current].map(v => `qa-${v}-${cycle}`).join(' ') + ` qa-state-${s.playing ? 'playing' : s.ready ? 'paused' : 'loading'}-${cycle}`);
  }, [cycle]);
  return <SafeAreaView style={{ flex: 1 }}>
    {open ? <ReviewVideosScreen loadVideos={loadVideos} onPlaybackStatus={status} onClose={() => { setOpen(false); marker('list_close', { cycle }); }} /> :
      <View style={{ flex: 1, padding: 24, gap: 24 }}>
        <Text>Native simulator QA. Synthetic data only.</Text>
        <Pressable accessibilityRole="button" testID="open-review-videos" accessibilityLabel="open-review-videos" onPress={() => {
          observed.current.clear(); setFlags('qa-loading'); setCycle(cycle + 1); setOpen(true); marker('list_open', { cycle: cycle + 1 });
        }}><Text>Open review videos</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="run-pdf-smoke" testID="run-pdf-smoke" disabled={pdf !== 'idle'} onPress={async () => {
          setPDF('running'); try { setPDF(await pdfSmoke()); } catch { marker('pdf_result', { result: 'fail' }); setPDF('fail'); }
        }}><Text>Run synthetic PDF pipeline</Text></Pressable>
      </View>}
    <View pointerEvents="none" style={styles.status}>
      <Text accessibilityLabel={jsError ? 'qa-js-error' : flags}>{jsError ? 'qa-js-error' : flags}</Text>
      <Text testID="qa-telemetry" accessibilityLabel={telemetry()} style={{ height: 2, fontSize: 1 }}>QA telemetry</Text>
      <Text accessibilityLabel={`qa-pdf-${pdf}`}>{`qa-pdf-${pdf}`}</Text>
    </View>
    {hidden && <View style={[StyleSheet.absoluteFill, { backgroundColor: "#000", zIndex: 20000 }]} />}
  </SafeAreaView>;
}
function Root() { return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><Boundary><QA /></Boundary></SafeAreaProvider></GestureHandlerRootView>; }
marker('boot');
registerRootComponent(Root);
const styles = StyleSheet.create({ status: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10000, backgroundColor: '#fff', padding: 2 } });
