import React from "react";
import {
  BarChart3,
  LayoutDashboard,
  ClipboardList,
  Settings as SettingsIcon,
  LogOut,
  User,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../hooks/useTheme";

interface SidebarProps {
  activeItem: string;
  onItemChange: (item: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Below the md breakpoint the sidebar is an off-canvas drawer, shown only while this is true. */
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

interface NavItem {
  id: string;
  icon: React.FC<{ className?: string }>;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { id: "dispatch-performance", icon: BarChart3, label: "Dispatch Performance" },
  { id: "outstanding-orders", icon: ClipboardList, label: "Outstanding Sales Orders" },
];

const BOTTOM_ITEMS: NavItem[] = [
  { id: "settings", icon: SettingsIcon, label: "Settings" },
];

export const Sidebar: React.FC<SidebarProps> = ({ activeItem, onItemChange, collapsed: collapsedSetting, onToggleCollapse, mobileOpen, onCloseMobile }) => {
  // The mobile drawer always shows labels, whatever the desktop collapse setting is.
  const collapsed = collapsedSetting && !mobileOpen;
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();

  const handleLogout = async () => {
    try { await logout(); } catch (error) { console.error("Logout error:", error); }
  };

  const renderNavButton = ({ id, icon: Icon, label }: NavItem) => {
    const isActive = activeItem === id;
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
        {isActive && !collapsed && (
          <span className="absolute left-[3px] top-[25%] bottom-[25%] w-[3px] rounded-full bg-emerald-400" />
        )}
        <Icon className={`w-[18px] h-[18px] flex-shrink-0 ${isActive ? "text-emerald-400" : ""}`} />
        {!collapsed && (
          <span className={`text-[14px] flex-1 text-left ${isActive ? "text-white font-semibold" : "font-medium"}`}>{label}</span>
        )}
      </button>
    );
  };

  const utilityButtonClass = `w-full flex items-center gap-3 rounded-xl transition-all duration-150 text-white/40 hover:bg-white/[0.06] ${
    collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5"
  }`;

  return (
    <div
      className={`fixed left-0 top-0 h-[100dvh] flex flex-col overflow-y-auto z-40 transition-all duration-300 sidebar-scroll md:translate-x-0 ${
        mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
      } ${collapsed ? "w-16" : "w-60"}`}
      style={{ background: "#064e3b" }}
    >
      {/* Header */}
      <div
        className={`sticky top-0 z-10 flex items-center justify-between py-5 border-b border-white/[0.06] flex-shrink-0 ${collapsed ? "px-3" : "px-5"}`}
        style={{ background: "#064e3b" }}
      >
        {!collapsed && (
          <div>
            <h1 className="text-white font-bold text-2xl tracking-tight leading-tight">Dispatch</h1>
            <p className="text-white/40 text-[11px] uppercase tracking-[0.14em] mt-0.5">
              Performance
            </p>
          </div>
        )}
        <button
          onClick={onToggleCollapse}
          className="hidden md:flex w-8 h-8 rounded-xl bg-white/[0.06] items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.1] transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
        <button
          onClick={onCloseMobile}
          className="md:hidden w-8 h-8 rounded-xl bg-white/[0.06] flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.1] transition-colors"
          aria-label="Close menu"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation */}
      <div className="flex-1 px-3 pt-4 pb-2 space-y-1">
        {NAV_ITEMS.map(renderNavButton)}
      </div>

      {/* Bottom Utilities */}
      <div className="border-t border-white/[0.06] px-3 pt-4 pb-3 space-y-0.5 flex-shrink-0">
        {BOTTOM_ITEMS.map(renderNavButton)}

        <button
          onClick={toggleTheme}
          className={`${utilityButtonClass} hover:text-amber-400`}
          title={collapsed ? (theme === "dark" ? "Light Mode" : "Dark Mode") : undefined}
        >
          {theme === "dark" ? <Sun className="w-[17px] h-[17px] flex-shrink-0" /> : <Moon className="w-[17px] h-[17px] flex-shrink-0" />}
          {!collapsed && <span className="text-[13px] font-medium">{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>}
        </button>

        <button onClick={handleLogout} className={`${utilityButtonClass} hover:text-rose-400`} title={collapsed ? "Logout" : undefined}>
          <LogOut className="w-[17px] h-[17px] flex-shrink-0" />
          {!collapsed && <span className="text-[13px] font-medium">Logout</span>}
        </button>
      </div>

      {/* Profile Card */}
      {!collapsed && (
        <div className="mx-4 mb-4 p-3.5 rounded-xl border border-white/[0.08] flex items-center gap-3 bg-white/10 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0 shadow-sm">
            <User className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-white/90 truncate">{user?.username || "User"}</p>
            <p className="text-[11px] text-white/70 truncate capitalize">{user?.role || "user"}</p>
          </div>
        </div>
      )}

      <style>{`
        .sidebar-scroll::-webkit-scrollbar { width: 2px; }
        .sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
        .sidebar-scroll::-webkit-scrollbar-thumb { background: rgba(100, 116, 139, 0.1); border-radius: 2px; }
        .sidebar-scroll::-webkit-scrollbar-thumb:hover { background: rgba(100, 116, 139, 0.2); }
      `}</style>
    </div>
  );
};
