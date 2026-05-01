import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getMyListeningHistory } from "../utils/api";
import { useAuth } from "../contexts/AuthContext";

const LEGACY_DISMISS_KEY = "lastfm_banner_dismissed";
const DISMISS_KEY_PREFIX = "aurral:lastfm-banner-dismissed";

const getDismissKey = (user) => {
  if (user?.id != null) return `${DISMISS_KEY_PREFIX}:${user.id}`;
  if (user?.username) return `${DISMISS_KEY_PREFIX}:${user.username}`;
  return DISMISS_KEY_PREFIX;
};

const readDismissed = (user) => {
  try {
    const dismissKey = getDismissKey(user);
    if (localStorage.getItem(dismissKey) === "1") {
      return true;
    }

    if (sessionStorage.getItem(LEGACY_DISMISS_KEY) === "1") {
      localStorage.setItem(dismissKey, "1");
      sessionStorage.removeItem(LEGACY_DISMISS_KEY);
      return true;
    }
  } catch {}

  return false;
};

const LastfmBanner = () => {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(() => readDismissed(user));
  const [listenHistoryUsername, setListenHistoryUsername] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    setDismissed(readDismissed(user));
  }, [user]);

  useEffect(() => {
    if (dismissed) return;
    getMyListeningHistory()
      .then((d) => setListenHistoryUsername(d.listenHistoryUsername || ""))
      .catch(() => {});
  }, [dismissed]);

  if (
    dismissed ||
    listenHistoryUsername === null ||
    listenHistoryUsername !== ""
  ) {
    return null;
  }

  return (
    <div className="mb-6 bg-[#211f27] px-5 py-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-sm uppercase tracking-wide">
            Personalize your discovery
          </p>
          <p className="text-xs text-[#c1c1c3]">
            Connect your Last.fm or ListenBrainz account for personalized
            results based on your own listening history.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button
            type="button"
            className="btn btn-secondary bg-gray-700/50 hover:bg-gray-700/70 btn-sm w-full sm:w-auto"
            onClick={() => navigate("/settings")}
          >
            Connect History
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm hover:bg-gray-700/50 w-full sm:w-auto"
            onClick={() => {
              setDismissed(true);
              try {
                localStorage.setItem(getDismissKey(user), "1");
                sessionStorage.removeItem(LEGACY_DISMISS_KEY);
              } catch {}
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

export default LastfmBanner;
