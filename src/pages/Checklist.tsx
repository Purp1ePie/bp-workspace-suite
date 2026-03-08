import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useI18n } from '@/lib/i18n';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { CheckSquare } from 'lucide-react';
import { format } from 'date-fns';
import type { Tables } from '@/integrations/supabase/types';

type ChecklistItem = Tables<'checklist_items'>;

export default function Checklist() {
  const { t } = useI18n();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('checklist_items').select('*').order('due_at', { ascending: true });
      setItems(data || []);
      setLoading(false);
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const open = items.filter(i => i.status !== 'done');
  const done = items.filter(i => i.status === 'done');

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
              <span className="text-sm font-bold font-heading text-primary">{done.length}/{items.length}</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${items.length > 0 ? (done.length / items.length) * 100 : 0}%` }} />
            </div>
          </div>

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
                    </div>
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
                    <p className="text-sm line-through flex-1">{item.title}</p>
                    {item.due_at && (
                      <span className="text-xs text-muted-foreground shrink-0">{format(new Date(item.due_at), 'dd.MM.yyyy')}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
