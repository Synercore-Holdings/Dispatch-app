import React, { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react";

// ---------- Types ----------
export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  createdAt: number;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  type?: "danger" | "warning" | "info";
  confirmText?: string;
  cancelText?: string;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface NotificationContextType {
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  showWarning: (message: string) => void;
  showInfo: (message: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

// ---------- Sound System (Web Audio API) ----------
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playTone(
  frequencies: number[],
  durations: number[],
  waveType: OscillatorType = "sine",
  gain: number = 0.1
) {
  const ctx = getAudioContext();
  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(gain, ctx.currentTime);
  gainNode.connect(ctx.destination);

  let offset = 0;
  frequencies.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = waveType;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + offset);
    osc.connect(gainNode);
    osc.start(ctx.currentTime + offset);
    osc.stop(ctx.currentTime + offset + durations[i]);
    offset += durations[i];
  });

  // Fade out at the end to avoid clicks
  gainNode.gain.setValueAtTime(gain, ctx.currentTime + offset - 0.02);
  gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + offset);
}

const notificationSounds: Record<NotificationType, () => void> = {
  success: () => playTone([523.25, 659.25, 783.99], [0.12, 0.12, 0.16], "sine", 0.1),    // C5→E5→G5
  error: () => playTone([220, 196], [0.2, 0.3], "triangle", 0.12),                         // A3→G3
  warning: () => playTone([329.63, 349.23, 329.63], [0.12, 0.12, 0.12], "square", 0.07),  // E4→F4→E4
  info: () => playTone([440, 523.25], [0.15, 0.2], "sine", 0.08),                          // A4→C5
};

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const useNotification = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotification must be used within NotificationProvider");
  return ctx;
};

// ---------- Toast Component ----------
const TOAST_DURATION = 5000;

