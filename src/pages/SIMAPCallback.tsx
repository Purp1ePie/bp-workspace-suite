import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { callEdgeFunction } from '@/lib/edgeFunctions';
import { getSIMAPCallbackData, clearSIMAPSession } from '@/lib/simapOAuth';
import { useI18n } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

export default function SIMAPCallback() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { toast } = useToast();
  const [status, setStatus] = useState<'exchanging' | 'success' | 'error'>('exchanging');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const exchange = async () => {
      const { code, state, error, code_verifier, stored_state, redirect_uri } =
        getSIMAPCallbackData();

      // Handle error from SIMAP
      if (error) {
        setStatus('error');
        setErrorMsg(error);
        clearSIMAPSession();
        setTimeout(() => navigate('/discover'), 3000);
        return;
      }

      // Validate state
      if (!state || !stored_state || state !== stored_state) {
        setStatus('error');
        setErrorMsg('OAuth state mismatch — possible CSRF attack');
        clearSIMAPSession();
        setTimeout(() => navigate('/discover'), 3000);
        return;
      }

      // Validate code and verifier
      if (!code || !code_verifier) {
        setStatus('error');
        setErrorMsg('Missing authorization code or PKCE verifier');
        clearSIMAPSession();
        setTimeout(() => navigate('/discover'), 3000);
        return;
      }

      try {
        await callEdgeFunction('simap-auth', {
          action: 'exchange',
          code,
          code_verifier,
          redirect_uri,
        });

        setStatus('success');
        clearSIMAPSession();

        toast({
          title: t('simap.callbackSuccess'),
          description: t('simap.callbackSuccessDesc'),
        });

        setTimeout(() => navigate('/discover'), 1500);
      } catch (err: any) {
        setStatus('error');
        setErrorMsg(err.message || 'Token exchange failed');
        clearSIMAPSession();

        toast({
          title: t('simap.callbackError'),
          description: err.message,
          variant: 'destructive',
        });

        setTimeout(() => navigate('/discover'), 3000);
      }
    };

    exchange();
  }, []);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="glass-card p-8 text-center max-w-md">
        {status === 'exchanging' && (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-1">SIMAP Verbindung</h2>
            <p className="text-sm text-muted-foreground">
              {t('simap.connecting')}
            </p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 className="h-10 w-10 text-success mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-1">{t('simap.callbackSuccess')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('simap.callbackSuccessDesc')}
            </p>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="h-10 w-10 text-destructive mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-1">{t('simap.callbackError')}</h2>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
          </>
        )}
      </div>
    </div>
  );
}
