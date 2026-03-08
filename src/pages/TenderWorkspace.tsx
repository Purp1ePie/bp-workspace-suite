import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useI18n } from '@/lib/i18n';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft, FileText, AlertTriangle, CheckSquare, BookOpen, Edit, List,
  Clock, Shield, Calendar, Target, Gauge, ThumbsUp, ThumbsDown, Minus,
  Loader2, Info, RefreshCw, CheckCircle2, XCircle, Circle, Hash, Tag,
  Check, X as XIcon, Sparkles,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import type { Tables } from '@/integrations/supabase/types';

type Tender = Tables<'tenders'>;
type Doc = Tables<'tender_documents'>;
type Requirement = Tables<'requirements'>;
type Risk = Tables<'risks'>;
type Deadline = Tables<'deadlines'>;
type ResponseSection = Tables<'response_sections'>;
type ChecklistItem = Tables<'checklist_items'>;
type RequirementMatch = Tables<'requirement_matches'>;
type KnowledgeAsset = Tables<'knowledge_assets'>;

const TABS = ['overview', 'documents', 'requirements', 'risks', 'knowledge', 'draft', 'checklist'] as const;
type Tab = typeof TABS[number];

const tabIcons: Record<Tab, any> = {
  overview: Target,
  documents: FileText,
  requirements: List,
  risks: AlertTriangle,
  knowledge: BookOpen,
  draft: Edit,
  checklist: CheckSquare,
};

const parseStatusConfig: Record<string, { color: string; icon: any }> = {
  pending: { color: 'text-muted-foreground bg-muted', icon: Clock },
  processing: { color: 'text-warning bg-warning/15', icon: Loader2 },
  parsed: { color: 'text-success bg-success/15', icon: CheckCircle2 },
  failed: { color: 'text-destructive bg-destructive/15', icon: XCircle },
};

const reviewStatusColors: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  in_review: 'bg-warning/15 text-warning',
  approved: 'bg-success/15 text-success',
};

const severityConfig: Record<string, { color: string; dot: string }> = {
  high: { color: 'text-destructive bg-destructive/15', dot: 'bg-destructive' },
  medium: { color: 'text-warning bg-warning/15', dot: 'bg-warning' },
  low: { color: 'text-info bg-info/15', dot: 'bg-info' },
};

