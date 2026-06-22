import { useState, lazy, Suspense, useEffect, useMemo } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { NotificationProvider } from "./context/NotificationContext";
import { Sidebar } from "./components/Sidebar";
import { AlertHub } from "./components/AlertHub";
import { JobDetailsModal } from "./components/JobDetailsModal";
import { Login } from "./components/views/Login";
import { PrivacyNotice } from "./components/views/PrivacyNotice";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { HelpGuide } from "./components/HelpGuide";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DispatchProvider, useDispatch } from "./context/DispatchContext";
import { mockDrivers } from "./data/mockData";
import { Loader2, Mail } from "lucide-react";
import { messagesAPI } from "./services/api";

const NAV_TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  exceptions: "Exceptions",
  home: "Import Customer Orders",
  ibt: "Import IBT",
  "ibt-dispatch": "IBT Management",
  clipboard: "Order Management",
  "africa-exports": "Africa Exports",
  "africa-export-onboarding": "Export Onboarding",
  invoicing: "Invoicing Reconciliation",
  calendar: "Scheduling",
  grid: "Order Reports",
  "ibt-reports": "IBT Reports",
  analytics: "Analytics",
  "flowbin-tracking": "Flowbin Tracking",
  inbox: "Messages",
  clock: "Order History",
  settings: "Settings",
  "user-management": "User Management",
};

