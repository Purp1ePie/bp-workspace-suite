import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useI18n } from '@/lib/i18n';
import { callEdgeFunction } from '@/lib/edgeFunctions';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import {
  BookOpen, Upload, Search, X, FileText, Loader2, Database, Tag, FolderOpen,
  CheckCircle2, AlertCircle, Clock, RotateCw, Trash2, Sparkles,
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
import { formatDistanceToNow } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import type { Tables } from '@/integrations/supabase/types';

type KnowledgeAsset = Tables<'knowledge_assets'>;

const ASSET_TYPES = ['reference', 'certificate', 'cv', 'policy', 'service_description', 'template', 'past_answer', 'past_tender'] as const;

const typeIcons: Record<string, string> = {
  reference: '📋',
  certificate: '🏆',
  cv: '👤',
  policy: '📜',
  service_description: '📦',
  template: '📄',
  past_answer: '💬',
  past_tender: '📑',
};

function ParseStatusIndicator({ status }: { status: string }) {
  if (status === 'parsed') return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-success/15 text-success font-medium">
      <CheckCircle2 className="h-3 w-3" /> Parsed
    </span>
  );
  if (status === 'processing') return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-warning/15 text-warning font-medium">
      <Loader2 className="h-3 w-3 animate-spin" /> Processing
    </span>
  );
  if (status === 'failed') return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-destructive/15 text-destructive font-medium">
      <AlertCircle className="h-3 w-3" /> Failed
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
      <Clock className="h-3 w-3" /> Pending
    </span>
  );
}

