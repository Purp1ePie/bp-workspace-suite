import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useI18n } from '@/lib/i18n';
import { callEdgeFunction } from '@/lib/edgeFunctions';
import { useToast } from '@/hooks/use-toast';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Compass, FolderPlus, ExternalLink, Loader2, Calendar, Building2, MapPin } from 'lucide-react';
import { format } from 'date-fns';

function pickTranslation(t: any, preferredLang = 'de'): string {
  if (!t) return '';
  if (typeof t === 'string') return t;
  return t[preferredLang] || t.de || t.fr || t.en || t.it || Object.values(t).find(Boolean) || '';
}

interface SimapResult {
  project_id: string;
  title: string;
  description: string;
  issuer: string;
  publication_date: string | null;
  deadline: string | null;
  project_type: string | null;
  process_type: string | null;
  canton: string | null;
  cpv_codes: string[];
  language: string;
  simap_url: string;
}

export default function SIMAPDiscovery() {
  const { t } = useI18n();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SimapResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [pagination, setPagination] = useState<{ lastItem?: string } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (query.trim().length < 3) return;
    setSearching(true);
    setSearched(true);
    try {
      const result = await callEdgeFunction('search-simap', { query: query.trim() });
      setResults(result.results || []);
      setPagination(result.pagination || null);
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleLoadMore = async () => {
    if (!pagination?.lastItem) return;
    setLoadingMore(true);
    try {
      const result = await callEdgeFunction('search-simap', {
        query: query.trim(),
        lastItem: pagination.lastItem,
      });
      setResults(prev => [...prev, ...(result.results || [])]);
      setPagination(result.pagination || null);
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    } finally {
      setLoadingMore(false);
    }
  };

  const handleImport = async (item: SimapResult) => {
    setImportingId(item.project_id);
    try {
      const { data: orgData } = await supabase.rpc('current_organization_id');
      if (!orgData) throw new Error('No organization found');

      // Fetch rich project data from SIMAP
      let richData: any = null;
      try {
        const fetchResult = await callEdgeFunction('fetch-simap', {
          simap_project_id: item.project_id,
          simap_url: item.simap_url,
        });
        richData = fetchResult.data;
      } catch {
        // Fall back to search result data
      }

      const description = richData?.raw_data
        ? (pickTranslation(richData.raw_data.description) || pickTranslation(richData.raw_data.shortDescription) || item.description)
        : item.description;

      const { data: tender, error } = await supabase
        .from('tenders')
        .insert({
          title: richData?.title || item.title || `SIMAP ${item.project_id}`,
          issuer: richData?.issuer || item.issuer || null,
          description: description || null,
          source_type: 'simap',
          tender_type: 'public',
          status: 'ready_for_review',
          language: richData?.language || item.language || 'de',
          deadline: (richData?.deadline || item.deadline)
            ? new Date(richData?.deadline || item.deadline).toISOString()
            : null,
          organization_id: orgData,
          simap_url: item.simap_url,
          simap_project_id: item.project_id,
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: t('discover.imported'),
        description: t('discover.importedDescription'),
      });

      navigate(`/tenders/${tender.id}`);
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold font-heading">{t('discover.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('discover.subtitle')}</p>
      </div>

      <form onSubmit={handleSearch} className="glass-card p-4 mb-6">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('discover.searchPlaceholder')}
              className="pl-10"
            />
          </div>
          <Button type="submit" disabled={searching || query.trim().length < 3} className="shrink-0">
            {searching ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                {t('discover.searching')}
              </>
            ) : (
              t('discover.search')
            )}
          </Button>
        </div>
      </form>

      {searching && !results.length ? (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : results.length > 0 ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {results.length} {t('discover.resultsCount')}
          </p>
          {results.map(item => (
            <div
              key={item.project_id}
              className="glass-card p-4 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold truncate">{item.title}</h3>
                  {item.issuer && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-xs text-muted-foreground truncate">{item.issuer}</span>
                      {item.canton && (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="text-xs text-muted-foreground">{item.canton}</span>
                        </>
                      )}
                    </div>
                  )}
                  {item.description && (
                    <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{item.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-2">
                    {item.publication_date && (
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {t('discover.publicationDate')}: {format(new Date(item.publication_date), 'dd.MM.yyyy')}
                        </span>
                      </div>
                    )}
                    {item.deadline && (
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-primary" />
                        <span className="text-xs text-primary font-medium">
                          {t('tender.deadline')}: {format(new Date(item.deadline), 'dd.MM.yyyy')}
                        </span>
                      </div>
                    )}
                    {item.process_type && (
                      <span className="text-xs capitalize px-2 py-0.5 rounded bg-muted text-muted-foreground">
                        {item.process_type}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={item.simap_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary transition-colors p-1.5"
                    title={t('discover.openOnSimap')}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleImport(item)}
                    disabled={importingId === item.project_id}
                  >
                    {importingId === item.project_id ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                    ) : (
                      <FolderPlus className="h-4 w-4 mr-1.5" />
                    )}
                    {importingId === item.project_id ? t('discover.importing') : t('discover.import')}
                  </Button>
                </div>
              </div>
            </div>
          ))}

          {pagination?.lastItem && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" size="sm" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : null}
                {t('discover.loadMore')}
              </Button>
            </div>
          )}
        </div>
      ) : searched && !searching ? (
        <EmptyState
          icon={Compass}
          title={t('discover.noResults')}
          description={t('discover.noResultsHint')}
        />
      ) : (
        <EmptyState
          icon={Compass}
          title={t('discover.title')}
          description={t('discover.subtitle')}
        />
      )}
    </div>
  );
}
