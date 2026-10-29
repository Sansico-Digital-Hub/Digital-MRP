
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter, createRoute, createRootRoute, redirect } from '@tanstack/react-router';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './routes/Dashboard';
import { Login } from './routes/Login';
import { useAuthStore } from './stores/authStore';
import { isFeatureEnabled } from './lib/features';
import './index.css';

const queryClient = new QueryClient();

// Auth Guard
const checkAuth = () => {
  const { accessToken } = useAuthStore.getState();
  if (!accessToken) {
    throw redirect({
      to: '/login',
    });
  }
};

const rootRoute = createRootRoute({
  component: () => <RouterProviderInner />
});

// Create a wrapper to use Zustand hook properly inside React
function RouterProviderInner() {
  return <Outlet />;
}
import { Outlet } from '@tanstack/react-router';

const authLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authLayout',
  beforeLoad: checkAuth,
  component: Layout,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: () => {
    const { accessToken } = useAuthStore.getState();
    if (accessToken) throw redirect({ to: '/' });
  },
  component: Login,
});

const indexRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/',
  component: Dashboard,
});

import { ItemTracking } from './routes/ItemTracking';

const trackingRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/tracking',
  component: ItemTracking,
});

import { Items } from './routes/Items';
import { Users } from './routes/Users';
import { DailySchedule } from './routes/DailySchedule';
import { FGStock } from './routes/FGStock';
import { WIP } from './routes/WIP';
import { WeeklyDemand } from './routes/WeeklyDemand';
import { ShortageDetail } from './routes/ShortageDetail';
import { Hotlist } from './routes/Hotlist';
import { StockRawMaterial } from './routes/StockRawMaterial';
import { OutstandingPO } from './routes/OutstandingPO';
import { NpofMaterials } from './routes/NpofMaterials';
import { MaterialCalc } from './routes/MaterialCalc';

const materialCalcRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/material-calculation',
  beforeLoad: () => {
    // Menu ini disembunyikan saat flag mati, jadi URL-nya ikut dikunci
    // supaya tetap bisa diakses hanya lewat alat uji (mis. Postman).
    if (!isFeatureEnabled('materialCalculation')) throw redirect({ to: '/' });
  },
  component: MaterialCalc,
});

const outstandingPoRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/outstanding-po',
  component: OutstandingPO,
});

const npofMaterialsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/npof-materials',
  component: NpofMaterials,
});

const stockRawMaterialRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/stock-raw-material',
  component: StockRawMaterial,
});

const hotlistRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/hotlist',
  component: Hotlist,
});

const itemsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/items',
  component: Items,
});

const dailyScheduleRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/schedule',
  component: DailySchedule,
});

const fgStockRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/fg-stock',
  component: FGStock,
});

const wipRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/wip',
  component: WIP,
});

const usersRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/users',
  component: Users,
});

const weeklyDemandRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/weekly-demand',
  component: WeeklyDemand,
});

const shortageDetailRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/shortage-detail',
  component: ShortageDetail,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  authLayoutRoute.addChildren([
    indexRoute,
    trackingRoute,
    hotlistRoute,
    itemsRoute,
    dailyScheduleRoute,
    fgStockRoute,
    wipRoute,
    usersRoute,
    weeklyDemandRoute,
    shortageDetailRoute,
    stockRawMaterialRoute,
    outstandingPoRoute,
    npofMaterialsRoute,
    materialCalcRoute,
  ]),
]);

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

export default App;
