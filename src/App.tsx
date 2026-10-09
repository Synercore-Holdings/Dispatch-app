import { useState, lazy, Suspense } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { NotificationProvider } from "./context/NotificationContext";
import { Sidebar } from "./components/Sidebar";
import { Login } from "./components/views/Login";
import { PrivacyNotice } from "./components/views/PrivacyNotice";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Loader2, Menu } from "lucide-react";

const NAV_TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  "dispatch-performance": "Dispatch Performance",
  "outstanding-orders": "Outstanding Sales Orders",
  settings: "Settings",
};

// The app is now a reporting view over uploaded ERP exports (invoice lines,
// invoice register, IBT transactions). The previous order-management screens
// are no longer routed; their code remains in git history / src for reference.
const Overview = lazy(() => import("./components/views/Overview").then(m => ({ default: m.Overview })));
const DispatchPerformance = lazy(() => import("./components/views/DispatchPerformance").then(m => ({ default: m.DispatchPerformance })));
const OutstandingOrders = lazy(() => import("./components/views/OutstandingOrders").then(m => ({ default: m.OutstandingOrders })));
const SettingsView = lazy(() => import("./components/views/SettingsView").then(m => ({ default: m.SettingsView })));

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[400px]">
    <div className="text-center">
      <Loader2 className="w-8 h-8 text-resilinc-primary animate-spin mx-auto mb-3" />
      <p className="text-sm text-gray-500">Loading...</p>
    </div>
  </div>
);

type AuthView = "login" | "privacy";

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();
  const [activeNavItem, setActiveNavItem] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [authView, setAuthView] = useState<AuthView>("login");

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-resilinc-primary animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    if (authView === "privacy") {
      return <PrivacyNotice onBack={() => setAuthView("login")} />;
    }
    return <Login onPrivacy={() => setAuthView("privacy")} />;
  }

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gray-50">
        <Sidebar
          activeItem={activeNavItem}
          onItemChange={(item) => { setActiveNavItem(item); setMobileNavOpen(false); }}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNavOpen(false)}
        />
        {mobileNavOpen && (
          <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />
        )}

        <div className={`${sidebarCollapsed ? "md:ml-16" : "md:ml-60"} min-h-screen transition-all duration-300`}>
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 px-4 md:hidden" style={{ background: "#064e3b" }}>
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.08] text-white"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="truncate text-sm font-semibold text-white">{NAV_TITLES[activeNavItem] ?? "Dispatch"}</span>
          </header>
          <div className="mx-auto max-w-[1600px] p-4 sm:p-6 lg:p-8">
            <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
                {activeNavItem === "settings" ? <SettingsView /> : activeNavItem === "outstanding-orders" ? <OutstandingOrders /> : activeNavItem === "dashboard" ? <Overview onNavigate={setActiveNavItem} /> : <DispatchPerformance />}
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}

function App() {
  return (
    <NotificationProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </NotificationProvider>
  );
}

export default App;
