import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useI18n } from '@/lib/i18n';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft, FileText, AlertTriangle, CheckSquare, BookOpen, Edit, List,
  Clock, Shield, Calendar, Target, Gauge, ThumbsUp, ThumbsDown, Minus,
  Loader2, Info, RotateCcw, RefreshCw, AlertCircle,
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

const parseStatusColors: Record<string, string> = {
  pending: 'text-muted-foreground bg-muted',
  processing: 'text-warning bg-warning/15',
  parsed: 'text-success bg-success/15',
  failed: 'text-destructive bg-destructive/15',
};

const reviewStatusColors: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  in_review: 'bg-warning/15 text-warning',
  approved: 'bg-success/15 text-success',
};

const severityColors: Record<string, string> = {
  high: 'text-destructive bg-destructive/15',
  medium: 'text-warning bg-warning/15',
  low: 'text-info bg-info/15',
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
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const loadData = useCallback(async () => {
    if (!id) return;
    const [tRes, dRes, rRes, rkRes, dlRes, sRes, cRes] = await Promise.all([
      supabase.from('tenders').select('*').eq('id', id).single(),
      supabase.from('tender_documents').select('*').eq('tender_id', id).order('created_at', { ascending: false }),
      supabase.from('requirements').select('*').eq('tender_id', id).order('created_at', { ascending: true }),
      supabase.from('risks').select('*').eq('tender_id', id),
      supabase.from('deadlines').select('*').eq('tender_id', id).order('due_at', { ascending: true }),
      supabase.from('response_sections').select('*').eq('tender_id', id).order('created_at', { ascending: true }),
      supabase.from('checklist_items').select('*').eq('tender_id', id).order('created_at', { ascending: true }),
    ]);
    setTender(tRes.data);
    setDocs(dRes.data || []);
    setRequirements(rRes.data || []);
    setRisks(rkRes.data || []);
    setDeadlines(dlRes.data || []);
    setSections(sRes.data || []);
    setChecklist(cRes.data || []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRetryProcessing = async () => {
    if (!id) return;
    setRetrying(true);
    try {
      const { error } = await supabase.functions.invoke('process-tender', {
        body: { tender_id: id },
      });
      if (error) throw error;
      toast({ title: t('tender.analysisReady') });
      await loadData();
    } catch (err: any) {
      toast({ title: t('workspace.processingFailed'), description: err.message, variant: 'destructive' });
    } finally {
      setRetrying(false);
    }
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

  const bidIcon = tender.bid_decision === 'bid' ? ThumbsUp : tender.bid_decision === 'no_bid' ? ThumbsDown : Minus;
  const completedChecklist = checklist.filter(c => c.status === 'done').length;
  const mandatoryReqs = requirements.filter(r => r.mandatory).length;
  const pendingDocs = docs.filter(d => d.parse_status === 'pending' || d.parse_status === 'processing').length;
  const failedDocs = docs.filter(d => d.parse_status === 'failed').length;
  const allDocsParsed = docs.length > 0 && pendingDocs === 0 && failedDocs === 0;
  const isProcessing = tender.status === 'new' || tender.status === 'analyzing' || pendingDocs > 0;

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
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border px-6 lg:px-8 overflow-x-auto surface-1">
        <div className="flex gap-0">
          {TABS.map(tab => {
            const Icon = tabIcons[tab];
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
            {/* Processing status banner */}
            {isProcessing && (
              <div className="glass-card p-4 border-warning/30 bg-warning/5 flex items-start gap-3">
                <Loader2 className="h-5 w-5 text-warning animate-spin shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{t('workspace.processingStatus')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('workspace.processingHint')}</p>
                  {docs.length > 0 && <p className="text-xs text-warning mt-1">{pendingDocs} / {docs.length} {t('workspace.parseStatus.pending').toLowerCase()}</p>}
                </div>
                <Button size="sm" variant="ghost" onClick={loadData} className="shrink-0">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {/* Failed docs banner */}
            {failedDocs > 0 && !isProcessing && (
              <div className="glass-card p-4 border-destructive/30 bg-destructive/5 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{t('workspace.processingFailed')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('workspace.processingFailedHint')}</p>
                </div>
                <Button size="sm" variant="outline" onClick={handleRetryProcessing} disabled={retrying} className="shrink-0">
                  {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  <span className="ml-1.5">{t('workspace.retryProcessing')}</span>
                </Button>
              </div>
            )}

            {allDocsParsed && (
              <div className="glass-card p-4 border-success/30 bg-success/5 flex items-center gap-3">
                <Info className="h-5 w-5 text-success shrink-0" />
                <p className="text-sm font-medium text-success">{t('workspace.allParsed')}</p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard label={t('workspace.documents')} value={docs.length} icon={FileText} />
              <StatCard label={t('workspace.requirements')} value={`${mandatoryReqs} ${t('workspace.mandatory')} / ${requirements.length}`} icon={List} />
              <StatCard label={t('workspace.risks.title')} value={risks.length} icon={AlertTriangle} />
              <StatCard label={t('workspace.checklist')} value={`${completedChecklist}/${checklist.length}`} icon={CheckSquare} />
              <StatCard label={t('workspace.draft')} value={`${sections.filter(s => s.draft_text).length}/${sections.length}`} icon={Edit} />
              <StatCard label={t('workspace.deadlines.title')} value={deadlines.length} icon={Calendar} />
            </div>
          </div>
        )}

        {/* DOCUMENTS */}
        {activeTab === 'documents' && (
          docs.length === 0 ? (
            <EmptyState icon={FileText} title={t('workspace.noDocuments')} />
          ) : (
            <div className="glass-card overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('workspace.fileName')}</th>
                    <th className="px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">{t('workspace.fileType')}</th>
                    <th className="px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('workspace.parseStatus')}</th>
                    <th className="px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">{t('workspace.uploadDate')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {docs.map(d => (
                    <tr key={d.id} className="hover:bg-accent/30 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-sm font-medium truncate">{d.file_name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 hidden sm:table-cell">
                        <span className="text-xs text-muted-foreground">{d.file_type || '—'}</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1 ${parseStatusColors[d.parse_status] || 'text-muted-foreground bg-muted'}`}>
                          {d.parse_status === 'processing' && <Loader2 className="h-3 w-3 animate-spin" />}
                          {t(`workspace.parseStatus.${d.parse_status}` as any) || d.parse_status}
                        </span>
                      </td>
                      <td className="px-5 py-3 hidden md:table-cell">
                        <span className="text-xs text-muted-foreground">{format(new Date(d.created_at), 'dd.MM.yyyy HH:mm')}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* REQUIREMENTS */}
        {activeTab === 'requirements' && (
          requirements.length === 0 ? (
            <EmptyState icon={List} title={t('workspace.noRequirements')} description={pendingDocs > 0 ? t('workspace.processingHint') : undefined} />
          ) : (
            <div className="space-y-3">
              {requirements.map((r, idx) => (
                <div key={r.id} className="glass-card px-5 py-4">
                  <div className="flex items-start gap-3">
                    <span className="text-xs text-muted-foreground font-mono mt-0.5 shrink-0 w-6">#{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-relaxed">{r.text}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          r.mandatory ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground'
                        }`}>
                          {r.mandatory ? t('workspace.mandatory') : t('workspace.optional')}
                        </span>
                        {r.category && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{r.category}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* RISKS & DEADLINES */}
        {activeTab === 'risks' && (
          <div className="grid lg:grid-cols-2 gap-6">
            <div>
              <h3 className="flex items-center gap-2 font-heading font-semibold text-sm mb-4">
                <Shield className="h-4 w-4 text-destructive" />
                {t('workspace.risks.title')}
              </h3>
              {risks.length === 0 ? (
                <EmptyState icon={AlertTriangle} title={t('workspace.noRisks')} description={pendingDocs > 0 ? t('workspace.processingHint') : undefined} />
              ) : (
                <div className="space-y-3">
                  {risks.map(r => (
                    <div key={r.id} className="glass-card px-5 py-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{r.risk_type}</span>
                        {r.severity && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${severityColors[r.severity] || 'bg-muted text-muted-foreground'}`}>
                            {r.severity}
                          </span>
                        )}
                      </div>
                      {r.description && <p className="text-sm text-muted-foreground leading-relaxed">{r.description}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="flex items-center gap-2 font-heading font-semibold text-sm mb-4">
                <Calendar className="h-4 w-4 text-warning" />
                {t('workspace.deadlines.title')}
              </h3>
              {deadlines.length === 0 ? (
                <EmptyState icon={Clock} title={t('workspace.noDeadlines')} />
              ) : (
                <div className="space-y-3">
                  {deadlines.map(d => (
                    <div key={d.id} className="glass-card px-5 py-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{d.deadline_type}</span>
                        <span className="text-xs font-medium text-warning">
                          {formatDistanceToNow(new Date(d.due_at), { addSuffix: true, locale: dateFnsLocale })}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{format(new Date(d.due_at), 'dd.MM.yyyy HH:mm')}</p>
                      {d.description && <p className="text-sm text-muted-foreground mt-1">{d.description}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* KNOWLEDGE MATCHES */}
        {activeTab === 'knowledge' && (
          requirements.length === 0 ? (
            <EmptyState icon={BookOpen} title={t('workspace.noKnowledge')} description={t('workspace.knowledgeHint')} />
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{t('workspace.knowledgeHint')}</p>
              {requirements.slice(0, 8).map((req) => (
                <div key={req.id} className="glass-card p-5">
                  <div className="grid lg:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{t('workspace.requirement')}</p>
                      <p className="text-sm leading-relaxed">{req.text}</p>
                      {req.mandatory && (
                        <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">{t('workspace.mandatory')}</span>
                      )}
                    </div>
                    <div className="border-t lg:border-t-0 lg:border-l border-border pt-4 lg:pt-0 lg:pl-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{t('workspace.suggestedAssets')}</p>
                      <div className="flex flex-col items-center justify-center py-6 text-center">
                        <BookOpen className="h-5 w-5 text-muted-foreground/50 mb-1" />
                        <p className="text-xs text-muted-foreground">—</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* DRAFT */}
        {activeTab === 'draft' && (
          sections.length === 0 ? (
            <EmptyState icon={Edit} title={t('workspace.noDraft')} />
          ) : (
            <div className="space-y-4">
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
              {/* Readiness bar */}
              <div className="glass-card p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold font-heading">{t('workspace.readiness')}</h3>
                  <span className="text-sm font-bold font-heading text-primary">
                    {completedChecklist}/{checklist.length}
                  </span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${checklist.length > 0 ? (completedChecklist / checklist.length) * 100 : 0}%` }}
                  />
                </div>
              </div>

              {/* Items */}
              <div className="glass-card overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-8"></th>
                      <th className="px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Task</th>
                      <th className="px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">{t('tender.status')}</th>
                      <th className="px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">{t('workspace.dueDate')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {checklist.map(c => (
                      <tr key={c.id} className="hover:bg-accent/30 transition-colors">
                        <td className="px-5 py-3">
                          <button
                            onClick={() => handleToggleChecklist(c)}
                            className={`h-4 w-4 rounded border-2 transition-colors ${
                              c.status === 'done' ? 'bg-success border-success' : 'border-border hover:border-primary'
                            }`}
                          />
                        </td>
                        <td className="px-5 py-3">
                          <span className={`text-sm ${c.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>
                            {c.title}
                          </span>
                        </td>
                        <td className="px-5 py-3 hidden sm:table-cell">
                          <StatusBadge status={c.status} />
                        </td>
                        <td className="px-5 py-3 hidden md:table-cell">
                          <span className="text-xs text-muted-foreground">
                            {c.due_at ? format(new Date(c.due_at), 'dd.MM.yyyy') : '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: any }) {
  return (
    <div className="glass-card p-5 flex items-center gap-4">
      <div className="rounded-lg bg-primary/10 p-3">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold font-heading mt-0.5">{value}</p>
      </div>
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
      <div className="px-5 py-3 border-b border-border flex items-center justify-between bg-muted/30">
        <h3 className="text-sm font-semibold font-heading">{section.section_title}</h3>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            reviewStatusColors[section.review_status] || 'bg-muted text-muted-foreground'
          }`}>
            {t(`status.${section.review_status}` as any) || section.review_status}
          </span>
        </div>
      </div>
      <div className="px-5 py-4">
        {editing ? (
          <div className="space-y-3">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              className="w-full min-h-[120px] bg-background border border-border rounded-lg p-3 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="..."
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
            className="cursor-pointer hover:bg-accent/20 rounded-lg p-2 -m-2 transition-colors min-h-[60px]"
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