// Lazy-loaded views for code splitting
const Dashboard = lazy(() => import("./components/views/Dashboard").then(m => ({ default: m.Dashboard })));
const ExceptionsView = lazy(() => import("./components/views/ExceptionsView").then(m => ({ default: m.ExceptionsView })));
const DispatchView = lazy(() => import("./components/views/DispatchView").then(m => ({ default: m.DispatchView })));
const AfricaExportsView = lazy(() => import("./components/views/AfricaExportsView").then(m => ({ default: m.AfricaExportsView })));
const InvoicingReconciliation = lazy(() => import("./components/views/InvoicingReconciliation").then(m => ({ default: m.InvoicingReconciliation })));
const IBTDispatchView = lazy(() => import("./components/views/IBTDispatchView").then(m => ({ default: m.IBTDispatchView })));
const OrderImport = lazy(() => import("./components/views/OrderImport").then(m => ({ default: m.OrderImport })));
const IBTImport = lazy(() => import("./components/views/IBTImport").then(m => ({ default: m.IBTImport })));
const CalendarView = lazy(() => import("./components/views/CalendarView").then(m => ({ default: m.CalendarView })));
const AnalyticsView = lazy(() => import("./components/views/AnalyticsView").then(m => ({ default: m.AnalyticsView })));
const AdvancedAnalytics = lazy(() => import("./components/views/AdvancedAnalytics").then(m => ({ default: m.AdvancedAnalytics })));
const HistoryView = lazy(() => import("./components/views/HistoryView").then(m => ({ default: m.HistoryView })));
const IBTReports = lazy(() => import("./components/views/IBTReports").then(m => ({ default: m.IBTReports })));
const FlowbinTracking = lazy(() => import("./components/views/FlowbinTracking").then(m => ({ default: m.FlowbinTracking })));
const InboxView = lazy(() => import("./components/views/InboxView").then(m => ({ default: m.InboxView })));
const UserManagement = lazy(() => import("./components/views/UserManagement").then(m => ({ default: m.UserManagement })));
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
  const { isAuthenticated, isLoading, user } = useAuth();
  const { jobs, drivers } = useDispatch();
  const [activeNavItem, setActiveNavItem] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [alertHubOpen, setAlertHubOpen] = useState(false);
  const [helpGuideOpen, setHelpGuideOpen] = useState(false);
  const [dispatchTab, setDispatchTab] = useState<string | undefined>(undefined);
  const [selectedDispatchRef, setSelectedDispatchRef] = useState<string | undefined>(undefined);
  const [selectedAfricaExportRef, setSelectedAfricaExportRef] = useState<string | undefined>(undefined);
  const [selectedAfricaExportFilter, setSelectedAfricaExportFilter] = useState<string | undefined>(undefined);
  const [selectedJobFromAlert, setSelectedJobFromAlert] = useState<string | null>(null);
  const [authView, setAuthView] = useState<AuthView>("login");
  const [openTabs, setOpenTabs] = useState([{ id: "dashboard", title: NAV_TITLES.dashboard }]);

  const openPageTab = (page: string) => {
    setOpenTabs((prev) => {
      if (prev.some((tab) => tab.id === page)) return prev;
      return [...prev, { id: page, title: NAV_TITLES[page] ?? page }];
    });
  };

  const navigateToPage = (page: string, tab?: string, ref?: string) => {
    openPageTab(page);
    setActiveNavItem(page);
    setDispatchTab(tab);
    setSelectedDispatchRef(page === "clipboard" ? ref : undefined);
    if (page === "africa-exports") {
      setSelectedAfricaExportRef(ref);
      setSelectedAfricaExportFilter(tab);
    } else {
      setSelectedAfricaExportRef(undefined);
      setSelectedAfricaExportFilter(undefined);
    }
  };

  // Unread message count
  const [unreadMessages, setUnreadMessages] = useState(0);
  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchUnread = () => {
      messagesAPI.getUnreadCount().then((data) => setUnreadMessages(data.count)).catch((err) => {
        console.warn("Failed to fetch unread message count", err);
      });
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 15000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Find job by ID for the modal triggered from AlertHub
  const alertJob = useMemo(() => selectedJobFromAlert ? jobs.find(j => j.id === selectedJobFromAlert) ?? null : null, [selectedJobFromAlert, jobs]);
  const alertJobDriver = useMemo(() => alertJob?.driverId ? drivers.find(d => d.id === alertJob.driverId)?.name : undefined, [alertJob, drivers]);

  const renderView = () => {
    let view;
    switch (activeNavItem) {
      case "dashboard":
        view = <Dashboard onOpenAlerts={() => setAlertHubOpen(true)} onNavigate={navigateToPage} />; break;
      case "exceptions":
        view = <ExceptionsView onNavigate={navigateToPage} />; break;
      case "home":
        view = <OrderImport />; break;
      case "ibt":
        view = <IBTImport />; break;
      case "ibt-dispatch":
        view = <IBTDispatchView onOpenAlerts={() => setAlertHubOpen(true)} />; break;
      case "clipboard":
        view = <DispatchView onOpenAlerts={() => setAlertHubOpen(true)} initialTab={dispatchTab as any} initialRef={selectedDispatchRef} />; break;
      case "africa-exports":
        view = <AfricaExportsView initialRef={selectedAfricaExportRef} initialFilter={selectedAfricaExportFilter} />; break;
      case "africa-export-onboarding":
        view = <AfricaExportsView initialFilter="onboarding" />; break;
      case "invoicing":
        view = <InvoicingReconciliation onNavigate={navigateToPage} />; break;
      case "calendar":
        view = <CalendarView />; break;
      case "grid":
        view = <AnalyticsView />; break;
      case "ibt-reports":
        view = <IBTReports />; break;
      case "flowbin-tracking":
        view = <FlowbinTracking />; break;
      case "analytics":
        view = <AdvancedAnalytics />; break;
      case "clock":
        view = <HistoryView />; break;
      case "inbox":
        view = <InboxView />; break;
      case "settings":
        view = <SettingsView />; break;
      case "user-management":
        if (user?.role === "admin") {
          view = <UserManagement />; break;
        }
        view = <Dashboard onNavigate={navigateToPage} />; break;
      default:
        view = <Dashboard onNavigate={navigateToPage} />; break;
    }

    return (
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          {view}
        </Suspense>
      </ErrorBoundary>
    );
  };

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
        <ConnectionStatus />

        <Sidebar
          activeItem={activeNavItem}
          onItemChange={navigateToPage}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          onOpenHelp={() => setHelpGuideOpen(true)}
        />

        <div className={`${sidebarCollapsed ? "ml-16" : "ml-60"} min-h-screen transition-all duration-300`}>
          {/* Floating message notification */}
          {unreadMessages > 0 && activeNavItem !== "inbox" && (
            <button
              onClick={() => navigateToPage("inbox")}
              className="fixed top-4 right-4 z-40 flex items-center gap-2 px-3 py-2 bg-resilinc-primary text-white rounded-lg shadow-lg hover:bg-resilinc-primary-dark transition-all animate-pulse hover:animate-none"
            >
              <Mail className="h-4 w-4" />
              <span className="text-sm font-medium">{unreadMessages} new message{unreadMessages > 1 ? "s" : ""}</span>
            </button>
          )}
          <div className="mx-auto max-w-[1600px] p-8">
            <div className="mb-5 flex items-center gap-2 overflow-x-auto border-b border-gray-200 pb-2">
              {openTabs.map((tab) => (
                <div
                  key={tab.id}
                  onClick={() => navigateToPage(tab.id)}
                  className={`flex h-9 max-w-[240px] flex-shrink-0 cursor-pointer items-center gap-2 rounded-t-lg border px-3 text-sm font-semibold transition-colors ${
                    activeNavItem === tab.id
                      ? "border-emerald-200 bg-white text-emerald-700 shadow-sm"
                      : "border-gray-200 bg-gray-100 text-gray-600 hover:bg-white hover:text-gray-900"
                  }`}
                >
                  <span className="truncate">{tab.title}</span>
                  {tab.id !== "dashboard" && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenTabs((prev) => {
                          const remaining = prev.filter((item) => item.id !== tab.id);
                          if (activeNavItem === tab.id) {
                            const fallback = remaining[remaining.length - 1]?.id ?? "dashboard";
                            setActiveNavItem(fallback);
                            setDispatchTab(undefined);
                          }
                          return remaining.length > 0 ? remaining : [{ id: "dashboard", title: NAV_TITLES.dashboard }];
                        });
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded-full text-gray-400 hover:bg-red-50 hover:text-red-500"
                      title={`Close ${tab.title}`}
                    >
                      x
                    </button>
                  )}
                </div>
              ))}
            </div>
            {renderView()}
          </div>
        </div>

        {/* Alert Hub */}
        <AlertHub
          open={alertHubOpen}
          onClose={() => setAlertHubOpen(false)}
          onSelectJob={(jobId) => setSelectedJobFromAlert(jobId)}
        />

        {/* Job Details from Alert */}
        {alertJob && (
          <JobDetailsModal
            job={alertJob}
            onClose={() => setSelectedJobFromAlert(null)}
            driverName={alertJobDriver}
          />
        )}

        {/* Help Guide */}
        <HelpGuide
          open={helpGuideOpen}
          onClose={() => setHelpGuideOpen(false)}
          onNavigateTo={(page) => navigateToPage(page)}
        />
      </div>
    </ProtectedRoute>
  );
}

function AuthenticatedDispatchApp() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <DispatchProvider
      initialJobs={[]}
      initialDrivers={mockDrivers}
      useAPI={!isLoading && isAuthenticated}
    >
      <AppContent />
    </DispatchProvider>
  );
}

function App() {
  return (
    <NotificationProvider>
      <AuthProvider>
        <AuthenticatedDispatchApp />
      </AuthProvider>
    </NotificationProvider>
  );
}

export default App;
