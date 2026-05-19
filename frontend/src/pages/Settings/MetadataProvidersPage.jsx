import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useToast } from "../../contexts/ToastContext";
import { useAuth } from "../../contexts/AuthContext";
import { useSettingsData } from "./hooks/useSettingsData";
import { useUnsavedGuard } from "./hooks/useUnsavedGuard";
import { UnsavedModal } from "./components/UnsavedModal";
import { SettingsMetadataTab } from "./components/SettingsMetadataTab";

function MetadataProvidersPage() {
  const { showSuccess, showError, showInfo } = useToast();
  const { user: authUser } = useAuth();
  const data = useSettingsData(showSuccess, showError, showInfo);
  const guard = useUnsavedGuard(
    data.hasUnsavedChanges,
    data.setHasUnsavedChanges,
  );

  useEffect(() => {
    data.refreshHealth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (authUser?.role !== "admin") {
    return <Navigate to="/settings" replace />;
  }

  return (
    <>
      <UnsavedModal
        show={guard.showUnsavedModal}
        onCancel={guard.handleCancelLeave}
        onConfirm={guard.handleConfirmLeave}
      />

      <div className="animate-fade-in max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#fff" }}>
            Metadata Providers
          </h1>
          <p style={{ color: "#c1c1c3" }}>
            Configure the BrainzMash-native metadata backend used for local
            testing.
          </p>
        </div>

        <SettingsMetadataTab
          settings={data.settings}
          updateSettings={data.updateSettings}
          health={data.health}
          hasUnsavedChanges={data.hasUnsavedChanges}
          saving={data.saving}
          handleSaveSettings={data.handleSaveSettings}
        />
      </div>
    </>
  );
}

export default MetadataProvidersPage;
