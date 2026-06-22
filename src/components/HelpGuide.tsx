import React, { useState } from "react";
import {
  X, ChevronRight,
  LayoutDashboard, Home, ClipboardList, Calendar, Grid3x3, Clock,
  BarChart3, ArrowRightLeft, Truck, Users, Search, Settings, Package, Mail,
  Globe2, AlertTriangle, FileText,
} from "lucide-react";

interface HelpGuideProps {
  open: boolean;
  onClose: () => void;
  onNavigateTo?: (page: string) => void;
}

interface GuideSection {
  id: string;
  icon: React.FC<any>;
  title: string;
  description: string;
  steps: { title: string; detail: string }[];
  tips?: string[];
}

const guideSections: GuideSection[] = [
  {
    id: "dashboard",
    icon: LayoutDashboard,
    title: "Dashboard",
    description: "Your executive overview of the entire dispatch operation. See real-time stats, trends, and alerts at a glance.",
    steps: [
      { title: "View KPI Cards", detail: "The top row shows live statistics: Total Jobs, In Transit, Delivered, Exceptions, Pending, ETD This Week, Available Drivers, Pallets, and Weight." },
      { title: "Check Alerts", detail: "Click the red Alerts button (top right) to see overdue orders, exceptions, and urgent items that need attention. The badge shows the total count." },
      { title: "Monitor Trends", detail: "The Weekly Trend chart shows your order volume over the last 12 weeks. Status Distribution shows the breakdown of current jobs." },
      { title: "Track Customers", detail: "The Top 5 Customers section ranks your highest-volume customers with order counts." },
    ],
    tips: [
      "The progress bar at the top shows your overall delivery completion rate.",
      "Stats update automatically every 15 seconds.",
    ],
  },
  {
    id: "exceptions",
    icon: AlertTriangle,
    title: "Exceptions",
    description: "Focused queue for orders that need attention, including overdue work, dispatch-due items, priority jobs, and operational exceptions.",
    steps: [
      { title: "Review Exception Queues", detail: "Use the queue tabs to move between overdue orders, dispatch-due orders, priority work, and exception items without changing the main dispatch filters." },
      { title: "Open the Source Order", detail: "Select an exception to jump back into Order Management with the related order or open its details for investigation." },
      { title: "Clear the Cause", detail: "Resolve the underlying issue by updating dates, status, transporter assignment, pallets, workflow checks, or notes on the order itself." },
      { title: "Watch the Sidebar Badge", detail: "The Exceptions badge in the sidebar counts active exception-queue items, so it drops when the order data no longer matches an exception rule." },
    ],
    tips: [
      "Use Exceptions as the daily control list before dispatching trucks.",
      "The Dashboard alerts and sidebar badge use the same exception logic, so the counts stay aligned.",
    ],
  },
  {
    id: "home",
    icon: Home,
    title: "Import Customer Orders",
    description: "Bulk import customer orders from Excel or CSV files. The system automatically maps columns and normalizes dates.",
    steps: [
      { title: "Upload File", detail: "Drag and drop an Excel (.xlsx/.xls) or CSV file onto the upload area, or click to browse. Supported columns: Document No, Customer Name, Warehouse, Delivery Date, Pallets, Outstanding Qty." },
      { title: "Review Mapping", detail: "The system auto-maps columns from your spreadsheet. Verify the mappings are correct before proceeding." },
      { title: "Preview Data", detail: "Review the parsed orders in the preview table. Check that dates, quantities, and customer names look correct." },
      { title: "Import", detail: "Click Import to create the orders. You'll see a summary showing how many were new, updated, skipped, or failed." },
    ],
    tips: [
      "Date formats like DD/MM/YYYY, YYYY-MM-DD, and Excel serial numbers are all supported.",
      "Orders with the same reference number will be updated, not duplicated.",
      "This PTA deployment accepts Finished Goods AFi, Raw AFi, Dispatch Allmark, and Raws Allmark in Pretoria. Rows for other warehouses are skipped automatically.",
      "Admins can remove legacy customer orders outside the PTA scope using the red 'Remove Non-PTA Orders' action. The action always requires confirmation.",
    ],
  },
  {
    id: "clipboard",
    icon: ClipboardList,
    title: "Order Management",
    description: "The main dispatch hub. Assign transporters, track workflow, and manage all customer orders.",
    steps: [
      { title: "View Orders by Tab", detail: "Use the Open / Assigned / Delivered tabs to filter orders by stage. Each tab shows its count." },
      { title: "Change the ETA Range", detail: "The order list defaults to All Dates by ETA. Use the 'All Dates / Next 5 Weeks / 3 Months / 6 Months' dropdown in the filter bar to narrow the window when you need a shorter planning view." },
      { title: "Search Across All Dates", detail: "Typing in the search box ignores the ETA Range filter, so you can always find an order by reference or customer name." },
      { title: "Assign a Transporter", detail: "Drag an order card from the left panel and drop it onto a transporter card on the right to assign. The system checks pallet capacity automatically." },
      { title: "Open Job Details", detail: "Click 'Details' on any order card to view full details, edit fields, change status, set truck size, and manage the dispatch workflow." },
      { title: "Dispatch Workflow", detail: "Each order has 3 workflow checkboxes: Transporter Booked (TB), Order Picked (OP), and COA Available (COA). All three must be checked before dispatching." },
      { title: "Use Stat Cards", detail: "Click the stat cards at the top to filter: Orders Picked, Outstanding COA, Delivery, and Collection each filter the list when clicked." },
      { title: "Add a Job", detail: "Click '+ Add Job' to manually create a new order with reference, customer, warehouse, and priority." },
    ],
    tips: [
      "The green checkmark button on a card dispatches the order (marks as en-route).",
      "High Volume Date alerts warn you when 5+ distinct pending orders are due on the same day (counted by order reference, not by line). Click a badge to drill into the list — multi-line orders appear as a single row with a 'lines' badge, and pallet totals are summed across lines.",
      "Use the warehouse selector to focus on a specific warehouse.",
    ],
  },
  {
    id: "africa-exports",
    icon: Globe2,
    title: "Africa Exports",
    description: "Independent workspace for shipments from South Africa into Africa, with Africa clients, export transporters, document packs, and destination checks kept separate from local order management.",
    steps: [
      { title: "Import or Create Exports", detail: "Use Import Africa Orders for CSV/XLSX uploads or New Export for one shipment. These exports do not appear in local customer orders." },
      { title: "Complete Shipment Setup", detail: "Capture the Africa client, destination country, HS code, product type, Incoterm, transport mode, ETA, pallet count, preference scheme, and destination agent." },
      { title: "Plan Lead Times", detail: "Use the country lead-time guide for air, road, and sea movements. Zambia road exports show a 5-9 day guide, with customs buffer days used to calculate ETD and ETA planning dates." },
      { title: "Assign Export Transporters", detail: "Use the Africa export transporter list on the right. These transporters are separate from local dispatch transporters." },
      { title: "Capture Product Lines", detail: "Add product lines with product name, HS code, quantity, pallets, batch, and notes. This supports batch traceability, COA checks, best-before details, and multi-product export packs." },
      { title: "Tick the Document Pack", detail: "The Document Pack tab tracks core export documents, origin documents, food ingredient documents, permits, destination customs items, and country-specific required documents per shipment." },
      { title: "Use Zambia Road Rules", detail: "For Zambia, the checklist includes Commercial Invoice, Packing List, SAD 500, transport document, road manifest, SADC Certificate of Origin, COAs, TDS, SDS, allergen, GMO/Non-GMO, food grade, TPIN, ZCSA, labelling, HS confirmation, and final clearance checks." },
      { title: "Run Destination Checks", detail: "Use Destination Checks before dispatch. Botswana, Egypt, Cameroon, Uganda, and Zambia show country guidance when selected, including permits, standards, original documents, and clearing-agent confirmations." },
      { title: "Approve Dispatch", detail: "Only approve dispatch once required documents are complete and the destination agent has confirmed permits, health or standards controls, originals, duties/VAT responsibility, and final clearance ownership." },
      { title: "Review in Reports", detail: "Africa exports appear in Dashboard, Order Reports, Analytics, and Global Search using the shared database-backed export records." },
    ],
    tips: [
      "Use the HS Code lookup button beside the HS Code field when tariff classification needs checking.",
      "For Zambia DAP Lusaka loads, do not dispatch until Matvin, the buyer, or the Zambia clearing agent confirms import clearance, permits, duties, VAT, taxes, food or health clearance, TPIN, ZCSA, and labelling requirements.",
      "For Calcium Propionate, include SDS, COA, food grade declaration, and HS confirmation. For ifaBake Z and ifaBake Bun & Roll, check SADC origin support, allergen, soya/GMO, wheat/gluten, and food-grade declarations.",
      "Existing browser-saved Africa exports and default country rules are uploaded or backfilled to the database automatically when the Africa Exports page loads.",
    ],
  },
  {
    id: "ibt",
    icon: ArrowRightLeft,
    title: "Import IBT",
    description: "Import Internal Branch Transfers from Excel or CSV. Works the same as customer order import but with IBT-specific field mapping.",
    steps: [
      { title: "Upload File", detail: "Upload your IBT spreadsheet. The system maps From Branch, To Branch, Transfer Date, and other fields automatically." },
      { title: "Review & Import", detail: "Preview the data, then click Import. IBT jobs are kept separate from customer orders in the system." },
      { title: "Add Pallets After Import", detail: "The IBT template no longer includes a Pallets column. After importing, open the job details card on the IBT Management page and enter the pallet count there." },
      { title: "Clear All IBTs", detail: "Use the 'Clear All IBTs' button in the header to wipe every IBT job before uploading a fresh batch. Customer orders are not affected. The action requires a confirmation prompt." },
    ],
  },
  {
    id: "ibt-dispatch",
    icon: Truck,
    title: "IBT Management",
    description: "Manage and dispatch Internal Branch Transfers. Same drag-and-drop interface as Order Management but dedicated to IBT jobs.",
    steps: [
      { title: "Assign Transporters", detail: "Drag IBT jobs to transporters to assign them, just like customer orders." },
      { title: "Track Status", detail: "Use the Open / Assigned / Delivered tabs to monitor IBT progress." },
      { title: "High Volume Dates", detail: "When 5+ distinct IBTs are due on the same day (counted by reference, not by line), a High Volume badge appears. Click any badge to drill into the list — multi-line IBTs appear as a single row with a 'lines' badge and pallet totals are summed across lines." },
    ],
  },
  {
    id: "flowbin-tracking",
    icon: Package,
    title: "Flowbin Tracking",
    description: "Track flowbins dispatched to customer sites and manage their return. Monitor outstanding quantities, receive returns with partial quantity support, and keep notes on condition.",
    steps: [
      { title: "Enable Flowbin on a Job", detail: "Open any job's details modal and toggle the Flowbin switch on. Then add batches with a batch number and quantity for each flowbin shipment." },
      { title: "View Tracking Dashboard", detail: "Go to Flowbin Tracking in the sidebar. The KPI cards show Total, On Time, Warning (2+ weeks), Overdue (4+ weeks), and Returned counts." },
      { title: "Monitor Outstanding", detail: "The table shows Sent and Outstanding columns per job. Outstanding (in red) = total sent minus total returned. Green 0 means all flowbins are back." },
      { title: "Receive a Return", detail: "Expand a job's batches and click 'Receive Return'. A modal lets you enter: quantity returned (defaults to full qty), return date, and optional notes for damage or losses." },
      { title: "Partial Returns", detail: "If fewer flowbins come back than were sent, enter the lower quantity. The system records the shortage and shows it as outstanding." },
      { title: "Undo a Return", detail: "If a return was logged incorrectly, click 'Undo' on the batch to clear the return data and mark it as pending again." },
    ],
    tips: [
      "Status is calculated from the ETA date: On Time (0-13 days), Warning (14-27 days), Overdue (28+ days).",
      "A job is marked 'Returned' only when ALL its batches have been returned.",
      "Use the search bar and status filter to find specific jobs quickly.",
      "Return notes are visible in the expanded batch view — use them to document damage or missing units.",
    ],
  },
  {
    id: "calendar",
    icon: Calendar,
    title: "Scheduling",
    description: "Monthly calendar view showing all jobs grouped by their scheduled delivery date.",
    steps: [
      { title: "Browse Months", detail: "Use the arrow buttons to navigate between months." },
      { title: "View Day Details", detail: "Click the day number, the count badge, or the '+N more' link to open a full list of every order due that day. The number badge counts distinct orders, not lines — multi-line orders show as one entry with a '×N' suffix on the calendar tile and a 'lines' badge in the day-detail modal. Hover the badge to see line count. Press Esc or click outside to close." },
      { title: "Open Job Details", detail: "Click any job in the day list to open its full details modal." },
    ],
  },
  {
    id: "grid",
    icon: Grid3x3,
    title: "Order Reports",
    description: "Generate detailed reports with filters for status, priority, warehouse, transporter, and date range.",
    steps: [
      { title: "Select Report Type", detail: "Choose from Job Summary, Driver Performance, Customer Analysis, Exception Report, Delivery Performance, Warehouse Utilization, Overdue Analysis, or Africa Export Report." },
      { title: "Apply Filters", detail: "Use the filter controls to narrow results by date range, status, priority, warehouse, or transporter." },
      { title: "Export", detail: "Click 'Export to Excel' to download the filtered report as a spreadsheet." },
    ],
  },
  {
    id: "invoicing",
    icon: FileText,
    title: "Invoicing Reconciliation",
    description: "Operational workspace for checking invoice document timing, late-invoice reasons, creator activity, and exportable reconciliation reports.",
    steps: [
      { title: "Load the Ledger View", detail: "Use the period, creator, status, and search controls to focus on the invoice documents you need to review." },
      { title: "Review Timing", detail: "Use the timing cards and late invoice views to identify invoices that were created late or still need a reason captured." },
      { title: "Apply Reasons", detail: "Update late invoice reasons individually or in bulk, then save changes so the review trail stays consistent." },
      { title: "Navigate Exceptions", detail: "Use linked exception actions to move back into related dispatch work where an invoice issue depends on order data." },
      { title: "Export Reports", detail: "Export the current reconciliation, exception list, or late-invoice reason report for finance and operations follow-up." },
    ],
    tips: [
      "Keep filters narrow when doing month-end checks so exported reports match the working period.",
      "Use saved reasons consistently; they make repeated delay patterns easier to spot.",
    ],
  },
  {
    id: "analytics",
    icon: BarChart3,
    title: "Analytics",
    description: "Advanced visualization dashboard with charts showing performance trends, driver utilization, and delivery metrics.",
    steps: [
      { title: "Set Time Range", detail: "Choose 7 days, 30 days, 90 days, or All to adjust the chart period." },
      { title: "Filter by Warehouse", detail: "Select a warehouse to see its specific performance data." },
      { title: "Read the Charts", detail: "Bar charts show transporter performance, line charts show job trends, and Africa export charts show destination volume, status load, and document or agent check gaps." },
    ],
  },
  {
    id: "inbox",
    icon: Mail,
    title: "Messages",
    description: "Internal messaging system for team communication. Send messages to specific users or broadcast to everyone, with optional order linking.",
    steps: [
      { title: "View Inbox", detail: "The Messages page shows your inbox by default. Unread messages have a blue dot and bold text. Click any message to read it." },
      { title: "Switch to Sent", detail: "Click the 'Sent' tab to see messages you've sent and who has read them." },
      { title: "Compose a Message", detail: "Click 'New Message' to open the compose form. Select recipients individually or use 'Broadcast to All' to message everyone." },
      { title: "Link to an Order", detail: "Optionally enter an order reference (e.g. ASO0024525) to link the message to a specific job for context." },
      { title: "Set Priority", detail: "Mark a message as 'Urgent' to flag it with a red indicator in the recipient's inbox." },
      { title: "Reply to Messages", detail: "Click 'Reply' on any message to compose a response — the subject and recipient are pre-filled." },
    ],
    tips: [
      "Unread message count shows as a badge on the Messages item in the sidebar.",
      "Messages poll for updates every 15 seconds — no need to refresh.",
      "Use Broadcast for shift handover notes or important announcements.",
    ],
  },
  {
    id: "clock",
    icon: Clock,
    title: "Order History",
    description: "View all completed and cancelled orders. Filter by week number, search, and export professional PDF or Excel reports.",
    steps: [
      { title: "Filter by Week", detail: "Select a week number from the dropdown to view only that week's completed jobs. A banner card shows which week you're viewing." },
      { title: "Use Filters", detail: "Filter by status, transporter, warehouse, or use the search bar to find specific orders." },
      { title: "Read the Stats", detail: "The KPI cards show Total Jobs, Delivered, Cancelled, Success Rate, Total Pallets, Qty Picked, and Avg Delivery Time — all filtered to your selection." },
      { title: "Export PDF", detail: "Click 'Export PDF' for a professional report with KPI summary cards and full data table. Includes truck size, week number, and line items." },
      { title: "Export Excel", detail: "Click 'Export Excel' for a spreadsheet with all columns including Line Items, Transport Type, and Week Number." },
    ],
    tips: [
      "The PDF includes a dark header, KPI cards, and a formatted table — ready for management reporting.",
      "When filtered by week, the PDF filename includes the week number.",
    ],
  },
  {
    id: "ibt-reports",
    icon: ArrowRightLeft,
    title: "IBT Reports",
    description: "Specialized reporting for Internal Branch Transfers with route analysis and branch utilization metrics.",
    steps: [
      { title: "Select Report Type", detail: "Choose IBT Summary, Transfer Routes, Branch Utilization, Transporter Performance, or Exception Report." },
      { title: "Apply Filters & Export", detail: "Filter by status, branch, or transporter, then export to Excel." },
    ],
  },
  {
    id: "user-management",
    icon: Users,
    title: "User Management (Admin)",
    description: "Manage user accounts — create, edit, and delete users. Assign roles to control access.",
    steps: [
      { title: "Add User", detail: "Click 'Add User' and fill in username, email, password (min 12 characters), and role (User, Dispatcher, Manager, Admin)." },
      { title: "Edit User", detail: "Click the edit button on any user row to update their details or reset their password." },
      { title: "Delete User", detail: "Click delete to remove a user. You cannot delete your own account." },
    ],
    tips: [
      "Only admin users can access this page.",
      "Passwords are securely hashed — they cannot be viewed after creation.",
      "Password resets are admin-only: if a user is locked out, an admin opens Edit User here and sets a new password. There is no self-serve 'Forgot Password' flow.",
    ],
  },
  {
    id: "settings",
    icon: Settings,
    title: "Settings",
    description: "Manage your profile, privacy actions, and application preferences.",
    steps: [
      { title: "Open Profile Settings", detail: "Use Settings from the bottom of the sidebar to view account details and profile-related actions." },
      { title: "Export Personal Data", detail: "Use the data export action to download a copy of your personal information for POPIA access requests." },
      { title: "Use Privacy Links", detail: "Review privacy information from the login page or Settings when you need to confirm how personal data is handled." },
      { title: "Admin User Controls", detail: "Admins should use User Management for account creation, password resets, role changes, and data erasure workflows." },
    ],
    tips: [
      "Theme preference is controlled from the sidebar sun/moon button, not inside Settings.",
      "The connection indicator shows whether the app is currently using the server or local cached data.",
    ],
  },
  {
    id: "general",
    icon: Settings,
    title: "General Tips",
    description: "Features available across the entire application.",
    steps: [
      { title: "Dark Mode", detail: "Click the sun/moon icon in the sidebar to toggle between light and dark themes. Your preference is saved." },
      { title: "Sidebar Search", detail: "Use the search bar at the top of the sidebar to quickly find any menu item." },
      { title: "Quick Stats", detail: "The sidebar shows live stats: Total Jobs, In Transit, and Exceptions — always visible." },
      { title: "Notifications", detail: "Toast notifications appear in the top-right corner for success, error, and warning messages. They include sound alerts." },
      { title: "Connection Status", detail: "The indicator in the bottom-right shows if you're connected to the server. If offline, data is served from local cache." },
      { title: "Collapse Sidebar", detail: "Click the arrow button in the sidebar header to collapse it for more screen space." },
      { title: "Workspace Tabs", detail: "Pages open as tabs across the top of the workspace. Click a tab to switch back to it, or close tabs you no longer need. Dashboard stays available as the fallback tab." },
      { title: "Privacy & Data Export", detail: "Go to Settings > Profile to download a copy of all your personal data (POPIA s23). A Privacy Notice is linked on the login page." },
      { title: "Data Erasure", detail: "Admins can erase a user's personal information via User Management. PII is removed but audit records are preserved (POPIA s25)." },
    ],
  },
];

