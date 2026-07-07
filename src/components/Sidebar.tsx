import React, { useState, useMemo, useEffect } from "react";
import {
  LayoutDashboard,
  Home,
  ClipboardCheck,
  ClipboardList,
  Calendar,
  Grid3x3,
  Clock,
  Settings as SettingsIcon,
  BarChart3,
  ArrowRightLeft,
  Truck,
  LogOut,
  User,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Search,
  Sun,
  Moon,
  HelpCircle,
  Package,
  Mail,
  AlertTriangle,
  Globe2,
  FileText,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useDispatch } from "../context/DispatchContext";
import { africaExportCountryRulesAPI, africaExportsAPI, messagesAPI } from "../services/api";
import { useTheme } from "../hooks/useTheme";
import { countExceptionQueueItems } from "../utils/exceptionQueues";

interface SidebarProps {
  activeItem: string;
  onItemChange: (item: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenHelp?: () => void;
}

interface NavItem {
  id: string;
  icon: React.FC<any>;
  label: string;
  adminOnly?: boolean;
  badge?: number;
  badgeLabel?: string;
  badgeType?: "danger" | "info";
}

interface NavSection {
  key: string;
  title: string;
  items: NavItem[];
}

interface SidebarAfricaExport {
  ref: string;
  destinationCountry?: string;
  status: "pending" | "assigned" | "in-transit" | "delivered" | "cancelled";
  eta: string;
  lastCheckedAt: string;
  documents: Record<string, boolean>;
  archived?: boolean;
}

interface SidebarCountryRule {
  country: string;
  requiredDocumentIds: string[];
}

const AFRICA_EXPORTS_KEY = "dispatch_africa_export_shipments_v2";
const REQUIRED_AFRICA_DOCUMENT_IDS = [
  "commercial-invoice",
  "packing-list",
  "sad-500",
  "transport-document",
  "hs-code",
  "exporter-code",
  "proof-export",
  "coa",
  "tds",
  "sds",
  "allergen",
  "non-gmo",
  "food-grade",
  "shelf-life",
  "batch-traceability",
];

const isInDefaultEtaWindow = (eta?: string) => {
  if (!eta) return true;

  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfRange = new Date(startOfWeek);
  endOfRange.setDate(endOfRange.getDate() + 5 * 7);
  endOfRange.setHours(23, 59, 59, 999);

  const etaDate = new Date(eta);
  return !Number.isNaN(etaDate.getTime()) && etaDate >= startOfWeek && etaDate <= endOfRange;
};

export const Sidebar: React.FC<SidebarProps> = ({ activeItem, onItemChange, collapsed, onToggleCollapse, onOpenHelp }) => {
  const { user, logout } = useAuth();
  const { jobs } = useDispatch();
  const { theme, toggle: toggleTheme } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [africaExports, setAfricaExports] = useState<SidebarAfricaExport[]>(() => {
    try {
      const raw = localStorage.getItem(AFRICA_EXPORTS_KEY);
      return raw ? JSON.parse(raw) as SidebarAfricaExport[] : [];
    } catch {
      return [];
    }
  });
  const [africaExportCountryRules, setAfricaExportCountryRules] = useState<Record<string, string[]>>({});
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    dispatch: true,
    operations: true,
  });

  // Unread message count
  const [unreadMessages, setUnreadMessages] = useState(0);
  useEffect(() => {
    const fetchUnread = () => {
      messagesAPI.getUnreadCount().then((data) => setUnreadMessages(data.count)).catch((err) => {
        console.warn("Failed to fetch unread message count", err);
      });
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchAfricaExports = () => {
      Promise.all([africaExportsAPI.getAll(), africaExportCountryRulesAPI.getAll()])
        .then(([shipments, rules]) => {
          setAfricaExports(shipments);
          setAfricaExportCountryRules((rules as SidebarCountryRule[]).reduce<Record<string, string[]>>((acc, rule) => {
            acc[rule.country] = rule.requiredDocumentIds || [];
            return acc;
          }, {}));
          localStorage.setItem(AFRICA_EXPORTS_KEY, JSON.stringify(shipments));
        })
        .catch((err) => {
          console.warn("Failed to fetch Africa export sidebar stats", err);
        });
    };
    fetchAfricaExports();
    const interval = setInterval(fetchAfricaExports, 30000);
    return () => clearInterval(interval);
  }, []);

  const sidebarStats = useMemo(() => {
    const orderJobs = jobs.filter((j) => j.jobType === "order" || j.jobType === undefined);
    const ibtJobs = jobs.filter((j) => j.jobType === "ibt");
    const pendingOrderRefs = new Set(
      orderJobs
        .filter((j) => j.status === "pending" && isInDefaultEtaWindow(j.eta))
        .map((j) => j.ref || j.id),
    );
    return {
      totalJobs: orderJobs.length,
      inTransit: orderJobs.filter((j) => j.status === "en-route").length,
      exceptions: countExceptionQueueItems(orderJobs),
      pendingCount: pendingOrderRefs.size,
      ibtPendingCount: ibtJobs.filter((j) => j.status === "pending").length,
      africaExportRiskCount: africaExports.filter((shipment) => {
        if (shipment.archived || shipment.status === "delivered" || shipment.status === "cancelled") return false;
        const requiredIds = new Set([
          ...REQUIRED_AFRICA_DOCUMENT_IDS,
          ...(shipment.destinationCountry ? africaExportCountryRules[shipment.destinationCountry] || [] : []),
        ]);
        const missingRequiredDocs = Array.from(requiredIds).some((id) => !shipment.documents?.[id]);
        return missingRequiredDocs || !shipment.lastCheckedAt;
      }).length,
    };
  }, [africaExportCountryRules, africaExports, jobs]);

  const navSections: NavSection[] = [
    {
      key: "dispatch",
      title: "DISPATCH",
      items: [
        { id: "home", icon: Home, label: "Import Customer Orders" },
        { id: "ibt", icon: ArrowRightLeft, label: "Import IBT" },
        { id: "ibt-dispatch", icon: Truck, label: "IBT Management", badge: sidebarStats.ibtPendingCount, badgeType: "info" },
        { id: "clipboard", icon: ClipboardList, label: "Order Management", badge: sidebarStats.pendingCount, badgeType: "info" },
        {
          id: "africa-exports",
          icon: Globe2,
          label: "Africa Exports",
          badge: sidebarStats.africaExportRiskCount,
          badgeLabel: sidebarStats.africaExportRiskCount > 0 ? String(sidebarStats.africaExportRiskCount) : "OK",
          badgeType: sidebarStats.africaExportRiskCount > 0 ? "danger" : "info",
        },
        { id: "africa-export-onboarding", icon: ClipboardCheck, label: "Export Onboarding" },
      ],
    },
    {
      key: "operations",
      title: "OPERATIONS",
      items: [
        { id: "calendar", icon: Calendar, label: "Scheduling" },
        { id: "grid", icon: Grid3x3, label: "Order Reports" },
        { id: "ibt-reports", icon: ArrowRightLeft, label: "IBT Reports" },
        { id: "analytics", icon: BarChart3, label: "Analytics" },
        { id: "invoicing", icon: FileText, label: "Invoicing Reconciliation" },
        { id: "flowbin-tracking", icon: Package, label: "Flowbin Tracking" },
        { id: "inbox", icon: Mail, label: "Messages", badge: unreadMessages, badgeType: "danger" },
        { id: "clock", icon: Clock, label: "Order History" },
      ],
    },
  ];

  const bottomItems: NavItem[] = [
    { id: "settings", icon: SettingsIcon, label: "Settings" },
  ];

  const filteredBottomItems = bottomItems.filter(item => {
    if (item.adminOnly) return user?.role === "admin";
    return true;
  });

  const handleLogout = async () => {
    try { await logout(); } catch (error) { console.error("Logout error:", error); }
  };

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const matchesSearch = (label: string) => {
    if (!searchQuery) return true;
    return label.toLowerCase().includes(searchQuery.toLowerCase());
  };

  const filterItems = (items: NavItem[]) => {
    return items.filter(item => {
      if (item.adminOnly && user?.role !== "admin") return false;
      return matchesSearch(item.label);
    });
  };

  const renderNavButton = ({ id, icon: Icon, label, badge, badgeLabel, badgeType }: NavItem) => {
    const isActive = activeItem === id;
    const showBadge = badgeLabel !== undefined || (badge !== undefined && badge > 0);
    const displayBadge = badgeLabel ?? (badge && badge > 99 ? "99+" : String(badge));
    return (
      <button
        key={id}
        onClick={() => onItemChange(id)}
        className={`w-full flex items-center rounded-xl transition-all duration-150 relative overflow-hidden ${
          collapsed ? "justify-center px-2 py-3" : "gap-3 px-3.5 py-[11px]"
        } ${
          isActive
            ? "bg-emerald-400/20 shadow-[0_0_12px_-3px_rgba(16,185,129,0.1)]"
            : "text-white/50 hover:text-white/90 hover:bg-white/[0.08]"
        }`}
        title={collapsed ? label : undefined}
      >
        {/* Left accent bar */}
        {isActive && !collapsed && (
          <span className="absolute left-[3px] top-[25%] bottom-[25%] w-[3px] rounded-full bg-emerald-400" />
        )}
        <Icon className={`w-[18px] h-[18px] flex-shrink-0 ${isActive ? "text-emerald-400" : ""}`} />
        {collapsed && showBadge && (
          <span className={`absolute right-1.5 top-1.5 min-w-[16px] rounded-full px-1 text-[9px] font-bold leading-4 ${
            badgeType === "danger" ? "bg-red-500 text-white" : "bg-emerald-400 text-emerald-950"
          }`}>
            {displayBadge}
          </span>
        )}
        {!collapsed && (
          <>
            <span className={`text-[14px] flex-1 text-left ${isActive ? "text-white font-semibold" : "font-medium"}`}>{label}</span>
            {showBadge && (
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                isActive
                  ? "bg-emerald-500/20 text-emerald-300"
                  : badgeType === "danger" ? "bg-red-500/20 text-red-400" : "bg-emerald-500/15 text-emerald-400"
              }`}>
                {displayBadge}
              </span>
            )}
          </>
        )}
      </button>
    );
  };

  return (
    <div
      className={`fixed left-0 top-0 h-screen flex flex-col z-30 transition-all duration-300 ${
        collapsed ? "w-16" : "w-60"
      }`}
      style={{ background: "#064e3b" }}
    >
      {/* Header */}
      <div className={`flex items-center justify-between py-5 border-b border-white/[0.06] ${collapsed ? "px-3" : "px-5"}`}>
        {!collapsed && (
          <div>
            <h1 className="text-white font-bold text-2xl tracking-tight leading-tight">Dispatch</h1>
            <p className="text-white/40 text-[11px] uppercase tracking-[0.14em] mt-0.5">
              K58 Dispatch
            </p>
          </div>
        )}
        <button
          onClick={onToggleCollapse}
          className="w-8 h-8 rounded-xl bg-white/[0.06] flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.1] transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Search */}
      {!collapsed && (
        <div className="px-4 pt-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              type="text"
              placeholder="Search menu..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-white/80 text-sm rounded-xl pl-10 pr-3 py-3 placeholder-white/40 border border-white/[0.1] bg-white/10 focus:outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20"
            />
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-2 sidebar-scroll">
        {/* Dashboard */}
        {matchesSearch("Dashboard") && renderNavButton({
          id: "dashboard", icon: LayoutDashboard, label: "Dashboard",
        })}
        {matchesSearch("Exceptions") && renderNavButton({
          id: "exceptions", icon: AlertTriangle, label: "Exceptions", badge: sidebarStats.exceptions, badgeType: "danger",
        })}

        {/* Sections */}
        {navSections.map((section) => {
          const items = filterItems(section.items);
          if (items.length === 0) return null;

          const isExpanded = searchQuery ? true : expandedSections[section.key] !== false;

          return (
            <div key={section.key} className="mt-7">
              {!collapsed ? (
                <button
                  onClick={() => !searchQuery && toggleSection(section.key)}
                  className="w-full flex items-center justify-between px-3 mb-2.5 group"
                >
                  <span className="text-[11px] font-bold text-white/60 uppercase tracking-[0.14em]">
                    {section.title}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-white/30 transition-transform duration-200 ${
                      isExpanded ? "" : "-rotate-90"
                    }`}
                  />
                </button>
              ) : (
                <div className="border-t border-white/[0.06] mx-2 my-3" />
              )}

              <div
                className={`space-y-1 overflow-hidden transition-all duration-200 ${
                  isExpanded ? "max-h-[500px] opacity-100" : collapsed ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
                }`}
              >
                {items.map(renderNavButton)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Stats */}
      {!collapsed && (
        <div className="mx-4 mb-3 p-3 rounded-xl bg-white/10">
          <p className="text-[11px] font-bold text-white/60 uppercase tracking-[0.14em] mb-3">
            Quick Stats
          </p>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-white/70">Total Jobs</span>
              <span className="text-[13px] font-bold text-white">{sidebarStats.totalJobs}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-[13px] text-white/70">In Transit</span>
              </div>
              <span className="text-[13px] font-bold text-emerald-400">{sidebarStats.inTransit}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${sidebarStats.exceptions > 0 ? "bg-rose-400" : "bg-white/20"}`} />
                <span className="text-[13px] text-white/70">Exceptions</span>
              </div>
              <span className={`text-[13px] font-bold ${sidebarStats.exceptions > 0 ? "text-rose-400" : "text-white/40"}`}>
                {sidebarStats.exceptions}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Utilities */}
      <div className="border-t border-white/[0.06] px-3 pt-4 pb-3 space-y-0.5">
        {filteredBottomItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onItemChange(item.id)}
              className={`w-full flex items-center gap-3 rounded-xl transition-all duration-150 relative overflow-hidden ${
                collapsed ? "justify-center px-2 py-2.5" : "px-3.5 py-2.5"
              } ${
                activeItem === item.id
                  ? "bg-emerald-400/20 shadow-[0_0_12px_-3px_rgba(16,185,129,0.1)]"
                  : "text-white/40 hover:text-white/70 hover:bg-white/[0.06]"
              }`}
              title={collapsed ? item.label : undefined}
            >
              {activeItem === item.id && !collapsed && (
                <span className="absolute left-[3px] top-[25%] bottom-[25%] w-[3px] rounded-full bg-emerald-400" />
              )}
              <Icon className={`w-[17px] h-[17px] flex-shrink-0 ${activeItem === item.id ? "text-emerald-400" : ""}`} />
              {!collapsed && <span className={`text-[13px] font-medium ${activeItem === item.id ? "text-white" : ""}`}>{item.label}</span>}
            </button>
          );
        })}

        {/* Help Guide */}
        {onOpenHelp && (
          <button
            onClick={onOpenHelp}
            className={`w-full flex items-center gap-3 rounded-xl transition-all duration-150 text-white/40 hover:text-emerald-400 hover:bg-white/[0.06] ${
              collapsed ? "justify-center px-2 py-2.5" : "px-3.5 py-2.5"
            }`}
            title={collapsed ? "Help Guide" : undefined}
          >
            <HelpCircle className="w-[17px] h-[17px] flex-shrink-0" />
            {!collapsed && <span className="text-[13px] font-medium">Help Guide</span>}
          </button>
        )}

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className={`w-full flex items-center gap-3 rounded-xl transition-all duration-150 text-white/40 hover:text-amber-400 hover:bg-white/[0.06] ${
            collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5"
          }`}
          title={collapsed ? (theme === "dark" ? "Light Mode" : "Dark Mode") : undefined}
        >
          {theme === "dark" ? (
            <Sun className="w-[17px] h-[17px] flex-shrink-0" />
          ) : (
            <Moon className="w-[17px] h-[17px] flex-shrink-0" />
          )}
          {!collapsed && (
            <span className="text-[13px] font-medium">
              {theme === "dark" ? "Light Mode" : "Dark Mode"}
            </span>
          )}
        </button>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className={`w-full flex items-center gap-3 rounded-xl transition-all duration-150 text-white/40 hover:text-rose-400 hover:bg-white/[0.06] ${
            collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5"
          }`}
          title={collapsed ? "Logout" : undefined}
        >
          <LogOut className="w-[17px] h-[17px] flex-shrink-0" />
          {!collapsed && <span className="text-[13px] font-medium">Logout</span>}
        </button>
      </div>

      {/* Profile Card */}
      {!collapsed && (
        <div className="mx-4 mb-4 p-3.5 rounded-xl border border-white/[0.08] flex items-center gap-3 bg-white/10">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0 shadow-sm">
            <User className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-white/90 truncate">{user?.username || "User"}</p>
            <p className="text-[11px] text-white/70 truncate capitalize">{user?.role || "user"}</p>
          </div>
        </div>
      )}

      {/* Scrollbar Styles */}
      <style>{`
        .sidebar-scroll::-webkit-scrollbar {
          width: 2px;
        }
        .sidebar-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .sidebar-scroll::-webkit-scrollbar-thumb {
          background: rgba(100, 116, 139, 0.1);
          border-radius: 2px;
        }
        .sidebar-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(100, 116, 139, 0.2);
        }
      `}</style>
    </div>
  );
};
