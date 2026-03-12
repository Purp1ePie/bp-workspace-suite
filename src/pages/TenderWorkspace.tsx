import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft, ArrowRight, FileText, AlertTriangle, CheckSquare, BookOpen, Edit, List,
  Clock, Shield, Calendar, Target, Gauge, ThumbsUp, ThumbsDown, Minus,
  Loader2, Info, RefreshCw, CheckCircle2, XCircle, Circle, Hash, Tag,
  Check, X as XIcon, Sparkles, FileSpreadsheet, Download, HelpCircle, Trash2,
  UserCircle2, Filter, MessageSquare, Send, Play, ChevronDown, ChevronUp, ExternalLink, Paperclip,
  Upload, Mail, Phone, Globe,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { callEdgeFunction } from '@/lib/edgeFunctions';
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
type ClarificationQuestion = Tables<'clarification_questions'>;
type Profile = Tables<'profiles'>;

type ChecklistFilter = 'all' | 'mine' | 'unassigned';

const TABS = ['overview', 'documents', 'requirements', 'risks', 'knowledge', 'draft', 'clarifications', 'checklist'] as const;
type Tab = typeof TABS[number];

const tabIcons: Record<Tab, any> = {
  overview: Target,
  documents: FileText,
  requirements: List,
  risks: AlertTriangle,
  knowledge: BookOpen,
  draft: Edit,
  clarifications: HelpCircle,
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
  critical: { color: 'text-destructive bg-destructive/20 font-bold', dot: 'bg-destructive' },
  high: { color: 'text-destructive bg-destructive/15', dot: 'bg-destructive' },
  medium: { color: 'text-warning bg-warning/15', dot: 'bg-warning' },
  low: { color: 'text-info bg-info/15', dot: 'bg-info' },
};

function parseMatchReason(reason: string | null): { items: { key: string; value: string }[]; aiReason: string | null } {
  if (!reason) return { items: [], aiReason: null };
  const items: { key: string; value: string }[] = [];
  // Extract AI reason text (comes after "reason=")
  const reasonMatch = reason.match(/reason=(.+)$/);
  const aiReason = reasonMatch ? reasonMatch[1].trim() : null;
  // Parse key=value pairs (stop before "reason=" to avoid pollution)
  const cleanedReason = reason.replace(/,?\s*reason=.+$/, '');
  const parts = cleanedReason.split(',').map(s => s.trim());
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx < 0) continue;
    const k = part.slice(0, eqIdx).trim();
    const v = part.slice(eqIdx + 1).trim();
    if (!k || !v) continue;
    if (k === 'ai_score') items.push({ key: 'matchAiScore', value: v });
    if (k === 'semantic') items.push({ key: 'matchSemantic', value: v });
    // Legacy formats
    const num = parseInt(v, 10);
    if (k === 'title' && num > 0) items.push({ key: 'matchTitleTerms', value: String(num) + '×' });
    if (k === 'text' && num > 0) items.push({ key: 'matchTextTerms', value: String(num) + '×' });
    if (k === 'cat_bonus' && num > 0) items.push({ key: 'matchCatBonus', value: '' });
  }
  return { items, aiReason };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

