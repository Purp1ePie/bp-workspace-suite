import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/lib/i18n';
import { EmptyState } from '@/components/EmptyState';
import { Progress } from '@/components/ui/progress';
import {
  Users, Crown, CheckSquare, Folders, Settings, Loader2,
  ChevronDown, ChevronRight, CheckCircle2, Circle, BarChart3,
} from 'lucide-react';
import { format } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import type { Tables } from '@/integrations/supabase/types';

type Profile = Tables<'profiles'>;
type ChecklistItem = Tables<'checklist_items'>;

interface TenderInfo {
  id: string;
  title: string;
  status: string;
  deadline: string | null;
}

type TeamFilter = 'all' | 'admins';

export default function Team() {
  const { t, language } = useI18n();
  const { user } = useAuth();
  const dateFnsLocale = language === 'de' ? de : enUS;

  const [members, setMembers] = useState<Profile[]>([]);
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [tenders, setTenders] = useState<TenderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TeamFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      if (!profile?.organization_id) {
        setLoading(false);
        return;
      }

      const orgId = profile.organization_id;

      const [membersRes, itemsRes, tendersRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('organization_id', orgId).order('full_name'),
        supabase.from('checklist_items').select('*').eq('organization_id', orgId),
        supabase.from('tenders').select('id, title, status, deadline').eq('organization_id', orgId).order('created_at', { ascending: false }),
      ]);

      setMembers(membersRes.data || []);
      setChecklistItems(itemsRes.data || []);
      setTenders(tendersRes.data || []);
      setLoading(false);
    };

    load();
  }, [user]);

  // Compute per-member stats
  const memberStats = useMemo(() => {
    const stats: Record<string, {
      open: number;
      done: number;
      tenderIds: Set<string>;
      tasks: ChecklistItem[];
    }> = {};

    for (const m of members) {
      stats[m.id] = { open: 0, done: 0, tenderIds: new Set(), tasks: [] };
    }

    for (const item of checklistItems) {
      if (item.owner_profile_id && stats[item.owner_profile_id]) {
        const s = stats[item.owner_profile_id];
        s.tasks.push(item);
        if (item.status === 'done') s.done++;
        else s.open++;
        if (item.tender_id) s.tenderIds.add(item.tender_id);
      }
    }

    return stats;
  }, [members, checklistItems]);

  // Overall stats
  const overallStats = useMemo(() => {
    const activeTenders = tenders.filter(t => t.status !== 'draft' && t.status !== 'archived').length;
    const totalTasks = checklistItems.length;
    const doneTasks = checklistItems.filter(i => i.status === 'done').length;
    const completionRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

    return { activeTenders, totalTasks, completionRate };
  }, [tenders, checklistItems]);

  // Tender lookup
  const tenderMap = useMemo(() => {
    const map: Record<string, TenderInfo> = {};
    for (const t of tenders) map[t.id] = t;
    return map;
  }, [tenders]);

  // Filter
  const filteredMembers = useMemo(() => {
    if (filter === 'admins') return members.filter(m => m.is_admin);
    return members;
  }, [members, filter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-heading">{t('team.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('team.subtitle')}</p>
        </div>
        <Link
          to="/settings"
          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
        >
          <Settings className="h-3.5 w-3.5" />
          {t('team.manageTeam')}
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="glass-card px-4 py-3.5 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2"><Users className="h-4 w-4 text-primary" /></div>
          <div>
            <p className="text-xs text-muted-foreground">{t('team.totalMembers')}</p>
            <p className="text-lg font-bold font-heading">{members.length}</p>
          </div>
        </div>
        <div className="glass-card px-4 py-3.5 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2"><Folders className="h-4 w-4 text-primary" /></div>
          <div>
            <p className="text-xs text-muted-foreground">{t('team.activeTenders')}</p>
            <p className="text-lg font-bold font-heading">{overallStats.activeTenders}</p>
          </div>
        </div>
        <div className="glass-card px-4 py-3.5 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2"><CheckSquare className="h-4 w-4 text-primary" /></div>
          <div>
            <p className="text-xs text-muted-foreground">{t('team.totalTasks')}</p>
            <p className="text-lg font-bold font-heading">{overallStats.totalTasks}</p>
          </div>
        </div>
        <div className="glass-card px-4 py-3.5 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2"><BarChart3 className="h-4 w-4 text-primary" /></div>
          <div>
            <p className="text-xs text-muted-foreground">{t('team.completionRate')}</p>
            <p className="text-lg font-bold font-heading">{overallStats.completionRate}%</p>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 mb-5">
        {(['all', 'admins'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
              filter === f
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted'
            }`}
          >
            {t(`team.filter${f.charAt(0).toUpperCase() + f.slice(1)}` as any)}
            {f === 'admins' && ` (${members.filter(m => m.is_admin).length})`}
          </button>
        ))}
      </div>

      {/* Member cards */}
      {filteredMembers.length === 0 ? (
        <EmptyState icon={Users} title={t('team.noMembers')} />
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredMembers.map(member => {
            const stats = memberStats[member.id] || { open: 0, done: 0, tenderIds: new Set(), tasks: [] };
            const totalTasks = stats.open + stats.done;
            const completionPct = totalTasks > 0 ? Math.round((stats.done / totalTasks) * 100) : 0;
            const isExpanded = expandedId === member.id;

            return (
              <div key={member.id} className="glass-card overflow-hidden hover:border-primary/20 transition-colors">
                {/* Member header */}
                <div className="p-4 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                    <span className="text-sm font-semibold text-primary">
                      {(member.full_name || '?').charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold truncate">
                        {member.full_name || 'Unnamed'}
                      </span>
                      {member.is_admin && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning font-medium">
                          <Crown className="h-3 w-3" /> Admin
                        </span>
                      )}
                      {member.id === user?.id && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                          You
                        </span>
                      )}
                    </div>
                    {member.role_name && (
                      <p className="text-xs text-muted-foreground truncate">{member.role_name}</p>
                    )}
                  </div>
                </div>

                {/* Stats row */}
                <div className="px-4 pb-2 flex items-center gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Circle className="h-3 w-3" />
                    <span className="font-medium text-foreground">{stats.open}</span>
                    {t('team.tasksOpen')}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    <span className="font-medium text-foreground">{stats.done}</span>
                    {t('team.tasksDone')}
                  </div>
                  <div className="flex items-center gap-1.5 ml-auto">
                    <Folders className="h-3 w-3" />
                    <span className="font-medium text-foreground">{stats.tenderIds.size}</span>
                    {t('team.tenders')}
                  </div>
                </div>

                {/* Completion bar */}
                <div className="px-4 pb-3">
                  <Progress value={completionPct} className="h-1.5" />
                </div>

                {/* Expand toggle */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : member.id)}
                  className="w-full border-t border-border px-4 py-2 flex items-center gap-2 text-xs text-muted-foreground hover:bg-muted/30 transition-colors"
                >
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  {t('team.viewTasks')} ({totalTasks})
                </button>

                {/* Expanded task list */}
                {isExpanded && (
                  <div className="border-t border-border/50 divide-y divide-border/50 max-h-60 overflow-y-auto">
                    {stats.tasks.length === 0 ? (
                      <div className="px-4 py-4 text-xs text-muted-foreground text-center">
                        {t('team.noTasks')}
                      </div>
                    ) : (
                      stats.tasks
                        .sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0))
                        .map(task => (
                          <div key={task.id} className="px-4 py-2 flex items-center gap-2">
                            {task.status === 'done' ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                            ) : (
                              <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            )}
                            <span className={`text-xs flex-1 truncate ${task.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>
                              {task.title}
                            </span>
                            {task.tender_id && tenderMap[task.tender_id] && (
                              <Link
                                to={`/tenders/${task.tender_id}`}
                                className="text-[10px] text-primary hover:underline shrink-0 truncate max-w-[120px]"
                              >
                                {tenderMap[task.tender_id].title}
                              </Link>
                            )}
                            {task.due_at && (
                              <span className="text-[10px] text-muted-foreground shrink-0">
                                {format(new Date(task.due_at), 'dd MMM', { locale: dateFnsLocale })}
                              </span>
                            )}
                          </div>
                        ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