export default function TenderWorkspace() {
  const { id } = useParams<{ id: string }>();
  const { t, language } = useI18n();
  const { toast } = useToast();
  const dateFnsLocale = language === 'de' ? de : enUS;
  const [tender, setTender] = useState<Tender | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [sections, setSections] = useState<ResponseSection[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [matches, setMatches] = useState<RequirementMatch[]>([]);
  const [knowledgeAssets, setKnowledgeAssets] = useState<KnowledgeAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);

  const loadData = useCallback(async () => {
    if (!id) return;
    const [tRes, dRes, rRes, rkRes, dlRes, sRes, cRes, mRes] = await Promise.all([
      supabase.from('tenders').select('*').eq('id', id).single(),
      supabase.from('tender_documents').select('*').eq('tender_id', id).order('created_at', { ascending: false }),
      supabase.from('requirements').select('*').eq('tender_id', id).order('created_at', { ascending: true }),
      supabase.from('risks').select('*').eq('tender_id', id),
      supabase.from('deadlines').select('*').eq('tender_id', id).order('due_at', { ascending: true }),
      supabase.from('response_sections').select('*').eq('tender_id', id).order('created_at', { ascending: true }),
      supabase.from('checklist_items').select('*').eq('tender_id', id).order('created_at', { ascending: true }),
      supabase.from('requirement_matches').select('*').eq('tender_id', id).order('confidence_score', { ascending: false }),
    ]);
    setTender(tRes.data);
    setDocs(dRes.data || []);
    setRequirements(rRes.data || []);
    setRisks(rkRes.data || []);
    setDeadlines(dlRes.data || []);
    setSections(sRes.data || []);
    setChecklist(cRes.data || []);
    setMatches(mRes.data || []);

    // Fetch knowledge assets if we have matches
    const matchData = mRes.data || [];
    if (matchData.length > 0) {
      const assetIds = [...new Set(matchData.map(m => m.knowledge_asset_id))];
      const { data: assets } = await supabase.from('knowledge_assets').select('*').in('id', assetIds);
      setKnowledgeAssets(assets || []);
    } else {
      setKnowledgeAssets([]);
    }
  }, [id]);

  useEffect(() => {
    loadData().then(() => setLoading(false));
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleSaveDraft = async (sectionId: string, text: string) => {
    setSavingSection(sectionId);
    const { error } = await supabase.from('response_sections').update({ draft_text: text }).eq('id', sectionId);
    if (error) {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    } else {
      toast({ title: t('workspace.draftSaved') });
      setSections(prev => prev.map(s => s.id === sectionId ? { ...s, draft_text: text } : s));
    }
    setSavingSection(null);
  };

  const handleToggleChecklist = async (item: ChecklistItem) => {
    const newStatus = item.status === 'done' ? 'open' : 'done';
    const { error } = await supabase.from('checklist_items').update({ status: newStatus }).eq('id', item.id);
    if (!error) {
      setChecklist(prev => prev.map(c => c.id === item.id ? { ...c, status: newStatus } : c));
    }
  };

  const handleUpdateMatchStatus = async (matchId: string, status: 'accepted' | 'rejected') => {
    const { error } = await supabase.from('requirement_matches').update({ status }).eq('id', matchId);
    if (error) {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    } else {
      setMatches(prev => prev.map(m => m.id === matchId ? { ...m, status } : m));
    }
  };

  const handleReprocessDocuments = async () => {
    if (!id) return;
    setReprocessing(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        toast({ title: t('common.error'), description: 'No active session. Please sign in again.', variant: 'destructive' });
        return;
      }
      const { data, error } = await supabase.functions.invoke('process-tender', {
        body: { tender_id: id },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (error) throw error;
      toast({ title: 'Documents reprocessed', description: 'Tender documents have been re-analyzed.' });
      await loadData();
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message || 'Failed to reprocess documents', variant: 'destructive' });
    } finally {
      setReprocessing(false);
    }
  };

  const [matchingInProgress, setMatchingInProgress] = useState(false);
  const handleRetryMatching = async () => {
    if (!id) return;
    setMatchingInProgress(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('No active session');
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/match-knowledge-assets`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ tender_id: id }),
        }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || `Matching failed: ${response.status}`);
      toast({ title: 'Knowledge matching complete', description: `${result.inserted_matches || 0} matches found` });
      await loadData();
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    } finally {
      setMatchingInProgress(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!tender) {
    return <div className="p-6"><EmptyState icon={FileText} title={t('workspace.notFound')} /></div>;
  }

  const tabLabels: Record<Tab, string> = {
    overview: t('workspace.overview'),
    documents: t('workspace.documents'),
    requirements: t('workspace.requirements'),
    risks: t('workspace.risks'),
    knowledge: t('workspace.knowledge'),
    draft: t('workspace.draft'),
    checklist: t('workspace.checklist'),
  };

  const tabCounts: Partial<Record<Tab, number>> = {
    documents: docs.length,
    requirements: requirements.length,
    risks: risks.length + deadlines.length,
    knowledge: matches.length,
    draft: sections.length,
    checklist: checklist.length,
  };

  const bidIcon = tender.bid_decision === 'bid' ? ThumbsUp : tender.bid_decision === 'no_bid' ? ThumbsDown : Minus;
  const completedChecklist = checklist.filter(c => c.status === 'done').length;
  const mandatoryReqs = requirements.filter(r => r.mandatory).length;
  const pendingDocs = docs.filter(d => d.parse_status === 'pending' || d.parse_status === 'processing').length;
  const parsedDocs = docs.filter(d => d.parse_status === 'parsed').length;
  const failedDocs = docs.filter(d => d.parse_status === 'failed').length;
  const allDocsParsed = docs.length > 0 && pendingDocs === 0;
  const isProcessing = tender.status === 'new' || tender.status === 'analyzing' || pendingDocs > 0;
  const highRisks = risks.filter(r => r.severity === 'high').length;
  const draftedSections = sections.filter(s => s.draft_text).length;
  const checklistProgress = checklist.length > 0 ? Math.round((completedChecklist / checklist.length) * 100) : 0;

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="border-b border-border px-6 lg:px-8 py-5 surface-1">
        <Link to="/tenders" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3 transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('nav.tenders')}
        </Link>
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-bold font-heading truncate">{tender.title}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-muted-foreground">
              {tender.issuer && <span>{tender.issuer}</span>}
              <span className="capitalize text-xs px-2 py-0.5 rounded bg-muted">{tender.source_type}</span>
              <span className="capitalize text-xs px-2 py-0.5 rounded bg-muted">{tender.tender_type}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <StatusBadge status={tender.status} />
            {tender.deadline && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {format(new Date(tender.deadline), 'dd.MM.yyyy HH:mm')}
              </span>
            )}
            {tender.fit_score != null && (
              <span className="flex items-center gap-1 text-xs font-medium text-primary">
                <Gauge className="h-3.5 w-3.5" />
                {tender.fit_score}%
              </span>
            )}
            {tender.bid_decision && (
              <span className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded ${
                tender.bid_decision === 'bid' ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'
              }`}>
                {React.createElement(bidIcon, { className: 'h-3 w-3' })}
                {tender.bid_decision}
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={handleRefresh} disabled={refreshing} className="h-8 w-8 p-0">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border px-6 lg:px-8 overflow-x-auto surface-1">
        <div className="flex gap-0">
          {TABS.map(tab => {
            const Icon = tabIcons[tab];
            const count = tabCounts[tab];
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tabLabels[tab]}
                {count !== undefined && count > 0 && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground ml-0.5">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="p-6 lg:p-8 max-w-6xl animate-fade-in">
        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Processing banner */}
            {isProcessing && (
              <div className="glass-card p-5 border-warning/30 bg-warning/5">
                <div className="flex items-start gap-3">
                  <Loader2 className="h-5 w-5 text-warning animate-spin shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{t('workspace.processingStatus')}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t('workspace.processingHint')}</p>
                    {docs.length > 0 && (
                      <div className="flex items-center gap-4 mt-3">
                        <div className="flex-1">
                          <Progress value={docs.length > 0 ? ((parsedDocs + failedDocs) / docs.length) * 100 : 0} className="h-1.5" />
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {parsedDocs + failedDocs} / {docs.length}
                        </span>
                      </div>
                    )}
                  </div>
                  <Button size="sm" variant="ghost" onClick={handleRefresh} disabled={refreshing} className="shrink-0">
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
              </div>
            )}

            {allDocsParsed && !isProcessing && (
              <div className="glass-card p-4 border-success/30 bg-success/5 flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
                <p className="text-sm font-medium text-success">{t('workspace.allParsed')}</p>
              </div>
            )}

            {/* Summary grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                label={t('workspace.documents')}
                value={docs.length}
                icon={FileText}
                detail={parsedDocs > 0 ? `${parsedDocs} ${t('workspace.parseStatus.parsed').toLowerCase()}` : undefined}
                accent={failedDocs > 0 ? 'destructive' : undefined}
              />
              <StatCard
                label={t('workspace.requirements')}
                value={requirements.length}
                icon={List}
                detail={mandatoryReqs > 0 ? `${mandatoryReqs} ${t('workspace.mandatory').toLowerCase()}` : undefined}
              />
              <StatCard
                label={t('workspace.risks.title')}
                value={risks.length}
                icon={Shield}
                detail={highRisks > 0 ? `${highRisks} high severity` : undefined}
                accent={highRisks > 0 ? 'destructive' : undefined}
              />
              <StatCard
                label={t('workspace.deadlines.title')}
                value={deadlines.length}
                icon={Calendar}
                detail={deadlines[0] ? formatDistanceToNow(new Date(deadlines[0].due_at), { addSuffix: true, locale: dateFnsLocale }) : undefined}
              />
              <StatCard
                label={t('workspace.draft')}
                value={`${draftedSections}/${sections.length}`}
                icon={Edit}
                detail={sections.length > 0 ? `${Math.round((draftedSections / sections.length) * 100)}%` : undefined}
              />
              <StatCard
                label={t('workspace.checklist')}
                value={`${completedChecklist}/${checklist.length}`}
                icon={CheckSquare}
                detail={checklist.length > 0 ? `${checklistProgress}%` : undefined}
                progress={checklistProgress}
              />
            </div>
          </div>
        )}

        {/* DOCUMENTS */}
        {activeTab === 'documents' && (
          docs.length === 0 ? (
            <EmptyState icon={FileText} title={t('workspace.noDocuments')} />
          ) : (
            <div className="space-y-4">
              {/* Document stats bar */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>{docs.length} {t('workspace.documents').toLowerCase()}</span>
                <span className="w-px h-3 bg-border" />
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-success" />{parsedDocs} parsed</span>
                {pendingDocs > 0 && <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 text-warning animate-spin" />{pendingDocs} processing</span>}
                {failedDocs > 0 && <span className="flex items-center gap-1"><XCircle className="h-3 w-3 text-destructive" />{failedDocs} failed</span>}
              </div>

              <div className="space-y-2">
                {docs.map(d => {
                  const cfg = parseStatusConfig[d.parse_status] || parseStatusConfig.pending;
                  const StatusIcon = cfg.icon;
                  return (
                    <div key={d.id} className="glass-card px-5 py-4 flex items-center gap-4 hover:border-primary/20 transition-colors">
                      <div className="rounded-lg bg-primary/10 p-2.5 shrink-0">
                        <FileText className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{d.file_name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {d.file_type || 'document'} · {format(new Date(d.created_at), 'dd MMM yyyy, HH:mm', { locale: dateFnsLocale })}
                        </p>
                      </div>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium inline-flex items-center gap-1.5 shrink-0 ${cfg.color}`}>
                        <StatusIcon className={`h-3 w-3 ${d.parse_status === 'processing' ? 'animate-spin' : ''}`} />
                        {t(`workspace.parseStatus.${d.parse_status}` as any) || d.parse_status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )
        )}

        {/* REQUIREMENTS */}
        {activeTab === 'requirements' && (
          requirements.length === 0 ? (
            <EmptyState icon={List} title={t('workspace.noRequirements')} description={pendingDocs > 0 ? t('workspace.processingHint') : undefined} />
          ) : (
            <div className="space-y-4">
              {/* Req stats */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>{requirements.length} {t('workspace.requirements').toLowerCase()}</span>
                <span className="w-px h-3 bg-border" />
                <span className="text-destructive font-medium">{mandatoryReqs} {t('workspace.mandatory').toLowerCase()}</span>
                <span>{requirements.length - mandatoryReqs} {t('workspace.optional').toLowerCase()}</span>
              </div>

              <div className="space-y-2">
                {requirements.map((r, idx) => (
                  <div key={r.id} className="glass-card px-5 py-4 hover:border-primary/20 transition-colors">
                    <div className="flex items-start gap-3">
                      <span className="flex items-center justify-center h-6 w-6 rounded bg-muted text-[10px] font-bold text-muted-foreground shrink-0 mt-0.5">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-relaxed">{r.text}</p>
                        <div className="flex items-center gap-2 mt-2.5">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                            r.mandatory ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground'
                          }`}>
                            {r.mandatory ? t('workspace.mandatory') : t('workspace.optional')}
                          </span>
                          {r.category && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium flex items-center gap-1">
                              <Tag className="h-2.5 w-2.5" />
                              {r.category}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        )}

        {/* RISKS & DEADLINES */}
        {activeTab === 'risks' && (
          <div className="space-y-8">
            {/* Risks */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Shield className="h-4 w-4 text-destructive" />
                <h3 className="font-heading font-semibold text-sm">{t('workspace.risks.title')}</h3>
                <span className="text-xs text-muted-foreground ml-1">({risks.length})</span>
              </div>
              {risks.length === 0 ? (
                <EmptyState icon={AlertTriangle} title={t('workspace.noRisks')} description={pendingDocs > 0 ? t('workspace.processingHint') : undefined} />
              ) : (
                <div className="space-y-2">
                  {risks.map(r => {
                    const sev = severityConfig[r.severity || ''] || { color: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' };
                    return (
                      <div key={r.id} className="glass-card px-5 py-4 hover:border-primary/20 transition-colors">
                        <div className="flex items-start gap-3">
                          <span className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${sev.dot}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">{r.risk_type}</span>
                              {r.severity && (
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${sev.color}`}>
                                  {r.severity}
                                </span>
                              )}
                            </div>
                            {r.description && <p className="text-sm text-muted-foreground leading-relaxed mt-1.5">{r.description}</p>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-border" />

            {/* Deadlines */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="h-4 w-4 text-warning" />
                <h3 className="font-heading font-semibold text-sm">{t('workspace.deadlines.title')}</h3>
                <span className="text-xs text-muted-foreground ml-1">({deadlines.length})</span>
              </div>
              {deadlines.length === 0 ? (
                <EmptyState icon={Clock} title={t('workspace.noDeadlines')} />
              ) : (
                <div className="space-y-2">
                  {deadlines.map(d => {
                    const dueDate = new Date(d.due_at);
                    const isPast = dueDate < new Date();
                    return (
                      <div key={d.id} className="glass-card px-5 py-4 hover:border-primary/20 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <Clock className={`h-4 w-4 mt-0.5 shrink-0 ${isPast ? 'text-destructive' : 'text-warning'}`} />
                            <div>
                              <span className="text-sm font-medium">{d.deadline_type}</span>
                              {d.description && <p className="text-sm text-muted-foreground mt-0.5">{d.description}</p>}
                            </div>
                          </div>
                          <div className="text-right shrink-0 ml-4">
                            <p className={`text-sm font-medium ${isPast ? 'text-destructive' : 'text-foreground'}`}>
                              {format(dueDate, 'dd MMM yyyy', { locale: dateFnsLocale })}
                            </p>
                            <p className={`text-xs mt-0.5 ${isPast ? 'text-destructive' : 'text-muted-foreground'}`}>
                              {formatDistanceToNow(dueDate, { addSuffix: true, locale: dateFnsLocale })}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* KNOWLEDGE MATCHES */}
        {activeTab === 'knowledge' && (
          <div className="space-y-4">
            {/* Header with retry button */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span>{matches.length} matches across {requirements.length} requirements</span>
              </div>
              <Button size="sm" variant="outline" onClick={handleRetryMatching} disabled={matchingInProgress}>
                {matchingInProgress ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                Re-run matching
              </Button>
            </div>

            {matches.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="No knowledge matches yet"
                description="No relevant company knowledge was matched to tender requirements. Upload assets in Company Memory or re-run matching."
                action={
                  <Button size="sm" variant="outline" onClick={handleRetryMatching} disabled={matchingInProgress}>
                    {matchingInProgress ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                    Run matching
                  </Button>
                }
              />
            ) : (
              (() => {
                // Group matches by requirement
                const assetMap = new Map(knowledgeAssets.map(a => [a.id, a]));
                const grouped = new Map<string, { req: Requirement; matches: RequirementMatch[] }>();
                for (const req of requirements) {
                  const reqMatches = matches.filter(m => m.requirement_id === req.id);
                  if (reqMatches.length > 0) {
                    grouped.set(req.id, { req, matches: reqMatches });
                  }
                }
                // Requirements with no matches
                const unmatchedReqs = requirements.filter(r => !grouped.has(r.id));

                return (
                  <div className="space-y-4">
                    {Array.from(grouped.values()).map(({ req, matches: reqMatches }) => (
                      <div key={req.id} className="glass-card overflow-hidden">
                        {/* Requirement header */}
                        <div className="px-5 py-3.5 border-b border-border surface-2">
                          <p className="text-sm leading-relaxed">{req.text}</p>
                          <div className="flex items-center gap-2 mt-2">
                            {req.mandatory && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-destructive/15 text-destructive font-semibold uppercase tracking-wider">
                                Mandatory
                              </span>
                            )}
                            {req.category && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium flex items-center gap-1">
                                <Tag className="h-2.5 w-2.5" />
                                {req.category}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Matched assets */}
                        <div className="divide-y divide-border">
                          {reqMatches.map(match => {
                            const asset = assetMap.get(match.knowledge_asset_id);
                            const statusColors: Record<string, string> = {
                              suggested: 'bg-primary/10 text-primary',
                              accepted: 'bg-success/15 text-success',
                              rejected: 'bg-destructive/15 text-destructive',
                            };
                            return (
                              <div key={match.id} className="px-5 py-3.5 flex items-center gap-4">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-medium truncate">{asset?.title || 'Unknown asset'}</p>
                                    {asset?.asset_type && (
                                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium capitalize shrink-0">
                                        {asset.asset_type.replace('_', ' ')}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-3 mt-1">
                                    <span className="text-xs text-muted-foreground">
                                      Confidence: <span className="font-semibold text-foreground">{match.confidence_score}%</span>
                                    </span>
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${statusColors[match.status] || 'bg-muted text-muted-foreground'}`}>
                                      {match.status}
                                    </span>
                                  </div>
                                </div>
                                {match.status === 'suggested' && (
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 w-8 p-0 text-success hover:bg-success/10 hover:text-success"
                                      onClick={() => handleUpdateMatchStatus(match.id, 'accepted')}
                                    >
                                      <Check className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                      onClick={() => handleUpdateMatchStatus(match.id, 'rejected')}
                                    >
                                      <XIcon className="h-4 w-4" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}

                    {unmatchedReqs.length > 0 && (
                      <div className="glass-card p-4 border-muted">
                        <p className="text-xs text-muted-foreground mb-2">{unmatchedReqs.length} requirements with no matches</p>
                        <div className="space-y-1.5">
                          {unmatchedReqs.slice(0, 5).map(r => (
                            <p key={r.id} className="text-xs text-muted-foreground/70 truncate">• {r.text}</p>
                          ))}
                          {unmatchedReqs.length > 5 && (
                            <p className="text-xs text-muted-foreground/50">+{unmatchedReqs.length - 5} more</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()
            )}
          </div>
        )}

        {/* DRAFT */}
        {activeTab === 'draft' && (
          sections.length === 0 ? (
            <EmptyState icon={Edit} title={t('workspace.noDraft')} />
          ) : (
            <div className="space-y-4">
              {/* Draft progress */}
              <div className="glass-card p-4 flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">{t('workspace.draftSections')}</span>
                    <span className="text-xs font-semibold">{draftedSections}/{sections.length}</span>
                  </div>
                  <Progress value={sections.length > 0 ? (draftedSections / sections.length) * 100 : 0} className="h-1.5" />
                </div>
              </div>

              {sections.map(s => (
                <DraftSection
                  key={s.id}
                  section={s}
                  saving={savingSection === s.id}
                  onSave={handleSaveDraft}
                  reviewStatusColors={reviewStatusColors}
                  t={t}
                />
              ))}
            </div>
          )
        )}

        {/* CHECKLIST */}
        {activeTab === 'checklist' && (
          checklist.length === 0 ? (
            <EmptyState icon={CheckSquare} title={t('workspace.noChecklist')} />
          ) : (
            <div className="space-y-4">
              {/* Readiness card */}
              <div className="glass-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold font-heading">{t('workspace.readiness')}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {completedChecklist} {t('workspace.completedItems').toLowerCase()} · {checklist.length - completedChecklist} {t('workspace.missingItems').toLowerCase()}
                    </p>
                  </div>
                  <span className="text-2xl font-bold font-heading text-primary">
                    {checklistProgress}%
                  </span>
                </div>
                <Progress value={checklistProgress} className="h-2" />
              </div>

              {/* Open items first, then done */}
              <div className="space-y-2">
                {[...checklist].sort((a, b) => {
                  if (a.status === 'done' && b.status !== 'done') return 1;
                  if (a.status !== 'done' && b.status === 'done') return -1;
                  return 0;
                }).map(c => (
                  <div
                    key={c.id}
                    className={`glass-card px-5 py-3.5 flex items-center gap-4 transition-colors hover:border-primary/20 ${
                      c.status === 'done' ? 'opacity-60' : ''
                    }`}
                  >
                    <button
                      onClick={() => handleToggleChecklist(c)}
                      className="shrink-0 transition-colors"
                    >
                      {c.status === 'done' ? (
                        <CheckCircle2 className="h-5 w-5 text-success" />
                      ) : (
                        <Circle className="h-5 w-5 text-muted-foreground hover:text-primary" />
                      )}
                    </button>
                    <span className={`text-sm flex-1 ${c.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>
                      {c.title}
                    </span>
                    {c.due_at && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {format(new Date(c.due_at), 'dd MMM', { locale: dateFnsLocale })}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

/* ──── Sub-components ──── */

function StatCard({
  label,
  value,
  icon: Icon,
  detail,
  accent,
  progress,
}: {
  label: string;
  value: string | number;
  icon: any;
  detail?: string;
  accent?: 'destructive' | 'warning';
  progress?: number;
}) {
  const accentColor = accent === 'destructive' ? 'text-destructive' : accent === 'warning' ? 'text-warning' : 'text-primary';
  return (
    <div className="glass-card p-5 hover:border-primary/20 transition-colors">
      <div className="flex items-center gap-4">
        <div className="rounded-lg bg-primary/10 p-2.5">
          <Icon className="h-4.5 w-4.5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold font-heading mt-0.5">{value}</p>
        </div>
      </div>
      {detail && <p className={`text-xs mt-2 ${accent ? accentColor : 'text-muted-foreground'}`}>{detail}</p>}
      {progress !== undefined && (
        <Progress value={progress} className="h-1 mt-2" />
      )}
    </div>
  );
}

function DraftSection({
  section,
  saving,
  onSave,
  reviewStatusColors,
  t,
}: {
  section: ResponseSection;
  saving: boolean;
  onSave: (id: string, text: string) => void;
  reviewStatusColors: Record<string, string>;
  t: (key: any) => string;
}) {
  const [text, setText] = useState(section.draft_text || '');
  const [editing, setEditing] = useState(false);

  return (
    <div className="glass-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between surface-2">
        <div className="flex items-center gap-2">
          <Edit className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold font-heading">{section.section_title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
            reviewStatusColors[section.review_status] || 'bg-muted text-muted-foreground'
          }`}>
            {t(`status.${section.review_status}` as any) || section.review_status}
          </span>
          {section.draft_text ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          ) : (
            <Circle className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </div>
      <div className="px-5 py-4">
        {editing ? (
          <div className="space-y-3">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              className="w-full min-h-[140px] bg-background border border-border rounded-lg p-3 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Write your response..."
            />
            <div className="flex items-center gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setText(section.draft_text || ''); }}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={() => { onSave(section.id, text); setEditing(false); }} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                {t('common.save')}
              </Button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => setEditing(true)}
            className="cursor-pointer hover:bg-accent/20 rounded-lg p-3 -m-3 transition-colors min-h-[60px]"
          >
            {section.draft_text ? (
              <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">{section.draft_text}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">{t('common.edit')}...</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
