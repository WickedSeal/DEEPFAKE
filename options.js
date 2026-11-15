const STORAGE_KEYS = {
  API_URL: 'trustlock_api_url',
  SENSITIVITY: 'trustlock_sensitivity',
  MIN_BASELINE: 'trustlock_min_baseline',
  NOTIFY_DESKTOP: 'trustlock_notify_desktop',
  NOTIFY_SOUND: 'trustlock_notify_sound',
  PROFILES: 'senderProfiles',
};

const DEFAULT_SETTINGS = {
  apiUrl: 'http://127.0.0.1:8000',
  sensitivity: 'balanced',
  minBaseline: 10,
  notifyDesktop: true,
  notifySound: false,
};

async function loadSettings() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.API_URL,
    STORAGE_KEYS.SENSITIVITY,
    STORAGE_KEYS.MIN_BASELINE,
    STORAGE_KEYS.NOTIFY_DESKTOP,
    STORAGE_KEYS.NOTIFY_SOUND,
    STORAGE_KEYS.PROFILES,
  ]);

  document.getElementById('apiUrl').value = data[STORAGE_KEYS.API_URL] || DEFAULT_SETTINGS.apiUrl;
  document.getElementById('sensitivity').value = data[STORAGE_KEYS.SENSITIVITY] || DEFAULT_SETTINGS.sensitivity;
  document.getElementById('minBaseline').value = data[STORAGE_KEYS.MIN_BASELINE] || DEFAULT_SETTINGS.minBaseline;
  document.getElementById('notifyDesktop').checked = data[STORAGE_KEYS.NOTIFY_DESKTOP] ?? DEFAULT_SETTINGS.notifyDesktop;
  document.getElementById('notifySound').checked = data[STORAGE_KEYS.NOTIFY_SOUND] ?? DEFAULT_SETTINGS.notifySound;

  const profiles = data[STORAGE_KEYS.PROFILES] || {};
  const count = Object.keys(profiles).length;
  document.getElementById('profileCount').textContent = count;
}

async function saveSettings() {
  const apiUrl = document.getElementById('apiUrl').value.trim() || DEFAULT_SETTINGS.apiUrl;
  const sensitivity = document.getElementById('sensitivity').value;
  const minBaseline = Number.parseInt(document.getElementById('minBaseline').value, 10) || DEFAULT_SETTINGS.minBaseline;
  const notifyDesktop = document.getElementById('notifyDesktop').checked;
  const notifySound = document.getElementById('notifySound').checked;

  await chrome.storage.local.set({
    [STORAGE_KEYS.API_URL]: apiUrl,
    [STORAGE_KEYS.SENSITIVITY]: sensitivity,
    [STORAGE_KEYS.MIN_BASELINE]: minBaseline,
    [STORAGE_KEYS.NOTIFY_DESKTOP]: notifyDesktop,
    [STORAGE_KEYS.NOTIFY_SOUND]: notifySound,
  });

  const status = document.getElementById('saveStatus');
  status.textContent = 'Settings saved successfully!';
  setTimeout(() => {
    status.textContent = '';
  }, 2500);
}

async function exportProfiles() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.PROFILES);
  const profiles = data[STORAGE_KEYS.PROFILES] || {};
  const jsonStr = JSON.stringify(profiles, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `trustlock-sender-baselines-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function clearProfiles() {
  if (!confirm('Are you sure you want to delete all learned sender profiles? You will need to accumulate history again.')) {
    return;
  }
  await chrome.storage.local.remove(STORAGE_KEYS.PROFILES);
  document.getElementById('profileCount').textContent = '0';
  const status = document.getElementById('saveStatus');
  status.textContent = 'All stored baselines cleared.';
  setTimeout(() => {
    status.textContent = '';
  }, 2500);
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('exportBtn').addEventListener('click', exportProfiles);
  document.getElementById('clearBtn').addEventListener('click', clearProfiles);
});
