import type { ReviewVideo } from '../../src/lib/api';
export const videos: ReviewVideo[] = Array.from({ length: 4 }, (_, i) => ({
  id: `qa-video-${i + 1}`, title: `QA Video ${i + 1}`, videoId: 'aqz-KE-bpKQ',
  assignedAt: '2026-01-01T00:00:00.000Z',
  passages: [{ id: `qa-passage-${i + 1}`, title: `Synthetic passage ${i + 1}` }],
}));
export const loadVideos = async (_credential: string | null) => ({ videos });
