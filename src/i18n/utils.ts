import { ui, defaultLang } from './ui';

export function getLangFromUrl(url: URL) {
  const [, lang] = url.pathname.split('/');
  if (lang in ui) return lang as keyof typeof ui;
  return defaultLang;
}

export function useTranslations(lang: keyof typeof ui) {
  return function t(key: keyof typeof ui[typeof defaultLang]) {
    return ui[lang][key] || ui[defaultLang][key];
  }
}

export function getAlternateLangPath(currentPath: string, targetLang: string) {
  const fiToEn: Record<string, string> = {
    'galleria': 'gallery',
    'aikakone': 'time-machine',
    'tunnistamatta': 'identify',
    'yhteystiedot': 'yhteystiedot',
    'tietosuojaseloste': 'privacy-policy',
  };
  const enToFi: Record<string, string> = Object.fromEntries(
    Object.entries(fiToEn).map(([k, v]) => [v, k])
  );
  const translations = targetLang === 'en' ? fiToEn : enToFi;
  const segments = currentPath.split('/').filter(Boolean);
  if (segments.length === 0) return `/${targetLang}`;
  const currentLang = segments[0];
  if (currentLang in ui) {
    segments[0] = targetLang;
  } else {
    segments.unshift(targetLang);
  }
  for (let i = 1; i < segments.length; i++) {
    if (translations[segments[i]]) {
      segments[i] = translations[segments[i]];
    }
  }
  return '/' + segments.join('/');
}
