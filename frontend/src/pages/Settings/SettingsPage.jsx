import { useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { useToast } from "../../contexts/ToastContext";
import { useAuth } from "../../contexts/AuthContext";
import { useSettingsData } from "./hooks/useSettingsData";
import { useUnsavedGuard } from "./hooks/useUnsavedGuard";
import { useSettingsTabs } from "./hooks/useSettingsTabs";
import { useSettingsUsers } from "./hooks/useSettingsUsers";
import { UnsavedModal } from "./components/UnsavedModal";
import { CommunityGuideModal } from "./components/CommunityGuideModal";
import { SettingsIntegrationsTab } from "./components/SettingsIntegrationsTab";
import { SettingsDiscoverTab } from "./components/SettingsDiscoverTab";
import { SettingsNotificationsTab } from "./components/SettingsNotificationsTab";
import { SettingsUsersTab } from "./components/SettingsUsersTab";
import { SettingsAccountTab } from "./components/SettingsAccountTab";
import { useAccountSettings } from "./hooks/useAccountSettings";

function SettingsPage() {
  const { showSuccess, showError, showInfo } = useToast();
  const { user: authUser } = useAuth();

  const data = useSettingsData(showSuccess, showError, showInfo);
  const account = useAccountSettings(authUser, showSuccess, showError);
  const guard = useUnsavedGuard(data.hasUnsavedChanges, data.setHasUnsavedChanges);
  const tabs = useSettingsTabs(authUser);
  const users = useSettingsUsers(
    authUser,
    showSuccess,
    showError,
    tabs.activeTab
  );

  useEffect(() => {
    if (tabs.activeTab === "discover") {
      data.refreshHealth();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only run when switching to discover tab
  }, [tabs.activeTab]);

  const renderTabContent = () => {
    switch (tabs.activeTab) {
      case "integrations":
        return (
          <SettingsIntegrationsTab
            settings={data.settings}
            updateSettings={data.updateSettings}
            health={data.health}
            lidarrProfiles={data.lidarrProfiles}
            loadingLidarrProfiles={data.loadingLidarrProfiles}
            setLoadingLidarrProfiles={data.setLoadingLidarrProfiles}
            setLidarrProfiles={data.setLidarrProfiles}
            lidarrMetadataProfiles={data.lidarrMetadataProfiles}
            loadingLidarrMetadataProfiles={data.loadingLidarrMetadataProfiles}
            setLoadingLidarrMetadataProfiles={
              data.setLoadingLidarrMetadataProfiles
            }
            setLidarrMetadataProfiles={data.setLidarrMetadataProfiles}
            lidarrTags={data.lidarrTags}
            loadingLidarrTags={data.loadingLidarrTags}
            setLoadingLidarrTags={data.setLoadingLidarrTags}
            setLidarrTags={data.setLidarrTags}
            testingLidarr={data.testingLidarr}
            setTestingLidarr={data.setTestingLidarr}
            applyingCommunityGuide={data.applyingCommunityGuide}
            showCommunityGuideModal={data.showCommunityGuideModal}
            setShowCommunityGuideModal={data.setShowCommunityGuideModal}
            hasUnsavedChanges={data.hasUnsavedChanges}
            saving={data.saving}
            handleSaveSettings={data.handleSaveSettings}
            showSuccess={showSuccess}
            showError={showError}
            showInfo={showInfo}
          />
        );
      case "discover":
        return (
          <SettingsDiscoverTab
            settings={data.settings}
            updateSettings={data.updateSettings}
            health={data.health}
            hasUnsavedChanges={data.hasUnsavedChanges}
            saving={data.saving}
            handleSaveSettings={data.handleSaveSettings}
            refreshingDiscovery={data.refreshingDiscovery}
            discoveryProgressMessage={data.discoveryProgressMessage}
            clearingCache={data.clearingCache}
            handleRefreshDiscovery={data.handleRefreshDiscovery}
            handleClearCache={data.handleClearCache}
          />
        );
      case "notifications":
        return (
          <SettingsNotificationsTab
            settings={data.settings}
            updateSettings={data.updateSettings}
            hasUnsavedChanges={data.hasUnsavedChanges}
            saving={data.saving}
            handleSaveSettings={data.handleSaveSettings}
            testingGotify={data.testingGotify}
            setTestingGotify={data.setTestingGotify}
            showSuccess={showSuccess}
            showError={showError}
          />
        );
      case "account":
        return (
          <SettingsAccountTab
            listenHistoryProvider={account.listenHistoryProvider}
            setListenHistoryProvider={account.setListenHistoryProvider}
            listenHistoryUsername={account.listenHistoryUsername}
            setListenHistoryUsername={account.setListenHistoryUsername}
            lidarrConfigured={account.lidarrConfigured}
            lidarrRootFolders={account.lidarrRootFolders}
            lidarrQualityProfiles={account.lidarrQualityProfiles}
            lidarrRootFolderPath={account.lidarrRootFolderPath}
            setLidarrRootFolderPath={account.setLidarrRootFolderPath}
            lidarrQualityProfileId={account.lidarrQualityProfileId}
            setLidarrQualityProfileId={account.setLidarrQualityProfileId}
            hasUnsavedChanges={account.hasUnsavedChanges}
            loading={account.loading}
            saving={account.saving}
            handleSave={account.handleSave}
          />
        );
      case "users":
        return (
          <SettingsUsersTab
            authUser={authUser}
            usersList={users.usersList}
            loadingUsers={users.loadingUsers}
            newUserUsername={users.newUserUsername}
            setNewUserUsername={users.setNewUserUsername}
            newUserPassword={users.newUserPassword}
            setNewUserPassword={users.setNewUserPassword}
            newUserPermissions={users.newUserPermissions}
            setNewUserPermissions={users.setNewUserPermissions}
            creatingUser={users.creatingUser}
            setCreatingUser={users.setCreatingUser}
            showAddUserModal={users.showAddUserModal}
            setShowAddUserModal={users.setShowAddUserModal}
            editUser={users.editUser}
            setEditUser={users.setEditUser}
            editPassword={users.editPassword}
            setEditPassword={users.setEditPassword}
            editCurrentPassword={users.editCurrentPassword}
            setEditCurrentPassword={users.setEditCurrentPassword}
            editPermissions={users.editPermissions}
            setEditPermissions={users.setEditPermissions}
            savingEdit={users.savingEdit}
            setSavingEdit={users.setSavingEdit}
            changePwCurrent={users.changePwCurrent}
            setChangePwCurrent={users.setChangePwCurrent}
            changePwNew={users.changePwNew}
            setChangePwNew={users.setChangePwNew}
            changePwConfirm={users.changePwConfirm}
            setChangePwConfirm={users.setChangePwConfirm}
            changingPassword={users.changingPassword}
            setChangingPassword={users.setChangingPassword}
            deleteUserTarget={users.deleteUserTarget}
            setDeleteUserTarget={users.setDeleteUserTarget}
            deletingUser={users.deletingUser}
            setDeletingUser={users.setDeletingUser}
            refreshUsers={users.refreshUsers}
            createUser={users.createUser}
            updateUser={users.updateUser}
            deleteUser={users.deleteUser}
            changeMyPassword={users.changeMyPassword}
            settings={data.settings}
            updateSettings={data.updateSettings}
            handleSaveSettings={data.handleSaveSettings}
            health={data.health}
            refreshSettingsData={data.fetchSettings}
            showSuccess={showSuccess}
            showError={showError}
          />
        );
      default:
        return null;
    }
  };

  return (
    <>
      <UnsavedModal
        show={guard.showUnsavedModal}
        onCancel={guard.handleCancelLeave}
        onConfirm={guard.handleConfirmLeave}
      />

      <CommunityGuideModal
        show={data.showCommunityGuideModal}
        onClose={() => data.setShowCommunityGuideModal(false)}
        onApply={data.handleApplyCommunityGuide}
      />

      <div className="animate-fade-in max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#fff" }}>
            Settings
          </h1>
          <p style={{ color: "#c1c1c3" }}>
            Configure application preferences and integrations
          </p>
        </div>

        <div className="mb-5 sm:hidden">
          <label
            htmlFor="settings-tab-select"
            className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-[#8b8b90]"
          >
            Section
          </label>
          <div className="relative">
            <select
              id="settings-tab-select"
              value={tabs.activeTab}
              onChange={(event) => tabs.setActiveTab(event.target.value)}
              className="input h-11 w-full appearance-none bg-[#141419] pr-14 text-sm text-white"
            >
              {tabs.tabs.map((tab) => (
                <option key={tab.id} value={tab.id}>
                  {tab.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#b9bac1]" />
          </div>
        </div>

        <div className="mb-8 hidden w-full overflow-x-auto sm:block">
          <div
            ref={tabs.tabsRef}
            className="relative p-1.5 inline-flex"
            style={{ backgroundColor: "#0f0f12" }}
          >
            <div
              ref={tabs.activeBubbleRef}
              className="absolute transition-all duration-300 ease-out z-10 opacity-0"
              style={{ backgroundColor: "#211f27" }}
            />
            <div
              ref={tabs.hoverBubbleRef}
              className="absolute transition-all duration-200 ease-out z-0"
              style={{ backgroundColor: "#1a1a1e" }}
            />
            <div
              className="relative flex gap-1"
              onMouseLeave={() => tabs.setHoveredTabIndex(null)}
            >
              {tabs.tabs.map((tab, index) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    ref={(el) => {
                      if (el) tabs.tabRefs.current[index] = el;
                    }}
                    onClick={() => tabs.setActiveTab(tab.id)}
                    onMouseEnter={() => tabs.setHoveredTabIndex(index)}
                    className="relative z-20 flex items-center space-x-2 px-4 py-2.5 font-medium transition-all duration-200 text-sm"
                    style={{ color: "#fff" }}
                  >
                    <Icon
                      className="w-4 h-4 transition-transform flex-shrink-0"
                      style={{ color: "#fff" }}
                    />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div>{renderTabContent()}</div>
      </div>
    </>
  );
}

export default SettingsPage;
