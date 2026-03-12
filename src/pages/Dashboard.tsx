import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { callEdgeFunction } from '@/lib/edgeFunctions';
import {
  FolderPlus, Clock, Upload, BarChart3, ArrowRight,
  Folders, CalendarClock, FileText, CheckSquare,
  Gauge, Target, Users, TrendingUp, ChevronDown, ChevronUp,
  Compass, RefreshCw, ExternalLink, Building2, MapPin, Loader2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow, format } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import type { Tables } from '@/integrations/supabase/types';

type Tender = Tables<'tenders'>;
type TenderDocument = Tables<'tender_documents'>;
type Deadline = Tables<'deadlines'>;
type ChecklistItem = Tables<'checklist_items'>;

interface MemberSlim {
  id: string;
  full_name: string | null;
  role_name: string | null;
}

export default function Dashboard() {
  const { t, language } = useI18n();
  const { user } = useAuth();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [deadlines, setDeadlines] = useState<(Deadline & { tender_title?: string })[]>([]);
  const [recentDocs, setRecentDocs] = useState<(TenderDocument & { tender_title?: string })[]>([]);
  const [openChecklistItems, setOpenChecklistItems] = useState<ChecklistItem[]>([]);
  const [allChecklistItems, setAllChecklistItems] = useState<ChecklistItem[]>([]);
  const [members, setMembers] = useState<MemberSlim[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [deadlinesExpanded, setDeadlinesExpanded] = useState(false);
  // SIMAP ticker state
  const [simapResults, setSimapResults] = useState<any[]>([]);
  const [simapLoading, setSimapLoading] = useState(false);
  const [simapKeywords, setSimapKeywords] = useState<string[]>([]);
  const [importingSimapId, setImportingSimapId] = useState<string | null>(null);
  const [simapRefreshCounter, setSimapRefreshCounter] = useState(0);
  const navigate = useNavigate();
  const { toast } = useToast();

  // Status change handler for pipeline
  const handleStatusChange = async (tenderId: string, newStatus: string) => {
    const { error } = await supabase
      .from('tenders')
      .update({ status: newStatus })
      .eq('id', tenderId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setTenders(prev => prev.map(t => t.id === tenderId ? { ...t, status: newStatus } : t));
      toast({ title: t('dashboard.statusChanged') });
    }
  };

  useEffect(() => {
    const load = async () => {
      if (!user) { setLoading(false); return; }

      // Get current user's org
      const { data: profile } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();
      const orgId = profile?.organization_id;

      const [tendersRes, deadlinesRes, docsRes, openCheckRes, allCheckRes, membersRes] = await Promise.all([
        supabase.from('tenders').select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('deadlines').select('*').order('due_at', { ascending: true }).limit(20),
        supabase.from('tender_documents').select('*').order('created_at', { ascending: false }).limit(5),
        supabase.from('checklist_items').select('*').eq('status', 'open').order('due_at', { ascending: true }).limit(8),
        supabase.from('checklist_items').select('*').order('created_at', { ascending: true }).limit(500),
        orgId
          ? supabase.from('profiles').select('id, full_name, role_name').eq('organization_id', orgId).order('full_name')
          : Promise.resolve({ data: [] as MemberSlim[] }),
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

      setOpenChecklistItems(openCheckRes.data || []);
      setAllChecklistItems(allCheckRes.data || []);
      setMembers((membersRes.data as MemberSlim[]) || []);
      setLoading(false);
    };
    load();
  }, [user]);

  // SIMAP ticker — separate effect, non-blocking
  useEffect(() => {
    const loadSimapRecommendations = async () => {
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();
      if (!profile?.organization_id) return;

      const { data: org } = await supabase
        .from('organizations')
        .select('simap_keywords')
        .eq('id', profile.organization_id)
        .single();

      const keywords: string[] = org?.simap_keywords || [];
      setSimapKeywords(keywords);
      if (keywords.length === 0) return;

      // Check localStorage cache
      const cacheKey = `bidpilot-simap-ticker-${profile.organization_id}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          const age = Date.now() - parsed.timestamp;
          if (age < 30 * 60 * 1000 && JSON.stringify(parsed.keywords) === JSON.stringify(keywords)) {
            setSimapResults(parsed.results);
            return;
          }
        } catch { /* ignore bad cache */ }
      }

      setSimapLoading(true);
      try {
        const allResults: any[] = [];
        const seenIds = new Set<string>();

        for (const kw of keywords.slice(0, 3)) {
          try {
            const result = await callEdgeFunction('search-simap', { query: kw });
            for (const r of (result.results || [])) {
              if (!seenIds.has(r.project_id)) {
                seenIds.add(r.project_id);
                allResults.push(r);
              }
            }
          } catch (err) {
            console.warn(`SIMAP search failed for "${kw}":`, err);
          }
        }

        // Sort by publication_date DESC, limit to 8
        allResults.sort((a, b) => {
          const da = a.publication_date ? new Date(a.publication_date).getTime() : 0;
          const db = b.publication_date ? new Date(b.publication_date).getTime() : 0;
          return db - da;
        });
        const limited = allResults.slice(0, 8);
        setSimapResults(limited);

        localStorage.setItem(cacheKey, JSON.stringify({
          results: limited,
          keywords,
          timestamp: Date.now(),
        }));
      } catch (err) {
        console.warn('SIMAP ticker load failed:', err);
      } finally {
        setSimapLoading(false);
      }
    };

    loadSimapRecommendations();
  }, [user, simapRefreshCounter]);

  const handleSimapImport = async (item: any) => {
    setImportingSimapId(item.project_id);
    try {
      const { data: orgData } = await supabase.rpc('current_organization_id');
      if (!orgData) throw new Error('No organization found');

      let richData: any = null;
      try {
        const fetchResult = await callEdgeFunction('fetch-simap', {
          simap_project_id: item.project_id,
          simap_url: item.simap_url,
          publication_id: item.publication_id,
        });
        richData = fetchResult.data;
      } catch { /* fall back to search result data */ }

      const { data: tender, error } = await supabase
        .from('tenders')
        .insert({
          title: richData?.title || item.title || `SIMAP ${item.project_id}`,
          issuer: richData?.issuer || item.issuer || null,
          description: richData?.description || item.description || null,
          source_type: 'simap',
          tender_type: 'public',
          status: 'ready_for_review',
          language: richData?.language || item.language || 'de',
          deadline: (richData?.deadline || item.deadline)
            ? new Date(richData?.deadline || item.deadline).toISOString()
            : null,
          organization_id: orgData,
          simap_url: item.simap_url,
          simap_project_id: item.project_id,
          contact_info: richData?.contact_info || null,
          canton: richData?.canton || null,
          cpv_codes: richData?.cpv_codes || [],
          publication_number: richData?.publication_number || null,
          process_type: richData?.process_type || null,
        })
        .select()
        .single();

      if (error) throw error;
      toast({ title: t('discover.imported'), description: t('discover.importedDescription') });
      navigate(`/tenders/${tender.id}`);
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    } finally {
      setImportingSimapId(null);
    }
  };

  const handleRefreshSimap = () => {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('bidpilot-simap-ticker-'));
    keys.forEach(k => localStorage.removeItem(k));
    setSimapRefreshCounter(c => c + 1);
  };

  const activeTenders = tenders.filter(t => ['new', 'in_progress'].includes(t.status));
  const dateFnsLocale = language === 'de' ? de : enUS;
  const DEADLINES_COLLAPSED_COUNT = 5;
  const visibleDeadlines = deadlinesExpanded ? deadlines : deadlines.slice(0, DEADLINES_COLLAPSED_COUNT);

  // Pipeline stages with target status for moving tenders
  const pipelineStages = useMemo(() => {
    const stages = [
      { key: 'draft', statuses: ['new', 'draft'], targetStatus: 'new', label: t('dashboard.stageDraft'), color: 'bg-muted', borderColor: 'border-muted-foreground/20' },
      { key: 'in_progress', statuses: ['in_progress', 'analyzing'], targetStatus: 'in_progress', label: t('dashboard.stageInProgress'), color: 'bg-warning/15', borderColor: 'border-warning/30' },
      { key: 'review', statuses: ['review', 'in_review', 'ready_for_review'], targetStatus: 'ready_for_review', label: t('dashboard.stageReview'), color: 'bg-primary/15', borderColor: 'border-primary/30' },
      { key: 'submitted', statuses: ['submitted'], targetStatus: 'submitted', label: t('dashboard.stageSubmitted'), color: 'bg-info/15', borderColor: 'border-info/30' },
      { key: 'won', statuses: ['won'], targetStatus: 'won', label: t('status.won'), color: 'bg-success/15', borderColor: 'border-success/30' },
      { key: 'lost', statuses: ['lost'], targetStatus: 'lost', label: t('status.lost'), color: 'bg-destructive/15', borderColor: 'border-destructive/30' },
    ];
    return stages.map(stage => ({
      ...stage,
      count: tenders.filter(t => stage.statuses.includes(t.status)).length,
      tenders: tenders.filter(t => stage.statuses.includes(t.status)),
    }));
  }, [tenders, t]);

  // Win/Loss
  const wonTenders = tenders.filter(t => t.status === 'won');
  const lostTenders = tenders.filter(t => t.status === 'lost');
  const winRate = (wonTenders.length + lostTenders.length) > 0
    ? Math.round((wonTenders.length / (wonTenders.length + lostTenders.length)) * 100)
    : null;
  const avgFitWon = wonTenders.length > 0
    ? Math.round(wonTenders.filter(t => t.fit_score != null).reduce((sum, t) => sum + (t.fit_score ?? 0), 0) / (wonTenders.filter(t => t.fit_score != null).length || 1))
    : null;
  const avgFitLost = lostTenders.length > 0
    ? Math.round(lostTenders.filter(t => t.fit_score != null).reduce((sum, t) => sum + (t.fit_score ?? 0), 0) / (lostTenders.filter(t => t.fit_score != null).length || 1))
    : null;

  // Team workload
  const teamWorkload = useMemo(() => {
    const openItems = allChecklistItems.filter(c => c.status !== 'done');
    return members.map(m => ({
      id: m.id,
      name: m.full_name || '—',
      role: m.role_name,
      openTasks: openItems.filter(c => c.owner_profile_id === m.id).length,
      doneTasks: allChecklistItems.filter(c => c.owner_profile_id === m.id && c.status === 'done').length,
    })).sort((a, b) => b.openTasks - a.openTasks);
  }, [members, allChecklistItems]);

  // Enhanced KPIs
  const activeTendersForKpi = tenders.filter(t => ['new', 'in_progress', 'analyzing', 'draft', 'review', 'ready_for_review'].includes(t.status));
  const tendersWithFit = activeTendersForKpi.filter(t => t.fit_score != null);
  const avgFitScore = tendersWithFit.length > 0
    ? Math.round(tendersWithFit.reduce((sum, t) => sum + (t.fit_score ?? 0), 0) / tendersWithFit.length)
    : null;
  const now = new Date();
  const overdueDeadlines = deadlines.filter(d => new Date(d.due_at) < now).length;
  const dueThisWeek = deadlines.filter(d => {
    const due = new Date(d.due_at);
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return due >= now && due <= weekFromNow;
  }).length;
  const bidDecisionsMade = tenders.filter(t => t.bid_decision).length;
  const bidDecisionsPending = activeTendersForKpi.filter(t => !t.bid_decision && t.fit_score != null).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const statCards: Array<{ label: string; value: string | number; icon: any; color: string; detail?: string }> = [
    { label: t('dashboard.totalTenders'), value: tenders.length, icon: Folders, color: 'text-primary' },
    { label: t('dashboard.avgFitScore'), value: avgFitScore != null ? `${avgFitScore}%` : '—', icon: Gauge, color: 'text-primary' },
    { label: t('dashboard.deadlineUrgency'), value: overdueDeadlines, icon: CalendarClock, color: overdueDeadlines > 0 ? 'text-destructive' : 'text-warning',
      detail: dueThisWeek > 0 ? `${dueThisWeek} ${t('dashboard.dueThisWeek')}` : undefined },
    { label: t('dashboard.bidDecisions'), value: `${bidDecisionsMade}/${bidDecisionsMade + bidDecisionsPending}`, icon: Target, color: 'text-info' },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-heading">{t('dashboard.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('dashboard.welcome')}</p>
        </div>
        <Link to="/tenders/new">
          <Button size="sm">
            <FolderPlus className="h-4 w-4 mr-1.5" />
            {t('tender.new')}
          </Button>
        </Link>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <div key={stat.label} className="glass-card p-4">
            <div className="flex items-center justify-between">
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
              <span className="text-2xl font-bold font-heading">{stat.value}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">{stat.label}</p>
            {stat.detail && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{stat.detail}</p>}
          </div>
        ))}
      </div>

      {/* Interactive Pipeline View */}
      {tenders.length > 0 && (
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h2 className="font-semibold font-heading text-sm">{t('dashboard.pipeline')}</h2>
          </div>
          <div className="flex items-stretch gap-0">
            {pipelineStages.map((stage, i) => (
              <div key={stage.key} className="contents">
                <button
                  onClick={() => setExpandedStage(expandedStage === stage.key ? null : stage.key)}
                  className={`flex-1 text-center p-3 rounded-lg ${stage.color} border transition-all ${
                    expandedStage === stage.key ? stage.borderColor + ' ring-1 ring-primary/30' : 'border-border/30 hover:border-border/60'
                  }`}
                >
                  <p className="text-xl font-bold font-heading">{stage.count}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{stage.label}</p>
                  {stage.count > 0 && (
                    expandedStage === stage.key
                      ? <ChevronUp className="h-3 w-3 text-muted-foreground/50 mx-auto mt-1" />
                      : <ChevronDown className="h-3 w-3 text-muted-foreground/50 mx-auto mt-1" />
                  )}
                </button>
                {i < pipelineStages.length - 1 && (
                  <div className="flex items-center px-1">
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Expanded stage: show tenders with status change */}
          {expandedStage && (() => {
            const stage = pipelineStages.find(s => s.key === expandedStage);
            if (!stage || stage.tenders.length === 0) return null;
            return (
              <div className="mt-4 border-t border-border pt-4 space-y-2">
                {stage.tenders.map(tender => (
                  <div key={tender.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent/30 transition-colors">
                    <Link to={`/tenders/${tender.id}`} className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate hover:text-primary transition-colors">{tender.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{tender.issuer || '—'}</p>
                    </Link>
                    {tender.fit_score != null && (
                      <span className="text-xs font-medium text-primary shrink-0">{tender.fit_score}%</span>
                    )}
                    {/* Status change dropdown */}
                    <select
                      value={tender.status}
                      onChange={(e) => handleStatusChange(tender.id, e.target.value)}
                      className="text-xs bg-muted border border-border rounded-md px-2 py-1 text-foreground shrink-0 cursor-pointer hover:bg-accent transition-colors"
                    >
                      <option value="new">{t('dashboard.stageDraft')}</option>
                      <option value="in_progress">{t('dashboard.stageInProgress')}</option>
                      <option value="ready_for_review">{t('dashboard.stageReview')}</option>
                      <option value="submitted">{t('dashboard.stageSubmitted')}</option>
                      <option value="won">{t('status.won')}</option>
                      <option value="lost">{t('status.lost')}</option>
                    </select>
                    <Link to={`/tenders/${tender.id}`} className="shrink-0">
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground hover:text-primary transition-colors" />
                    </Link>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* Win/Loss & Team Workload row */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Win/Loss Tracking */}
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-success" />
            <h2 className="font-semibold font-heading text-sm">{t('dashboard.winLoss')}</h2>
          </div>
          {(wonTenders.length + lostTenders.length) === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">{t('dashboard.noWinLossData')}</p>
          ) : (
            <div className="space-y-4">
              {/* Win rate gauge */}
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-success font-medium">{wonTenders.length} {t('status.won')}</span>
                    <span className="text-destructive font-medium">{lostTenders.length} {t('status.lost')}</span>
                  </div>
                  <div className="h-3 rounded-full bg-destructive/20 overflow-hidden">
                    <div
                      className="h-full bg-success rounded-full transition-all"
                      style={{ width: `${winRate}%` }}
                    />
                  </div>
                </div>
                <span className="text-2xl font-bold font-heading text-success">{winRate}%</span>
              </div>
              {/* Avg fit scores comparison */}
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-3 rounded-lg bg-success/5 border border-success/20">
                  <p className="text-lg font-bold font-heading text-success">{avgFitWon ?? '—'}%</p>
                  <p className="text-[10px] text-muted-foreground">{t('dashboard.avgFitWon')}</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                  <p className="text-lg font-bold font-heading text-destructive">{avgFitLost ?? '—'}%</p>
                  <p className="text-[10px] text-muted-foreground">{t('dashboard.avgFitLost')}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Team Workload */}
        <div className="glass-card">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h2 className="font-semibold font-heading text-sm">{t('dashboard.teamWorkload')}</h2>
            </div>
            <Link to="/team" className="text-xs text-primary hover:underline">{t('dashboard.viewAll')}</Link>
          </div>
          {teamWorkload.length === 0 ? (
            <EmptyState icon={Users} title={t('dashboard.noTeamData')} />
          ) : (
            <div className="divide-y divide-border">
              {teamWorkload.slice(0, 5).map((member) => (
                <div key={member.id} className="px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{member.name}</p>
                      {member.role && <p className="text-[10px] text-muted-foreground">{member.role}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <span className="text-xs text-warning font-medium">{member.openTasks} {t('team.tasksOpen')}</span>
                    <span className="text-xs text-success font-medium">{member.doneTasks} {t('team.tasksDone')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* SIMAP Recommended Tenders */}
      {simapKeywords.length > 0 && (
        <div className="glass-card">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Compass className="h-4 w-4 text-primary shrink-0" />
              <h2 className="font-semibold font-heading text-sm">{t('dashboard.recommendedTenders')}</h2>
              <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                ({simapKeywords.join(', ')})
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleRefreshSimap}
                disabled={simapLoading}
                className="text-muted-foreground hover:text-primary transition-colors p-1"
                title={t('dashboard.refreshSimap')}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${simapLoading ? 'animate-spin' : ''}`} />
              </button>
              <Link to="/discover" className="text-xs text-primary hover:underline">{t('dashboard.viewAll')}</Link>
            </div>
          </div>
          {simapLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : simapResults.length === 0 ? (
            <EmptyState
              icon={Compass}
              title={t('dashboard.noSimapResults')}
              description={t('dashboard.noSimapResultsHint')}
            />
          ) : (
            <div className="divide-y divide-border">
              {simapResults.map(item => (
                <div key={item.project_id} className="px-5 py-3 hover:bg-accent/30 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-medium truncate">{item.title}</h3>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {item.issuer && (
                          <div className="flex items-center gap-1">
                            <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="text-xs text-muted-foreground truncate max-w-[200px]">{item.issuer}</span>
                          </div>
                        )}
                        {item.canton && (
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="text-xs text-muted-foreground">{item.canton}</span>
                          </div>
                        )}
                        {item.deadline && (
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-primary shrink-0" />
                            <span className="text-xs text-primary font-medium">
                              {format(new Date(item.deadline), 'dd.MM.yyyy')}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={item.simap_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-primary transition-colors p-1"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSimapImport(item)}
                        disabled={importingSimapId === item.project_id}
                      >
                        {importingSimapId === item.project_id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <FolderPlus className="h-3.5 w-3.5 mr-1" />
                        )}
                        {t('discover.import')}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Active Tenders */}
        <div className="glass-card">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Folders className="h-4 w-4 text-primary" />
              <h2 className="font-semibold font-heading text-sm">{t('dashboard.activeTenders')}</h2>
            </div>
            <Link to="/tenders" className="text-xs text-primary hover:underline">{t('dashboard.viewAll')}</Link>
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
              {activeTenders.slice(0, 6).map((tender) => (
                <Link
                  key={tender.id}
                  to={`/tenders/${tender.id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-accent/30 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{tender.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{tender.issuer || '—'}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {tender.fit_score != null && (
                      <span className="text-xs font-medium text-primary">{tender.fit_score}%</span>
                    )}
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
            <>
              <div className="divide-y divide-border">
                {visibleDeadlines.map((dl) => (
                  <div key={dl.id} className="px-5 py-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">{dl.deadline_type}</p>
                      <span className={`text-xs font-medium ${new Date(dl.due_at) < now ? 'text-destructive' : 'text-warning'}`}>
                        {formatDistanceToNow(new Date(dl.due_at), { addSuffix: true, locale: dateFnsLocale })}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{dl.tender_title}</p>
                  </div>
                ))}
              </div>
              {deadlines.length > DEADLINES_COLLAPSED_COUNT && (
                <button
                  onClick={() => setDeadlinesExpanded(!deadlinesExpanded)}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs text-primary hover:bg-accent/30 transition-colors border-t border-border"
                >
                  {deadlinesExpanded ? (
                    <>
                      <ChevronUp className="h-3.5 w-3.5" />
                      {t('dashboard.showLessDeadlines')}
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3.5 w-3.5" />
                      {t('dashboard.showAllDeadlines').replace('{count}', String(deadlines.length))}
                    </>
                  )}
                </button>
              )}
            </>
          )}
        </div>

        {/* Open Checklist Items */}
        <div className="glass-card">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-destructive" />
              <h2 className="font-semibold font-heading text-sm">{t('dashboard.openChecklist')}</h2>
            </div>
            <Link to="/checklist" className="text-xs text-primary hover:underline">{t('dashboard.viewAll')}</Link>
          </div>
          {openChecklistItems.length === 0 ? (
            <EmptyState icon={CheckSquare} title={t('dashboard.noChecklist')} />
          ) : (
            <div className="divide-y divide-border">
              {openChecklistItems.slice(0, 5).map((item) => (
                <div key={item.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="h-4 w-4 rounded border border-border shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{item.title}</p>
                    {item.due_at && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {format(new Date(item.due_at), 'dd.MM.yyyy')}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Uploads */}
        <div className="glass-card">
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
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <p className="text-sm font-medium truncate">{doc.file_name}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 ml-5.5">{doc.tender_title}</p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 ml-3">
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
