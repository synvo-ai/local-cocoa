import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n/config';
import { Check } from 'lucide-react';

// Language flags mapping using emoji flags
const LANGUAGE_FLAGS: Record<SupportedLanguage, string> = {
    en: '🇺🇸',
    zh: '🇨🇳',
    ja: '🇯🇵',
    ko: '🇰🇷',
    fr: '🇫🇷',
    de: '🇩🇪',
    es: '🇪🇸',
    ru: '🇷🇺'
};

export function LanguageSwitcher() {
    const { i18n } = useTranslation();

    // Normalize language code (e.g., 'en-US' -> 'en')
    const normalizeLanguage = (lang: string): SupportedLanguage => {
        const base = lang.split('-')[0].toLowerCase();
        return (base in SUPPORTED_LANGUAGES ? base : 'en') as SupportedLanguage;
    };

    const currentLanguage = normalizeLanguage(i18n.language);

    const changeLanguage = (lng: SupportedLanguage) => {
        i18n.changeLanguage(lng);
    };

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '0.75rem' }}>
            {(Object.entries(SUPPORTED_LANGUAGES) as [SupportedLanguage, string][]).map(([code, name]) => (
                <button
                    key={code}
                    onClick={() => changeLanguage(code)}
                    className={`relative flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2.5 transition-all hover:shadow-sm ${
                        currentLanguage === code
                            ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                            : 'bg-card hover:bg-accent/50'
                    }`}
                >
                    {currentLanguage === code && (
                        <Check className="absolute top-1.5 right-1.5 h-3 w-3 text-primary" />
                    )}
                    <span className="text-xl" role="img" aria-label={name}>
                        {LANGUAGE_FLAGS[code]}
                    </span>
                    <span className={`text-[11px] font-medium ${
                        currentLanguage === code ? 'text-primary' : 'text-muted-foreground'
                    }`}>
                        {name}
                    </span>
                </button>
            ))}
        </div>
    );
}

