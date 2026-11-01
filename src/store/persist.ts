import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage, persist, PersistOptions } from 'zustand/middleware';
export const storage = createJSONStorage(() => AsyncStorage);
export function persistOpts<T>(name: string, partialize?: (s: T) => Partial<T>): PersistOptions<T, Partial<T>> {
  return { name: `paperly:${name}`, storage: storage as any, partialize: partialize ?? ((s) => s as Partial<T>) } as PersistOptions<T, Partial<T>>;
}
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const nowIso = () => new Date().toISOString();
