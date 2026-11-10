import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { ReviewVideosScreen } from '@/features/viewer/ReviewVideos';

export default function ReviewVideosRoute() {
  const router = useRouter();
  const close = useCallback(() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }, [router]);
  return <ReviewVideosScreen onClose={close} />;
}
