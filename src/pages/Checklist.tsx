import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/lib/i18n';
import { EmptyState } from '@/components/EmptyState';
import {
  CheckSquare, Filter, UserCircle2, CheckCircle2, Circle,
  MessageSquare, Send, Loader2, Trash2, ChevronDown, ChevronRight, Folders,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import type { Tables } from '@/integrations/supabase/types';

type ChecklistItem = Tables<'checklist_items'>;
type Profile = Tables<'profiles'>;
type Tender = Tables<'tenders'>;

type ChecklistFilter = 'all' | 'mine' | 'unassigned';

export default function Checklist() {
  const { t, language } = useI18n();
  const { user } = useAuth();
  const dateFnsLocale = language === 'de' ? de : enUS;

  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ChecklistFilter>('all');
  const [orgId, setOrgId] = useState<string | null>(null);

  // Assignments
  const [assignDropdownId, setAssignDropdownId] = useState<string | null>(null);

  // Comments
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, any[]>>({});
  const [commentText, setCommentText] = useState('');
  const [loadingComments, setLoadingComments] = useState<string | null>(null);

  // Collapsed tenders
  const [collapsedTenders, setCollapsedTenders] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      const [itemsRes, tendersRes] = await Promise.all([
        supabase.from('checklist_items').select('*').order('due_at', { ascending: true }),
        supabase.from('tenders').select('id, title, organization_id'),
      ]);
      setItems(itemsRes.data || []);
      setTenders(tendersRes.data || []);

      if (user) {
        const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
        if (profile?.organization_id) {
          setOrgId(profile.organization_id);
          const { data: m } = await supabase.from('profiles').select('*').eq('organization_id', profile.organization_id).order('full_name');
          setMembers(m || []);
        }
      }
      setLoading(false);
    };
    load();
  }, [user]);

  const getMemberName = (profileId: string | null) => {
    if (!profileId) return null;
    return members.find(m => m.id === profileId)?.full_name || null;
  };

  const getMemberInitial = (profileId: string | null) => {
    const name = getMemberName(profileId);
    return name ? name.charAt(0).toUpperCase() : '?';
  };

  const getTenderTitle = (tenderId: string) => {
    return tenders.find(t => t.id === tenderId)?.title || tenderId.slice(0, 8);
  };

  // --- Handlers ---

  const handleToggle = async (item: ChecklistItem) => {
    const newStatus = item.status === 'done' ? 'open' : 'done';
    const { error } = await supabase.from('checklist_items').update({ status: newStatus }).eq('id', item.id);
    if (!error) {
      setItems(prev => prev.map(c => c.id === item.id ? { ...c, status: newStatus } : c));
    }
  };

  const handleAssign = async (itemId: string, profileId: string | null) => {
    const { error } = await supabase.from('checklist_items').update({ owner_profile_id: profileId }).eq('id', itemId);
    if (!error) {
      setItems(prev => prev.map(c => c.id === itemId ? { ...c, owner_profile_id: profileId } : c));
      const item = items.find(c => c.id === itemId);
      // Notification for assignee
      if (profileId && profileId !== user?.id && orgId) {
        await supabase.from('notifications').insert({
          profile_id: profileId,
          organization_id: orgId,
          type: 'assignment',
          title: language === 'de' ? 'Neue Aufgabe zugewiesen' : 'New task assigned',
          body: item?.title || '',
          link: `/tenders/${item?.tender_id}?tab=checklist`,
        });
      }
    }
    setAssignDropdownId(null);
  };

  const handleExpandItem = async (itemId: string) => {
    if (expandedItemId === itemId) {
      setExpandedItemId(null);
      return;
    }
    setExpandedItemId(itemId);
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
    if (!body || !user || !orgId) return;
    const { data, error } = await supabase
      .from('comments')
      .insert({
        entity_type: 'checklist_item',
        entity_id: itemId,
        author_profile_id: user.id,
        organization_id: orgId,
        body,
      })
      .select('*, profiles(full_name)')
      .single();
    if (!error && data) {
      setComments(prev => ({ ...prev, [itemId]: [...(prev[itemId] || []), data] }));
      setCommentText('');
      // Notify the item owner
      const item = items.find(c => c.id === itemId);
      if (item?.owner_profile_id && item.owner_profile_id !== user.id && orgId) {
        await supabase.from('notifications').insert({
          profile_id: item.owner_profile_id,
          organization_id: orgId,
          type: 'comment',
          title: language === 'de' ? 'Neuer Kommentar' : 'New comment',
          body: `${getMemberName(user.id) || '—'}: ${body.slice(0, 100)}`,
          link: `/tenders/${item.tender_id}?tab=checklist`,
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

  const toggleTenderCollapse = (tenderId: string) => {
    setCollapsedTenders(prev => {
      const next = new Set(prev);
      if (next.has(tenderId)) next.delete(tenderId);
      else next.add(tenderId);
      return next;
    });
  };

  // --- Derived data ---

  const filtered = items.filter(i => {
    if (filter === 'mine') return i.owner_profile_id === user?.id;
    if (filter === 'unassigned') return !i.owner_profile_id;
    return true;
  });

  const allDone = filtered.filter(i => i.status === 'done');

  // Group by tender, maintaining tender order
  const groupedByTender = useMemo(() => {
    const groups: { tenderId: string; title: string; items: ChecklistItem[] }[] = [];
    const map = new Map<string, ChecklistItem[]>();
    for (const item of filtered) {
      if (!map.has(item.tender_id)) map.set(item.tender_id, []);
      map.get(item.tender_id)!.push(item);
    }
    for (const [tenderId, tenderItems] of map) {
      // Sort: open first, then done
      tenderItems.sort((a, b) => {
        if (a.status === 'done' && b.status !== 'done') return 1;
        if (a.status !== 'done' && b.status === 'done') return -1;
        return 0;
      });
      groups.push({ tenderId, title: getTenderTitle(tenderId), items: tenderItems });
    }
    return groups;
  }, [filtered, tenders]);

  // --- Render ---

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold font-heading">{t('checklist.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('checklist.subtitle')}</p>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={CheckSquare} title={t('checklist.noItems')} />
      ) : (
        <div className="space-y-6">
          {/* Progress */}
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">{t('workspace.readiness')}</span>
              <span className="text-sm font-bold font-heading text-primary">{allDone.length}/{filtered.length}</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${filtered.length > 0 ? (allDone.length / filtered.length) * 100 : 0}%` }} />
            </div>
          </div>

          {/* Filter bar */}
          {members.length > 1 && (
            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              {(['all', 'mine', 'unassigned'] as ChecklistFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    filter === f
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {t(`workspace.filter.${f}` as any)}
                </button>
              ))}
            </div>
          )}

          {/* Grouped by tender */}
          {groupedByTender.map(({ tenderId, title, items: tenderItems }) => {
            const tenderDone = tenderItems.filter(i => i.status === 'done').length;
            const isCollapsed = collapsedTenders.has(tenderId);

            return (
              <div key={tenderId} className="glass-card overflow-hidden">
                {/* Tender header */}
                <button
                  onClick={() => toggleTenderCollapse(tenderId)}
                  className="w-full px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-3 hover:bg-muted/50 transition-colors text-left"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <Folders className="h-4 w-4 text-primary shrink-0" />
                  <Link
                    to={`/tenders/${tenderId}`}
                    onClick={e => e.stopPropagation()}
                    className="text-sm font-semibold font-heading truncate hover:text-primary transition-colors"
                  >
                    {title}
                  </Link>
                  <span className="text-xs text-muted-foreground ml-auto shrink-0">
                    {tenderDone}/{tenderItems.length}
                  </span>
                </button>

                {/* Items */}
                {!isCollapsed && (
                  <div className="divide-y divide-border/50">
                    {tenderItems.map(item => (
                      <div key={item.id}>
                        <div className={`px-5 py-3 flex items-center gap-3 ${item.status === 'done' ? 'opacity-60' : ''}`}>
                          {/* Toggle */}
                          <button onClick={() => handleToggle(item)} className="shrink-0 transition-colors">
                            {item.status === 'done' ? (
                              <CheckCircle2 className="h-5 w-5 text-success" />
                            ) : (
                              <Circle className="h-5 w-5 text-muted-foreground hover:text-primary" />
                            )}
                          </button>

                          {/* Title — click to expand */}
                          <button
                            onClick={() => handleExpandItem(item.id)}
                            className={`text-sm flex-1 text-left min-w-0 truncate ${item.status === 'done' ? 'line-through text-muted-foreground' : ''}`}
                          >
                            {item.title}
                          </button>

                          {/* Comment count */}
                          <button
                            onClick={() => handleExpandItem(item.id)}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors shrink-0"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            {comments[item.id]?.length || 0}
                          </button>

                          {/* Assignee */}
                          <div className="relative shrink-0">
                            <button
                              onClick={() => setAssignDropdownId(assignDropdownId === item.id ? null : item.id)}
                              className="flex items-center gap-1.5 text-xs transition-colors hover:text-primary"
                              title={getMemberName(item.owner_profile_id) || t('workspace.unassigned')}
                            >
                              {item.owner_profile_id ? (
                                <div className="h-6 w-6 rounded-full bg-primary/15 flex items-center justify-center">
                                  <span className="text-[10px] font-medium text-primary">{getMemberInitial(item.owner_profile_id)}</span>
                                </div>
                              ) : (
                                <UserCircle2 className="h-5 w-5 text-muted-foreground/50" />
                              )}
                            </button>

                            {assignDropdownId === item.id && (
                              <>
                                <div className="fixed inset-0 z-40" onClick={() => setAssignDropdownId(null)} />
                                <div className="absolute right-0 top-full mt-1 w-48 bg-popover border border-border rounded-lg shadow-lg z-50 py-1">
                                  <button
                                    onClick={() => handleAssign(item.id, null)}
                                    className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent transition-colors ${!item.owner_profile_id ? 'text-primary font-medium' : 'text-muted-foreground'}`}
                                  >
                                    <UserCircle2 className="h-4 w-4" />
                                    {t('workspace.unassigned')}
                                  </button>
                                  {members.map(m => (
                                    <button
                                      key={m.id}
                                      onClick={() => handleAssign(item.id, m.id)}
                                      className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent transition-colors ${item.owner_profile_id === m.id ? 'text-primary font-medium' : ''}`}
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

                          {/* Due date */}
                          {item.due_at && (
                            <span className="text-xs text-muted-foreground shrink-0">
                              {format(new Date(item.due_at), 'dd MMM', { locale: dateFnsLocale })}
                            </span>
                          )}
                        </div>

                        {/* Expanded comments section */}
                        {expandedItemId === item.id && (
                          <div className="px-5 pb-4 pt-0 border-t border-border/50">
                            <div className="mt-3 space-y-3">
                              {loadingComments === item.id ? (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                                  <Loader2 className="h-3 w-3 animate-spin" /> {t('common.loading')}
                                </div>
                              ) : (
                                <>
                                  {(comments[item.id] || []).length === 0 && (
                                    <p className="text-xs text-muted-foreground py-1">{t('workspace.noComments')}</p>
                                  )}
                                  {(comments[item.id] || []).map((comment: any) => (
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
                                              onClick={() => handleDeleteComment(comment.id, item.id)}
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
                                      onKeyDown={e => { if (e.key === 'Enter' && commentText.trim()) handleAddComment(item.id); }}
                                      placeholder={t('workspace.addComment')}
                                      className="flex-1 text-xs bg-muted/50 border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                    <button
                                      onClick={() => handleAddComment(item.id)}
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
                  </div>
                )}
              </div>
            );
          })}

          {filtered.length === 0 && items.length > 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {t('workspace.noFilterResults')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
