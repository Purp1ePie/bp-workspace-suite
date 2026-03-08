import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useI18n } from '@/lib/i18n';
import { BidPilotLogo } from '@/components/BidPilotLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Building2, Loader2 } from 'lucide-react';

const SIZE_OPTIONS = ['1-10', '11-50', '51-200', '201-500', '500+'];

export default function Onboarding() {
  const { t } = useI18n();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [sizeLabel, setSizeLabel] = useState('');
  const [defaultLanguage, setDefaultLanguage] = useState('de');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const { data, error } = await supabase.rpc('create_organization_for_current_user', {
        _name: name,
        _industry: industry || undefined,
        _size_label: sizeLabel || undefined,
        _default_language: defaultLanguage,
      });

      if (error) throw error;

      toast({ title: t('common.success') });
      // Force a full reload so profile/org context refreshes
      window.location.href = '/';
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8 animate-fade-in">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <div className="rounded-xl bg-primary/10 p-4">
              <Building2 className="h-8 w-8 text-primary" />
            </div>
          </div>
          <BidPilotLogo className="text-2xl" />
          <h1 className="text-xl font-bold font-heading mt-4">{t('onboarding.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('onboarding.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="glass-card p-6 space-y-5">
          <div className="space-y-2">
            <Label>{t('onboarding.name')}</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              required
              placeholder={t('onboarding.namePlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('onboarding.industry')}</Label>
            <Input
              value={industry}
              onChange={e => setIndustry(e.target.value)}
              placeholder={t('onboarding.industryPlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('onboarding.size')}</Label>
            <div className="flex flex-wrap gap-2">
              {SIZE_OPTIONS.map(size => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setSizeLabel(size)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                    sizeLabel === size
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('onboarding.language')}</Label>
            <select
              value={defaultLanguage}
              onChange={e => setDefaultLanguage(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="de">Deutsch</option>
              <option value="en">English</option>
              <option value="fr">Français</option>
              <option value="it">Italiano</option>
            </select>
          </div>

          <Button type="submit" className="w-full h-11" disabled={submitting}>
            {submitting ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t('onboarding.creating')}</>
            ) : (
              t('onboarding.create')
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
