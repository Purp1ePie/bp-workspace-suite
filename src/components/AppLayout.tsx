import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import {
  LayoutDashboard,
  FolderPlus,
  Folders,
  BookOpen,
  CheckSquare,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Building2,
  User,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const navItems = [
  { to: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard' as const },
  { to: '/tenders/new', icon: FolderPlus, labelKey: 'nav.newTender' as const },
  { to: '/tenders', icon: Folders, labelKey: 'nav.tenders' as const },
  { to: '/memory', icon: BookOpen, labelKey: 'nav.memory' as const },
  { to: '/checklist', icon: CheckSquare, labelKey: 'nav.checklist' as const },
  { to: '/settings', icon: Settings, labelKey: 'nav.settings' as const },
];

export default function AppLayout() {
  const { signOut, user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [profile, setProfile] = useState<{ full_name: string | null; role_name: string | null } | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);

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
        <h1 className="text-lg font-bold font-heading text-gradient tracking-tight">BidPilot</h1>
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
            <span className="md:hidden font-heading font-bold text-sm text-gradient">BidPilot</span>
          </div>

          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            
            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
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
