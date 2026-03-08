import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useI18n } from '@/lib/i18n';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { BookOpen, Upload, Search, X, FileText, Tag } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import type { Tables } from '@/integrations/supabase/types';

type KnowledgeAsset = Tables<'knowledge_assets'>;

const ASSET_TYPES = ['reference', 'certificate', 'cv', 'policy', 'service_description', 'template', 'past_answer'] as const;

export default function CompanyMemory() {
  const { t, language } = useI18n();
  const { toast } = useToast();
  const dateFnsLocale = language === 'de' ? de : enUS;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [assets, setAssets] = useState<KnowledgeAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showUpload, setShowUpload] = useState(false);

  // Upload form state
  const [assetTitle, setAssetTitle] = useState('');
  const [assetType, setAssetType] = useState<string>('reference');
  const [assetTags, setAssetTags] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadAssets = async () => {
    const { data } = await supabase.from('knowledge_assets').select('*').order('created_at', { ascending: false });
    setAssets(data || []);
    setLoading(false);
  };

  useEffect(() => { loadAssets(); }, []);

  const filtered = assets.filter(a =>
    a.title.toLowerCase().includes(search.toLowerCase()) ||
    a.tags.some(tag => tag.toLowerCase().includes(search.toLowerCase()))
  );

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data: orgId } = await supabase.rpc('current_organization_id');
      if (!orgId) throw new Error('No organization');

      let storagePath: string | null = null;
      if (file) {
        const path = `${orgId}/${crypto.randomUUID()}_${file.name}`;
        const { error: upErr } = await supabase.storage.from('knowledge-assets').upload(path, file);
        if (upErr) throw upErr;
        storagePath = path;
      }

      const tags = assetTags.split(',').map(t => t.trim()).filter(Boolean);
      const { error } = await supabase.from('knowledge_assets').insert({
        title: assetTitle,
        asset_type: assetType,
        organization_id: orgId,
        storage_path: storagePath,
        tags,
      });
      if (error) throw error;

      toast({ title: t('common.success') });
      setShowUpload(false);
      setAssetTitle('');
      setAssetTags('');
      setFile(null);
      loadAssets();
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold font-heading">{t('memory.title')}</h1>
        <Button size="sm" onClick={() => setShowUpload(!showUpload)}>
          <Upload className="h-4 w-4 mr-1.5" />
          {t('memory.upload')}
        </Button>
      </div>

      {/* Upload panel */}
      {showUpload && (
        <form onSubmit={handleUpload} className="glass-card p-5 mb-6 space-y-4 animate-fade-in">
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
            className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
          >
            {file ? (
              <div className="flex items-center justify-center gap-2 text-sm">
                <FileText className="h-4 w-4" />
                {file.name}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('tender.dropFiles')}</p>
            )}
            <input ref={fileInputRef} type="file" onChange={e => setFile(e.target.files?.[0] || null)} className="hidden" />
          </div>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
        </form>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('memory.search')}
          className="pl-10"
        />
      </div>

      {/* Asset list */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={t('memory.noAssets')}
          description={t('memory.addFirst')}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map(asset => (
            <div key={asset.id} className="glass-card px-5 py-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{asset.title}</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                    {t(`memory.types.${asset.asset_type}` as any)}
                  </span>
                  {asset.tags.map(tag => (
                    <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground flex items-center gap-1">
                      <Tag className="h-2.5 w-2.5" />{tag}
                    </span>
                  ))}
                </div>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatDistanceToNow(new Date(asset.created_at), { addSuffix: true, locale: dateFnsLocale })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
