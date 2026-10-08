import { useState, lazy, Suspense } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { NotificationProvider } from "./context/NotificationContext";
import { Sidebar } from "./components/Sidebar";
import { Login } from "./components/views/Login";
import { PrivacyNotice } from "./components/views/PrivacyNotice";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Loader2 } from "lucide-react";

// The app is now a reporting view over uploaded ERP exports (invoice lines,
// invoice register, IBT transactions). The previous order-management screens
// are no longer routed; their code remains in git history / src for reference.
const DispatchPerformance = lazy(() => import("./components/views/DispatchPerformance").then(m => ({ default: m.DispatchPerformance })));
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
  const [activeNavItem, setActiveNavItem] = useState("dispatch-performance");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
          onItemChange={setActiveNavItem}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        />

        <div className={`${sidebarCollapsed ? "ml-16" : "ml-60"} min-h-screen transition-all duration-300`}>
          <div className="mx-auto max-w-[1600px] p-8">
            <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
                {activeNavItem === "settings" ? <SettingsView /> : <DispatchPerformance />}
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