export default function TenderWorkspace() {
  const { id } = useParams<{ id: string }>();
  const { t, language } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
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
  const [clarifications, setClarifications] = useState<ClarificationQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [orgMembers, setOrgMembers] = useState<Profile[]>([]);
  const [checklistFilter, setChecklistFilter] = useState<ChecklistFilter>('all');
  const [assignDropdownId, setAssignDropdownId] = useState<string | null>(null);
  const [expandedChecklistId, setExpandedChecklistId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, any[]>>({});
  const [commentText, setCommentText] = useState('');
  const [loadingComments, setLoadingComments] = useState<string | null>(null);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);

  // SIMAP document download state
  const [simapDocsLoading, setSimapDocsLoading] = useState(false);
  const [simapDocList, setSimapDocList] = useState<any[]>([]);
  const [simapDocPickerOpen, setSimapDocPickerOpen] = useState(false);
  const [simapSelectedIds, setSimapSelectedIds] = useState<Set<string>>(new Set());
  const [simapDownloading, setSimapDownloading] = useState(false);
  const [simapAuthenticated, setSimapAuthenticated] = useState(false);

  // Document upload state
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [docDragOver, setDocDragOver] = useState(false);
  const docFileInputRef = useRef<HTMLInputElement>(null);

  // Requirement expansion state
  const [expandedReqId, setExpandedReqId] = useState<string | null>(null);

  // Description expand state
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  const loadData = useCallback(async () => {
    if (!id) return;
    const [tRes, dRes, rRes, rkRes, dlRes, sRes, cRes, mRes, clRes] = await Promise.all([
      supabase.from('tenders').select('*').eq('id', id).single(),
      supabase.from('tender_documents').select('*').eq('tender_id', id).order('created_at', { ascending: false }),
      supabase.from('requirements').select('*').eq('tender_id', id).order('created_at', { ascending: true }),
      supabase.from('risks').select('*').eq('tender_id', id),
      supabase.from('deadlines').select('*').eq('tender_id', id).order('due_at', { ascending: true }),
      supabase.from('response_sections').select('*').eq('tender_id', id).order('created_at', { ascending: true }),
      supabase.from('checklist_items').select('*').eq('tender_id', id).order('created_at', { ascending: true }),
      supabase.from('requirement_matches').select('*').eq('tender_id', id).order('confidence_score', { ascending: false }),
      supabase.from('clarification_questions').select('*').eq('tender_id', id).order('created_at', { ascending: true }),
    ]);
    setTender(tRes.data);
    setDocs(dRes.data || []);
    setRequirements(rRes.data || []);
    setRisks(rkRes.data || []);
    setDeadlines(dlRes.data || []);
    setSections(sRes.data || []);
    setChecklist(cRes.data || []);
    setMatches(mRes.data || []);
    setClarifications(clRes.data || []);

    // Fetch knowledge assets if we have matches
    const matchData = mRes.data || [];
    if (matchData.length > 0) {
      const assetIds = [...new Set(matchData.map(m => m.knowledge_asset_id))];
      const { data: assets } = await supabase.from('knowledge_assets').select('*').in('id', assetIds);
      setKnowledgeAssets(assets || []);
    } else {
      setKnowledgeAssets([]);
    }

    // Load org members for assignments
    const tenderData = tRes.data;
    if (tenderData?.organization_id) {
      const { data: members } = await supabase
        .from('profiles')
        .select('*')
        .eq('organization_id', tenderData.organization_id)
        .order('full_name');
      setOrgMembers(members || []);
    }

    // Load activity logs
    const { data: logs } = await supabase
      .from('activity_logs')
      .select('*, profiles(full_name)')
      .eq('tender_id', id)
      .order('created_at', { ascending: false })
      .limit(15);
    setActivityLogs(logs || []);
  }, [id]);

  useEffect(() => {
    loadData().then(() => setLoading(false));
  }, [loadData]);

  // Check SIMAP auth status for SIMAP-sourced tenders
  useEffect(() => {
    if (tender?.simap_project_id) {
      callEdgeFunction('simap-auth', { action: 'status' })
        .then(r => setSimapAuthenticated(r.connected === true))
        .catch(() => setSimapAuthenticated(false));
    }
  }, [tender?.simap_project_id]);

  const handleDownloadSimapDocs = async () => {
    if (!tender?.simap_project_id) return;
    setSimapDocsLoading(true);
    setSimapDocPickerOpen(true);
    setSimapDocList([]);
    setSimapSelectedIds(new Set());
    try {
      const result = await callEdgeFunction('simap-documents', {
        action: 'list',
        simap_project_id: tender.simap_project_id,
      });
      const docs = result.documents || [];
      setSimapDocList(docs);
      setSimapSelectedIds(new Set(docs.map((d: any) => d.id)));
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
      setSimapDocPickerOpen(false);
    } finally {
      setSimapDocsLoading(false);
    }
  };

  const handleSimapDocDownload = async () => {
    if (!tender?.simap_project_id || !id || simapSelectedIds.size === 0) return;
    setSimapDownloading(true);
    try {
      const result = await callEdgeFunction('simap-documents', {
        action: 'download-all',
        simap_project_id: tender.simap_project_id,
        tender_id: id,
        document_ids: [...simapSelectedIds],
      });
      const count = result.documents?.length || 0;
      toast({ title: t('simap.downloadComplete'), description: `${count} ${t('simap.docsAvailable')}` });
      setSimapDocPickerOpen(false);
      // Reload docs
      const { data: newDocs } = await supabase
        .from('tender_documents')
        .select('*')
        .eq('tender_id', id)
        .order('created_at', { ascending: true });
      if (newDocs) setDocs(newDocs);
    } catch (err: any) {
      toast({ title: t('simap.downloadFailed'), description: err.message, variant: 'destructive' });
    } finally {
      setSimapDownloading(false);
    }
  };

  const logActivity = async (actionType: string, payload: Record<string, unknown> = {}) => {
    if (!user || !tender?.organization_id || !id) return;
    await supabase.from('activity_logs').insert({
      action_type: actionType,
      action_payload: payload,
      profile_id: user.id,
      tender_id: id,
      organization_id: tender.organization_id,
    });
  };

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
      logActivity(newStatus === 'done' ? 'checklist_completed' : 'checklist_reopened', { title: item.title });
    }
  };

  const handleAssignChecklist = async (itemId: string, profileId: string | null) => {
    const { error } = await supabase
      .from('checklist_items')
      .update({ owner_profile_id: profileId })
      .eq('id', itemId);
    if (!error) {
      setChecklist(prev => prev.map(c => c.id === itemId ? { ...c, owner_profile_id: profileId } : c));
      const item = checklist.find(c => c.id === itemId);
      logActivity('checklist_assigned', { title: item?.title, assignee: getMemberName(profileId) });

      // Create notification for the assignee (if not self-assigning)
      if (profileId && profileId !== user?.id && tender?.organization_id) {
        await supabase.from('notifications').insert({
          profile_id: profileId,
          organization_id: tender.organization_id,
          type: 'assignment',
          title: language === 'de' ? 'Neue Aufgabe zugewiesen' : 'New task assigned',
          body: item?.title || '',
          link: `/tenders/${id}?tab=checklist`,
        });
      }
    }
    setAssignDropdownId(null);
  };

  const getMemberName = (profileId: string | null) => {
    if (!profileId) return null;
    const member = orgMembers.find(m => m.id === profileId);
    return member?.full_name || null;
  };

  const getMemberInitial = (profileId: string | null) => {
    const name = getMemberName(profileId);
    return name ? name.charAt(0).toUpperCase() : '?';
  };

  const filteredChecklist = checklist.filter(c => {
    if (checklistFilter === 'mine') return c.owner_profile_id === user?.id;
    if (checklistFilter === 'unassigned') return !c.owner_profile_id;
    return true;
  });

  const handleExpandChecklist = async (itemId: string) => {
    if (expandedChecklistId === itemId) {
      setExpandedChecklistId(null);
      return;
    }
    setExpandedChecklistId(itemId);
    setCommentText('');
    if (!comments[itemId]) {
      setLoadingComments(itemId);
      const { data } = await supabase
        .from('comments')
        .select('*, profiles(full_name)')
        .eq('entity_type', 'checklist_item')
        .eq('entity_id', itemId)
        .order('created_at', { ascending: true });
      setComments(prev => ({ ...prev, [itemId]: data || [] }));
      setLoadingComments(null);
    }
  };

  const handleAddComment = async (itemId: string) => {
    const body = commentText.trim();
    if (!body || !user || !tender?.organization_id) return;
    const { data, error } = await supabase
      .from('comments')
      .insert({
        entity_type: 'checklist_item',
        entity_id: itemId,
        author_profile_id: user.id,
        organization_id: tender.organization_id,
        body,
      })
      .select('*, profiles(full_name)')
      .single();
    if (!error && data) {
      setComments(prev => ({ ...prev, [itemId]: [...(prev[itemId] || []), data] }));
      setCommentText('');
      logActivity('comment_added', { entity_type: 'checklist_item' });

      // Notify the checklist item owner (if not self)
      const item = checklist.find(c => c.id === itemId);
      if (item?.owner_profile_id && item.owner_profile_id !== user?.id && tender?.organization_id) {
        await supabase.from('notifications').insert({
          profile_id: item.owner_profile_id,
          organization_id: tender.organization_id,
          type: 'comment',
          title: language === 'de' ? 'Neuer Kommentar' : 'New comment',
          body: `${getMemberName(user?.id ?? null) || '—'}: ${body.slice(0, 100)}`,
          link: `/tenders/${id}?tab=checklist`,
        });
      }
    }
  };

  const handleDeleteComment = async (commentId: string, itemId: string) => {
    const { error } = await supabase.from('comments').delete().eq('id', commentId);
    if (!error) {
      setComments(prev => ({
        ...prev,
        [itemId]: (prev[itemId] || []).filter((c: any) => c.id !== commentId),
      }));
    }
  };

  const handleAddChecklistItem = async () => {
    if (!id || !tender || !newTaskTitle.trim()) return;
    const { data, error } = await supabase.from('checklist_items').insert({
      tender_id: id,
      organization_id: tender.organization_id,
      title: newTaskTitle.trim(),
      due_at: newTaskDue || null,
      status: 'open',
    }).select().single();
    if (error) {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    } else if (data) {
      setChecklist(prev => [...prev, data]);
      setNewTaskTitle('');
      setNewTaskDue('');
      toast({ title: t('workspace.taskAdded') });
    }
  };

  const handleDeleteChecklistItem = async (itemId: string) => {
    const { error } = await supabase.from('checklist_items').delete().eq('id', itemId);
    if (error) {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    } else {
      setChecklist(prev => prev.filter(c => c.id !== itemId));
      toast({ title: t('workspace.taskDeleted') });
    }
  };

  const handleBidDecision = async (decision: 'bid' | 'no_bid') => {
    if (!id || !tender) return;
    const newDecision = tender.bid_decision === decision ? null : decision;
    const { error } = await supabase
      .from('tenders')
      .update({ bid_decision: newDecision })
      .eq('id', id);
    if (error) {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    } else {
      setTender(prev => prev ? { ...prev, bid_decision: newDecision } : prev);
      logActivity('bid_decision_changed', { decision: newDecision });
      toast({ title: t('workspace.bidDecisionSaved') });
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

  const handleLoadSummary = async (matchId: string, assetId: string, requirementText: string) => {
    if (matchSummaries[matchId]) return; // Already cached
    setLoadingSummary(matchId);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const resp = await supabase.functions.invoke('summarize-match', {
        body: { knowledge_asset_id: assetId, requirement_text: requirementText, language },
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      if (resp.error) throw new Error(resp.error.message);
      const summary = resp.data?.summary || '';
      setMatchSummaries(prev => ({ ...prev, [matchId]: summary }));
    } catch (err: any) {
      console.error('Summary error:', err);
      setMatchSummaries(prev => ({ ...prev, [matchId]: '' }));
    } finally {
      setLoadingSummary(null);
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

  // Document upload handler
  const handleDocUpload = async (files: FileList | File[]) => {
    if (!id || !tender) return;
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    setUploadingDocs(true);
    try {
      const { data: orgData } = await supabase.rpc('current_organization_id');
      if (!orgData) throw new Error('No organization found');

      for (const file of fileArray) {
        const path = `${orgData}/${id}/${crypto.randomUUID()}_${file.name}`;
        const { error: uploadErr } = await supabase.storage.from('tender-files').upload(path, file);
        if (!uploadErr) {
          await supabase.from('tender_documents').insert({
            tender_id: id,
            organization_id: orgData,
            file_name: file.name,
            file_type: file.type || null,
            storage_path: path,
            parse_status: 'pending',
          });
        }
      }

      toast({ title: t('workspace.uploadSuccess'), description: t('workspace.uploadSuccessDesc') });
      await loadData();

      // Trigger processing chain (non-blocking)
      try {
        await callEdgeFunction('process-tender', { tender_id: id });
        try { await callEdgeFunction('match-knowledge-assets', { tender_id: id }); } catch {}
        try { await callEdgeFunction('generate-response', { tender_id: id }); } catch {}
        await loadData();
      } catch (err: any) {
        console.warn('[BidPilot] Processing after upload failed:', err.message);
      }
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    } finally {
      setUploadingDocs(false);
    }
  };

  const handleDocDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDocDragOver(false);
    if (e.dataTransfer.files.length) handleDocUpload(e.dataTransfer.files);
  };

  const [matchingInProgress, setMatchingInProgress] = useState(false);
  const [generatingResponse, setGeneratingResponse] = useState(false);

  const handleGenerateResponse = async () => {
    if (!id) return;
    setGeneratingResponse(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('No active session');
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-response`,
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
      if (!response.ok) throw new Error(result?.error || `Generation failed: ${response.status}`);
      toast({
        title: 'Response generated',
        description: `${result.sections_generated} sections drafted, ${result.gaps_found} gaps found, fit score: ${result.fit_score}%`,
      });
      await loadData();
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    } finally {
      setGeneratingResponse(false);
    }
  };

  const [exportingExcel, setExportingExcel] = useState(false);

  const handleExportFilledExcel = async () => {
    if (!id) return;
    const excelDoc = docs.find(d => {
      const ext = (d.file_name || '').toLowerCase().split('.').pop();
      return ext === 'xlsx';
    });
    if (!excelDoc) {
      toast({ title: t('common.error'), description: 'No Excel (.xlsx) document found in this tender.', variant: 'destructive' });
      return;
    }
    setExportingExcel(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('No active session');
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-filled-excel`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ tender_id: id, document_id: excelDoc.id }),
        }
      );
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.error || `Export failed: ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `FILLED_${excelDoc.file_name}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: 'Excel exported', description: `Downloaded FILLED_${excelDoc.file_name}` });
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    } finally {
      setExportingExcel(false);
    }
  };

  const [exportingDocx, setExportingDocx] = useState(false);

  const handleExportDocx = async () => {
    if (!id) return;
    setExportingDocx(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('No active session');
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-response-doc`,
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
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.error || `Export failed: ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeTitle = (tender?.title || 'Response').replace(/[^a-zA-Z0-9\u00C0-\u024F\s_-]/g, '').replace(/\s+/g, '_').slice(0, 80);
      a.download = `${safeTitle}_Response.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: 'DOCX exported', description: `Downloaded ${safeTitle}_Response.docx` });
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    } finally {
      setExportingDocx(false);
    }
  };

  const [generatingClarifications, setGeneratingClarifications] = useState(false);
  const [exportingClarifications, setExportingClarifications] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editingQuestionText, setEditingQuestionText] = useState('');
  const [deleteDocTarget, setDeleteDocTarget] = useState<Doc | null>(null);
  const [deletingDoc, setDeletingDoc] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDue, setNewTaskDue] = useState('');
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);
  const [matchSummaries, setMatchSummaries] = useState<Record<string, string>>({});
  const [loadingSummary, setLoadingSummary] = useState<string | null>(null);
  const [expandedTextMatchId, setExpandedTextMatchId] = useState<string | null>(null);

  const handleDeleteDocument = async () => {
    if (!deleteDocTarget) return;
    setDeletingDoc(true);
    try {
      // Delete from storage
      if (deleteDocTarget.storage_path) {
        await supabase.storage.from('tender-files').remove([deleteDocTarget.storage_path]);
      }
      // Delete DB row
      const { error } = await supabase.from('tender_documents').delete().eq('id', deleteDocTarget.id);
      if (error) throw error;
      toast({ title: t('workspace.documentDeleted') });
      loadData();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setDeletingDoc(false);
      setDeleteDocTarget(null);
    }
  };

  const handleGenerateClarifications = async () => {
    if (!id) return;
    setGeneratingClarifications(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('No active session');
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-clarification-questions`,
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
      if (!response.ok) throw new Error(result?.error || `Generation failed: ${response.status}`);
      toast({
        title: t('workspace.clarificationsGenerated'),
        description: `${result.count} ${t('workspace.questionsGenerated')}`,
      });
      await loadData();
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    } finally {
      setGeneratingClarifications(false);
    }
  };

  const handleExportClarificationsDocx = async () => {
    if (!id) return;
    setExportingClarifications(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('No active session');
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-clarifications-doc`,
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
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.error || `Export failed: ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeTitle = (tender?.title || 'Clarifications').replace(/[^a-zA-Z0-9\u00C0-\u024F\s_-]/g, '').replace(/\s+/g, '_').slice(0, 80);
      a.download = `${safeTitle}_Clarifications.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: 'DOCX exported', description: `Downloaded ${safeTitle}_Clarifications.docx` });
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    } finally {
      setExportingClarifications(false);
    }
  };

  const handleSaveQuestion = async (questionId: string, newText: string) => {
    const { error } = await supabase.from('clarification_questions').update({ question_text: newText }).eq('id', questionId);
    if (error) {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    } else {
      setClarifications(prev => prev.map(q => q.id === questionId ? { ...q, question_text: newText } : q));
      toast({ title: t('workspace.questionSaved') });
    }
    setEditingQuestionId(null);
  };

  const handleDeleteQuestion = async (questionId: string) => {
    const { error } = await supabase.from('clarification_questions').delete().eq('id', questionId);
    if (!error) {
      setClarifications(prev => prev.filter(q => q.id !== questionId));
    }
  };

  const handleUpdateQuestionStatus = async (questionId: string, status: string) => {
    const { error } = await supabase.from('clarification_questions').update({ status }).eq('id', questionId);
    if (!error) {
      setClarifications(prev => prev.map(q => q.id === questionId ? { ...q, status } : q));
    }
  };

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
    clarifications: t('workspace.clarifications'),
    checklist: t('workspace.checklist'),
  };

  const tabCounts: Partial<Record<Tab, number>> = {
    documents: docs.length,
    requirements: requirements.length,
    risks: risks.length + deadlines.length,
    knowledge: matches.length,
    draft: sections.length,
    clarifications: clarifications.length,
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
  const highRisks = risks.filter(r => r.severity === 'high' || r.severity === 'critical').length;
  const draftedSections = sections.filter(s => s.draft_text).length;
  const checklistProgress = checklist.length > 0 ? Math.round((completedChecklist / checklist.length) * 100) : 0;

  // Gap & readiness computations
  const matchedReqIds = new Set(matches.filter(m => m.status !== 'rejected').map(m => m.requirement_id));
  const unmatchedReqs = requirements.filter(r => !matchedReqIds.has(r.id));
  const gapSection = sections.find(s => s.section_title === 'Coverage Gaps');
  const fitScoreColor = (tender.fit_score ?? 0) >= 70 ? 'text-success' : (tender.fit_score ?? 0) >= 40 ? 'text-warning' : 'text-destructive';
  const hasExcelDoc = docs.some(d => (d.file_name || '').toLowerCase().endsWith('.xlsx'));

  // Composite readiness score
  const knowledgeFit = tender.fit_score ?? 0;
  const requirementsCoverage = requirements.length > 0 ? Math.round((matchedReqIds.size / requirements.length) * 100) : 0;
  const riskPenalty = Math.min(30, highRisks * 10);
  const readinessScore = Math.max(0, Math.min(100, Math.round(
    (knowledgeFit * 0.35) + (requirementsCoverage * 0.30) + (checklistProgress * 0.25) + ((100 - riskPenalty) * 0.10)
  )));
  const readinessColor = readinessScore >= 70 ? 'text-success' : readinessScore >= 40 ? 'text-warning' : 'text-destructive';

  // Bid recommendation factors
  const deadlineDays = tender.deadline
    ? Math.ceil((new Date(tender.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const proFactors: string[] = [];
  const conFactors: string[] = [];
  if (knowledgeFit >= 60) proFactors.push(t('workspace.bidPro.goodFit'));
  else conFactors.push(t('workspace.bidCon.lowFit'));
  if (requirementsCoverage >= 70) proFactors.push(t('workspace.bidPro.goodCoverage'));
  else if (requirementsCoverage < 40) conFactors.push(t('workspace.bidCon.lowCoverage'));
  if (highRisks === 0) proFactors.push(t('workspace.bidPro.noHighRisks'));
  else conFactors.push(t('workspace.bidCon.highRisks').replace('{n}', String(highRisks)));
  if (deadlineDays !== null && deadlineDays < 7) conFactors.push(t('workspace.bidCon.deadlineUrgent'));
  else if (deadlineDays !== null && deadlineDays > 14) proFactors.push(t('workspace.bidPro.timeAvailable'));
  const aiRecommendation: 'bid' | 'no_bid' | 'neutral' =
    readinessScore >= 60 && conFactors.length <= 1 ? 'bid' :
    readinessScore < 30 || conFactors.length >= 3 ? 'no_bid' : 'neutral';

  // Bid confidence percentage (weighted factors)
  const bidConfidence = Math.max(0, Math.min(100, Math.round(
    (knowledgeFit * 0.30) + (requirementsCoverage * 0.35) + ((100 - riskPenalty) * 0.20) + (checklistProgress * 0.15)
  )));

  // Recommendation explanation text
  const bidReasonText = aiRecommendation === 'bid'
    ? t('workspace.recommendBidReason').replace('{coverage}', String(requirementsCoverage)).replace('{fit}', String(knowledgeFit))
    : aiRecommendation === 'no_bid'
    ? t('workspace.recommendNoBidReason').replace('{coverage}', String(requirementsCoverage)).replace('{fit}', String(knowledgeFit)).replace('{risks}', String(highRisks))
    : t('workspace.recommendNeutralReason').replace('{coverage}', String(requirementsCoverage)).replace('{fit}', String(knowledgeFit));

  // Process steps for stepper
  const processSteps: { key: string; icon: any; label: string; tab: Tab; completed: boolean; active: boolean; detail: string }[] = [
    {
      key: 'documents',
      icon: FileText,
      label: t('process.documents'),
      tab: 'documents' as Tab,
      completed: docs.length > 0 && allDocsParsed && !isProcessing,
      active: isProcessing || (docs.length > 0 && !allDocsParsed),
      detail: docs.length === 0
        ? t('process.nextUpload')
        : isProcessing
        ? `${parsedDocs}/${docs.length} ${t('process.docsDetail')}`
        : `${parsedDocs} ${t('process.docsDetail')}`,
    },
    {
      key: 'analysis',
      icon: List,
      label: t('process.analysis'),
      tab: 'requirements' as Tab,
      completed: requirements.length > 0,
      active: allDocsParsed && !isProcessing && requirements.length === 0,
      detail: requirements.length > 0
        ? `${requirements.length} ${t('process.reqsDetail')}`
        : '',
    },
    {
      key: 'matching',
      icon: BookOpen,
      label: t('process.matching'),
      tab: 'knowledge' as Tab,
      completed: matches.length > 0,
      active: requirements.length > 0 && matches.length === 0,
      detail: matches.length > 0
        ? `${requirementsCoverage}% ${t('process.coverageDetail')}`
        : '',
    },
    {
      key: 'draft',
      icon: Edit,
      label: t('process.draft'),
      tab: 'draft' as Tab,
      completed: draftedSections > 0,
      active: matches.length > 0 && draftedSections === 0,
      detail: sections.length > 0
        ? `${draftedSections}/${sections.length} ${t('process.sectionsDetail')}`
        : '',
    },
    {
      key: 'review',
      icon: CheckSquare,
      label: t('process.review'),
      tab: 'checklist' as Tab,
      completed: checklistProgress === 100 && tender.bid_decision != null,
      active: draftedSections > 0 && (checklistProgress < 100 || !tender.bid_decision),
      detail: tender.bid_decision
        ? tender.bid_decision === 'bid' ? t('workspace.bidDecisionBid') : t('workspace.bidDecisionNoBid')
        : checklist.length > 0 ? `${checklistProgress}%` : '',
    },
  ];

  // Determine the current active step index
  const activeStepIndex = processSteps.findIndex(s => s.active);
  const completedStepCount = processSteps.filter(s => s.completed).length;

  // Next action guidance
  const nextAction = (() => {
    if (docs.length === 0) return {
      key: 'upload',
      label: t('process.nextUpload'),
      description: t('process.nextUploadDesc'),
      action: () => setActiveTab('documents'),
      icon: FileText,
      loading: false,
      complete: false,
    };
    if (isProcessing) return {
      key: 'processing',
      label: t('process.nextProcessing'),
      description: t('process.nextProcessingDesc'),
      action: null,
      icon: Loader2,
      loading: true,
      complete: false,
    };
    if (requirements.length === 0 && allDocsParsed) return {
      key: 'reprocess',
      label: t('workspace.retryProcessing'),
      description: t('process.nextUploadDesc'),
      action: () => handleReprocessDocuments(),
      icon: RefreshCw,
      loading: reprocessing,
      complete: false,
    };
    if (matches.length === 0 && requirements.length > 0) return {
      key: 'matching',
      label: t('process.nextMatching'),
      description: t('process.nextMatchingDesc'),
      action: () => handleRetryMatching(),
      icon: BookOpen,
      loading: matchingInProgress,
      complete: false,
    };
    if (draftedSections === 0 && requirements.length > 0) return {
      key: 'draft',
      label: t('process.nextDraft'),
      description: t('process.nextDraftDesc'),
      action: () => handleGenerateResponse(),
      icon: Sparkles,
      loading: generatingResponse,
      complete: false,
    };
    if (checklist.length > 0 && checklistProgress < 100) return {
      key: 'checklist',
      label: t('process.nextChecklist'),
      description: t('process.nextChecklistDesc'),
      action: () => setActiveTab('checklist'),
      icon: CheckSquare,
      loading: false,
      complete: false,
    };
    if (!tender.bid_decision) return {
      key: 'decision',
      label: t('process.nextDecision'),
      description: t('process.nextDecisionDesc'),
      action: null,
      icon: Target,
      loading: false,
      complete: false,
    };
    return {
      key: 'complete',
      label: t('process.allComplete'),
      description: t('process.allCompleteDesc'),
      action: null,
      icon: CheckCircle2,
      loading: false,
      complete: true,
    };
  })();

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
            {tender.description && (() => {
              const cleanDesc = stripHtml(tender.description);
              const isLong = cleanDesc.length > 200;
              return (
                <div className="mt-2">
                  <p className={`text-sm text-muted-foreground ${!descriptionExpanded && isLong ? 'line-clamp-3' : ''}`}>
                    {cleanDesc}
                  </p>
                  {isLong && (
                    <button
                      onClick={() => setDescriptionExpanded(!descriptionExpanded)}
                      className="text-xs text-primary hover:underline mt-1 inline-flex items-center gap-1"
                    >
                      {descriptionExpanded ? (
                        <>{t('workspace.showLess')} <ChevronUp className="h-3 w-3" /></>
                      ) : (
                        <>{t('workspace.showMore')} <ChevronDown className="h-3 w-3" /></>
                      )}
                    </button>
                  )}
                </div>
              );
            })()}
            {/* Metadata pills */}
            {(tender.canton || tender.process_type || tender.publication_number || (tender.cpv_codes && tender.cpv_codes.length > 0)) && (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {tender.canton && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">{tender.canton}</span>
                )}
                {tender.process_type && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">{tender.process_type}</span>
                )}
                {tender.publication_number && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">Nr. {tender.publication_number}</span>
                )}
                {tender.cpv_codes && tender.cpv_codes.length > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">CPV: {tender.cpv_codes.slice(0, 3).join(', ')}</span>
                )}
              </div>
            )}
            {/* Contact info */}
            {tender.contact_info && Object.keys(tender.contact_info).length > 0 && (
              <div className="mt-2 p-3 rounded-lg bg-muted/50 border border-border/50">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{t('workspace.contactInfo')}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground/80">
                  {tender.contact_info.name && (
                    <span className="font-medium">{tender.contact_info.name}</span>
                  )}
                  {(tender.contact_info.street || tender.contact_info.city) && (
                    <span>{[tender.contact_info.street, [tender.contact_info.zip, tender.contact_info.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</span>
                  )}
                  {tender.contact_info.email && (
                    <a href={`mailto:${tender.contact_info.email}`} className="flex items-center gap-1 text-primary hover:underline">
                      <Mail className="h-3 w-3" />{tender.contact_info.email}
                    </a>
                  )}
                  {tender.contact_info.phone && (
                    <a href={`tel:${tender.contact_info.phone}`} className="flex items-center gap-1 text-primary hover:underline">
                      <Phone className="h-3 w-3" />{tender.contact_info.phone}
                    </a>
                  )}
                  {tender.contact_info.url && (
                    <a href={tender.contact_info.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                      <Globe className="h-3 w-3" />{new URL(tender.contact_info.url).hostname}
                    </a>
                  )}
                </div>
              </div>
            )}
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
            {/* Process Stepper */}
            <div className="glass-card p-5">
              <div className="flex items-center gap-2 mb-5">
                <Target className="h-4 w-4 text-primary" />
                <h3 className="font-heading font-semibold text-sm">{t('process.title')}</h3>
                <span className="ml-auto text-xs text-muted-foreground">
                  {completedStepCount}/{processSteps.length} {t('process.completed').toLowerCase()}
                </span>
              </div>

              {/* Stepper visual */}
              <div className="flex items-start gap-0">
                {processSteps.map((step, i) => {
                  const StepIcon = step.icon;
                  const isCompleted = step.completed;
                  const isActive = step.active && !step.completed;
                  const isPending = !step.completed && !step.active;

                  return (
                    <React.Fragment key={step.key}>
                      <button
                        onClick={() => setActiveTab(step.tab)}
                        className={`flex-1 flex flex-col items-center text-center group cursor-pointer transition-opacity hover:opacity-80`}
                        title={`${t('process.goToTab')}: ${step.label}`}
                      >
                        {/* Step circle */}
                        <div className={`relative h-10 w-10 rounded-full flex items-center justify-center transition-all duration-300 group-hover:scale-110 ${
                          isCompleted
                            ? 'bg-success text-white'
                            : isActive
                            ? 'bg-primary text-white ring-4 ring-primary/20'
                            : 'bg-muted text-muted-foreground group-hover:bg-muted/80'
                        }`}>
                          {isCompleted ? (
                            <Check className="h-4 w-4" />
                          ) : isActive ? (
                            <StepIcon className={`h-4 w-4 ${step.key === 'documents' && isProcessing ? 'animate-pulse' : ''}`} />
                          ) : (
                            <StepIcon className="h-4 w-4" />
                          )}
                          {isActive && !isProcessing && (
                            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-primary animate-ping" />
                          )}
                        </div>
                        {/* Label */}
                        <p className={`mt-2 text-xs font-medium leading-tight ${
                          isCompleted ? 'text-success' : isActive ? 'text-primary' : 'text-muted-foreground'
                        }`}>
                          {step.label}
                        </p>
                        {/* Detail */}
                        {step.detail && (
                          <p className={`mt-0.5 text-[10px] leading-tight ${
                            isCompleted ? 'text-success/70' : isActive ? 'text-primary/70' : 'text-muted-foreground/50'
                          }`}>
                            {step.detail}
                          </p>
                        )}
                      </button>
                      {/* Connector line */}
                      {i < processSteps.length - 1 && (
                        <div className="flex items-center pt-5 px-0 shrink-0">
                          <div className={`w-6 lg:w-10 h-0.5 rounded transition-colors ${
                            isCompleted ? 'bg-success' : 'bg-border'
                          }`} />
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            {/* Next Action guidance */}
            {!nextAction.complete ? (
              <div className={`glass-card p-5 ${
                nextAction.loading
                  ? 'border-warning/30 bg-warning/5'
                  : 'border-primary/30 bg-primary/5'
              }`}>
                <div className="flex items-start gap-4">
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${
                    nextAction.loading ? 'bg-warning/15' : 'bg-primary/15'
                  }`}>
                    <nextAction.icon className={`h-5 w-5 ${
                      nextAction.loading ? 'text-warning animate-spin' : 'text-primary'
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-primary">{t('process.nextStep')}</span>
                    </div>
                    <p className="text-sm font-semibold mt-1">{nextAction.label}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{nextAction.description}</p>
                    {isProcessing && docs.length > 0 && (
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
                  {nextAction.action && !nextAction.loading && (
                    <Button size="sm" onClick={nextAction.action} className="shrink-0">
                      {nextAction.label}
                      <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                    </Button>
                  )}
                  {nextAction.loading && (
                    <Button size="sm" variant="ghost" onClick={handleRefresh} disabled={refreshing} className="shrink-0">
                      <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
                      Refresh
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="glass-card p-4 border-success/30 bg-success/5 flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-success">{nextAction.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{nextAction.description}</p>
                </div>
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

            {/* Fit Score & Readiness */}
            {tender.fit_score != null && (
              <div className="glass-card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Gauge className="h-4 w-4 text-primary" />
                  <h3 className="font-heading font-semibold text-sm">Fit Score & Readiness</h3>
                </div>
                <div className="grid gap-4 sm:grid-cols-4">
                  <div className="text-center p-4 rounded-lg bg-muted/50">
                    <p className={`text-3xl font-bold font-heading ${fitScoreColor}`}>{tender.fit_score}%</p>
                    <p className="text-xs text-muted-foreground mt-1">{t('workspace.fitScore')}</p>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-muted/50">
                    <p className="text-3xl font-bold font-heading text-foreground">
                      {requirementsCoverage}%
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{t('workspace.requirements')}</p>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-muted/50">
                    <p className="text-3xl font-bold font-heading text-foreground">{checklistProgress}%</p>
                    <p className="text-xs text-muted-foreground mt-1">{t('workspace.checklist')}</p>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-muted/50">
                    <p className={`text-3xl font-bold font-heading ${readinessColor}`}>{readinessScore}%</p>
                    <p className="text-xs text-muted-foreground mt-1">{t('workspace.readinessScore')}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Bid Decision */}
            <div className="glass-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Target className="h-4 w-4 text-primary" />
                <h3 className="font-heading font-semibold text-sm">{t('workspace.bidDecision')}</h3>
                {tender.bid_decision && (
                  <span className={`ml-auto text-xs font-medium px-2.5 py-0.5 rounded-full ${
                    tender.bid_decision === 'bid' ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'
                  }`}>
                    {tender.bid_decision === 'bid' ? t('workspace.bidDecisionBid') : t('workspace.bidDecisionNoBid')}
                  </span>
                )}
              </div>

              {/* AI Recommendation with confidence % and explanation */}
              {tender.fit_score != null && (
                <div className={`rounded-lg p-4 mb-4 ${
                  aiRecommendation === 'bid' ? 'bg-success/5 border border-success/20' :
                  aiRecommendation === 'no_bid' ? 'bg-destructive/5 border border-destructive/20' :
                  'bg-muted/50 border border-border'
                }`}>
                  <div className="flex items-center gap-3 mb-3">
                    <Sparkles className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold">{t('workspace.aiRecommendation')}</span>
                        <span className={`text-xs font-bold ${
                          aiRecommendation === 'bid' ? 'text-success' : aiRecommendation === 'no_bid' ? 'text-destructive' : 'text-muted-foreground'
                        }`}>
                          {aiRecommendation === 'bid' ? t('workspace.recommendBid') :
                           aiRecommendation === 'no_bid' ? t('workspace.recommendNoBid') :
                           t('workspace.recommendNeutral')}
                        </span>
                      </div>
                    </div>
                    <div className={`text-right shrink-0 ${
                      bidConfidence >= 60 ? 'text-success' : bidConfidence >= 35 ? 'text-warning' : 'text-destructive'
                    }`}>
                      <p className="text-2xl font-bold font-heading">{bidConfidence}%</p>
                      <p className="text-[10px] text-muted-foreground">{t('workspace.bidConfidence')}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{bidReasonText}</p>
                </div>
              )}

              {/* Pros/Cons */}
              {(proFactors.length > 0 || conFactors.length > 0) && (
                <div className="grid sm:grid-cols-2 gap-3 mb-4">
                  {proFactors.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-success">{t('workspace.bidPros')}</p>
                      {proFactors.map((f, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <CheckCircle2 className="h-3 w-3 text-success shrink-0 mt-0.5" />
                          <span>{f}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {conFactors.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-destructive">{t('workspace.bidCons')}</p>
                      {conFactors.map((f, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <XCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                          <span>{f}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Decision buttons */}
              <div className="flex gap-3">
                <Button
                  size="sm"
                  variant={tender.bid_decision === 'bid' ? 'default' : 'outline'}
                  className={`flex-1 ${tender.bid_decision === 'bid' ? 'bg-success hover:bg-success/90 text-white' : 'border-success/30 text-success hover:bg-success/10'}`}
                  onClick={() => handleBidDecision('bid')}
                >
                  <ThumbsUp className="h-3.5 w-3.5 mr-1.5" />
                  {t('workspace.bidDecisionBid')}
                </Button>
                <Button
                  size="sm"
                  variant={tender.bid_decision === 'no_bid' ? 'default' : 'outline'}
                  className={`flex-1 ${tender.bid_decision === 'no_bid' ? 'bg-destructive hover:bg-destructive/90 text-white' : 'border-destructive/30 text-destructive hover:bg-destructive/10'}`}
                  onClick={() => handleBidDecision('no_bid')}
                >
                  <ThumbsDown className="h-3.5 w-3.5 mr-1.5" />
                  {t('workspace.bidDecisionNoBid')}
                </Button>
              </div>
            </div>

            {/* Coverage Gaps */}
            {unmatchedReqs.length > 0 && requirements.length > 0 && (
              <div className="glass-card p-5 border-warning/30">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-warning" />
                    <h3 className="font-heading font-semibold text-sm">Coverage Gaps</h3>
                    <span className="text-xs text-muted-foreground">({unmatchedReqs.length} of {requirements.length} requirements)</span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setActiveTab('knowledge')} className="text-xs">
                    View Knowledge Matches
                    <ArrowLeft className="h-3 w-3 ml-1 rotate-180" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  These requirements have no matching knowledge assets. Upload relevant documents to Company Memory to improve coverage.
                </p>
                <div className="space-y-1.5">
                  {unmatchedReqs.slice(0, 5).map(r => (
                    <div key={r.id} className="flex items-start gap-2 text-sm">
                      <span className={`shrink-0 text-[10px] mt-0.5 px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                        r.mandatory ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground'
                      }`}>
                        {r.mandatory ? 'M' : 'O'}
                      </span>
                      <span className="text-muted-foreground leading-snug">{r.text}</span>
                    </div>
                  ))}
                  {unmatchedReqs.length > 5 && (
                    <p className="text-xs text-muted-foreground/60 pl-6">+{unmatchedReqs.length - 5} more gaps</p>
                  )}
                </div>
              </div>
            )}

            {/* High Risks Summary */}
            {highRisks > 0 && (
              <div className="glass-card p-5 border-destructive/30">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-destructive" />
                    <h3 className="font-heading font-semibold text-sm">Attention Required</h3>
                    <span className="text-xs text-destructive font-medium">{highRisks} high/critical risks</span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setActiveTab('risks')} className="text-xs">
                    View Risks
                    <ArrowLeft className="h-3 w-3 ml-1 rotate-180" />
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {risks.filter(r => r.severity === 'high' || r.severity === 'critical').slice(0, 3).map(r => (
                    <div key={r.id} className="flex items-start gap-2 text-sm">
                      <span className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${r.severity === 'critical' ? 'bg-destructive' : 'bg-destructive/70'}`} />
                      <span className="text-muted-foreground leading-snug">{r.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Activity Feed */}
            {activityLogs.length > 0 && (
              <div className="glass-card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-heading font-semibold text-sm">{t('workspace.recentActivity')}</h3>
                </div>
                <div className="space-y-3">
                  {activityLogs.map((log: any) => {
                    const actionIcons: Record<string, any> = {
                      tender_created: Target,
                      document_uploaded: FileText,
                      processing_complete: CheckCircle2,
                      response_generated: Edit,
                      checklist_assigned: UserCircle2,
                      checklist_completed: CheckSquare,
                      checklist_reopened: Circle,
                      comment_added: MessageSquare,
                      document_deleted: Trash2,
                    };
                    const Icon = actionIcons[log.action_type] || Info;
                    return (
                      <div key={log.id} className="flex items-start gap-3">
                        <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                          <Icon className="h-3 w-3 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs">
                            <span className="font-medium">{log.profiles?.full_name || '—'}</span>
                            {' '}
                            <span className="text-muted-foreground">{t(`activity.${log.action_type}` as any) || log.action_type}</span>
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {formatDistanceToNow(new Date(log.created_at), { addSuffix: true, locale: dateFnsLocale })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* DOCUMENTS */}
        {activeTab === 'documents' && (
          <div className="space-y-4">
            {/* Upload zone */}
            <div
              onClick={() => !uploadingDocs && docFileInputRef.current?.click()}
              onDrop={handleDocDrop}
              onDragOver={(e) => { e.preventDefault(); setDocDragOver(true); }}
              onDragLeave={() => setDocDragOver(false)}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                docDragOver
                  ? 'border-primary bg-primary/5 scale-[1.01]'
                  : 'border-border hover:border-primary/50 hover:bg-accent/30'
              } ${uploadingDocs ? 'pointer-events-none opacity-60' : ''}`}
            >
              {uploadingDocs ? (
                <>
                  <Loader2 className="h-8 w-8 mx-auto mb-2 text-primary animate-spin" />
                  <p className="text-sm font-medium text-foreground">{t('workspace.uploading')}</p>
                </>
              ) : (
                <>
                  <Upload className={`h-8 w-8 mx-auto mb-2 transition-colors ${docDragOver ? 'text-primary' : 'text-muted-foreground'}`} />
                  <p className="text-sm font-medium text-foreground">
                    {docDragOver ? t('tender.dropFilesActive') : t('workspace.uploadDocuments')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{t('workspace.uploadDocumentsHint')}</p>
                </>
              )}
              <input
                ref={docFileInputRef}
                type="file"
                multiple
                onChange={(e) => { if (e.target.files?.length) { handleDocUpload(e.target.files); e.target.value = ''; } }}
                className="hidden"
              />
            </div>

            {/* SIMAP download button */}
            {tender?.simap_project_id && simapAuthenticated && (
              <div className="flex justify-center">
                <Button size="sm" variant="outline" onClick={handleDownloadSimapDocs} disabled={simapDocsLoading}>
                  {simapDocsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Paperclip className="h-3.5 w-3.5 mr-1.5" />}
                  {t('simap.downloadDocs')}
                </Button>
              </div>
            )}

            {docs.length === 0 ? (
              <EmptyState icon={FileText} title={t('workspace.noDocuments')} />
            ) : (
              <>
                {/* Document stats bar */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{docs.length} {t('workspace.documents').toLowerCase()}</span>
                    <span className="w-px h-3 bg-border" />
                    <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-success" />{parsedDocs} parsed</span>
                    {pendingDocs > 0 && <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 text-warning animate-spin" />{pendingDocs} processing</span>}
                    {failedDocs > 0 && <span className="flex items-center gap-1"><XCircle className="h-3 w-3 text-destructive" />{failedDocs} failed</span>}
                  </div>
                  <Button size="sm" variant="outline" onClick={handleReprocessDocuments} disabled={reprocessing}>
                    {reprocessing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                    Reprocess Documents
                  </Button>
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
                        <button
                          onClick={() => setDeleteDocTarget(d)}
                          className="text-muted-foreground hover:text-destructive transition-colors p-1.5 rounded hover:bg-destructive/10 shrink-0"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* REQUIREMENTS */}
        {activeTab === 'requirements' && (() => {
          // Build a set of requirement IDs that have at least one non-rejected match
          const fulfilledReqIds = new Set(
            matches
              .filter(m => m.status !== 'rejected' && (m.confidence_score ?? 0) >= 40)
              .map(m => m.requirement_id)
          );
          const fulfilledCount = requirements.filter(r => fulfilledReqIds.has(r.id)).length;

          return requirements.length === 0 ? (
            <EmptyState icon={List} title={t('workspace.noRequirements')} description={pendingDocs > 0 ? t('workspace.processingHint') : undefined} />
          ) : (
            <div className="space-y-4">
              {/* Req stats */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                <span>{requirements.length} {t('workspace.requirements').toLowerCase()}</span>
                <span className="w-px h-3 bg-border" />
                <span className="text-destructive font-medium">{mandatoryReqs} {t('workspace.mandatory').toLowerCase()}</span>
                <span>{requirements.length - mandatoryReqs} {t('workspace.optional').toLowerCase()}</span>
                {matches.length > 0 && (
                  <>
                    <span className="w-px h-3 bg-border" />
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-success" />
                      <span className="text-success font-medium">
                        {t('workspace.reqFulfilledCount')
                          .replace('{count}', String(fulfilledCount))
                          .replace('{total}', String(requirements.length))}
                      </span>
                    </span>
                  </>
                )}
              </div>

              <div className="space-y-2">
                {requirements.map((r, idx) => {
                  const isFulfilled = fulfilledReqIds.has(r.id);
                  const reqMatches = matches.filter(m => m.requirement_id === r.id && m.status !== 'rejected');
                  const bestScore = reqMatches.length > 0 ? Math.max(...reqMatches.map(m => m.confidence_score ?? 0)) : 0;
                  const isExpanded = expandedReqId === r.id;

                  return (
                    <div
                      key={r.id}
                      onClick={() => matches.length > 0 && setExpandedReqId(isExpanded ? null : r.id)}
                      className={`glass-card px-5 py-4 transition-all ${
                        matches.length > 0 ? 'cursor-pointer hover:border-primary/20' : ''
                      } ${
                        matches.length > 0 ? (isFulfilled ? 'border-l-2 border-l-success/50' : 'border-l-2 border-l-destructive/30') : ''
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex items-center justify-center h-6 w-6 rounded bg-muted text-[10px] font-bold text-muted-foreground shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm leading-relaxed">{r.text}</p>
                          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
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
                            {matches.length > 0 && (
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 ${
                                isFulfilled
                                  ? 'bg-success/15 text-success'
                                  : 'bg-destructive/10 text-destructive'
                              }`}>
                                {isFulfilled ? (
                                  <><CheckCircle2 className="h-2.5 w-2.5" />{t('workspace.fulfilled')} ({bestScore}%)</>
                                ) : (
                                  <><XCircle className="h-2.5 w-2.5" />{t('workspace.unfulfilled')}</>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                        {matches.length > 0 && (
                          <div className="shrink-0 mt-0.5 text-muted-foreground">
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </div>
                        )}
                      </div>

                      {/* Expanded explanation */}
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-border/50 ml-9">
                          {reqMatches.length > 0 ? (
                            <div className="space-y-2.5">
                              {reqMatches.slice(0, 3).map(m => {
                                const { aiReason } = parseMatchReason(m.match_reason);
                                const asset = knowledgeAssets.find(a => a.id === m.knowledge_asset_id);
                                return (
                                  <div key={m.id} className="flex items-start gap-2 text-xs">
                                    <CheckCircle2 className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {asset && <span className="font-medium text-foreground">{asset.title}</span>}
                                        <span className="text-muted-foreground">({m.confidence_score}%)</span>
                                      </div>
                                      {aiReason && (
                                        <p className="text-muted-foreground mt-0.5 italic leading-relaxed">{aiReason}</p>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                              {reqMatches.length > 3 && (
                                <p className="text-[10px] text-muted-foreground">
                                  +{reqMatches.length - 3} weitere Matches
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground italic">
                              {t('workspace.noMatchesFound')} {t('workspace.noMatchesHint')}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

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
                    const riskTypeLabel = t(`riskType.${r.risk_type}` as any) || r.risk_type.replace(/_/g, ' ');
                    const severityLabel = r.severity ? (t(`severity.${r.severity}` as any) || r.severity) : '';
                    const displayTitle = (r as any).title || riskTypeLabel;
                    return (
                      <div key={r.id} className="glass-card px-5 py-4 hover:border-primary/20 transition-colors">
                        <div className="flex items-start gap-3">
                          <span className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${sev.dot}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">{displayTitle}</span>
                              {r.severity && (
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${sev.color}`}>
                                  {severityLabel}
                                </span>
                              )}
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                                {riskTypeLabel}
                              </span>
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
                    const deadlineTypeLabel = t(`deadlineType.${d.deadline_type}` as any) || d.deadline_type.replace(/_/g, ' ');
                    return (
                      <div key={d.id} className="glass-card px-5 py-4 hover:border-primary/20 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <Clock className={`h-4 w-4 mt-0.5 shrink-0 ${isPast ? 'text-destructive' : 'text-warning'}`} />
                            <div>
                              <span className="text-sm font-medium">{deadlineTypeLabel}</span>
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

            {/* Explanation banner */}
            {matches.length > 0 && (
              <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-muted/30 border border-border/50">
                <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">{t('workspace.matchExplanation')}</p>
              </div>
            )}

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
                            const matchStatusColors: Record<string, string> = {
                              suggested: 'bg-primary/10 text-primary',
                              accepted: 'bg-success/15 text-success',
                              rejected: 'bg-destructive/15 text-destructive',
                            };
                            const isExpanded = expandedMatchId === match.id;
                            const { items: reasons, aiReason } = parseMatchReason(match.match_reason);
                            const fileExt = asset?.storage_path ? asset.storage_path.split('.').pop()?.toUpperCase() : null;
                            const textPreview = asset?.extracted_text ? asset.extracted_text.slice(0, 200).trim() + (asset.extracted_text.length > 200 ? '...' : '') : null;

                            return (
                              <div key={match.id}>
                                <div
                                  className={`px-5 py-3.5 flex items-center gap-4 cursor-pointer transition-colors hover:bg-accent/30 ${match.status === 'rejected' ? 'opacity-50' : ''}`}
                                  onClick={() => {
                                    const newExpanded = isExpanded ? null : match.id;
                                    setExpandedMatchId(newExpanded);
                                    if (newExpanded && asset) {
                                      handleLoadSummary(match.id, match.knowledge_asset_id, req.text);
                                    }
                                  }}
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="text-sm font-medium truncate">{asset?.title || 'Unknown asset'}</p>
                                      {asset?.asset_type && (
                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium capitalize shrink-0">
                                          {asset.asset_type.replace('_', ' ')}
                                        </span>
                                      )}
                                      {fileExt && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/70 text-muted-foreground font-mono shrink-0">
                                          {fileExt}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-3 mt-1">
                                      <span className="text-xs text-muted-foreground">
                                        {t('workspace.confidence')}: <span className="font-semibold text-foreground">{match.confidence_score}%</span>
                                      </span>
                                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${matchStatusColors[match.status] || 'bg-muted text-muted-foreground'}`}>
                                        {match.status === 'suggested' ? t('workspace.matchSuggested') : match.status === 'accepted' ? t('workspace.matchAccepted') : t('workspace.matchRejected')}
                                      </span>
                                      {aiReason && !isExpanded && (
                                        <span className="text-[10px] text-muted-foreground/60 truncate max-w-[300px]" title={aiReason}>
                                          {aiReason}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  {match.status === 'suggested' && (
                                    <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 px-2 text-success hover:bg-success/10 hover:text-success text-xs gap-1"
                                        onClick={() => handleUpdateMatchStatus(match.id, 'accepted')}
                                        title={t('workspace.acceptMatch')}
                                      >
                                        <Check className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive text-xs gap-1"
                                        onClick={() => handleUpdateMatchStatus(match.id, 'rejected')}
                                        title={t('workspace.rejectMatch')}
                                      >
                                        <XIcon className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  )}
                                </div>

                                {/* Expanded details */}
                                {isExpanded && (
                                  <div className="px-5 pb-4 pt-0 border-t border-border/30 bg-muted/20">
                                    <div className="pt-3 space-y-3">
                                      {/* AI Summary */}
                                      <div>
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
                                          <Sparkles className="h-3 w-3" />
                                          {t('workspace.aiSummary')}
                                        </p>
                                        {loadingSummary === match.id ? (
                                          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-background/50 rounded p-3 border border-border/30">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                                            <span>{t('workspace.loadingSummary')}</span>
                                          </div>
                                        ) : matchSummaries[match.id] ? (
                                          <p className="text-xs text-foreground/80 leading-relaxed bg-primary/5 rounded p-3 border border-primary/20">
                                            {matchSummaries[match.id]}
                                          </p>
                                        ) : matchSummaries[match.id] === '' ? (
                                          <p className="text-xs text-muted-foreground/50 italic bg-background/50 rounded p-3 border border-border/30">
                                            {t('workspace.noPreview')}
                                          </p>
                                        ) : null}
                                      </div>

                                      {/* Match reasons */}
                                      {(reasons.length > 0 || aiReason) && (
                                        <div>
                                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{t('workspace.whyMatch')}</p>
                                          {aiReason && (
                                            <p className="text-xs text-foreground/80 leading-relaxed mb-2 italic">
                                              {aiReason}
                                            </p>
                                          )}
                                          {reasons.length > 0 && (
                                            <div className="space-y-1">
                                              {reasons.map((r, i) => (
                                                <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                                                  <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                                                  <span>{t(`workspace.${r.key}` as any)}{r.value ? ` ${r.value}` : ''}</span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {/* Text preview with expand/collapse */}
                                      <div>
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{t('workspace.textPreview')}</p>
                                        {asset?.extracted_text ? (() => {
                                          const isTextExpanded = expandedTextMatchId === match.id;
                                          const fullText = asset.extracted_text || '';
                                          const shortText = fullText.slice(0, 200).trim() + (fullText.length > 200 ? '...' : '');
                                          const longText = fullText.slice(0, 1500).trim() + (fullText.length > 1500 ? '...' : '');
                                          return (
                                            <div>
                                              <p className="text-xs text-muted-foreground leading-relaxed bg-background/50 rounded p-2.5 border border-border/30 whitespace-pre-wrap">
                                                {isTextExpanded ? longText : shortText}
                                              </p>
                                              {fullText.length > 200 && (
                                                <button
                                                  onClick={(e) => { e.stopPropagation(); setExpandedTextMatchId(isTextExpanded ? null : match.id); }}
                                                  className="mt-1.5 text-xs text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
                                                >
                                                  {isTextExpanded ? (
                                                    <><ChevronUp className="h-3 w-3" /> {t('workspace.showLess')}</>
                                                  ) : (
                                                    <><ChevronDown className="h-3 w-3" /> {t('workspace.showMore')}</>
                                                  )}
                                                </button>
                                              )}
                                            </div>
                                          );
                                        })() : (
                                          <p className="text-xs text-muted-foreground/50 italic">{t('workspace.noPreview')}</p>
                                        )}
                                      </div>

                                      {/* Tags */}
                                      {asset?.tags && asset.tags.length > 0 && (
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <Tag className="h-3 w-3 text-muted-foreground" />
                                          {asset.tags.map((tag, i) => (
                                            <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                                              {tag}
                                            </span>
                                          ))}
                                        </div>
                                      )}

                                      {/* Document link — opens original file */}
                                      {asset?.storage_path && (
                                        <div className="flex items-center gap-3 pt-1 border-t border-border/20">
                                          <button
                                            onClick={async (e) => {
                                              e.stopPropagation();
                                              try {
                                                const { data, error } = await supabase.storage.from('knowledge-assets').createSignedUrl(asset.storage_path!, 600);
                                                if (error || !data?.signedUrl) {
                                                  toast({ title: t('common.error'), description: 'Datei nicht gefunden / File not found', variant: 'destructive' });
                                                  return;
                                                }
                                                window.open(data.signedUrl, '_blank');
                                              } catch {
                                                toast({ title: t('common.error'), description: 'Datei nicht gefunden / File not found', variant: 'destructive' });
                                              }
                                            }}
                                            className="text-xs text-primary hover:text-primary/80 flex items-center gap-1.5 transition-colors font-medium"
                                          >
                                            <ExternalLink className="h-3.5 w-3.5" />
                                            {t('workspace.openDocument')}
                                          </button>
                                          {fileExt && (
                                            <span className="text-[10px] text-muted-foreground/60">{fileExt}</span>
                                          )}
                                        </div>
                                      )}
                                    </div>
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
            <EmptyState
              icon={Edit}
              title={t('workspace.noDraft')}
              description={requirements.length > 0 ? 'Use AI to draft response sections based on your requirements and matched knowledge assets.' : 'Process the tender first to extract requirements.'}
              action={requirements.length > 0 ? (
                <Button size="sm" variant="outline" onClick={handleGenerateResponse} disabled={generatingResponse}>
                  {generatingResponse ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                  Generate AI Draft
                </Button>
              ) : undefined}
            />
          ) : (
            <div className="space-y-4">
              {/* Draft progress + generate button */}
              <div className="glass-card p-4 flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">{t('workspace.draftSections')}</span>
                    <span className="text-xs font-semibold">{draftedSections}/{sections.length}</span>
                  </div>
                  <Progress value={sections.length > 0 ? (draftedSections / sections.length) * 100 : 0} className="h-1.5" />
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={handleGenerateResponse} disabled={generatingResponse}>
                    {generatingResponse ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                    {sections.length > 0 ? 'Re-generate' : 'Generate AI Draft'}
                  </Button>
                  {hasExcelDoc && draftedSections > 0 && (
                    <Button size="sm" variant="outline" onClick={handleExportFilledExcel} disabled={exportingExcel}>
                      {exportingExcel ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />}
                      Download Filled Excel
                    </Button>
                  )}
                  {draftedSections > 0 && (
                    <Button size="sm" variant="outline" onClick={handleExportDocx} disabled={exportingDocx}>
                      {exportingDocx ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
                      Download DOCX
                    </Button>
                  )}
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

        {/* CLARIFICATIONS */}
        {activeTab === 'clarifications' && (
          clarifications.length === 0 ? (
            <EmptyState
              icon={HelpCircle}
              title={t('workspace.noClarifications')}
              description={requirements.length > 0
                ? 'Use AI to generate clarification questions based on gaps and ambiguities in the tender.'
                : 'Process the tender first to extract requirements.'}
              action={requirements.length > 0 ? (
                <Button size="sm" variant="outline" onClick={handleGenerateClarifications} disabled={generatingClarifications}>
                  {generatingClarifications ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                  Generate Clarification Questions
                </Button>
              ) : undefined}
            />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{clarifications.length} questions</span>
                  <span className="w-px h-3 bg-border" />
                  <span>{clarifications.filter(q => q.status === 'draft').length} draft</span>
                  <span>{clarifications.filter(q => q.status === 'sent').length} sent</span>
                  <span>{clarifications.filter(q => q.status === 'answered').length} answered</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={handleGenerateClarifications} disabled={generatingClarifications}>
                    {generatingClarifications ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                    Re-generate
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleExportClarificationsDocx} disabled={exportingClarifications}>
                    {exportingClarifications ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
                    Download DOCX
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {clarifications.map((q, idx) => {
                  const statusColors: Record<string, string> = {
                    draft: 'bg-muted text-muted-foreground',
                    sent: 'bg-warning/15 text-warning',
                    answered: 'bg-success/15 text-success',
                  };
                  const isEditing = editingQuestionId === q.id;
                  return (
                    <div key={q.id} className="glass-card px-5 py-4 hover:border-primary/20 transition-colors">
                      <div className="flex items-start gap-3">
                        <span className="flex items-center justify-center h-6 w-6 rounded bg-muted text-[10px] font-bold text-muted-foreground shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          {isEditing ? (
                            <div className="space-y-2">
                              <textarea
                                value={editingQuestionText}
                                onChange={e => setEditingQuestionText(e.target.value)}
                                className="w-full min-h-[80px] bg-background border border-border rounded-lg p-3 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                              />
                              <div className="flex items-center gap-2 justify-end">
                                <Button size="sm" variant="ghost" onClick={() => setEditingQuestionId(null)}>
                                  Cancel
                                </Button>
                                <Button size="sm" onClick={() => handleSaveQuestion(q.id, editingQuestionText)}>
                                  Save
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="text-sm leading-relaxed">{q.question_text}</p>
                              {q.rationale && (
                                <p className="text-xs text-muted-foreground mt-1.5 italic">{q.rationale}</p>
                              )}
                              <div className="flex items-center gap-2 mt-2.5">
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${statusColors[q.status] || 'bg-muted text-muted-foreground'}`}>
                                  {t(`status.${q.status}` as any) || q.status}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {q.status === 'draft' && (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                              onClick={() => handleUpdateQuestionStatus(q.id, 'sent')}>
                              Mark Sent
                            </Button>
                          )}
                          {q.status === 'sent' && (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                              onClick={() => handleUpdateQuestionStatus(q.id, 'answered')}>
                              Mark Answered
                            </Button>
                          )}
                          {!isEditing && (
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0"
                              onClick={() => { setEditingQuestionId(q.id); setEditingQuestionText(q.question_text); }}>
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                            onClick={() => handleDeleteQuestion(q.id)}>
                            <XIcon className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )
        )}

        {/* CHECKLIST */}
        {activeTab === 'checklist' && (
          checklist.length === 0 ? (
            <EmptyState
              icon={CheckSquare}
              title={t('workspace.noChecklist')}
              description={requirements.length > 0 ? 'Generate a response draft to auto-create checklist items from requirements, deadlines, and risks.' : undefined}
              action={requirements.length > 0 ? (
                <Button size="sm" variant="outline" onClick={() => { handleGenerateResponse(); setActiveTab('draft'); }} disabled={generatingResponse}>
                  {generatingResponse ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                  Generate AI Draft & Checklist
                </Button>
              ) : undefined}
            />
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

              {/* Filter bar */}
              {orgMembers.length > 1 && (
                <div className="flex items-center gap-1.5">
                  <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                  {(['all', 'mine', 'unassigned'] as ChecklistFilter[]).map(f => (
                    <button
                      key={f}
                      onClick={() => setChecklistFilter(f)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        checklistFilter === f
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {t(`workspace.filter.${f}` as any)}
                    </button>
                  ))}
                </div>
              )}

              {/* Add manual task */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={e => setNewTaskTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddChecklistItem()}
                  placeholder={t('workspace.taskTitle')}
                  className="flex-1 h-9 px-3 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground/50"
                />
                <input
                  type="date"
                  value={newTaskDue}
                  onChange={e => setNewTaskDue(e.target.value)}
                  className="h-9 px-2 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-muted-foreground w-[130px]"
                  title={t('workspace.dueOptional')}
                />
                <Button size="sm" onClick={handleAddChecklistItem} disabled={!newTaskTitle.trim()}>
                  <Check className="h-3.5 w-3.5 mr-1" />
                  {t('workspace.addTask')}
                </Button>
              </div>

              {/* Open items first, then done */}
              <div className="space-y-2">
                {[...filteredChecklist].sort((a, b) => {
                  if (a.status === 'done' && b.status !== 'done') return 1;
                  if (a.status !== 'done' && b.status === 'done') return -1;
                  return 0;
                }).map(c => (
                  <div
                    key={c.id}
                    className={`glass-card transition-colors hover:border-primary/20 group/item ${
                      c.status === 'done' ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="px-5 py-3.5 flex items-center gap-4">
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
                      <button
                        onClick={() => handleExpandChecklist(c.id)}
                        className={`text-sm flex-1 text-left ${c.status === 'done' ? 'line-through text-muted-foreground' : ''}`}
                      >
                        {c.title}
                      </button>

                      {/* Comment count */}
                      <button
                        onClick={() => handleExpandChecklist(c.id)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors shrink-0"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        {comments[c.id]?.length || 0}
                      </button>

                      {/* Assignee */}
                      <div className="relative shrink-0">
                        <button
                          onClick={() => setAssignDropdownId(assignDropdownId === c.id ? null : c.id)}
                          className="flex items-center gap-1.5 text-xs transition-colors hover:text-primary"
                          title={getMemberName(c.owner_profile_id) || t('workspace.unassigned')}
                        >
                          {c.owner_profile_id ? (
                            <div className="h-6 w-6 rounded-full bg-primary/15 flex items-center justify-center">
                              <span className="text-[10px] font-medium text-primary">{getMemberInitial(c.owner_profile_id)}</span>
                            </div>
                          ) : (
                            <UserCircle2 className="h-5 w-5 text-muted-foreground/50" />
                          )}
                        </button>

                        {/* Assignment dropdown */}
                        {assignDropdownId === c.id && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setAssignDropdownId(null)} />
                            <div className="absolute right-0 top-full mt-1 w-48 bg-popover border border-border rounded-lg shadow-lg z-50 py-1">
                              <button
                                onClick={() => handleAssignChecklist(c.id, null)}
                                className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent transition-colors ${!c.owner_profile_id ? 'text-primary font-medium' : 'text-muted-foreground'}`}
                              >
                                <UserCircle2 className="h-4 w-4" />
                                {t('workspace.unassigned')}
                              </button>
                              {orgMembers.map(m => (
                                <button
                                  key={m.id}
                                  onClick={() => handleAssignChecklist(c.id, m.id)}
                                  className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent transition-colors ${c.owner_profile_id === m.id ? 'text-primary font-medium' : ''}`}
                                >
                                  <div className="h-4 w-4 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                                    <span className="text-[8px] font-medium text-primary">{(m.full_name || '?').charAt(0).toUpperCase()}</span>
                                  </div>
                                  <span className="truncate">{m.full_name || m.id.slice(0, 8)}</span>
                                  {m.id === user?.id && <span className="text-muted-foreground ml-auto">({t('settings.you')})</span>}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>

                      {c.due_at && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {format(new Date(c.due_at), 'dd MMM', { locale: dateFnsLocale })}
                        </span>
                      )}

                      <button
                        onClick={() => handleDeleteChecklistItem(c.id)}
                        className="opacity-0 group-hover/item:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1 rounded shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Expanded comments section */}
                    {expandedChecklistId === c.id && (
                      <div className="px-5 pb-4 pt-0 border-t border-border/50">
                        <div className="mt-3 space-y-3">
                          {loadingComments === c.id ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                              <Loader2 className="h-3 w-3 animate-spin" /> {t('common.loading')}
                            </div>
                          ) : (
                            <>
                              {(comments[c.id] || []).length === 0 && (
                                <p className="text-xs text-muted-foreground py-1">{t('workspace.noComments')}</p>
                              )}
                              {(comments[c.id] || []).map((comment: any) => (
                                <div key={comment.id} className="flex gap-2.5 group">
                                  <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                                    <span className="text-[10px] font-medium">
                                      {(comment.profiles?.full_name || '?').charAt(0).toUpperCase()}
                                    </span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-medium">{comment.profiles?.full_name || '—'}</span>
                                      <span className="text-[10px] text-muted-foreground">
                                        {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true, locale: dateFnsLocale })}
                                      </span>
                                      {comment.author_profile_id === user?.id && (
                                        <button
                                          onClick={() => handleDeleteComment(comment.id, c.id)}
                                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all ml-auto"
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </button>
                                      )}
                                    </div>
                                    <p className="text-xs text-foreground mt-0.5">{comment.body}</p>
                                  </div>
                                </div>
                              ))}

                              {/* Add comment */}
                              <div className="flex gap-2 pt-1">
                                <input
                                  type="text"
                                  value={commentText}
                                  onChange={e => setCommentText(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter' && commentText.trim()) handleAddComment(c.id); }}
                                  placeholder={t('workspace.addComment')}
                                  className="flex-1 text-xs bg-muted/50 border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                                <button
                                  onClick={() => handleAddComment(c.id)}
                                  disabled={!commentText.trim()}
                                  className="text-primary hover:text-primary/80 disabled:text-muted-foreground transition-colors"
                                >
                                  <Send className="h-4 w-4" />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {filteredChecklist.length === 0 && checklist.length > 0 && (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    {t('workspace.noFilterResults')}
                  </div>
                )}
              </div>
            </div>
          )
        )}
      </div>

      <AlertDialog open={!!deleteDocTarget} onOpenChange={(open) => { if (!open) setDeleteDocTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('workspace.deleteDocument')}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{deleteDocTarget?.file_name}</span>
              <br /><br />
              {t('workspace.deleteDocumentConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingDoc}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteDocument}
              disabled={deletingDoc}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingDoc && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              {t('workspace.deleteDocument')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* SIMAP Document Picker Dialog */}
      <AlertDialog open={simapDocPickerOpen} onOpenChange={(open) => { if (!open && !simapDownloading) setSimapDocPickerOpen(false); }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('simap.selectDocs')}</AlertDialogTitle>
            <AlertDialogDescription>
              {simapDocsLoading
                ? t('simap.loadingDocs')
                : simapDocList.length > 0
                  ? `${simapDocList.length} ${t('simap.docsAvailable')}`
                  : t('simap.noDocsFound')
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          {simapDocsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : simapDocList.length > 0 ? (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              <label className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer border-b border-border/50 mb-1">
                <input
                  type="checkbox"
                  checked={simapSelectedIds.size === simapDocList.length}
                  onChange={() => {
                    if (simapSelectedIds.size === simapDocList.length) setSimapSelectedIds(new Set());
                    else setSimapSelectedIds(new Set(simapDocList.map((d: any) => d.id)));
                  }}
                  className="rounded"
                />
                <span className="text-xs font-medium text-muted-foreground">
                  {simapSelectedIds.size === simapDocList.length ? 'Deselect all' : 'Select all'}
                </span>
              </label>
              {simapDocList.map((doc: any) => (
                <label key={doc.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={simapSelectedIds.has(doc.id)}
                    onChange={() => {
                      setSimapSelectedIds(prev => {
                        const next = new Set(prev);
                        if (next.has(doc.id)) next.delete(doc.id);
                        else next.add(doc.id);
                        return next;
                      });
                    }}
                    className="rounded"
                  />
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm truncate flex-1">{doc.name}</span>
                  {doc.size && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {doc.size < 1024 * 1024 ? `${(doc.size / 1024).toFixed(0)} KB` : `${(doc.size / (1024 * 1024)).toFixed(1)} MB`}
                    </span>
                  )}
                </label>
              ))}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={simapDownloading}>{t('common.cancel')}</AlertDialogCancel>
            {simapDocList.length > 0 && (
              <AlertDialogAction
                onClick={handleSimapDocDownload}
                disabled={simapSelectedIds.size === 0 || simapDownloading}
              >
                {simapDownloading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Download className="h-4 w-4 mr-1.5" />}
                {t('simap.downloadDocs')} ({simapSelectedIds.size})
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
