import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/lib/i18n';
import { BidPilotLogo } from '@/components/BidPilotLogo';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

export default function Auth() {
  const { user, loading, signIn, signUp } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();
  const [isLogin, setIsLogin] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [roleName, setRoleName] = useState('');

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    if (isLogin) {
      const { error } = await signIn(email, password);
      if (error) {
        toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
      }
    } else {
      const { error, needsConfirmation } = await signUp(email, password, {
        full_name: fullName,
        organization_name: orgName,
        role_name: roleName,
      });
      if (error) {
        toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
      } else if (needsConfirmation) {
        toast({ title: t('common.success'), description: t('auth.checkEmail') });
      }
    }
    setSubmitting(false);
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center px-16 surface-2 relative">
        <div className="absolute top-6 left-6">
          <LanguageSwitcher />
        </div>
        <div className="max-w-md">
          <h1 className="text-4xl font-bold font-heading tracking-tight mb-4">
            <span className="text-gradient">BidPilot</span>
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            {t('auth.subtitle')}
          </p>
          <div className="mt-12 space-y-4">
            {['SIMAP', 'RFQ', 'AI-Workspace'].map((tag) => (
              <div key={tag} className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-primary" />
                <span className="text-sm text-muted-foreground">{tag}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="lg:hidden mb-8">
          <LanguageSwitcher />
        </div>
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold font-heading">{t('auth.welcome')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isLogin ? t('auth.login') : t('auth.signup')}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="fullName">{t('auth.fullName')}</Label>
                  <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="orgName">{t('auth.orgName')}</Label>
                  <Input id="orgName" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="roleName">{t('auth.roleName')}</Label>
                  <Input id="roleName" value={roleName} onChange={(e) => setRoleName(e.target.value)} />
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting
                ? (isLogin ? t('auth.signingIn') : t('auth.signingUp'))
                : (isLogin ? t('auth.login') : t('auth.signup'))}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            {isLogin ? t('auth.noAccount') : t('auth.hasAccount')}{' '}
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-primary hover:underline font-medium"
            >
              {isLogin ? t('auth.signup') : t('auth.login')}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
