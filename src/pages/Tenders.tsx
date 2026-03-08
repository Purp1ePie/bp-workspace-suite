import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useI18n } from '@/lib/i18n';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { FolderPlus, ArrowRight, Search, Folders } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import type { Tables } from '@/integrations/supabase/types';

type Tender = Tables<'tenders'>;

export default function Tenders() {
  const { t } = useI18n();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('tenders').select('*').order('created_at', { ascending: false });
      setTenders(data || []);
      setLoading(false);
    };
    load();
  }, []);

  const filtered = tenders.filter(t =>
    !search || t.title.toLowerCase().includes(search.toLowerCase()) ||
    (t.issuer || '').toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold font-heading">{t('tender.allTenders')}</h1>
        <Link to="/tenders/new">
          <Button size="sm">
            <FolderPlus className="h-4 w-4 mr-1.5" />
            {t('tender.new')}
          </Button>
        </Link>
      </div>

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('memory.search')} className="pl-10" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Folders}
          title={search ? t('common.empty') : t('tender.noTenders')}
          description={!search ? t('dashboard.createFirst') : undefined}
          action={!search ? (
            <Link to="/tenders/new"><Button size="sm" variant="outline">{t('tender.new')}</Button></Link>
          ) : undefined}
        />
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('tender.title')}</th>
                <th className="px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">{t('tender.issuer')}</th>
                <th className="px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">{t('tender.type')}</th>
                <th className="px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('tender.status')}</th>
                <th className="px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">{t('tender.deadline')}</th>
                <th className="px-5 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(tender => (
                <tr key={tender.id} className="hover:bg-accent/30 transition-colors">
                  <td className="px-5 py-3">
                    <Link to={`/tenders/${tender.id}`} className="text-sm font-medium hover:text-primary transition-colors">
                      {tender.title}
                    </Link>
                  </td>
                  <td className="px-5 py-3 hidden sm:table-cell">
                    <span className="text-sm text-muted-foreground">{tender.issuer || '—'}</span>
                  </td>
                  <td className="px-5 py-3 hidden md:table-cell">
                    <span className="text-xs capitalize px-2 py-0.5 rounded bg-muted text-muted-foreground">{tender.tender_type}</span>
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={tender.status} />
                  </td>
                  <td className="px-5 py-3 hidden lg:table-cell">
                    <span className="text-xs text-muted-foreground">
                      {tender.deadline ? format(new Date(tender.deadline), 'dd.MM.yyyy') : '—'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <Link to={`/tenders/${tender.id}`}>
                      <ArrowRight className="h-4 w-4 text-muted-foreground hover:text-primary transition-colors" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
