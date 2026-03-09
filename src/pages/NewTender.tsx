import { useState, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useI18n } from '@/lib/i18n';
import { callEdgeFunction } from '@/lib/edgeFunctions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Upload, X, FileText, CheckCircle2, Loader2, Link as LinkIcon, ArrowRight, AlertCircle, RefreshCw, Download } from 'lucide-react';

const SOURCE_TYPES = ['simap', 'email', 'upload', 'manual', 'portal'] as const;
const TENDER_TYPES = ['public', 'private'] as const;

type FlowState = 'idle' | 'uploading' | 'processing' | 'ready' | 'failed';

export default function NewTender() {
  const { t } = useI18n();
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [issuer, setIssuer] = useState('');
  const [sourceType, setSourceType] = useState<string>('upload');
  const [tenderType, setTenderType] = useState<string>('public');
  const [deadline, setDeadline] = useState('');
  const [tenderLanguage, setTenderLanguage] = useState('de');
  const [simapLink, setSimapLink] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [dragOver, setDragOver] = useState(false);
  const [createdTenderId, setCreatedTenderId] = useState<string | null>(null);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [simapFetching, setSimapFetching] = useState(false);
  const [simapProjectId, setSimapProjectId] = useState<string | null>(null);

  const handleFetchSimap = async () => {
    if (!simapLink) return;
    setSimapFetching(true);
    try {
      const result = await callEdgeFunction('fetch-simap', { simap_url: simapLink });
      if (result.success && result.data) {
        const d = result.data;
        if (d.title) setTitle(d.title);
        if (d.issuer) setIssuer(d.issuer);
        if (d.deadline) setDeadline(d.deadline.slice(0, 16));
        if (d.language) setTenderLanguage(d.language);
        if (d.simap_project_id) setSimapProjectId(d.simap_project_id);
        toast({ title: t('simap.fetchSuccess') });
      }
    } catch (err: any) {
      toast({ title: t('simap.fetchError'), description: err.message, variant: 'destructive' });
    } finally {
      setSimapFetching(false);
    }
  };

  const handleFiles = (newFiles: FileList | File[]) => {
    setFiles(prev => [...prev, ...Array.from(newFiles)]);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
  };

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const invokeProcessTender = async (tenderId: string) => {
    setFlowState('processing');
    setProcessingError(null);
    console.log('[BidPilot] Invoking process-tender for:', tenderId);
    try {
      const result = await callEdgeFunction('process-tender', { tender_id: tenderId });
      console.log('[BidPilot] process-tender result:', result);

      // Chain: call match-knowledge-assets
      console.log('[BidPilot] Invoking match-knowledge-assets for:', tenderId);
      try {
        const matchResult = await callEdgeFunction('match-knowledge-assets', { tender_id: tenderId });
        console.log('[BidPilot] match-knowledge-assets result:', matchResult);
      } catch (matchErr: any) {
        console.warn('[BidPilot] match-knowledge-assets failed (non-blocking):', matchErr.message);
        toast({ title: 'Knowledge matching skipped', description: matchErr.message, variant: 'destructive' });
      }

      // Chain: generate response drafts + checklist + fit score
      console.log('[BidPilot] Invoking generate-response for:', tenderId);
      try {
        const genResult = await callEdgeFunction('generate-response', { tender_id: tenderId });
        console.log('[BidPilot] generate-response result:', genResult);
      } catch (genErr: any) {
        console.warn('[BidPilot] generate-response failed (non-blocking):', genErr.message);
      }

      setFlowState('ready');
      toast({ title: t('tender.created'), description: t('tender.createdDescription') });
    } catch (err: any) {
      console.error('[BidPilot] process-tender error:', err);
      setProcessingError(err.message);
      setFlowState('failed');
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFlowState('uploading');
    setUploadedCount(0);
    setProcessingError(null);

    try {
      const { data: orgData } = await supabase.rpc('current_organization_id');
      if (!orgData) throw new Error('No organization found');

      const { data: tender, error: tenderErr } = await supabase
        .from('tenders')
        .insert({
          title,
          issuer: issuer || null,
          source_type: sourceType,
          tender_type: tenderType,
          deadline: deadline ? new Date(deadline).toISOString() : null,
          language: tenderLanguage,
          organization_id: orgData,
          ...(sourceType === 'simap' && simapLink ? { simap_url: simapLink } : {}),
          ...(sourceType === 'simap' && simapProjectId ? { simap_project_id: simapProjectId } : {}),
        })
        .select()
        .single();

      if (tenderErr) throw tenderErr;
      console.log('[BidPilot] Tender created:', tender.id);

      setCreatedTenderId(tender.id);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const path = `${orgData}/${tender.id}/${crypto.randomUUID()}_${file.name}`;
        const { error: uploadErr } = await supabase.storage.from('tender-files').upload(path, file);

        if (!uploadErr) {
          await supabase.from('tender_documents').insert({
            tender_id: tender.id,
            organization_id: orgData,
            file_name: file.name,
            file_type: file.type || null,
            storage_path: path,
            parse_status: 'pending',
          });
        }
        setUploadedCount(i + 1);
      }
      console.log('[BidPilot] Files uploaded:', files.length);

      // Invoke the real Edge Function
      await invokeProcessTender(tender.id);
    } catch (err: any) {
      console.error('[BidPilot] Submit error:', err);
      setFlowState('idle');
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (flowState === 'processing') {
    return (
      <div className="flex flex-col items-center justify-center h-96 animate-fade-in">
        <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
        <h2 className="text-xl font-bold font-heading">{t('tender.processingTender')}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t('tender.processingDescription')}</p>
      </div>
    );
  }

  if (flowState === 'failed') {
    return (
      <div className="flex flex-col items-center justify-center h-96 animate-fade-in">
        <div className="rounded-full bg-destructive/20 p-4 mb-4">
          <AlertCircle className="h-10 w-10 text-destructive" />
        </div>
        <h2 className="text-xl font-bold font-heading">{t('common.error')}</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-md text-center">{processingError}</p>
        {createdTenderId && (
          <div className="flex gap-3 mt-4">
            <Button size="sm" variant="outline" onClick={() => invokeProcessTender(createdTenderId)}>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              {t('workspace.retryProcessing')}
            </Button>
            <Link to={`/tenders/${createdTenderId}`}>
              <Button size="sm" variant="secondary">
                {t('tender.goToWorkspace')}
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </Link>
          </div>
        )}
      </div>
    );
  }

  if (flowState === 'ready') {
    return (
      <div className="flex flex-col items-center justify-center h-96 animate-fade-in">
        <div className="rounded-full bg-success/20 p-4 mb-4">
          <CheckCircle2 className="h-10 w-10 text-success" />
        </div>
        <h2 className="text-xl font-bold font-heading">{t('tender.created')}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t('tender.createdDescription')}</p>

        {createdTenderId && (
          <Link to={`/tenders/${createdTenderId}`}>
            <Button size="sm" className="mt-4">
              {t('tender.goToWorkspace')}
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold font-heading">{t('tender.new')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('tender.details')}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Basic details */}
        <div className="glass-card p-6 space-y-5">
          <h2 className="text-sm font-semibold font-heading text-muted-foreground uppercase tracking-wider">{t('tender.details')}</h2>

          <div className="space-y-2">
            <Label>{t('tender.title')}</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} required placeholder="z.B. IT-Infrastruktur Stadt Zürich" />
          </div>

          <div className="space-y-2">
            <Label>{t('tender.issuer')}</Label>
            <Input value={issuer} onChange={e => setIssuer(e.target.value)} placeholder="z.B. Stadt Zürich" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('tender.deadline')}</Label>
              <Input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t('tender.language')}</Label>
              <select
                value={tenderLanguage}
                onChange={e => setTenderLanguage(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="de">Deutsch</option>
                <option value="en">English</option>
                <option value="fr">Français</option>
                <option value="it">Italiano</option>
              </select>
            </div>
          </div>
        </div>

        {/* Source & Type */}
        <div className="glass-card p-6 space-y-5">
          <h2 className="text-sm font-semibold font-heading text-muted-foreground uppercase tracking-wider">{t('tender.sourceAndType')}</h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('tender.type')}</Label>
              <div className="flex gap-2">
                {TENDER_TYPES.map(tt => (
                  <button
                    key={tt}
                    type="button"
                    onClick={() => setTenderType(tt)}
                    className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                      tenderType === tt
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    {t(`tender.${tt}` as any)}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('tender.source')}</Label>
              <select
                value={sourceType}
                onChange={e => setSourceType(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {SOURCE_TYPES.map(st => (
                  <option key={st} value={st}>{t(`tender.sourceTypes.${st}` as any)}</option>
                ))}
              </select>
            </div>
          </div>

          {sourceType === 'simap' && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <LinkIcon className="h-3.5 w-3.5" />
                {t('tender.simapLink')}
              </Label>
              <div className="flex gap-2">
                <Input
                  value={simapLink}
                  onChange={e => setSimapLink(e.target.value)}
                  placeholder={t('tender.simapLinkPlaceholder')}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleFetchSimap}
                  disabled={!simapLink || simapFetching}
                  className="shrink-0 h-10"
                >
                  {simapFetching ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : (
                    <Download className="h-4 w-4 mr-1.5" />
                  )}
                  {simapFetching ? t('simap.fetching') : t('simap.fetch')}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* File upload */}
        <div className="glass-card p-6 space-y-5">
          <h2 className="text-sm font-semibold font-heading text-muted-foreground uppercase tracking-wider">{t('tender.uploadFiles')}</h2>

          <div
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
              dragOver
                ? 'border-primary bg-primary/5 scale-[1.01]'
                : 'border-border hover:border-primary/50 hover:bg-accent/30'
            }`}
          >
            <Upload className={`h-10 w-10 mx-auto mb-3 transition-colors ${dragOver ? 'text-primary' : 'text-muted-foreground'}`} />
            <p className="text-sm font-medium text-foreground">
              {dragOver ? t('tender.dropFilesActive') : t('tender.dropFiles')}
            </p>
            <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, XLSX, ZIP</p>
            <input ref={fileInputRef} type="file" multiple onChange={handleInputChange} className="hidden" />
          </div>

          {files.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{files.length} {t('tender.filesSelected')}</p>
              {files.map((file, idx) => (
                <div key={idx} className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-muted/50 border border-border">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
                  </div>
                  <button type="button" onClick={() => removeFile(idx)} className="text-muted-foreground hover:text-destructive transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Button type="submit" className="w-full h-11" disabled={flowState === 'uploading' || !title}>
          {flowState === 'uploading' ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {t('tender.creating')}
              {files.length > 0 && ` (${uploadedCount}/${files.length})`}
            </>
          ) : (
            t('tender.create')
          )}
        </Button>
      </form>
    </div>
  );
}