const typeStyles: Record<NotificationType, { bg: string; accent: string; icon: ReactNode }> = {
  success: {
    bg: "bg-white",
    accent: "bg-green-500",
    icon: (
      <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    ),
  },
  error: {
    bg: "bg-white",
    accent: "bg-red-500",
    icon: (
      <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
  },
  warning: {
    bg: "bg-white",
    accent: "bg-yellow-500",
    icon: (
      <svg className="w-5 h-5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86l-8.3 14.58A1 1 0 003 20h18a1 1 0 00.87-1.5l-8.3-14.58a1 1 0 00-1.74 0z" />
      </svg>
    ),
  },
  info: {
    bg: "bg-white",
    accent: "bg-blue-500",
    icon: (
      <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <circle cx="12" cy="12" r="10" />
        <path strokeLinecap="round" d="M12 16v-4m0-4h.01" />
      </svg>
    ),
  },
};

const Toast: React.FC<{ notification: Notification; onClose: (id: string) => void }> = ({ notification, onClose }) => {
  const { type, message, id } = notification;
  const style = typeStyles[type];
  const [exiting, setExiting] = React.useState(false);

  const handleClose = useCallback(() => {
    setExiting(true);
    setTimeout(() => onClose(id), 200);
  }, [id, onClose]);

  React.useEffect(() => {
    const timer = setTimeout(handleClose, TOAST_DURATION);
    return () => clearTimeout(timer);
  }, [handleClose]);

  return (
    <div
      className={`${style.bg} rounded-lg shadow-lg border border-gray-200 overflow-hidden flex items-stretch w-[calc(100vw-2rem)] sm:w-auto sm:min-w-[320px] max-w-[420px] transition-all duration-200 ${
        exiting ? "opacity-0 translate-x-8" : "opacity-100 translate-x-0"
      }`}
      style={{ animation: exiting ? undefined : "slideInRight 0.3s ease-out" }}
    >
      {/* Accent bar */}
      <div className={`${style.accent} w-1 flex-shrink-0`} />

      {/* Content */}
      <div className="flex items-start gap-3 px-4 py-3 flex-1 min-w-0">
        <div className="flex-shrink-0 mt-0.5">{style.icon}</div>
        <p className="text-sm text-gray-800 flex-1 break-words">{message}</p>
        <button
          onClick={handleClose}
          className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors mt-0.5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-100">
        <div
          className={`h-full ${style.accent}`}
          style={{ animation: `shrinkWidth ${TOAST_DURATION}ms linear forwards` }}
        />
      </div>
    </div>
  );
};

// ---------- Confirm Modal ----------
const confirmTypeStyles = {
  danger: { button: "bg-red-600 hover:bg-red-700 text-white", icon: "text-red-600" },
  warning: { button: "bg-yellow-500 hover:bg-yellow-600 text-white", icon: "text-yellow-600" },
  info: { button: "bg-resilinc-primary hover:bg-resilinc-primary-dark text-white", icon: "text-resilinc-primary" },
};

const ConfirmModal: React.FC<{ state: ConfirmState; onClose: () => void }> = ({ state, onClose }) => {
  const cType = state.type || "danger";
  const styles = confirmTypeStyles[cType];

  const handleConfirm = () => { state.resolve(true); onClose(); };
  const handleCancel = () => { state.resolve(false); onClose(); };

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={state.title} onClick={handleCancel} onKeyDown={(e) => { if (e.key === "Escape") handleCancel(); }}>
      <div
        className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "scaleIn 0.2s ease-out" }}
      >
        <div className="flex items-start gap-3">
          <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
            cType === "danger" ? "bg-red-100" : cType === "warning" ? "bg-yellow-100" : "bg-blue-100"
          }`}>
            <svg className={`w-5 h-5 ${styles.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {cType === "danger" ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86l-8.3 14.58A1 1 0 003 20h18a1 1 0 00.87-1.5l-8.3-14.58a1 1 0 00-1.74 0z" />
              ) : cType === "warning" ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86l-8.3 14.58A1 1 0 003 20h18a1 1 0 00.87-1.5l-8.3-14.58a1 1 0 00-1.74 0z" />
              ) : (
                <>
                  <circle cx="12" cy="12" r="10" />
                  <path strokeLinecap="round" d="M12 16v-4m0-4h.01" />
                </>
              )}
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{state.title}</h3>
            <p className="text-sm text-gray-600 mt-1 whitespace-pre-line">{state.message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            {state.cancelText || "Cancel"}
          </button>
          <button
            onClick={handleConfirm}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${styles.button}`}
          >
            {state.confirmText || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------- Provider ----------
export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const idRef = useRef(0);

  const addNotification = useCallback((type: NotificationType, message: string) => {
    const id = `notif-${++idRef.current}`;
    setNotifications((prev) => [...prev, { id, type, message, createdAt: Date.now() }]);
    try { if (localStorage.getItem("synercore_sound") !== "off") notificationSounds[type](); } catch { /* audio not available */ }
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const showSuccess = useCallback((msg: string) => addNotification("success", msg), [addNotification]);
  const showError = useCallback((msg: string) => addNotification("error", msg), [addNotification]);
  const showWarning = useCallback((msg: string) => addNotification("warning", msg), [addNotification]);
  const showInfo = useCallback((msg: string) => addNotification("info", msg), [addNotification]);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({ ...options, resolve });
    });
  }, []);

  return (
    <NotificationContext.Provider value={{ showSuccess, showError, showWarning, showInfo, confirm }}>
      {children}

      {/* Toast stack */}
      <div className="fixed top-4 right-4 z-[10000] flex flex-col gap-3 pointer-events-none">
        {notifications.map((n) => (
          <div key={n.id} className="pointer-events-auto">
            <Toast notification={n} onClose={removeNotification} />
          </div>
        ))}
      </div>

      {/* Confirm modal */}
      {confirmState && (
        <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
      )}

      {/* Animations */}
      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(100%); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes shrinkWidth {
          from { width: 100%; }
          to { width: 0%; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </NotificationContext.Provider>
  );
};
