import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useI18n } from '@/lib/i18n';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { FolderPlus, Clock, Upload, BarChart3, ArrowRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import type { Tables } from '@/integrations/supabase/types';

type Tender = Tables<'tenders'>;
type TenderDocument = Tables<'tender_documents'>;
type Deadline = Tables<'deadlines'>;

export default function Dashboard() {
  const { t, language } = useI18n();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [deadlines, setDeadlines] = useState<(Deadline & { tender_title?: string })[]>([]);
  const [recentDocs, setRecentDocs] = useState<(TenderDocument & { tender_title?: string })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [tendersRes, deadlinesRes, docsRes] = await Promise.all([
        supabase.from('tenders').select('*').order('created_at', { ascending: false }).limit(20),
        supabase.from('deadlines').select('*').order('due_at', { ascending: true }).limit(5),
        supabase.from('tender_documents').select('*').order('created_at', { ascending: false }).limit(5),
      ]);

      const tendersList = tendersRes.data || [];
      setTenders(tendersList);

      const tenderMap = new Map(tendersList.map(t => [t.id, t.title]));

      setDeadlines((deadlinesRes.data || []).map(d => ({
        ...d,
        tender_title: tenderMap.get(d.tender_id) || '',
      })));

      setRecentDocs((docsRes.data || []).map(d => ({
        ...d,
        tender_title: tenderMap.get(d.tender_id) || '',
      })));

      setLoading(false);
    };
    load();
  }, []);

  const activeTenders = tenders.filter(t => ['new', 'in_progress'].includes(t.status));
  const dateFnsLocale = language === 'de' ? de : enUS;

  const statusCounts = tenders.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-heading">{t('dashboard.title')}</h1>
        <Link to="/tenders/new">
          <Button size="sm">
            <FolderPlus className="h-4 w-4 mr-1.5" />
            {t('tender.new')}
          </Button>
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.entries(statusCounts).map(([status, count]) => (
          <div key={status} className="glass-card p-4">
            <div className="flex items-center justify-between mb-1">
              <StatusBadge status={status} />
              <span className="text-2xl font-bold font-heading">{count}</span>
            </div>
          </div>
        ))}
        {Object.keys(statusCounts).length === 0 && (
          <div className="glass-card p-4 col-span-full">
            <p className="text-sm text-muted-foreground">{t('dashboard.bidStatus')}: {t('common.empty')}</p>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Active Tenders */}
        <div className="glass-card">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h2 className="font-semibold font-heading text-sm">{t('dashboard.activeTenders')}</h2>
          </div>
          {activeTenders.length === 0 ? (
            <EmptyState
              icon={FolderPlus}
              title={t('dashboard.noTenders')}
              description={t('dashboard.createFirst')}
              action={
                <Link to="/tenders/new">
                  <Button size="sm" variant="outline">{t('tender.new')}</Button>
                </Link>
              }
            />
          ) : (
            <div className="divide-y divide-border">
              {activeTenders.slice(0, 5).map((tender) => (
                <Link
                  key={tender.id}
                  to={`/tenders/${tender.id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-accent/50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{tender.title}</p>
                    <p className="text-xs text-muted-foreground">{tender.issuer || '—'}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={tender.status} />
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming Deadlines */}
        <div className="glass-card">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Clock className="h-4 w-4 text-warning" />
            <h2 className="font-semibold font-heading text-sm">{t('dashboard.upcomingDeadlines')}</h2>
          </div>
          {deadlines.length === 0 ? (
            <EmptyState icon={Clock} title={t('dashboard.noDeadlines')} />
          ) : (
            <div className="divide-y divide-border">
              {deadlines.map((dl) => (
                <div key={dl.id} className="px-5 py-3">
                  <p className="text-sm font-medium">{dl.deadline_type}</p>
                  <p className="text-xs text-muted-foreground">{dl.tender_title}</p>
                  <p className="text-xs text-warning mt-0.5">
                    {formatDistanceToNow(new Date(dl.due_at), { addSuffix: true, locale: dateFnsLocale })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Uploads */}
        <div className="glass-card lg:col-span-2">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Upload className="h-4 w-4 text-info" />
            <h2 className="font-semibold font-heading text-sm">{t('dashboard.recentUploads')}</h2>
          </div>
          {recentDocs.length === 0 ? (
            <EmptyState icon={Upload} title={t('dashboard.noUploads')} />
          ) : (
            <div className="divide-y divide-border">
              {recentDocs.map((doc) => (
                <div key={doc.id} className="px-5 py-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{doc.file_name}</p>
                    <p className="text-xs text-muted-foreground">{doc.tender_title}</p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatDistanceToNow(new Date(doc.created_at), { addSuffix: true, locale: dateFnsLocale })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
