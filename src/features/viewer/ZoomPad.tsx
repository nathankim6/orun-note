import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, PixelRatio } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from '@/theme';
import { PdfPage } from './PdfPage';
import { PageQualityContext } from './pageQuality';
import { createIdleQualityGate } from './idleQuality';
import { penSession } from './penSession';
import { zoomPadTile, zoomPadQualityKey } from './zoomPadQuality';
import { InkCanvas, InkOpts } from './InkCanvas';
import { ToolConfig } from './ink';
import { ImageBox, Stroke, TextBox } from '@/data/types';

/** Region of the page shown in the pad, in PDF page units. Height follows the pad's aspect ratio. */
export type PadRegion = { x: number; y: number; w: number };

/**
 * 간편 입력창 (Samsung Notes zoom pad): a magnified strip at the bottom of the screen.
 * Writing in it lands inside the blue frame on the page; reaching the right edge auto-advances the frame,
 * and the end of a line wraps to the next line.
 */
export function ZoomPad({ height, uri, pageW, pageH, sourceIndex, template, region, setRegion, strokes, textBoxes, images, onStrokes, onTextBoxes, onImages, cfg, opts, textFont, onClose, historyRef, onHistory }: {
  height: number; uri: string | null; pageW: number; pageH: number; sourceIndex: number; template?: any;
  region: PadRegion; setRegion: (r: PadRegion) => void;
  strokes: Stroke[]; textBoxes: TextBox[]; images: ImageBox[]; onStrokes: (s: Stroke[]) => void; onTextBoxes: (t: TextBox[]) => void; onImages: (i: ImageBox[]) => void;
  cfg: ToolConfig; opts: InkOpts; textFont: string; onClose: () => void;
  /** undo/redo of strokes written in the pad (the toolbar routes 되돌리기/다시하기 here while the pad is open) */ historyRef?: any; onHistory?: (h: { canUndo: boolean; canRedo: boolean }) => void;
}) {
  const { colors } = useTheme(); const [padW, setPadW] = useState(0);
  const innerH = height - 16; const k = padW > 0 ? padW / region.w : 1; const regionH = innerH / k;
  const margin = pageW * 0.05;
  // Reading image shows immediately; full/tile detail unlocks only after 800 ms idle, and never while the pen is writing.
  const qualityKey = zoomPadQualityKey({ uri, sourceIndex, region, padW, height, pageW, pageH });
  const [quality, setQuality] = useState({ key: '', ready: false });
  // Reject a stale ready=true synchronously, before child effects can submit a changed tile.
  const detailReady = quality.key === qualityKey && quality.ready;
  useEffect(() => {
    const gate = createIdleQualityGate({ onReady: ready => setQuality({ key: qualityKey, ready }), isBusy: () => { const ps = penSession.value; return ps.writing && Date.now() - ps.since < 20000; } });
    gate.activity(); return () => gate.dispose();
  }, [qualityKey]);
  const dpr = PixelRatio.get();
  const tile = useMemo(() => zoomPadTile({ pageW, pageH, k, padW, padH: innerH, region, dpr }), [pageW, pageH, k, padW, innerH, region.x, region.y, region.w, dpr]);
  const move = (dx: number, dy: number) => setRegion({ ...region, x: Math.max(0, Math.min(pageW - region.w, region.x + dx)), y: Math.max(0, Math.min(pageH - regionH, region.y + dy)) });
  const nextLine = () => setRegion({ ...region, x: margin, y: Math.min(pageH - regionH, region.y + regionH * 0.92) });
  const resize = (f: number) => { const w = Math.max(pageW * 0.15, Math.min(pageW * 0.9, region.w * f)); setRegion({ ...region, w, x: Math.min(region.x, pageW - w) }); };
  // auto-advance: a stroke ending in the right 20 % moves the frame right; past the line end, wrap to the next line
  const handleStrokes = (next: Stroke[]) => {
    onStrokes(next);
    if (next.length <= strokes.length) return; const last = next[next.length - 1]; const maxX = Math.max(...last.points.map((p) => p.x));
    if (maxX > region.x + region.w * 0.8) { if (region.x + region.w >= pageW - 2) nextLine(); else move(region.w * 0.55, 0); }
  };
  return (
    <View style={[styles.wrap, { height }]}>
      <View style={styles.pad} onLayout={(e) => setPadW(e.nativeEvent.layout.width)}>
        {padW > 0 && (
          <View style={{ position: 'absolute', left: -region.x * k, top: -region.y * k, width: pageW * k, height: pageH * k }}>
            <PageQualityContext.Provider value={detailReady}>
              <PdfPage uri={uri} index={sourceIndex} width={pageW * k} height={pageH * k} template={template} tile={tile} />
            </PageQualityContext.Provider>
            <InkCanvas width={pageW * k} height={pageH * k} s={k} strokes={strokes} textBoxes={textBoxes} images={images} onImages={onImages} textFont={textFont} opts={opts}
              cfg={cfg} enabled fingerDraw={false} lineSnap onStrokes={handleStrokes} onTextBoxes={onTextBoxes} historyRef={historyRef} onHistory={onHistory} />
          </View>
        )}
        <View pointerEvents="none" style={[styles.advance, { width: padW * 0.2 }]} />
      </View>
      <View style={styles.controls}>
        <Row2>
          <Ctl icon="chevron-back" label="왼쪽" onPress={() => move(-region.w * 0.55, 0)} />
          <Ctl icon="chevron-forward" label="오른쪽" onPress={() => move(region.w * 0.55, 0)} />
        </Row2>
        <Row2>
          <Ctl icon="chevron-up" label="위" onPress={() => move(0, -regionH * 0.5)} />
          <Ctl icon="chevron-down" label="아래" onPress={() => move(0, regionH * 0.5)} />
        </Row2>
        <Row2>
          <Ctl mci="keyboard-return" label="줄 바꿈" onPress={nextLine} />
          <Ctl icon="close" label="간편 입력창 닫기" onPress={onClose} />
        </Row2>
        <Row2>
          <Ctl icon="remove" label="입력창 배율 낮추기" onPress={() => resize(1.25)} />
          <Ctl icon="add" label="입력창 배율 높이기" onPress={() => resize(0.8)} />
        </Row2>
        <Text style={{ fontSize: 9, color: colors.textMuted, textAlign: 'center' }}>간편 입력창</Text>
      </View>
    </View>
  );
}
const Row2 = ({ children }: { children: React.ReactNode }) => <View style={{ flexDirection: 'row', gap: 4 }}>{children}</View>;
function Ctl({ icon, mci, label, onPress }: { icon?: any; mci?: any; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.ctl, pressed && { backgroundColor: colors.primarySoft }]}>{mci ? <MaterialCommunityIcons name={mci} size={17} color={colors.text} /> : <Ionicons name={icon} size={17} color={colors.text} />}</Pressable>;
}

