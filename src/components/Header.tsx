import React from 'react';
import { View, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { IconButton, Muted, Row, T } from './ui';
export function PageHeader({ title, right, back, subtitle, logo }: { title: string; right?: React.ReactNode; back?: boolean; subtitle?: string; logo?: boolean }) {
  const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  return (
    <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8, backgroundColor: 'transparent' }}>
      <Row justify="space-between">
        <Row>{logo && <Image source={require('../../assets/orun-mark.png')} style={{ width: 44, height: 44, borderRadius: 12, marginRight: 4 }} />}{back && <IconButton icon="chevron-back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))} />}<View><T variant="h2">{title}</T>{subtitle && <Muted variant="caption">{subtitle}</Muted>}</View></Row>
        <Row gap={2}>{right}</Row>
      </Row>
    </View>
  );
}
