import { useI18n } from '@/lib/i18n';
import { EmptyState } from '@/components/EmptyState';
import { Settings as SettingsIcon } from 'lucide-react';

export default function Settings() {
  const { t } = useI18n();

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold font-heading">{t('settings.title')}</h1>
      </div>

      <div className="glass-card">
        <EmptyState
          icon={SettingsIcon}
          title={t('settings.comingSoon')}
          description={t('settings.profile') + ' & ' + t('settings.organization')}
        />
      </div>
    </div>
  );
}
