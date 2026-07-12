import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';

export type Settings = {
  baseUrl: string;
  apiKey: string;
};

const DEFAULTS: Settings = {
  baseUrl: 'http://192.168.0.31:8000',
  apiKey: 'dev-key',
};

const KEY = 'stock-trader-settings';

type Ctx = {
  settings: Settings;
  loaded: boolean;
  save: (s: Settings) => Promise<void>;
};

const SettingsContext = createContext<Ctx>({
  settings: DEFAULTS,
  loaded: false,
  save: async () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

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
    <SettingsContext.Provider value={{ settings, loaded, save }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
