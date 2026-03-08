import { useState, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Upload, X, FileText, CheckCircle2, Loader2, Link as LinkIcon, ArrowRight, AlertCircle, Sparkles, RotateCcw } from 'lucide-react';

const SOURCE_TYPES = ['simap', 'email', 'upload', 'manual', 'portal'] as const;
const TENDER_TYPES = ['public', 'private'] as const;

type FlowState = 'idle' | 'uploading' | 'uploaded' | 'processing' | 'ready' | 'failed';

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
    try {
      const { data, error } = await supabase.functions.invoke('process-tender', {
        body: { tender_id: tenderId },
      });
      if (error) throw error;
      setFlowState('ready');
      toast({ title: t('tender.analysisReady') });
    } catch (err: any) {
      setFlowState('failed');
      setProcessingError(err.message || 'Unknown error');
      toast({ title: t('tender.processingFailed'), description: err.message, variant: 'destructive' });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFlowState('uploading');
    setUploadedCount(0);

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
        })
        .select()
        .single();

      if (tenderErr) throw tenderErr;

      // Response sections and checklist items are auto-created by the seed_tender_defaults trigger

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

      setCreatedTenderId(tender.id);
      setFlowState('uploaded');

      // Automatically invoke process-tender
      await invokeProcessTender(tender.id);
    } catch (err: any) {
      setFlowState('idle');
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Post-upload states
  if (flowState === 'uploaded' || flowState === 'processing' || flowState === 'ready' || flowState === 'failed') {
    return (
      <div className="flex flex-col items-center justify-center h-96 animate-fade-in">
        {/* Step indicators */}
        <div className="flex items-center gap-3 mb-8">
          <StepIndicator step={1} label={t('tender.uploadComplete')} state="done" />
          <div className="w-8 h-px bg-border" />
          <StepIndicator
            step={2}
            label={t('tender.processingTender')}
            state={flowState === 'uploaded' ? 'waiting' : flowState === 'processing' ? 'active' : flowState === 'ready' ? 'done' : 'error'}
          />
          <div className="w-8 h-px bg-border" />
          <StepIndicator
            step={3}
            label={t('tender.analysisReady')}
            state={flowState === 'ready' ? 'done' : 'waiting'}
          />
        </div>

        {/* Main status */}
        {flowState === 'processing' && (
          <div className="text-center">
            <div className="rounded-full bg-primary/20 p-4 mb-4 mx-auto w-fit">
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
            </div>
            <h2 className="text-xl font-bold font-heading">{t('tender.processingTender')}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t('workspace.processingHint')}</p>
          </div>
        )}

        {flowState === 'ready' && (
          <div className="text-center">
            <div className="rounded-full bg-success/20 p-4 mb-4 mx-auto w-fit">
              <Sparkles className="h-10 w-10 text-success" />
            </div>
            <h2 className="text-xl font-bold font-heading">{t('tender.analysisReady')}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t('tender.createdDescription')}</p>
          </div>
        )}

        {flowState === 'failed' && (
          <div className="text-center">
            <div className="rounded-full bg-destructive/20 p-4 mb-4 mx-auto w-fit">
              <AlertCircle className="h-10 w-10 text-destructive" />
            </div>
            <h2 className="text-xl font-bold font-heading">{t('tender.processingFailed')}</h2>
            <p className="text-sm text-muted-foreground mt-1">{processingError}</p>
            {createdTenderId && (
              <Button size="sm" variant="outline" className="mt-4" onClick={() => invokeProcessTender(createdTenderId)}>
                <RotateCcw className="h-4 w-4 mr-1.5" />
                {t('tender.retryProcessing')}
              </Button>
            )}
          </div>
        )}

        {flowState === 'uploaded' && (
          <div className="text-center">
            <div className="rounded-full bg-primary/20 p-4 mb-4 mx-auto w-fit">
              <CheckCircle2 className="h-10 w-10 text-primary" />
            </div>
            <h2 className="text-xl font-bold font-heading">{t('tender.uploadComplete')}</h2>
          </div>
        )}

        {/* File summary */}
        {files.length > 0 && (
          <div className="mt-4 glass-card p-4 w-full max-w-sm">
            <p className="text-xs text-muted-foreground mb-2">
              {uploadedCount}/{files.length} {t('tender.filesSelected')}
            </p>
            {files.map((file, idx) => (
              <div key={idx} className="flex items-center gap-2 py-1 text-xs">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate flex-1">{file.name}</span>
                <span className="text-success">✓</span>
              </div>
            ))}
          </div>
        )}

        {createdTenderId && (flowState === 'ready' || flowState === 'failed') && (
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
              <Input
                value={simapLink}
                onChange={e => setSimapLink(e.target.value)}
                placeholder={t('tender.simapLinkPlaceholder')}
              />
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

function StepIndicator({ step, label, state }: { step: number; label: string; state: 'waiting' | 'active' | 'done' | 'error' }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
        state === 'done' ? 'bg-success text-success-foreground' :
        state === 'active' ? 'bg-primary text-primary-foreground animate-pulse' :
        state === 'error' ? 'bg-destructive text-destructive-foreground' :
        'bg-muted text-muted-foreground'
      }`}>
        {state === 'done' ? '✓' : state === 'error' ? '!' : step}
      </div>
      <span className={`text-xs max-w-[100px] text-center ${
        state === 'done' ? 'text-success' : state === 'active' ? 'text-primary' : state === 'error' ? 'text-destructive' : 'text-muted-foreground'
      }`}>
        {label}
      </span>
    </div>
  );
}
