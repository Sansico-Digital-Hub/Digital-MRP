import { Outlet, Link, useRouterState, useRouter } from '@tanstack/react-router';
import { LayoutDashboard, Activity, Users, Bell, LogOut, Settings, CalendarClock, Box, Settings2, CalendarRange, ShieldAlert, FileSpreadsheet, Factory, Package, Database, Menu, Calculator } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuthStore } from '../../stores/authStore';
import type { ModuleName } from '../../stores/authStore';
import { isFeatureEnabled, type FeatureName } from '../../lib/features';
import { useNavigationStore } from '../../stores/navigationStore';
import { useEffect, useState } from 'react';

const MODULES: { id: ModuleName; name: string; icon: any }[] = [
  { id: 'production', name: 'Production Planning', icon: Factory },
  { id: 'material', name: 'Material Planning', icon: Package },
  { id: 'masterdata', name: 'Master Data', icon: Database },
  { id: 'system', name: 'System', icon: Settings },
];

interface MenuItem {
  name: string;
  path: string;
  icon: any;
  badge?: string;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  /** Nama feature flag. Menu disembunyikan kalau flag-nya mati. */
  feature?: FeatureName;
}

const SIDEBAR_MENUS: Record<ModuleName, MenuItem[]> = {
  production: [
    { name: 'Dashboard Production', path: '/', icon: LayoutDashboard },
    { name: 'Daily Schedule', path: '/schedule', icon: CalendarClock },
    { name: 'Item Tracking', path: '/tracking', icon: Activity },
    { name: 'Shortage Detail', path: '/shortage-detail', icon: ShieldAlert },
    { name: 'Finish Good Inventory', path: '/fg-stock', icon: Box },
  ],
  material: [
    { name: 'Material Calculation', path: '/material-calculation', icon: Calculator, feature: 'materialCalculation' },
    { name: 'Raw Material Stock', path: '/stock-raw-material', icon: FileSpreadsheet },
  ],
  masterdata: [
    { name: '26-Week Demand (MRP)', path: '/weekly-demand', icon: CalendarRange, badge: 'Production & Material' },
    { name: 'Work in Progress (WIP)', path: '/wip', icon: Settings2, badge: 'Production & Material' },
    { name: 'Finish Good (FG) Stock', path: '/fg-stock', icon: Box, badge: 'Production' },
    { name: 'Daily Schedule', path: '/schedule', icon: CalendarClock, badge: 'Production' },
    { name: 'Hot List', path: '/hotlist', icon: FileSpreadsheet, badge: 'Material' },
    { name: 'NPOF Materials', path: '/npof-materials', icon: FileSpreadsheet, badge: 'Material' },
    { name: 'Stock Raw Material', path: '/stock-raw-material', icon: FileSpreadsheet, badge: 'Material' },
    { name: 'Outstanding PO', path: '/outstanding-po', icon: FileSpreadsheet, badge: 'Material' },
  ],
  system: [
    { name: 'Dropdown Management', path: '/items', icon: Settings2, adminOnly: true },
    { name: 'User Management', path: '/users', icon: Users, superAdminOnly: true },
  ]
};