export const HelpGuide: React.FC<HelpGuideProps> = ({ open, onClose, onNavigateTo }) => {
  const [selectedSection, setSelectedSection] = useState<string | null>(null);

  if (!open) return null;

  const activeSection = guideSections.find((s) => s.id === selectedSection);

  return (
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Help Guide"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex overflow-hidden"
        style={{ background: "#ffffff" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Section List */}
        <div className="w-72 flex-shrink-0 border-r border-gray-200 flex flex-col" style={{ background: "#f8fafc" }}>
          <div className="p-5 border-b border-gray-200">
            <h2 className="text-lg font-bold" style={{ color: "#0f172a" }}>Help Guide</h2>
            <p className="text-xs mt-1" style={{ color: "#64748b" }}>Click a section to learn more</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {guideSections.map((section) => {
              const Icon = section.icon;
              const isActive = selectedSection === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => setSelectedSection(section.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all mb-0.5 ${
                    isActive
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-resilinc-primary" : "text-gray-400"}`} />
                  <span className={`text-[13px] ${isActive ? "font-semibold" : "font-medium"}`}>{section.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-gray-200">
            <div>
              {activeSection ? (
                <>
                  <h3 className="text-xl font-bold" style={{ color: "#0f172a" }}>{activeSection.title}</h3>
                  <p className="text-sm mt-1" style={{ color: "#64748b" }}>{activeSection.description}</p>
                </>
              ) : (
                <>
                  <h3 className="text-xl font-bold" style={{ color: "#0f172a" }}>Welcome to PTA Dispatch</h3>
                  <p className="text-sm mt-1" style={{ color: "#64748b" }}>Select a section from the left to get started</p>
                </>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5">
            {!activeSection ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center mx-auto mb-4">
                  <Search className="w-8 h-8 text-resilinc-primary" />
                </div>
                <h4 className="text-lg font-semibold" style={{ color: "#0f172a" }}>Explore the Guide</h4>
                <p className="text-sm mt-2 max-w-md mx-auto" style={{ color: "#64748b" }}>
                  Choose a page from the left panel to see step-by-step instructions, key features, and helpful tips.
                </p>
                <div className="grid grid-cols-3 gap-3 mt-8 max-w-lg mx-auto">
                  {guideSections.slice(0, 6).map((s) => {
                    const Icon = s.icon;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSelectedSection(s.id)}
                        className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:border-resilinc-primary hover:bg-green-50 transition-all"
                      >
                        <Icon className="w-5 h-5 text-gray-500" />
                        <span className="text-xs font-medium" style={{ color: "#334155" }}>{s.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Steps */}
                {activeSection.steps.map((step, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold mt-0.5">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h5 className="text-sm font-semibold" style={{ color: "#0f172a" }}>{step.title}</h5>
                      <p className="text-sm mt-1 leading-relaxed" style={{ color: "#475569" }}>{step.detail}</p>
                    </div>
                  </div>
                ))}

                {/* Tips */}
                {activeSection.tips && activeSection.tips.length > 0 && (
                  <div className="mt-6 p-4 rounded-xl border border-blue-200" style={{ background: "#eff6ff" }}>
                    <h5 className="text-sm font-semibold mb-2" style={{ color: "#1e40af" }}>Tips</h5>
                    <ul className="space-y-1.5">
                      {activeSection.tips.map((tip, i) => (
                        <li key={i} className="text-sm flex items-start gap-2" style={{ color: "#1e40af" }}>
                          <span className="mt-1.5 w-1 h-1 rounded-full bg-blue-400 flex-shrink-0" />
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Go to page button */}
                {activeSection.id !== "general" && onNavigateTo && (
                  <button
                    onClick={() => {
                      onNavigateTo(activeSection.id);
                      onClose();
                    }}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-resilinc-primary text-white text-sm font-medium rounded-lg hover:bg-resilinc-primary-dark transition-colors"
                  >
                    Go to {activeSection.title}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
