import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useI18n } from '@/lib/i18n';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { ArrowLeft, FileText, AlertTriangle, CheckSquare, BookOpen, Edit, List, Clock } from 'lucide-react';
import { format } from 'date-fns';
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

export default function TenderWorkspace() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const [tender, setTender] = useState<Tender | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [sections, setSections] = useState<ResponseSection[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      const [tRes, dRes, rRes, rkRes, dlRes, sRes, cRes] = await Promise.all([
        supabase.from('tenders').select('*').eq('id', id).single(),
        supabase.from('tender_documents').select('*').eq('tender_id', id),
        supabase.from('requirements').select('*').eq('tender_id', id),
        supabase.from('risks').select('*').eq('tender_id', id),
        supabase.from('deadlines').select('*').eq('tender_id', id),
        supabase.from('response_sections').select('*').eq('tender_id', id),
        supabase.from('checklist_items').select('*').eq('tender_id', id),
      ]);
      setTender(tRes.data);
      setDocs(dRes.data || []);
      setRequirements(rRes.data || []);
      setRisks(rkRes.data || []);
      setDeadlines(dlRes.data || []);
      setSections(sRes.data || []);
      setChecklist(cRes.data || []);
      setLoading(false);
    };
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!tender) {
    return (
      <div className="p-6">
        <EmptyState icon={FileText} title={t('workspace.notFound')} />
      </div>
    );
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

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="border-b border-border px-6 lg:px-8 py-5 surface-1">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('common.back')}
        </Link>
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold font-heading">{tender.title}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-sm text-muted-foreground">
              {tender.issuer && <span>{tender.issuer}</span>}
              <span className="capitalize">{tender.source_type}</span>
              <span>•</span>
              <span className="capitalize">{tender.tender_type}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={tender.status} />
            {tender.deadline && (
              <span className="text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5 inline mr-1" />
                {format(new Date(tender.deadline), 'dd.MM.yyyy HH:mm')}
              </span>
            )}
            {tender.fit_score != null && (
              <span className="text-xs font-medium text-primary">
                {t('workspace.fitScore')}: {tender.fit_score}%
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border px-6 lg:px-8 overflow-x-auto">
        <div className="flex gap-0">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="p-6 lg:p-8 max-w-5xl">
        {activeTab === 'overview' && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <InfoCard label={t('workspace.documents')} value={docs.length} icon={FileText} />
            <InfoCard label={t('workspace.requirements')} value={requirements.length} icon={List} />
            <InfoCard label={t('workspace.risks')} value={risks.length} icon={AlertTriangle} />
            <InfoCard label={t('workspace.checklist')} value={`${checklist.filter(c => c.status === 'done').length}/${checklist.length}`} icon={CheckSquare} />
            <InfoCard label={t('workspace.draft')} value={sections.length} icon={Edit} />
            <InfoCard label={t('workspace.knowledge')} value="—" icon={BookOpen} />
          </div>
        )}

        {activeTab === 'documents' && (
          docs.length === 0
            ? <EmptyState icon={FileText} title={t('common.empty')} />
            : <div className="space-y-2">{docs.map(d => (
                <div key={d.id} className="glass-card px-4 py-3 flex items-center gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{d.file_name}</p>
                    <p className="text-xs text-muted-foreground">{d.parse_status}</p>
                  </div>
                </div>
              ))}</div>
        )}

        {activeTab === 'requirements' && (
          requirements.length === 0
            ? <EmptyState icon={List} title={t('common.empty')} />
            : <div className="space-y-2">{requirements.map(r => (
                <div key={r.id} className="glass-card px-4 py-3">
                  <div className="flex items-start gap-2">
                    {r.mandatory && <span className="shrink-0 mt-0.5 h-2 w-2 rounded-full bg-destructive" />}
                    <p className="text-sm">{r.text}</p>
                  </div>
                  {r.category && <p className="text-xs text-muted-foreground mt-1">{r.category}</p>}
                </div>
              ))}</div>
        )}

        {activeTab === 'risks' && (
          <div className="space-y-6">
            <div>
              <h3 className="font-heading font-semibold text-sm mb-3">{t('workspace.risks')}</h3>
              {risks.length === 0
                ? <EmptyState icon={AlertTriangle} title={t('common.empty')} />
                : <div className="space-y-2">{risks.map(r => (
                    <div key={r.id} className="glass-card px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{r.risk_type}</span>
                        {r.severity && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            r.severity === 'high' ? 'bg-destructive/15 text-destructive' :
                            r.severity === 'medium' ? 'bg-warning/15 text-warning' :
                            'bg-muted text-muted-foreground'
                          }`}>{r.severity}</span>
                        )}
                      </div>
                      {r.description && <p className="text-sm text-muted-foreground mt-1">{r.description}</p>}
                    </div>
                  ))}</div>
              }
            </div>
            <div>
              <h3 className="font-heading font-semibold text-sm mb-3">{t('dashboard.upcomingDeadlines')}</h3>
              {deadlines.length === 0
                ? <EmptyState icon={Clock} title={t('common.empty')} />
                : <div className="space-y-2">{deadlines.map(d => (
                    <div key={d.id} className="glass-card px-4 py-3">
                      <p className="text-sm font-medium">{d.deadline_type}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(d.due_at), 'dd.MM.yyyy HH:mm')}</p>
                      {d.description && <p className="text-xs text-muted-foreground mt-1">{d.description}</p>}
                    </div>
                  ))}</div>
              }
            </div>
          </div>
        )}

        {activeTab === 'knowledge' && <EmptyState icon={BookOpen} title={t('common.empty')} />}

        {activeTab === 'draft' && (
          sections.length === 0
            ? <EmptyState icon={Edit} title={t('common.empty')} />
            : <div className="space-y-2">{sections.map(s => (
                <div key={s.id} className="glass-card px-4 py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{s.section_title}</p>
                    <span className="text-xs text-muted-foreground">{s.review_status}</span>
                  </div>
                  {s.draft_text && <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{s.draft_text}</p>}
                </div>
              ))}</div>
        )}

        {activeTab === 'checklist' && (
          checklist.length === 0
            ? <EmptyState icon={CheckSquare} title={t('common.empty')} />
            : <div className="space-y-2">{checklist.map(c => (
                <div key={c.id} className="glass-card px-4 py-3 flex items-center gap-3">
                  <div className={`h-4 w-4 rounded border ${c.status === 'done' ? 'bg-success border-success' : 'border-border'}`} />
                  <p className={`text-sm ${c.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>{c.title}</p>
                </div>
              ))}</div>
        )}
      </div>
    </div>
  );
}

function InfoCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: any }) {
  return (
    <div className="glass-card p-4 flex items-center gap-3">
      <div className="rounded-lg bg-muted p-2.5">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold font-heading">{value}</p>
      </div>
    </div>
  );
}
