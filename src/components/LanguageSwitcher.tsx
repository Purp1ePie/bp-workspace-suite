import { useI18n, Language } from '@/lib/i18n';
import { Globe } from 'lucide-react';

export function LanguageSwitcher() {
  const { language, setLanguage } = useI18n();

  const toggle = () => {
    setLanguage(language === 'de' ? 'en' : 'de');
  };

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
    >
      <Globe className="h-3.5 w-3.5" />
      <span className="uppercase">{language}</span>
    </button>
  );
}
