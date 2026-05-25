import { useState } from "react";
import { ChevronRight, ChevronLeft, CheckCircle2 } from "lucide-react";
import {
  completeOnboarding,
  testLidarrOnboarding,
  testNavidromeOnboarding,
} from "../utils/api";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";

const inputClass =
  "block w-full px-3 py-2.5 rounded sm:text-sm focus:outline-none focus:ring-2 focus:ring-offset-0";
const inputStyle = {
  backgroundColor: "#2a2a30",
  color: "#fff",
  border: "1px solid #4a4a52",
};

const getApiErrorMessage = (error, fallback) =>
  error?.response?.data?.message ||
  error?.response?.data?.error ||
  error?.message ||
  fallback;

const STEPS = [
  "welcome",
  "admin",
  "lidarr",
  "navidrome",
  "lastfm",
  "done",
];

function Onboarding() {
  const [step, setStep] = useState(0);
  const [authUser, setAuthUser] = useState("admin");
  const [authPassword, setAuthPassword] = useState("");
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState("");
  const [lidarrUrl, setLidarrUrl] = useState("");
  const [lidarrApiKey, setLidarrApiKey] = useState("");
  const [navidromeUrl, setNavidromeUrl] = useState("");
  const [navidromeUsername, setNavidromeUsername] = useState("");
  const [navidromePassword, setNavidromePassword] = useState("");
  const [lastfmUsername, setLastfmUsername] = useState("");
  const [lastfmApiKey, setLastfmApiKey] = useState("");
  const [lidarrTestSuccess, setLidarrTestSuccess] = useState(false);
  const [testingLidarr, setTestingLidarr] = useState(false);
  const [navidromeTestSuccess, setNavidromeTestSuccess] = useState(false);
  const [testingNavidrome, setTestingNavidrome] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { refreshAuth } = useAuth();
  const { showSuccess } = useToast();

  const currentStep = STEPS[step];
  const hasNavidrome =
    navidromeUrl.trim() && navidromeUsername.trim() && navidromePassword;
  const hasLastfm =
    !!lastfmUsername.trim() && !!lastfmApiKey.trim();
  const passwordTooShort =
    authPassword.length > 0 && authPassword.length < 8;
  const adminComplete =
    authUser.trim() &&
    authPassword &&
    !passwordTooShort &&
    authPassword === authPasswordConfirm;
  const canNext =
    currentStep === "welcome" ||
    currentStep === "done" ||
    (currentStep === "admin" && adminComplete) ||
    (currentStep === "lidarr" && lidarrTestSuccess) ||
    (currentStep === "navidrome" && (!hasNavidrome || navidromeTestSuccess)) ||
    currentStep === "lastfm";
  const isPrimaryDisabled =
    currentStep === "done"
      ? submitting
      : currentStep === "lidarr"
        ? !lidarrTestSuccess &&
          (!lidarrUrl.trim() || !lidarrApiKey.trim() || testingLidarr)
        : currentStep === "navidrome"
          ? testingNavidrome
          : currentStep === "admin"
            ? !adminComplete
            : currentStep !== "welcome" && currentStep !== "lastfm" && !canNext;

  const handleNext = () => {
    setError("");
    if (currentStep === "done") return;
    if (step < STEPS.length - 1) setStep(step + 1);
  };

  const handleLidarrStepAction = async () => {
    if (lidarrTestSuccess) {
      handleNext();
      return;
    }
    await handleTestLidarr();
  };

  const handleNavidromeStepAction = async () => {
    if (!hasNavidrome) {
      handleNext();
      return;
    }
    if (navidromeTestSuccess) {
      handleNext();
      return;
    }
    await handleTestNavidrome();
  };

  const handleTestNavidrome = async () => {
    if (!hasNavidrome) return;
    setTestingNavidrome(true);
    setError("");
    try {
      await testNavidromeOnboarding(
        navidromeUrl.trim(),
        navidromeUsername.trim(),
        navidromePassword,
      );
      setNavidromeTestSuccess(true);
      showSuccess("Navidrome connection successful");
    } catch (e) {
      setError(getApiErrorMessage(e, "Connection failed"));
    } finally {
      setTestingNavidrome(false);
    }
  };

  const handleBack = () => {
    setError("");
    if (step > 0) setStep(step - 1);
  };

  const handleTestLidarr = async () => {
    if (!lidarrUrl.trim() || !lidarrApiKey.trim()) {
      setError("Enter Lidarr URL and API key first");
      return;
    }
    setTestingLidarr(true);
    setError("");
    try {
      await testLidarrOnboarding(lidarrUrl.trim(), lidarrApiKey.trim());
      setLidarrTestSuccess(true);
      showSuccess("Lidarr connection successful");
    } catch (e) {
      setError(getApiErrorMessage(e, "Connection failed"));
    } finally {
      setTestingLidarr(false);
    }
  };

  const handleFinish = async () => {
    setSubmitting(true);
    setError("");
    try {
      await completeOnboarding({
        authUser: authUser.trim() || "admin",
        authPassword: authPassword || undefined,
        lidarr:
          lidarrUrl.trim() && lidarrApiKey.trim()
            ? {
                url: lidarrUrl.trim().replace(/\/+$/, ""),
                apiKey: lidarrApiKey.trim(),
              }
            : undefined,
        navidrome:
          navidromeUrl.trim() && navidromeUsername.trim() && navidromePassword
            ? {
                url: navidromeUrl.trim().replace(/\/+$/, ""),
                username: navidromeUsername.trim(),
                password: navidromePassword,
              }
            : undefined,
        lastfm:
          lastfmUsername.trim() && lastfmApiKey.trim()
            ? {
                username: lastfmUsername.trim(),
                apiKey: lastfmApiKey.trim(),
              }
            : undefined,
      });
      await refreshAuth();
      showSuccess("Setup complete. Sign in with your admin account.");
    } catch (e) {
      setError(getApiErrorMessage(e, "Failed to save"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <form
        autoComplete="off"
        onSubmit={(e) => e.preventDefault()}
        className="max-w-lg w-full space-y-6 p-8 shadow-lg"
        style={{ backgroundColor: "#211f27" }}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex gap-1">
            {STEPS.slice(0, -1).map((s, i) => (
              <div
                key={s}
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: i <= step ? "#707e61" : "#3d3d44",
                }}
              />
            ))}
          </div>
          <span className="text-xs" style={{ color: "#c1c1c3" }}>
            {step + 1} / {STEPS.length}
          </span>
        </div>

        {currentStep === "welcome" && (
          <>
            <div className="text-center">
              <img
                src="/arralogo.svg"
                alt="Aurral Logo"
                className="mx-auto w-14 h-14 mb-4 transition-transform"
                style={{
                  filter:
                    "brightness(0) saturate(100%) invert(45%) sepia(8%) saturate(800%) hue-rotate(60deg) brightness(95%) contrast(85%)",
                }}
              />
              <h2 className="text-2xl font-bold mb-2" style={{ color: "#fff" }}>
                Welcome to Aurral
              </h2>
              <p className="text-sm" style={{ color: "#c1c1c3" }}>
                Set up your admin account and connect Lidarr. Navidrome and
                Last.fm are optional but recommended.
              </p>
            </div>
          </>
        )}

        {currentStep === "admin" && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-xl font-bold" style={{ color: "#fff" }}>
                Admin account
              </h2>
            </div>
            <p className="text-sm mb-4" style={{ color: "#c1c1c3" }}>
              Create a local account to sign in to Aurral.
            </p>
            <div className="space-y-3">
              <input
                type="text"
                autoComplete="off"
                className={inputClass}
                style={inputStyle}
                placeholder="Username"
                value={authUser}
                onChange={(e) => setAuthUser(e.target.value)}
              />
              <input
                type="password"
                autoComplete="new-password"
                className={inputClass}
                style={inputStyle}
                placeholder="Password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
              />
              <input
                type="password"
                autoComplete="new-password"
                className={inputClass}
                style={inputStyle}
                placeholder="Confirm password"
                value={authPasswordConfirm}
                onChange={(e) => setAuthPasswordConfirm(e.target.value)}
              />
              <p className="text-xs" style={{ color: "#c1c1c3" }}>
                Password must be at least 8 characters long.
              </p>
            </div>
          </>
        )}

        {currentStep === "lidarr" && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-xl font-bold" style={{ color: "#fff" }}>
                Connect Lidarr
              </h2>
            </div>
            <p className="text-sm mb-4" style={{ color: "#c1c1c3" }}>
              Aurral uses Lidarr to manage your music library and downloads.
            </p>
            <div className="space-y-3">
              <input
                type="url"
                autoComplete="off"
                className={inputClass}
                style={inputStyle}
                placeholder="Lidarr URL (e.g. http://localhost:8686)"
                value={lidarrUrl}
                onChange={(e) => {
                  setLidarrUrl(e.target.value);
                  setLidarrTestSuccess(false);
                }}
              />
              <input
                type="password"
                autoComplete="off"
                className={inputClass}
                style={inputStyle}
                placeholder="API key"
                value={lidarrApiKey}
                onChange={(e) => {
                  setLidarrApiKey(e.target.value);
                  setLidarrTestSuccess(false);
                }}
              />
            </div>
          </>
        )}

        {currentStep === "navidrome" && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-xl font-bold" style={{ color: "#fff" }}>
                Navidrome (optional)
              </h2>
            </div>
            <p className="text-sm mb-4" style={{ color: "#c1c1c3" }}>
              Recommended for streaming and playlists. Leave blank to skip and
              add later in settings.
            </p>
            <div className="space-y-3">
              <input
                type="url"
                autoComplete="off"
                className={inputClass}
                style={inputStyle}
                placeholder="Navidrome URL"
                value={navidromeUrl}
                onChange={(e) => {
                  setNavidromeUrl(e.target.value);
                  setNavidromeTestSuccess(false);
                }}
              />
              <input
                type="text"
                autoComplete="off"
                className={inputClass}
                style={inputStyle}
                placeholder="Username"
                value={navidromeUsername}
                onChange={(e) => {
                  setNavidromeUsername(e.target.value);
                  setNavidromeTestSuccess(false);
                }}
              />
              <input
                type="password"
                autoComplete="off"
                className={inputClass}
                style={inputStyle}
                placeholder="Password"
                value={navidromePassword}
                onChange={(e) => {
                  setNavidromePassword(e.target.value);
                  setNavidromeTestSuccess(false);
                }}
              />
            </div>
          </>
        )}

        {currentStep === "lastfm" && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-xl font-bold" style={{ color: "#fff" }}>
                Last.fm (optional)
              </h2>
            </div>
            <p className="text-sm mb-4" style={{ color: "#c1c1c3" }}>
              Recommended for personalized discovery, related artists, full tag
              search, and flows. If you skip it, Discover will use ListenBrainz
              trending artists and default genre shelves.
            </p>
            <div className="space-y-3">
              <input
                type="text"
                autoComplete="off"
                className={inputClass}
                style={inputStyle}
                placeholder="Last.fm username"
                value={lastfmUsername}
                onChange={(e) => setLastfmUsername(e.target.value)}
              />
              <input
                type="password"
                autoComplete="off"
                className={inputClass}
                style={inputStyle}
                placeholder="Last.fm API key"
                value={lastfmApiKey}
                onChange={(e) => setLastfmApiKey(e.target.value)}
              />
            </div>
          </>
        )}

        {currentStep === "done" && (
          <div className="text-center py-4">
            <CheckCircle2
              className="mx-auto h-12 w-12 mb-4"
              style={{ color: "#707e61" }}
            />
            <h2 className="text-xl font-bold mb-2" style={{ color: "#fff" }}>
              You&apos;re all set
            </h2>
            <p className="text-sm" style={{ color: "#c1c1c3" }}>
              Sign in with your admin account to start using Aurral.
            </p>
          </div>
        )}

        {error && (
          <p className="text-sm text-center" style={{ color: "#ff6b6b" }}>
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-4">
          {step > 0 && currentStep !== "done" && (
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center gap-1 py-2 px-4 text-sm border rounded transition-colors"
              style={{
                ...inputStyle,
                borderColor: "#3d3d44",
                color: "#c1c1c3",
              }}
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          )}
          <button
            type="button"
            onClick={
              currentStep === "done"
                ? handleFinish
                : currentStep === "lidarr"
                  ? handleLidarrStepAction
                  : currentStep === "navidrome"
                    ? handleNavidromeStepAction
                    : handleNext
            }
            disabled={isPrimaryDisabled}
            className="flex-1 flex items-center justify-center gap-1 py-2 px-4 text-sm font-medium rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              backgroundColor: isPrimaryDisabled ? "#3d3d44" : "#707e61",
              color: "#fff",
            }}
          >
            {currentStep === "done" ? (
              submitting ? (
                "Saving…"
              ) : (
                "Go to Aurral"
              )
            ) : currentStep === "lidarr" ? (
              lidarrTestSuccess ? (
                <>
                  Next
                  <ChevronRight className="w-4 h-4" />
                </>
              ) : testingLidarr ? (
                "Testing…"
              ) : (
                "Test"
              )
            ) : currentStep === "navidrome" ? (
              !hasNavidrome ? (
                "Skip"
              ) : navidromeTestSuccess ? (
                <>
                  Next
                  <ChevronRight className="w-4 h-4" />
                </>
              ) : testingNavidrome ? (
                "Testing…"
              ) : (
                "Test"
              )
            ) : currentStep === "lastfm" ? (
              hasLastfm ? (
                <>
                  Next
                  <ChevronRight className="w-4 h-4" />
                </>
              ) : (
                "Skip"
              )
            ) : currentStep === "welcome" ? (
              "Get started"
            ) : (
              <>
                Next
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export default Onboarding;
