import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { BidPilotLogo } from '@/components/BidPilotLogo';
import {
  LayoutDashboard,
  FolderPlus,
  Folders,
  BookOpen,
  CheckSquare,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Building2,
  User,
  Compass,
  Bell,
  CheckCheck,
} from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { de, enUS } from 'date-fns/locale';

const navItems = [
  { to: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard' as const },
  { to: '/tenders/new', icon: FolderPlus, labelKey: 'nav.newTender' as const },
  { to: '/tenders', icon: Folders, labelKey: 'nav.tenders' as const },
  { to: '/discover', icon: Compass, labelKey: 'nav.discover' as const },
  { to: '/memory', icon: BookOpen, labelKey: 'nav.memory' as const },
  { to: '/checklist', icon: CheckSquare, labelKey: 'nav.checklist' as const },
  { to: '/team', icon: Users, labelKey: 'nav.team' as const },
  { to: '/settings', icon: Settings, labelKey: 'nav.settings' as const },
];

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

export default function AppLayout() {
  const { signOut, user } = useAuth();
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const dateFnsLocale = language === 'de' ? de : enUS;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [profile, setProfile] = useState<{ full_name: string | null; role_name: string | null } | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);

  // Notifications
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      const { data: p } = await supabase.from('profiles').select('full_name, role_name, organization_id').eq('id', user?.id || '').single();
      if (p) {
        setProfile(p);
        if (p.organization_id) {
          const { data: org } = await supabase.from('organizations').select('name').eq('id', p.organization_id).single();
          if (org) setOrgName(org.name);
        }
      }
    };
    if (user) loadProfile();
  }, [user]);

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    const { data, count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('profile_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setNotifications(data || []);
    const unread = (data || []).filter(n => !n.read).length;
    setUnreadCount(unread);
  }, [user]);

  useEffect(() => {
    loadNotifications();
    // Poll every 30s
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  const handleMarkAllRead = async () => {
    if (!user) return;
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('profile_id', user.id)
      .eq('read', false);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const handleClickNotification = async (notif: Notification) => {
    if (!notif.read) {
      await supabase.from('notifications').update({ read: true }).eq('id', notif.id);
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    }
    setNotifOpen(false);
    if (notif.link) navigate(notif.link);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
      isActive
        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
        : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
    }`;

  const sidebar = (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-sidebar-border">
        <BidPilotLogo className="text-lg" />
        {orgName && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <Building2 className="h-3 w-3 text-sidebar-foreground/60" />
            <span className="text-xs text-sidebar-foreground/60 truncate">{orgName}</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/' || item.to === '/tenders'}
            className={linkClass}
            onClick={() => setMobileOpen(false)}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {t(item.labelKey)}
          </NavLink>
        ))}
      </nav>

      {/* Bottom */}
      <div className="px-3 py-3 border-t border-sidebar-border space-y-1">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground transition-colors w-full"
        >
          <LogOut className="h-4 w-4" />
          {t('nav.logout')}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 flex-col bg-sidebar border-r border-sidebar-border shrink-0">
        {sidebar}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-56 bg-sidebar border-r border-sidebar-border animate-fade-in">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 text-sidebar-foreground"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-between h-12 px-4 border-b border-border bg-background shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="md:hidden">
              <Menu className="h-5 w-5 text-foreground" />
            </button>
            <span className="md:hidden"><BidPilotLogo className="text-sm" /></span>
          </div>

          <div className="flex items-center gap-2">
            <LanguageSwitcher />

            {/* Notification bell */}
            <div className="relative">
              <button
                onClick={() => { setNotifOpen(!notifOpen); setUserMenuOpen(false); }}
                className="relative p-2 rounded-lg hover:bg-accent transition-colors"
              >
                <Bell className="h-4 w-4 text-muted-foreground" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 h-4 min-w-[16px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center px-1">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 w-80 bg-popover border border-border rounded-lg shadow-lg z-50">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                      <span className="text-sm font-semibold">{t('notifications.title')}</span>
                      {unreadCount > 0 && (
                        <button
                          onClick={handleMarkAllRead}
                          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                        >
                          <CheckCheck className="h-3 w-3" />
                          {t('notifications.markAllRead')}
                        </button>
                      )}
                    </div>

                    <div className="max-h-80 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">
                          {t('notifications.empty')}
                        </div>
                      ) : (
                        notifications.map(n => (
                          <button
                            key={n.id}
                            onClick={() => handleClickNotification(n)}
                            className={`w-full text-left px-4 py-3 hover:bg-accent transition-colors border-b border-border/50 last:border-0 ${
                              !n.read ? 'bg-primary/5' : ''
                            }`}
                          >
                            <div className="flex items-start gap-2.5">
                              {!n.read && (
                                <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5" />
                              )}
                              <div className={`flex-1 min-w-0 ${n.read ? 'ml-4' : ''}`}>
                                <p className="text-xs font-medium truncate">{n.title}</p>
                                {n.body && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                                <p className="text-[10px] text-muted-foreground mt-1">
                                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: dateFnsLocale })}
                                </p>
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => { setUserMenuOpen(!userMenuOpen); setNotifOpen(false); }}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm hover:bg-accent transition-colors"
              >
                <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center">
                  <User className="h-3.5 w-3.5 text-primary" />
                </div>
                <span className="hidden sm:block text-xs text-foreground truncate max-w-[120px]">
                  {profile?.full_name || user?.email?.split('@')[0]}
                </span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>

              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 w-56 bg-popover border border-border rounded-lg shadow-lg z-50 py-1">
                    <div className="px-3 py-2 border-b border-border">
                      <p className="text-sm font-medium truncate">{profile?.full_name || '—'}</p>
                      <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                      {orgName && <p className="text-xs text-primary mt-0.5">{orgName}</p>}
                    </div>
                    <button
                      onClick={() => { setUserMenuOpen(false); navigate('/settings'); }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                    >
                      <Settings className="h-3.5 w-3.5" />
                      {t('nav.settings')}
                    </button>
                    <button
                      onClick={() => { setUserMenuOpen(false); handleSignOut(); }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      {t('nav.logout')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
