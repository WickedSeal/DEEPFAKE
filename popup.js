document.addEventListener('DOMContentLoaded', async () => {
  const guardStatus = document.getElementById('guardStatus');
  const toggleMonitoring = document.getElementById('toggleMonitoring');
  const toggleDeepfake = document.getElementById('toggleDeepfake');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const statusDescription = document.getElementById('statusDescription');

  // Load current states
  const data = await chrome.storage.local.get(['trustlock_monitoring_active', 'trustlock_deepfake_active']);
  const monitoringActive = data.trustlock_monitoring_active ?? true;
  const deepfakeActive = data.trustlock_deepfake_active ?? true;

  toggleMonitoring.checked = monitoringActive;
  toggleDeepfake.checked = deepfakeActive;

  function updateStatusUI() {
    const isAnyActive = toggleMonitoring.checked || toggleDeepfake.checked;
    if (isAnyActive) {
      guardStatus.textContent = 'ACTIVE';
      guardStatus.className = 'status-pill active';
      statusDescription.textContent = 'Monitoring Active Communications';
    } else {
      guardStatus.textContent = 'STANDBY';
      guardStatus.className = 'status-pill inactive';
      statusDescription.textContent = 'Protection Temporarily Paused';
    }
  }

  updateStatusUI();

  toggleMonitoring.addEventListener('change', async () => {
    await chrome.storage.local.set({ trustlock_monitoring_active: toggleMonitoring.checked });
    updateStatusUI();
  });

  toggleDeepfake.addEventListener('change', async () => {
    await chrome.storage.local.set({ trustlock_deepfake_active: toggleDeepfake.checked });
    updateStatusUI();
  });

  openSettingsBtn.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
  });
});
