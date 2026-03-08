import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [orgCheck, setOrgCheck] = useState<'loading' | 'has_org' | 'no_org'>('loading');

  useEffect(() => {
    if (!user) {
      setOrgCheck('loading');
      return;
    }
    supabase.rpc('current_organization_id').then(({ data }) => {
      setOrgCheck(data ? 'has_org' : 'no_org');
    });
  }, [user]);

  if (loading || (user && orgCheck === 'loading')) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;
  if (orgCheck === 'no_org') return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}