// --- Bulk upload types ---
interface BulkFileEntry {
  id: string;
  file: File;
  status: 'queued' | 'analyzing' | 'ready' | 'error' | 'uploading' | 'done';
  error?: string;
  title: string;
  assetType: string;
  tags: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CompanyMemory() {
  const { t, language } = useI18n();
  const { toast } = useToast();
  const dateFnsLocale = language === 'de' ? de : enUS;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [assets, setAssets] = useState<KnowledgeAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('');
  const [showUpload, setShowUpload] = useState(false);
  const [reprocessingIds, setReprocessingIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeAsset | null>(null);
  const [deletingAsset, setDeletingAsset] = useState(false);

  // Bulk upload state
  const [bulkFiles, setBulkFiles] = useState<BulkFileEntry[]>([]);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const loadAssets = async () => {
    const { data } = await supabase.from('knowledge_assets').select('*').order('created_at', { ascending: false });
    setAssets(data || []);
    setLoading(false);
  };

  // Refresh knowledge matching for all active tenders (non-blocking background)
  const refreshKnowledgeMatching = async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) return;

      const { data: tenders } = await supabase
        .from('tenders')
        .select('id')
        .not('status', 'eq', 'draft');

      if (!tenders || tenders.length === 0) return;

      console.log(`Refreshing knowledge matching for ${tenders.length} tenders`);
      for (const tender of tenders) {
        supabase.functions.invoke('match-knowledge-assets', {
          body: { tender_id: tender.id },
          headers: { Authorization: `Bearer ${accessToken}` },
        }).catch(err => console.warn('match-knowledge-assets refresh error:', err));
      }
    } catch (err) {
      console.warn('Knowledge refresh error:', err);
    }
  };

  useEffect(() => { loadAssets(); }, []);

  const handleReprocess = async (assetId: string) => {
    setReprocessingIds(prev => new Set(prev).add(assetId));
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        toast({ title: 'Auth error', description: 'No active session.', variant: 'destructive' });
        return;
      }
      const { error: fnError } = await supabase.functions.invoke('process-knowledge-assets', {
        body: { knowledge_asset_id: assetId },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (fnError) {
        toast({ title: 'Reprocessing failed', description: fnError.message, variant: 'destructive' });
      } else {
        toast({ title: 'Reprocessing started' });
      }
      await loadAssets();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setReprocessingIds(prev => { const next = new Set(prev); next.delete(assetId); return next; });
    }
  };

  const handleDeleteAsset = async () => {
    if (!deleteTarget) return;
    setDeletingAsset(true);
    try {
      if (deleteTarget.storage_path) {
        await supabase.storage.from('knowledge-assets').remove([deleteTarget.storage_path]);
      }
      const { error } = await supabase.from('knowledge_assets').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      setAssets(prev => prev.filter(a => a.id !== deleteTarget.id));
      toast({ title: t('memory.assetDeleted') });
      // Refresh knowledge matching in background
      refreshKnowledgeMatching();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setDeletingAsset(false);
      setDeleteTarget(null);
    }
  };

  const filtered = assets.filter(a => {
    const matchesSearch = !search ||
      a.title.toLowerCase().includes(search.toLowerCase()) ||
      a.tags.some(tag => tag.toLowerCase().includes(search.toLowerCase()));
    const matchesType = !filterType || a.asset_type === filterType;
    return matchesSearch && matchesType;
  });

  // --- Bulk upload logic ---

  const handleFilesSelected = useCallback((newFiles: FileList | File[]) => {
    const entries: BulkFileEntry[] = Array.from(newFiles).map(file => ({
      id: crypto.randomUUID(),
      file,
      status: 'queued' as const,
      title: file.name.replace(/\.[^.]+$/, ''),
      assetType: 'reference',
      tags: '',
    }));
    setBulkFiles(prev => [...prev, ...entries]);
    if (!showUpload) setShowUpload(true);

    // Start AI analysis for newly added files
    analyzeFiles(entries);
  }, [showUpload]);

  const analyzeFiles = async (entries: BulkFileEntry[]) => {
    for (const entry of entries) {
      // Mark as analyzing
      setBulkFiles(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'analyzing' } : f));

      try {
        // Skip files > 15MB for AI analysis
        if (entry.file.size > 15 * 1024 * 1024) {
          setBulkFiles(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'ready' } : f));
          continue;
        }

        const buffer = await entry.file.arrayBuffer();
        const base64 = arrayBufferToBase64(buffer);

        const result = await callEdgeFunction('suggest-metadata', {
          mode: 'knowledge',
          file_name: entry.file.name,
          file_content_base64: base64,
        });

        if (result.success && result.suggestions) {
          const s = result.suggestions;
          setBulkFiles(prev => prev.map(f => f.id === entry.id ? {
            ...f,
            status: 'ready',
            title: s.title || f.title,
            assetType: s.asset_type || f.assetType,
            tags: Array.isArray(s.tags) ? s.tags.join(', ') : f.tags,
          } : f));
        } else {
          setBulkFiles(prev => prev.map(f => f.id === entry.id ? {
            ...f,
            status: 'error',
            error: result.error || 'Analysis failed',
          } : f));
        }
      } catch (err: any) {
        setBulkFiles(prev => prev.map(f => f.id === entry.id ? {
          ...f,
          status: 'error',
          error: err.message || 'Analysis failed',
        } : f));
      }
    }
  };

  const removeBulkFile = (id: string) => {
    setBulkFiles(prev => prev.filter(f => f.id !== id));
  };

  const updateBulkFile = (id: string, updates: Partial<BulkFileEntry>) => {
    setBulkFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const handleBulkUpload = async () => {
    const toUpload = bulkFiles.filter(f => f.status === 'ready' || f.status === 'error');
    if (toUpload.length === 0) return;

    setBulkUploading(true);
    try {
      const { data: orgId } = await supabase.rpc('current_organization_id');
      if (!orgId) throw new Error('No organization');

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      let successCount = 0;

      for (const entry of toUpload) {
        setBulkFiles(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'uploading' } : f));

        try {
          // Upload file to storage
          const path = `${orgId}/${entry.assetType}/${crypto.randomUUID()}_${entry.file.name}`;
          const { error: upErr } = await supabase.storage.from('knowledge-assets').upload(path, entry.file);
          if (upErr) throw upErr;

          // Create DB record
          const tags = entry.tags.split(',').map(t => t.trim()).filter(Boolean);
          const { data: insertedRow, error } = await supabase.from('knowledge_assets').insert({
            title: entry.title || entry.file.name,
            asset_type: entry.assetType,
            organization_id: orgId,
            storage_path: path,
            tags,
          }).select('id').single();
          if (error) throw error;

          // Trigger processing
          if (insertedRow?.id && accessToken) {
            supabase.functions.invoke('process-knowledge-assets', {
              body: { knowledge_asset_id: insertedRow.id },
              headers: { Authorization: `Bearer ${accessToken}` },
            }).catch(err => console.warn('process-knowledge-assets error:', err));
          }

          setBulkFiles(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'done' } : f));
          successCount++;
        } catch (err: any) {
          setBulkFiles(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'error', error: err.message } : f));
        }
      }

      if (successCount > 0) {
        toast({ title: `${successCount} ${t('memory.bulkSuccess')}` });
        await loadAssets();
        // Refresh knowledge matching in background
        refreshKnowledgeMatching();
        // Close panel after a short delay if all succeeded
        if (successCount === toUpload.length) {
          setTimeout(() => {
            setShowUpload(false);
            setBulkFiles([]);
          }, 1000);
        }
      }
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    } finally {
      setBulkUploading(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleFilesSelected(e.dataTransfer.files);
  }, [handleFilesSelected]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) handleFilesSelected(e.target.files);
    // Reset input so the same files can be re-selected
    e.target.value = '';
  };

  // Stats
  const typeCounts = ASSET_TYPES.reduce((acc, at) => {
    acc[at] = assets.filter(a => a.asset_type === at).length;
    return acc;
  }, {} as Record<string, number>);
  const totalTags = new Set(assets.flatMap(a => a.tags)).size;

  const readyCount = bulkFiles.filter(f => f.status === 'ready' || f.status === 'error').length;
  const analyzingCount = bulkFiles.filter(f => f.status === 'analyzing' || f.status === 'queued').length;
  const doneCount = bulkFiles.filter(f => f.status === 'done').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-heading">{t('memory.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('memory.subtitle')}</p>
        </div>
        <Button size="sm" onClick={() => { setShowUpload(!showUpload); if (showUpload) { setBulkFiles([]); } }}>
          <Upload className="h-4 w-4 mr-1.5" />
          {t('memory.upload')}
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="glass-card px-4 py-3.5 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2"><Database className="h-4 w-4 text-primary" /></div>
          <div>
            <p className="text-xs text-muted-foreground">{t('memory.totalAssets')}</p>
            <p className="text-lg font-bold font-heading">{assets.length}</p>
          </div>
        </div>
        <div className="glass-card px-4 py-3.5 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2"><FolderOpen className="h-4 w-4 text-primary" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Categories</p>
            <p className="text-lg font-bold font-heading">{ASSET_TYPES.filter(at => typeCounts[at] > 0).length}</p>
          </div>
        </div>
        <div className="glass-card px-4 py-3.5 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2"><Tag className="h-4 w-4 text-primary" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Tags</p>
            <p className="text-lg font-bold font-heading">{totalTags}</p>
          </div>
        </div>
        <div className="glass-card px-4 py-3.5">
          <p className="text-xs text-muted-foreground mb-1.5">Coverage</p>
          <Progress value={ASSET_TYPES.length > 0 ? (ASSET_TYPES.filter(at => typeCounts[at] > 0).length / ASSET_TYPES.length) * 100 : 0} className="h-1.5" />
          <p className="text-[10px] text-muted-foreground mt-1">{ASSET_TYPES.filter(at => typeCounts[at] > 0).length}/{ASSET_TYPES.length} types</p>
        </div>
      </div>

      {/* Bulk Upload Panel */}
      {showUpload && (
        <div className="glass-card p-6 mb-6 space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <h3 className="font-heading font-semibold text-sm flex items-center gap-2">
              <Upload className="h-4 w-4" />
              {t('memory.upload')}
            </h3>
            <button type="button" onClick={() => { setShowUpload(false); setBulkFiles([]); }} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Drop zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
              dragOver ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border hover:border-primary/50 hover:bg-accent/30'
            }`}
          >
            <Upload className={`h-8 w-8 mx-auto mb-2 transition-colors ${dragOver ? 'text-primary' : 'text-muted-foreground'}`} />
            <p className="text-sm font-medium">{t('memory.dropFilesMultiple')}</p>
            <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, XLSX, TXT, CSV, JSON</p>
            <input ref={fileInputRef} type="file" multiple onChange={handleInputChange} className="hidden" />
          </div>

          {/* Bulk file cards */}
          {bulkFiles.length > 0 && (
            <div className="space-y-3">
              {/* Summary bar */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {bulkFiles.length} {language === 'de' ? 'Dateien' : 'files'}
                  {analyzingCount > 0 && ` · ${analyzingCount} ${t('memory.bulkAnalyzing')}`}
                  {readyCount > 0 && ` · ${readyCount} ${t('memory.bulkReady')}`}
                  {doneCount > 0 && ` · ${doneCount} ${t('memory.bulkDone')}`}
                </span>
              </div>

              {/* Individual file cards */}
              {bulkFiles.map(entry => (
                <div
                  key={entry.id}
                  className={`rounded-lg border p-4 transition-all ${
                    entry.status === 'done' ? 'border-success/30 bg-success/5 opacity-60' :
                    entry.status === 'error' ? 'border-destructive/30 bg-destructive/5' :
                    entry.status === 'analyzing' || entry.status === 'queued' ? 'border-primary/30 bg-primary/5' :
                    entry.status === 'uploading' ? 'border-warning/30 bg-warning/5' :
                    'border-border'
                  }`}
                >
                  {/* File info + status row */}
                  <div className="flex items-center gap-3 mb-3">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{entry.file.name}</p>
                      <p className="text-[10px] text-muted-foreground">{formatSize(entry.file.size)}</p>
                    </div>

                    {/* Status indicator */}
                    {(entry.status === 'queued' || entry.status === 'analyzing') && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium shrink-0">
                        <Sparkles className="h-3 w-3 animate-pulse" /> {t('memory.bulkAnalyzing')}
                      </span>
                    )}
                    {entry.status === 'ready' && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-success/15 text-success font-medium shrink-0">
                        <CheckCircle2 className="h-3 w-3" /> {t('memory.bulkReady')}
                      </span>
                    )}
                    {entry.status === 'error' && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-destructive/15 text-destructive font-medium shrink-0">
                        <AlertCircle className="h-3 w-3" /> {t('memory.bulkError')}
                      </span>
                    )}
                    {entry.status === 'uploading' && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-warning/15 text-warning font-medium shrink-0">
                        <Loader2 className="h-3 w-3 animate-spin" /> {t('memory.bulkUploading')}
                      </span>
                    )}
                    {entry.status === 'done' && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-success/15 text-success font-medium shrink-0">
                        <CheckCircle2 className="h-3 w-3" /> {t('memory.bulkDone')}
                      </span>
                    )}

                    {/* Remove button */}
                    {entry.status !== 'uploading' && entry.status !== 'done' && (
                      <button
                        onClick={() => removeBulkFile(entry.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        title={t('memory.removeFile')}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {/* Error message */}
                  {entry.status === 'error' && entry.error && (
                    <p className="text-[10px] text-destructive mb-2">{entry.error}</p>
                  )}

                  {/* Editable fields (show when not uploading/done) */}
                  {entry.status !== 'uploading' && entry.status !== 'done' && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('memory.assetTitle')}</Label>
                        <Input
                          value={entry.title}
                          onChange={e => updateBulkFile(entry.id, { title: e.target.value })}
                          className="h-8 text-xs"
                          disabled={entry.status === 'analyzing' || entry.status === 'queued'}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('memory.assetType')}</Label>
                        <select
                          value={entry.assetType}
                          onChange={e => updateBulkFile(entry.id, { assetType: e.target.value })}
                          disabled={entry.status === 'analyzing' || entry.status === 'queued'}
                          className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        >
                          {ASSET_TYPES.map(at => (
                            <option key={at} value={at}>{t(`memory.types.${at}` as any)}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('memory.tags')}</Label>
                        <Input
                          value={entry.tags}
                          onChange={e => updateBulkFile(entry.id, { tags: e.target.value })}
                          placeholder="tag1, tag2..."
                          className="h-8 text-xs"
                          disabled={entry.status === 'analyzing' || entry.status === 'queued'}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Upload All button */}
              {readyCount > 0 && !bulkUploading && (
                <Button onClick={handleBulkUpload} className="w-full">
                  <Upload className="h-4 w-4 mr-2" />
                  {t('memory.bulkUploadAll')} ({readyCount})
                </Button>
              )}
              {bulkUploading && (
                <Button disabled className="w-full">
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('memory.bulkUploading')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('memory.search')} className="pl-10" />
        </div>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-w-[180px]"
        >
          <option value="">{t('memory.allTypes')}</option>
          {ASSET_TYPES.map(at => (
            <option key={at} value={at}>{t(`memory.types.${at}` as any)} ({typeCounts[at]})</option>
          ))}
        </select>
      </div>

      {/* Asset list */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={search || filterType ? t('common.empty') : t('memory.noAssets')}
          description={!search && !filterType ? t('memory.addFirst') : undefined}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(asset => (
            <div key={asset.id} className="glass-card p-5 hover:border-primary/20 transition-colors group relative">
              <button
                onClick={() => setDeleteTarget(asset)}
                className="absolute top-3 right-3 text-muted-foreground hover:text-destructive transition-colors p-1.5 rounded hover:bg-destructive/10 opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-start gap-3">
                <span className="text-xl">{typeIcons[asset.asset_type] || '📎'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-tight group-hover:text-primary transition-colors">{asset.title}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold uppercase tracking-wider">
                      {t(`memory.types.${asset.asset_type}` as any)}
                    </span>
                    <ParseStatusIndicator status={asset.parse_status} />
                  </div>
                </div>
              </div>
              {asset.parse_status === 'failed' && asset.parse_error && (
                <div className="mt-2 flex items-start gap-1.5 text-xs text-destructive bg-destructive/10 rounded-md px-2.5 py-1.5">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span className="line-clamp-2">{asset.parse_error}</span>
                </div>
              )}
              {(asset.parse_status === 'pending' || asset.parse_status === 'failed') && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 w-full text-xs h-7"
                  disabled={reprocessingIds.has(asset.id)}
                  onClick={() => handleReprocess(asset.id)}
                >
                  {reprocessingIds.has(asset.id) ? (
                    <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Processing…</>
                  ) : (
                    <><RotateCw className="h-3 w-3 mr-1.5" />Reprocess</>
                  )}
                </Button>
              )}
              {asset.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {asset.tags.map(tag => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-3">
                {formatDistanceToNow(new Date(asset.created_at), { addSuffix: true, locale: dateFnsLocale })}
              </p>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('memory.deleteAsset')}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{deleteTarget?.title}</span>
              <br /><br />
              {t('memory.deleteAssetConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAsset}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAsset}
              disabled={deletingAsset}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingAsset && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              {t('memory.deleteAsset')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
