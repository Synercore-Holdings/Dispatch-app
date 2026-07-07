import React, { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { AlertCircle, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Card } from "../ui/Card";
import { DeliveryIllustration } from "../ui/DeliveryIllustration";
import synercoreLogo from "../../assets/synercore-logo.png";

interface LoginProps {
  onPrivacy?: () => void;
}

const SYNERCORE_GREEN = "#52A547";
const SYNERCORE_GREEN_DARK = "#3F8A37";

export const Login: React.FC<LoginProps> = ({ onPrivacy }) => {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password.trim()) {
      setError("Please enter both username and password");
      return;
    }

    setIsLoading(true);

    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen grid md:grid-cols-2"
      style={{
        background:
          "linear-gradient(135deg, #eaf5e6 0%, #ffffff 50%, #f3faf1 100%)",
      }}
    >
      <style>{`
        @keyframes synercoreFadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .synercore-login-card { animation: synercoreFadeIn 0.45s ease-out both; }
        .synercore-input:focus {
          outline: none;
          border-color: ${SYNERCORE_GREEN} !important;
          box-shadow: 0 0 0 3px rgba(82, 165, 71, 0.2);
        }
      `}</style>

      {/* Left panel — Illustration (hidden on mobile) */}
      <div
        className="hidden md:flex items-center justify-center p-8 relative overflow-hidden"
        aria-hidden="true"
      >
        <div className="w-full max-w-lg">
          <div className="mb-6">
            <img
              src={synercoreLogo}
              alt=""
              className="h-12 select-none"
              draggable={false}
            />
          </div>
          <DeliveryIllustration className="w-full h-auto" />
          <div className="mt-8 max-w-md">
            <h2 className="text-2xl font-semibold mb-2" style={{ color: "#1f2937" }}>
              Dispatch Management
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: "#6b7280" }}>
              Track orders, assign transporters, and manage every delivery from one place.
            </p>
          </div>
        </div>
      </div>

      {/* Right panel — Login form */}
      <div className="flex items-center justify-center p-4 md:p-8">
        <div className="w-full max-w-md">
          {/* Logo + heading (mobile-only; desktop uses left panel) */}
          <div className="md:hidden text-center mb-6 synercore-login-card">
            <img
              src={synercoreLogo}
              alt="Synercore — Leaders in Food Innovation"
              className="h-12 mx-auto mb-4 select-none"
              draggable={false}
            />
            <h1 className="text-xl font-semibold" style={{ color: "#1f2937" }}>
              Dispatch Management
            </h1>
          </div>

          <Card
            className="p-8 synercore-login-card"
            style={{
              background: "#ffffff",
              borderColor: "#e5e7eb",
              boxShadow:
                "0 10px 25px -5px rgba(15, 23, 42, 0.08), 0 4px 10px -4px rgba(15, 23, 42, 0.05)",
            }}
          >
            <div className="mb-6">
              <h1 className="text-xl font-semibold mb-1" style={{ color: "#1f2937" }}>
                Welcome back
              </h1>
              <p className="text-sm" style={{ color: "#6b7280" }}>
                Sign in to your account to continue
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              {/* Error Alert */}
              {error && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3"
                >
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="text-sm text-red-800">{error}</div>
                </div>
              )}

              {/* Username Field */}
              <div>
                <label
                  htmlFor="username"
                  className="block text-sm font-medium mb-2"
                  style={{ color: "#374151" }}
                >
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="synercore-input w-full px-4 py-3.5 rounded-lg transition-all text-base"
                  style={{
                    background: "#ffffff",
                    border: "1px solid #d1d5db",
                    color: "#0f172a",
                  }}
                  placeholder="Enter your username"
                  disabled={isLoading}
                  autoComplete="username"
                  aria-required="true"
                  aria-invalid={!!error}
                />
              </div>

              {/* Password Field */}
              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium mb-2"
                  style={{ color: "#374151" }}
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="synercore-input w-full px-4 py-3.5 pr-12 rounded-lg transition-all text-base"
                    style={{
                      background: "#ffffff",
                      border: "1px solid #d1d5db",
                      color: "#0f172a",
                    }}
                    placeholder="Enter your password"
                    disabled={isLoading}
                    autoComplete="current-password"
                    aria-required="true"
                    aria-invalid={!!error}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 transition-colors p-1 rounded hover:bg-gray-100"
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="w-5 h-5" aria-hidden="true" />
                    ) : (
                      <Eye className="w-5 h-5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              {/* Remember Me */}
              <div className="flex items-center">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 border-gray-300 rounded"
                    style={{ accentColor: SYNERCORE_GREEN }}
                  />
                  <span className="ml-2 text-sm" style={{ color: "#4b5563" }}>
                    Remember me
                  </span>
                </label>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 text-base font-medium rounded-lg text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{
                  background: isLoading ? SYNERCORE_GREEN_DARK : SYNERCORE_GREEN,
                }}
                onMouseEnter={(e) => {
                  if (!isLoading) e.currentTarget.style.background = SYNERCORE_GREEN_DARK;
                }}
                onMouseLeave={(e) => {
                  if (!isLoading) e.currentTarget.style.background = SYNERCORE_GREEN;
                }}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Signing in...
                  </span>
                ) : (
                  "Sign In"
                )}
              </button>
            </form>
          </Card>

          {/* Security reassurance */}
          <div className="mt-5 flex items-center justify-center gap-2 text-xs" style={{ color: "#6b7280" }}>
            <ShieldCheck className="w-3.5 h-3.5" style={{ color: SYNERCORE_GREEN }} aria-hidden="true" />
            <span>Your session is encrypted. Credentials are never shared.</span>
          </div>

          {/* Footer */}
          <div className="mt-4 text-center text-sm" style={{ color: "#4b5563" }}>
            <p>
              Need an account?{" "}
              <span className="font-medium" style={{ color: SYNERCORE_GREEN }}>
                Contact your administrator
              </span>
            </p>
            <p className="mt-1">
              Forgot password?{" "}
              <span className="font-medium" style={{ color: SYNERCORE_GREEN }}>
                Contact your administrator
              </span>
            </p>
            <button
              type="button"
              onClick={onPrivacy}
              className="mt-3 text-gray-400 hover:opacity-80 text-xs transition-colors"
              onMouseEnter={(e) => (e.currentTarget.style.color = SYNERCORE_GREEN)}
              onMouseLeave={(e) => (e.currentTarget.style.color = "")}
            >
              Privacy Notice
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