export function Layout() {
  const routerState = useRouterState();
  const router = useRouter();
  const pathname = routerState.location.pathname;

  const { user, logout, canView, canEdit } = useAuthStore();
  const { activeModule, setActiveModule } = useNavigationStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [masterDataFilter, setMasterDataFilter] = useState<'all' | 'production' | 'material'>('all');

  // Auto-switch active module based on current pathname
  useEffect(() => {
    // Prevent jumping if the current module already contains the path
    const currentModuleHasPath = SIDEBAR_MENUS[activeModule].some(i => i.path === pathname || (i.path !== '/' && pathname.startsWith(i.path)));

    if (!currentModuleHasPath) {
      for (const [mod, items] of Object.entries(SIDEBAR_MENUS)) {
        if (items.some(i => i.path === pathname || (i.path !== '/' && pathname.startsWith(i.path)))) {
          setActiveModule(mod as ModuleName);
          break;
        }
      }
    }
  }, [pathname, activeModule, setActiveModule]);

  const handleLogout = () => {
    logout();
    router.navigate({ to: '/login' });
  };

  // Filter menu items based on roles and master data dropdown filter
  const currentMenuItems = SIDEBAR_MENUS[activeModule].filter(item => {
    if (item.feature && !isFeatureEnabled(item.feature)) return false;
    if (item.superAdminOnly && user?.role !== 'SUPER_ADMIN') return false;
    if (item.adminOnly && (user?.role !== 'SUPER_ADMIN' && user?.role !== 'PRODUCTION_PLANNER')) return false;

    if (activeModule === 'masterdata' && masterDataFilter !== 'all') {
      if (masterDataFilter === 'production') {
        return item.badge?.includes('Production');
      }
      if (masterDataFilter === 'material') {
        return item.badge?.includes('Material');
      }
    }

    return true;
  });

  const isViewOnly = !canEdit(activeModule);

  const getVisibleMenuItems = (modId: ModuleName) => {
    return SIDEBAR_MENUS[modId].filter(item => {
      if (item.feature && !isFeatureEnabled(item.feature)) return false;
      if (item.superAdminOnly && user?.role !== 'SUPER_ADMIN') return false;
      if (item.adminOnly && (user?.role !== 'SUPER_ADMIN' && user?.role !== 'PRODUCTION_PLANNER')) return false;
      return true;
    });
  };

  const handleModuleChange = (modId: ModuleName) => {
    setActiveModule(modId);
    // Gunakan menu pertama yang benar-benar terlihat (lolos feature flag & role check),
    // bukan index [0] mentah, supaya menu yang dimatikan tidak memicu redirect ke /
    const visibleItems = getVisibleMenuItems(modId);
    const firstItem = visibleItems[0];
    if (firstItem) {
      router.navigate({ to: firstItem.path });
    }
  };

  return (
    <div className="min-h-screen bg-secondary/30 flex flex-col overflow-hidden">
      {/* Topbar */}
      <header className="h-16 bg-card border-b flex items-center justify-between px-4 lg:px-6 shadow-sm z-20 shrink-0">
        <div className="flex items-center space-x-4">
          <button
            className="lg:hidden p-2 rounded-md hover:bg-secondary"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <Menu size={20} />
          </button>
          <div className="bg-primary text-primary-foreground font-bold text-xl px-3 py-1 rounded-md hidden sm:block">
            Digital MRP
          </div>

          {/* Module Switcher */}
          <nav className="hidden md:flex space-x-1 ml-4">
            {MODULES.map(mod => {
              const Icon = mod.icon;
              const isActive = activeModule === mod.id;
              // Check view permission
              if (!canView(mod.id)) return null;

              return (
                <button
                  key={mod.id}
                  onClick={() => handleModuleChange(mod.id)}
                  className={cn(
                    "flex items-center space-x-2 px-3 py-2 rounded-md transition-all font-medium text-sm cursor-pointer",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <Icon size={16} />
                  <span>{mod.name}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center space-x-4">
          <button className="p-2 rounded-full hover:bg-secondary relative">
            <Bell size={20} className="text-muted-foreground" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-destructive rounded-full"></span>
          </button>
          <div className="flex items-center space-x-3 border-l pl-4">
            <div className="flex flex-col text-right hidden sm:flex">
              <span className="text-sm font-semibold">{user?.name || 'User'}</span>
              <span className="text-xs text-muted-foreground">{user?.role?.replace('_', ' ') || 'Role'}</span>
            </div>
            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </div>
          </div>
        </div>
      </header>

      {/* Main Layout Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Dynamic Sidebar */}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-10 w-64 bg-card border-r shadow-sm flex flex-col transform transition-transform duration-200 ease-in-out lg:relative lg:translate-x-0 h-[calc(100vh-4rem)] mt-16 lg:mt-0",
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="p-4 border-b bg-muted/30">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
              {MODULES.find(m => m.id === activeModule)?.name}
            </h2>
          </div>

          {/* Master Data Category Dropdown Filter */}
          {activeModule === 'masterdata' && (
            <div className="px-3 pt-3 pb-2 border-b bg-muted/10">
              <label className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5 block">
                Filter Filter Data:
              </label>
              <select
                value={masterDataFilter}
                onChange={(e) => setMasterDataFilter(e.target.value as 'all' | 'production' | 'material')}
                className="w-full text-xs font-medium bg-card border rounded-md px-2.5 py-1.5 shadow-sm focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
              >
                <option value="all">🌐 All Master Data (Semua)</option>
                <option value="production">🏭 Production Data</option>
                <option value="material">📦 Material Data</option>
              </select>
            </div>
          )}

          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            {currentMenuItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path));

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => window.innerWidth < 1024 && setSidebarOpen(false)}
                  className={cn(
                    "flex flex-col px-3 py-2.5 rounded-md transition-all group",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "hover:bg-secondary text-muted-foreground hover:text-foreground"
                  )}
                >
                  <div className="flex items-center space-x-3">
                    <Icon size={18} className={cn(isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground")} />
                    <span className="font-medium">{item.name}</span>
                  </div>
                  {item.badge && (
                    <div className="mt-1.5 ml-7">
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-sm font-medium border",
                        item.badge.includes('Production & Material')
                          ? "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800"
                          : item.badge.includes('Production')
                            ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800"
                            : "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800"
                      )}>
                        {item.badge}
                      </span>
                    </div>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="p-4 border-t space-y-2 shrink-0">
            <button
              onClick={handleLogout}
              className="flex w-full items-center space-x-3 px-3 py-2 rounded-md transition-colors hover:bg-destructive/10 text-destructive hover:text-destructive"
            >
              <LogOut size={18} />
              <span className="font-medium">Logout</span>
            </button>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 flex flex-col h-[calc(100vh-4rem)] overflow-hidden relative bg-background">
          {/* View Only Banner */}
          {isViewOnly && (
            <div className="bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-4 py-2 text-sm font-medium flex items-center justify-center border-b border-amber-200 dark:border-amber-800 shrink-0">
              <ShieldAlert size={16} className="mr-2" />
              View-Only Mode. You do not have permission to edit data in this module.
            </div>
          )}

          <div className="flex-1 overflow-auto p-4 md:p-6">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-0 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
