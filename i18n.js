import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import tr from './locales/tr.json';

const resources = {
  en: { translation: en },
  tr: { translation: tr },
};

// Determine initial language from device settings; default to 'tr'.
const deviceLocale = Array.isArray(Localization.locales) && Localization.locales.length > 0
  ? (Localization.locales[0].languageCode || 'tr')
  : (Localization.locale?.split('-')[0] || 'tr');

i18n
  .use(initReactI18next)
  .init({
    compatibilityJSON: 'v4',
    resources,
    lng: deviceLocale === 'en' ? 'en' : 'tr',
    fallbackLng: 'tr',
    interpolation: { escapeValue: false },
  });

export default i18n;