/** The movable blue frame drawn on the page showing what the pad edits. Drag the tab to move it (finger or pen). */
export function PadFrame({ region, regionH, s, pageW, pageH, setRegion }: { region: PadRegion; regionH: number; s: number; pageW: number; pageH: number; setRegion: (r: PadRegion) => void }) {
  const start = React.useRef(region);
  const drag = Gesture.Pan().runOnJS(true).minDistance(1)
    .onStart(() => { start.current = region; })
    .onUpdate((e) => setRegion({ ...start.current, x: Math.max(0, Math.min(pageW - start.current.w, start.current.x + e.translationX / s)), y: Math.max(0, Math.min(pageH - regionH, start.current.y + e.translationY / s)) }));
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: region.x * s, top: region.y * s, width: region.w * s, height: regionH * s }}>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderWidth: 2, borderColor: '#2F6FED', backgroundColor: 'rgba(47,111,237,0.06)', borderRadius: 3 }} />
      <GestureDetector gesture={drag}>
        <View style={{ position: 'absolute', left: -2, top: -22, height: 22, paddingHorizontal: 8, borderTopLeftRadius: 6, borderTopRightRadius: 6, backgroundColor: '#2F6FED', flexDirection: 'row', alignItems: 'center', gap: 4 }} collapsable={false}>
          <MaterialCommunityIcons name="drag" size={14} color="#fff" /><Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>간편 입력창</Text>
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.98)', borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)', padding: 8, gap: 8 },
  pad: { flex: 1, overflow: 'hidden', backgroundColor: '#fff', borderRadius: 12, borderWidth: 2, borderColor: '#2F6FED' },
  advance: { position: 'absolute', right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(47,111,237,0.07)', borderLeftWidth: 1, borderLeftColor: 'rgba(47,111,237,0.35)', borderStyle: 'dashed' },
  controls: { width: 84, justifyContent: 'center', alignItems: 'center', gap: 4 },
  ctl: { width: 38, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.04)' },
});
