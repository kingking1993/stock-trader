import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';

export type Settings = {
  baseUrl: string;
  apiKey: string;
};

const DEFAULTS: Settings = {
  // 클라우드(Render) 백엔드 — 노트북 없이 어디서든 접속. 로컬 개발 시 설정에서 변경.
  baseUrl: 'https://stock-trader-fav6.onrender.com',
  apiKey: '', // 비밀번호 잠금: 첫 실행 시 사용자가 입력 → 저장
};

const KEY = 'stock-trader-settings';

type Ctx = {
  settings: Settings;
  loaded: boolean;
  unlocked: boolean; // 비밀번호 확인 완료 여부
  save: (s: Settings) => Promise<void>;
  setUnlocked: (v: boolean) => void;
};

const SettingsContext = createContext<Ctx>({
  settings: DEFAULTS,
  loaded: false,
  unlocked: false,
  save: async () => {},
  setUnlocked: () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) setSettings({ ...DEFAULTS, ...JSON.parse(raw) });
      })
      .finally(() => setLoaded(true));
  }, []);

  const save = async (s: Settings) => {
    setSettings(s);
    await AsyncStorage.setItem(KEY, JSON.stringify(s));
  };

  return (
    <SettingsContext.Provider value={{ settings, loaded, unlocked, save, setUnlocked }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
