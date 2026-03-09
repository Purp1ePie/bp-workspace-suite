import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/lib/i18n';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { CheckSquare, Filter, UserCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import type { Tables } from '@/integrations/supabase/types';

type ChecklistItem = Tables<'checklist_items'>;
type Profile = Tables<'profiles'>;
type Tender = Tables<'tenders'>;

type ChecklistFilter = 'all' | 'mine' | 'unassigned';

export default function Checklist() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ChecklistFilter>('all');

  useEffect(() => {
    const load = async () => {
      const [itemsRes, tendersRes] = await Promise.all([
        supabase.from('checklist_items').select('*').order('due_at', { ascending: true }),
        supabase.from('tenders').select('id, title'),
      ]);
      setItems(itemsRes.data || []);
      setTenders(tendersRes.data || []);

      // Load org members
      if (user) {
        const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
        if (profile?.organization_id) {
          const { data: m } = await supabase.from('profiles').select('*').eq('organization_id', profile.organization_id);
          setMembers(m || []);
        }
      }
      setLoading(false);
    };
    load();
  }, [user]);

  const getMemberName = (profileId: string | null) => {
    if (!profileId) return null;
    return members.find(m => m.id === profileId)?.full_name || null;
  };

  const getTenderTitle = (tenderId: string) => {
    return tenders.find(t => t.id === tenderId)?.title || tenderId.slice(0, 8);
  };

  const filtered = items.filter(i => {
    if (filter === 'mine') return i.owner_profile_id === user?.id;
    if (filter === 'unassigned') return !i.owner_profile_id;
    return true;
  });

  const open = filtered.filter(i => i.status !== 'done');
  const done = filtered.filter(i => i.status === 'done');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold font-heading">{t('checklist.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('checklist.subtitle')}</p>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={CheckSquare} title={t('checklist.noItems')} />
      ) : (
        <div className="space-y-6">
          {/* Progress */}
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">{t('workspace.readiness')}</span>
              <span className="text-sm font-bold font-heading text-primary">{done.length}/{filtered.length}</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${filtered.length > 0 ? (done.length / filtered.length) * 100 : 0}%` }} />
            </div>
          </div>

          {/* Filter bar */}
          {members.length > 1 && (
            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              {(['all', 'mine', 'unassigned'] as ChecklistFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    filter === f
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {t(`workspace.filter.${f}` as any)}
                </button>
              ))}
            </div>
          )}

          {/* Open */}
          {open.length > 0 && (
            <div className="glass-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-muted/30">
                <h2 className="text-sm font-semibold font-heading">{t('workspace.missingItems')} ({open.length})</h2>
              </div>
              <div className="divide-y divide-border">
                {open.map(item => (
                  <div key={item.id} className="px-5 py-3 flex items-center gap-3">
                    <div className="h-4 w-4 rounded border-2 border-border shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{item.title}</p>
                      <Link to={`/tenders/${item.tender_id}`} className="text-xs text-muted-foreground hover:text-primary transition-colors">
                        {getTenderTitle(item.tender_id)}
                      </Link>
                    </div>
                    {item.owner_profile_id ? (
                      <div className="h-6 w-6 rounded-full bg-primary/15 flex items-center justify-center shrink-0" title={getMemberName(item.owner_profile_id) || ''}>
                        <span className="text-[10px] font-medium text-primary">
                          {(getMemberName(item.owner_profile_id) || '?').charAt(0).toUpperCase()}
                        </span>
                      </div>
                    ) : (
                      <UserCircle2 className="h-5 w-5 text-muted-foreground/40 shrink-0" />
                    )}
                    <StatusBadge status={item.status} />
                    {item.due_at && (
                      <span className="text-xs text-muted-foreground shrink-0">{format(new Date(item.due_at), 'dd.MM.yyyy')}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Done */}
          {done.length > 0 && (
            <div className="glass-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-muted/30">
                <h2 className="text-sm font-semibold font-heading">{t('workspace.completedItems')} ({done.length})</h2>
              </div>
              <div className="divide-y divide-border">
                {done.map(item => (
                  <div key={item.id} className="px-5 py-3 flex items-center gap-3 opacity-60">
                    <div className="h-4 w-4 rounded border-2 bg-success border-success shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm line-through">{item.title}</p>
                      <Link to={`/tenders/${item.tender_id}`} className="text-xs text-muted-foreground hover:text-primary transition-colors">
                        {getTenderTitle(item.tender_id)}
                      </Link>
                    </div>
                    {item.owner_profile_id && (
                      <div className="h-6 w-6 rounded-full bg-primary/15 flex items-center justify-center shrink-0" title={getMemberName(item.owner_profile_id) || ''}>
                        <span className="text-[10px] font-medium text-primary">
                          {(getMemberName(item.owner_profile_id) || '?').charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                    {item.due_at && (
                      <span className="text-xs text-muted-foreground shrink-0">{format(new Date(item.due_at), 'dd.MM.yyyy')}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {filtered.length === 0 && items.length > 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {t('workspace.noFilterResults')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
