import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Upload, X, FileText } from 'lucide-react';

const SOURCE_TYPES = ['simap', 'email', 'upload', 'manual', 'portal'] as const;
const TENDER_TYPES = ['public', 'private'] as const;

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
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      // Get org id
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

      // Upload files to storage + create document records
      for (const file of files) {
        const path = `${orgData}/${tender.id}/${crypto.randomUUID()}_${file.name}`;
        const { error: uploadErr } = await supabase.storage.from('tender-files').upload(path, file);

        if (!uploadErr) {
          await supabase.from('tender_documents').insert({
            tender_id: tender.id,
            organization_id: orgData,
            file_name: file.name,
            file_type: file.type || null,
            storage_path: path,
          });
        }
      }

      toast({ title: t('common.success'), description: t('tender.create') });
      navigate(`/tenders/${tender.id}`);
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto animate-fade-in">
      <h1 className="text-2xl font-bold font-heading mb-6">{t('tender.new')}</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label>{t('tender.title')}</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} required />
        </div>

        <div className="space-y-2">
          <Label>{t('tender.issuer')}</Label>
          <Input value={issuer} onChange={e => setIssuer(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t('tender.type')}</Label>
            <select
              value={tenderType}
              onChange={e => setTenderType(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {TENDER_TYPES.map(tt => (
                <option key={tt} value={tt}>{t(`tender.${tt}` as any)}</option>
              ))}
            </select>
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

        {/* File upload */}
        <div className="space-y-2">
          <Label>{t('tender.uploadFiles')}</Label>
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
          >
            <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{t('tender.dropFiles')}</p>
            <input ref={fileInputRef} type="file" multiple onChange={handleFiles} className="hidden" />
          </div>
          {files.length > 0 && (
            <div className="space-y-2 mt-3">
              {files.map((file, idx) => (
                <div key={idx} className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted text-sm">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1">{file.name}</span>
                  <button type="button" onClick={() => removeFile(idx)} className="text-muted-foreground hover:text-destructive">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? t('tender.creating') : t('tender.create')}
        </Button>
      </form>
    </div>
  );
}
