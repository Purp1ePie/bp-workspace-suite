import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useI18n } from '@/lib/i18n';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { BookOpen, Upload, Search, X, FileText, Loader2, Database, Tag, FolderOpen, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDistanceToNow } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import type { Tables } from '@/integrations/supabase/types';

type KnowledgeAsset = Tables<'knowledge_assets'>;

const ASSET_TYPES = ['reference', 'certificate', 'cv', 'policy', 'service_description', 'template', 'past_answer'] as const;

const typeIcons: Record<string, string> = {
  reference: '📋',
  certificate: '🏆',
  cv: '👤',
  policy: '📜',
  service_description: '📦',
  template: '📄',
  past_answer: '💬',
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

  const { t, language } = useI18n();
  const { toast } = useToast();
  const dateFnsLocale = language === 'de' ? de : enUS;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [assets, setAssets] = useState<KnowledgeAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('');
  const [showUpload, setShowUpload] = useState(false);

  const [assetTitle, setAssetTitle] = useState('');
  const [assetType, setAssetType] = useState<string>('reference');
  const [assetTags, setAssetTags] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const loadAssets = async () => {
    const { data } = await supabase.from('knowledge_assets').select('*').order('created_at', { ascending: false });
    setAssets(data || []);
    setLoading(false);
  };

  useEffect(() => { loadAssets(); }, []);

  const filtered = assets.filter(a => {
    const matchesSearch = !search ||
      a.title.toLowerCase().includes(search.toLowerCase()) ||
      a.tags.some(tag => tag.toLowerCase().includes(search.toLowerCase()));
    const matchesType = !filterType || a.asset_type === filterType;
    return matchesSearch && matchesType;
  });

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data: orgId } = await supabase.rpc('current_organization_id');
      if (!orgId) throw new Error('No organization');

      let storagePath: string | null = null;
      if (file) {
        const path = `${orgId}/${assetType}/${crypto.randomUUID()}_${file.name}`;
        const { error: upErr } = await supabase.storage.from('knowledge-assets').upload(path, file);
        if (upErr) throw upErr;
        storagePath = path;
      }

      const tags = assetTags.split(',').map(t => t.trim()).filter(Boolean);
      const { data: insertedRow, error } = await supabase.from('knowledge_assets').insert({
        title: assetTitle,
        asset_type: assetType,
        organization_id: orgId,
        storage_path: storagePath,
        tags,
      }).select('id').single();
      if (error) throw error;

      toast({ title: t('common.success') });
      setShowUpload(false);
      setAssetTitle('');
      setAssetTags('');
      setFile(null);
      loadAssets();

      // Trigger processing via Edge Function
      if (insertedRow?.id) {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (!accessToken) {
          toast({ title: 'Auth error', description: 'No active session. Please sign in again.', variant: 'destructive' });
          return;
        }
        const { error: fnError } = await supabase.functions.invoke('process-knowledge-assets', {
          body: { knowledge_asset_id: insertedRow.id },
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (fnError) {
          console.error('process-knowledge-assets error:', fnError);
          toast({ title: 'Processing failed', description: fnError.message || 'Could not process asset.', variant: 'destructive' });
        }
        loadAssets();
      }
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  // Stats
  const typeCounts = ASSET_TYPES.reduce((acc, at) => {
    acc[at] = assets.filter(a => a.asset_type === at).length;
    return acc;
  }, {} as Record<string, number>);
  const totalTags = new Set(assets.flatMap(a => a.tags)).size;

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
        <Button size="sm" onClick={() => setShowUpload(!showUpload)}>
          <Upload className="h-4 w-4 mr-1.5" />
          {t('memory.upload')}
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="glass-card px-4 py-3.5 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <Database className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('memory.totalAssets')}</p>
            <p className="text-lg font-bold font-heading">{assets.length}</p>
          </div>
        </div>
        <div className="glass-card px-4 py-3.5 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <FolderOpen className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Categories</p>
            <p className="text-lg font-bold font-heading">{ASSET_TYPES.filter(at => typeCounts[at] > 0).length}</p>
          </div>
        </div>
        <div className="glass-card px-4 py-3.5 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <Tag className="h-4 w-4 text-primary" />
          </div>
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

      {/* Upload panel */}
      {showUpload && (
        <form onSubmit={handleUpload} className="glass-card p-6 mb-6 space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <h3 className="font-heading font-semibold text-sm">{t('memory.upload')}</h3>
            <button type="button" onClick={() => setShowUpload(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('memory.assetTitle')}</Label>
              <Input value={assetTitle} onChange={e => setAssetTitle(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>{t('memory.assetType')}</Label>
              <select
                value={assetType}
                onChange={e => setAssetType(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {ASSET_TYPES.map(at => (
                  <option key={at} value={at}>{t(`memory.types.${at}` as any)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('memory.tags')}</Label>
            <Input value={assetTags} onChange={e => setAssetTags(e.target.value)} placeholder="tag1, tag2, ..." />
          </div>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
              dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
            }`}
          >
            {file ? (
              <div className="flex items-center justify-center gap-2 text-sm">
                <FileText className="h-4 w-4" />
                {file.name}
              </div>
            ) : (
              <>
                <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">{t('tender.dropFiles')}</p>
              </>
            )}
            <input ref={fileInputRef} type="file" onChange={e => setFile(e.target.files?.[0] || null)} className="hidden" />
          </div>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t('common.saving')}</> : t('common.save')}
          </Button>
        </form>
      )}

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('memory.search')}
            className="pl-10"
          />
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
            <div key={asset.id} className="glass-card p-5 hover:border-primary/20 transition-colors group">
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
    </div>
  );
}
