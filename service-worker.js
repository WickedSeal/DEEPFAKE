const APPS = {
  gmail: { origin: 'https://mail.google.com/*', match: 'https://mail.google.com/*', title: 'Gmail' },
  telegram: { origin: 'https://web.telegram.org/*', match: 'https://web.telegram.org/*', title: 'Telegram Web' },
};
const SCRIPT_IDS = { gmail: 'trustlock-gmail-monitor', telegram: 'trustlock-telegram-monitor' };
const MIN_BASELINE_MESSAGES = 10;
const PROFILE_STORAGE_KEY = 'senderProfiles';
const ENABLED_KEY = 'enabledIntegrations';
// Chrome match patterns do not take a port; these host grants cover loopback ports.
const API_ORIGINS = ['http://127.0.0.1/*', 'http://localhost/*'];
const API_URLS = ['http://127.0.0.1:8000/api/extension/events', 'http://localhost:8000/api/extension/events'];
const IMAGE_ANALYSIS_URLS = ['http://127.0.0.1:8000/api/media-check/extension-image', 'http://localhost:8000/api/media-check/extension-image'];
const IMAGE_MENU_ID = 'trustlock-analyze-image';
const MAX_PROCESSED_IMAGE_BYTES = 4 * 1024 * 1024;

const intentPatterns = {
  FINANCIAL_TRANSACTION: /\b(transfer|rtgs|neft|imps|wire|payment|invoice|vendor|remit|funds|payout|paise|rakam|bhejo|bhugtan)\b/i,
  CREDENTIAL_HARVESTING: /\b(password|otp|pin|token|credential|access key|login|auth code)\b/i,
  POLICY_BYPASS: /\b(bypass|skip protocol|don't tell|keep quiet|off the record|override|exception|kisiko mat batana|process skip|direct approval)\b/i,
  DATA_EXFILTRATION: /\b(dump|database|export|customer list|leak|source code|backup|aadhaar|data bhejo)\b/i,
};
const urgencyMarkers = [
  'immediately', 'urgent', 'right now', 'emergency', 'within 10 minutes', 'before closing',
  'without delay', 'critical', 'turant', 'jaldi', 'fatafat', 'abhi ke abhi', 'der mat karo',
  'emergency hai', 'call mat kaatna', 'jaldi se transfer karo',
];

function extractFeatures(text) {
  const chars = [...text].filter((char) => !/\s/.test(char));
  const words = text.trim().split(/\s+/).filter(Boolean);
  const letters = chars.filter((char) => /\p{L}/u.test(char));
  const uppercase = letters.filter((char) => char.toUpperCase() === char && char.toLowerCase() !== char).length;
  const digits = chars.filter((char) => /\p{N}/u.test(char)).length;
  const punctuation = chars.filter((char) => /[!?.,;:।！？。，；：]/u.test(char)).length;
  const exclamations = chars.filter((char) => /[!！]/u.test(char)).length;
  const wordLengths = words.map((word) => [...word].filter((char) => /\p{L}/u.test(char)).length);
  const denominator = Math.max(1, chars.length);
  const urgencyCount = urgencyMarkers.filter((marker) => text.toLowerCase().includes(marker)).length;
  const intent = Object.entries(intentPatterns).find(([, pattern]) => pattern.test(text))?.[0] || 'BENIGN_COMMUNICATION';
  return {
    log_char_count: Math.log1p(chars.length),
    log_word_count: Math.log1p(words.length),
    mean_word_length: wordLengths.reduce((sum, value) => sum + value, 0) / Math.max(1, wordLengths.length),
    uppercase_ratio: uppercase / Math.max(1, letters.length),
    digit_ratio: digits / denominator,
    punctuation_ratio: punctuation / denominator,
    exclamation_ratio: exclamations / denominator,
    intent,
    urgency_score: Math.min(1, 0.1 + urgencyCount * 0.22),
  };
}

function profileKey(message) {
  return `${message.app}|${message.sender.toLowerCase()}`;
}

function updateStat(stats, name, value) {
  const item = stats[name] || { count: 0, mean: 0, m2: 0 };
  const count = item.count + 1;
  const delta = value - item.mean;
  const mean = item.mean + delta / count;
  const delta2 = value - mean;
  stats[name] = { count, mean, m2: item.m2 + delta * delta2 };
}

function scoreAgainstProfile(profile, features) {
  const indicators = [];
  const deviations = [];
  for (const [name, value] of Object.entries(features)) {
    if (name === 'intent' || name === 'urgency_score') continue;
    const stat = profile.stats[name];
    if (!stat || stat.count < 2) continue;
    const variance = stat.m2 / (stat.count - 1);
    const floor = name.startsWith('log_') || name === 'mean_word_length' ? 0.15 : 0.05;
    const z = Math.abs(value - stat.mean) / Math.max(Math.sqrt(Math.max(0, variance)), floor);
    deviations.push(z);
    if (z >= 2.5) indicators.push({ feature: name, deviations: Number(z.toFixed(2)) });
  }
  let score = Math.min(100, Math.round(Math.max(0, ...deviations) * 20));
  if (profile.intentCounts[features.intent] === undefined) {
    indicators.push({ feature: 'new_intent_category', category: features.intent });
    score = Math.min(100, score + 15);
  }
  return { score, indicators };
}

async function getStored() {
  return chrome.storage.local.get({ [PROFILE_STORAGE_KEY]: {}, [ENABLED_KEY]: {} });
}

async function digest(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function learnMessages(messages) {
  const { [PROFILE_STORAGE_KEY]: profiles } = await getStored();
  const report = {};
  for (const message of messages) {
    if (!message.sender || !message.text || message.outgoing || message.previewOnly) continue;
    const key = profileKey(message);
    const profile = profiles[key] || { app: message.app, sender: message.sender, senderLabel: message.senderLabel, stats: {}, intentCounts: {}, sampleIds: [], messagesObserved: 0, updatedAt: null };
    const sampleId = await digest(`${message.conversation}|${message.id}|${message.text}`);
    if (profile.sampleIds.includes(sampleId)) continue;
    const features = extractFeatures(message.text);
    for (const [name, value] of Object.entries(features)) {
      if (name === 'intent' || name === 'urgency_score') continue;
      updateStat(profile.stats, name, value);
    }
    profile.intentCounts[features.intent] = (profile.intentCounts[features.intent] || 0) + 1;
    profile.sampleIds.push(sampleId);
    if (profile.sampleIds.length > 5000) profile.sampleIds = profile.sampleIds.slice(-5000);
    profile.messagesObserved += 1;
    profile.senderLabel = message.senderLabel || profile.senderLabel;
    profile.updatedAt = new Date().toISOString();
    profiles[key] = profile;
    report[key] ||= { sender: profile.senderLabel, app: profile.app, added: 0, total: profile.messagesObserved };
    report[key].added += 1;
    report[key].total = profile.messagesObserved;
  }
  await chrome.storage.local.set({ [PROFILE_STORAGE_KEY]: profiles });
  return Object.values(report);
}

async function analyzeMessage(message) {
  if (!message.sender || !message.text || message.outgoing) return null;
  const { [PROFILE_STORAGE_KEY]: profiles } = await getStored();
  const profile = profiles[profileKey(message)];
  const features = extractFeatures(message.text);
  const result = {
    app: message.app,
    sender: message.senderLabel || message.sender,
    intent: features.intent,
    urgency_score: features.urgency_score,
    behavior_status: profile?.messagesObserved >= MIN_BASELINE_MESSAGES ? 'baseline_ready' : 'learning_baseline',
    behavior_score: null,
    baseline_messages: profile?.messagesObserved || 0,
    indicators: [],
  };
  if (result.behavior_status === 'baseline_ready') {
    const behavior = scoreAgainstProfile(profile, features);
    result.behavior_score = behavior.score;
    result.indicators = behavior.indicators;
  }
  const intentRisk = features.intent === 'BENIGN_COMMUNICATION' ? 0 : 30;
  result.is_alert = features.urgency_score >= 0.45 || intentRisk > 0 || (result.behavior_score !== null && result.behavior_score >= 50);
  return result;
}

async function notify(result) {
  if (!result?.is_alert) return;
  const behavior = result.behavior_score === null ? 'Baseline learning' : `Behavior change ${result.behavior_score}/100`;
  await chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Trustlock: review this message',
    message: `${result.app === 'gmail' ? 'Gmail' : 'Telegram'} detected ${result.intent.toLowerCase().replaceAll('_', ' ')}. Urgency ${Math.round(result.urgency_score * 100)}; ${behavior}. ${result.syncFailed ? 'Local API sync failed; check that Trustlock is running.' : 'Alert sent to Trustlock Live Stream Feed.'}`,
    priority: 1,
  });
  await chrome.action.setBadgeText({ text: '!' });
  await chrome.action.setBadgeBackgroundColor({ color: '#d95d39' });
}

async function getApiUrls() {
  const data = await chrome.storage.local.get('trustlock_api_url');
  const custom = (data.trustlock_api_url || '').trim().replace(/\/+$/, '');
  if (custom) return [`${custom}/api/extension/events`, ...API_URLS];
  return API_URLS;
}

async function forwardAlert(message, result) {
  if (!await chrome.permissions.contains({ origins: API_ORIGINS })) return false;
  const payload = {
    source: result.app,
    sender: String(result.sender || message.senderLabel || message.sender).slice(0, 320),
    preview: String(message.text || '').slice(0, 500),
    intent: result.intent,
    urgency_score: result.urgency_score,
    behavior_score: result.behavior_score,
    baseline_messages: result.baseline_messages,
    indicators: result.indicators || [],
  };
  const urls = await getApiUrls();
  for (const url of urls) {
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      return response.ok;
    } catch { /* Try the other loopback host. */ }
  }
  return false;
}

async function enabledIntegrations() {
  const data = await chrome.storage.local.get({ [ENABLED_KEY]: {} });
  return data[ENABLED_KEY];
}

async function enableIntegration(app) {
  const integration = APPS[app];
  if (!integration) throw new Error('Unsupported app.');
  const granted = await chrome.permissions.contains({ origins: [integration.origin] });
  if (!granted) return { enabled: false, message: 'Grant Chrome site access to enable monitoring.' };
  try {
    await chrome.scripting.registerContentScripts([{
      id: SCRIPT_IDS[app],
      matches: [integration.match],
      js: ['content.js'],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    }]);
  } catch (error) {
    if (!String(error).includes('Duplicate script ID')) throw error;
  }
  const { [ENABLED_KEY]: enabled } = await getStored();
  enabled[app] = true;
  await chrome.storage.local.set({ [ENABLED_KEY]: enabled });
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true, url: integration.match });
  if (tabs[0]?.id) {
    try {
      await chrome.tabs.sendMessage(tabs[0].id, { type: 'TRUSTLOCK_START' });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['content.js'] });
    }
    try {
      const snapshot = await chrome.tabs.sendMessage(tabs[0].id, { type: 'TRUSTLOCK_LEARN_HISTORY' });
      if (snapshot?.messages?.length) await learnMessages(snapshot.messages);
    } catch { /* User can reload to let the registered content script learn loaded history. */ }
  }
  return { enabled: true, message: `${integration.title} monitoring enabled. Reload the open tab if it is not detected.` };
}

async function disableIntegration(app) {
  const integration = APPS[app];
  if (!integration) throw new Error('Unsupported app.');
  try { await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_IDS[app]] }); } catch {}
  const tabs = await chrome.tabs.query({ url: integration.match });
  for (const tab of tabs) {
    try { await chrome.tabs.sendMessage(tab.id, { type: 'TRUSTLOCK_STOP' }); } catch {}
  }
  const { [ENABLED_KEY]: enabled } = await getStored();
  delete enabled[app];
  await chrome.storage.local.set({ [ENABLED_KEY]: enabled });
  const otherEnabled = Object.values(enabled).some(Boolean);
  await chrome.permissions.remove({ origins: [integration.origin, ...(otherEnabled ? [] : API_ORIGINS)] });
  return { enabled: false, message: `${integration.title} monitoring disabled.` };
}

async function activeTabContext() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return { error: 'No active tab.' };
  const app = tab.url?.startsWith('https://mail.google.com/') ? 'gmail' : tab.url?.startsWith('https://web.telegram.org/') ? 'telegram' : null;
  if (!app) return { error: 'Open Gmail or Telegram Web in this tab first.' };
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: 'TRUSTLOCK_CONTEXT' });
  } catch {
    return { app, error: 'Enable this site in Trustlock, then reload the tab.' };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'TRUSTLOCK_PAGE_CONTEXT') {
      await chrome.storage.session.set({ activePageContext: message.context });
      return { ok: true };
    }
    if (message?.type === 'TRUSTLOCK_NEW_MESSAGES') {
      const results = [];
      for (const item of message.messages || []) {
        const result = await analyzeMessage(item);
        if (result) {
          results.push(result);
          result.sender = item.senderLabel || item.sender;
          if (result.is_alert) {
            const synced = await forwardAlert(item, result);
            await notify({ ...result, syncFailed: !synced });
          }
        }
      }
      await chrome.storage.session.set({ lastResults: results });
      return { ok: true, results };
    }
    if (message?.type === 'TRUSTLOCK_HISTORY_MESSAGES') {
      const learned = await learnMessages(message.messages || []);
      return { ok: true, learned };
    }
    if (message?.type === 'TRUSTLOCK_ENABLE') return enableIntegration(message.app);
    if (message?.type === 'TRUSTLOCK_DISABLE') return disableIntegration(message.app);
    if (message?.type === 'TRUSTLOCK_ACTIVE_CONTEXT') return activeTabContext();
    if (message?.type === 'TRUSTLOCK_LEARN_ACTIVE_HISTORY') {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) return { error: 'No active tab.' };
      const snapshot = await chrome.tabs.sendMessage(tab.id, { type: 'TRUSTLOCK_LEARN_HISTORY' });
      if (!snapshot?.messages?.length) return { error: 'No loaded messages were detected in the open conversation. Scroll to load history, then try again.' };
      const learned = await learnMessages(snapshot.messages);
      return { app: snapshot.app, count: snapshot.messages.length, learned };
    }
    if (message?.type === 'TRUSTLOCK_STATUS') {
      const stored = await getStored();
      const enabled = stored[ENABLED_KEY];
      const profiles = stored[PROFILE_STORAGE_KEY];
      const session = await chrome.storage.session.get({ lastResults: [] });
      return {
        enabled,
        profiles: Object.values(profiles).map(({ app, senderLabel, messagesObserved, updatedAt }) => ({ app, sender: senderLabel, messagesObserved, updatedAt })),
        lastResults: session.lastResults,
      };
    }
    if (message?.type === 'TRUSTLOCK_CLEAR_PROFILES') {
      await chrome.storage.local.set({ [PROFILE_STORAGE_KEY]: {} });
      await chrome.storage.session.set({ lastResults: [] });
      return { cleared: true };
    }
    return { error: 'Unknown request.' };
  })().then(sendResponse).catch((error) => sendResponse({ error: error.message || String(error) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ [PROFILE_STORAGE_KEY]: {}, [ENABLED_KEY]: {} }).then((data) => chrome.storage.local.set(data));
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: IMAGE_MENU_ID, title: 'Analyze image with Trustlock', contexts: ['image'] });
  });
});

function resultPageUrl() {
  return chrome.runtime.getURL('image-result.html');
}

async function showImageResult(result) {
  await chrome.storage.session.set({ lastImageAnalysis: result });
  await chrome.windows.create({
    url: resultPageUrl(),
    type: 'popup',
    width: 520,
    height: 760,
    focused: true,
  });
}

async function makeScreeningImage(blob, crop = null) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
    const source = crop || { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
    const scale = Math.min(1, 1600 / Math.max(source.width, source.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('The browser could not prepare this image for screening.');
    context.drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);
    let quality = 0.86;
    let output = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    while (output.size > MAX_PROCESSED_IMAGE_BYTES && quality > 0.55) {
      quality -= 0.1;
      output = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    }
    if (output.size > MAX_PROCESSED_IMAGE_BYTES) throw new Error('The image could not be reduced below the 4 MB screening limit.');
    return output;
  } catch (error) {
    if (error instanceof Error && error.message) throw error;
    throw new Error('The browser could not decode this image format.');
  } finally {
    bitmap?.close();
  }
}

async function postImageForAnalysis(blob) {
  const form = new FormData();
  form.append('file', blob, 'selected-image.jpg');
  let lastError;
  for (const url of IMAGE_ANALYSIS_URLS) {
    try {
      const response = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(90000) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Trustlock returned HTTP ${response.status}.`);
      return data;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(lastError?.message?.includes('Failed to fetch')
    ? 'Trustlock API is not reachable. Start the local backend and allow its Chrome permission.'
    : (lastError?.message || 'Trustlock could not analyze this image.'));
}

async function analyzeSelectedImage(info, tab) {
  if (!tab?.id) throw new Error('Could not identify the tab containing the selected image.');
  const apiPermission = chrome.permissions.request({ origins: API_ORIGINS });
  if (!await apiPermission) throw new Error('Allow Trustlock to access its local API to analyze the selected image.');

  const frameId = Number.isInteger(info.frameId) ? info.frameId : 0;
  const [target] = await chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [frameId] },
    func: (sourceUrl) => {
      const normalize = (value) => {
        try { return new URL(value, location.href).href; } catch { return value; }
      };
      const expected = normalize(sourceUrl);
      const image = [...document.images].find((candidate) =>
        normalize(candidate.currentSrc) === expected || normalize(candidate.src) === expected,
      );
      if (!image) return null;
      const rect = image.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return null;
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight };
    },
    args: [info.srcUrl],
  });
  const bounds = target?.result;
  if (!bounds) throw new Error('Could not locate the selected image in the page. Right-click the image itself and try again.');

  // Capture the visible page only in memory, then crop to the selected image
  // before any pixels leave the browser. This also handles blob and CDN images.
  const screenshotUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const screenshot = await (await fetch(screenshotUrl)).blob();
  const bitmap = await createImageBitmap(screenshot);
  try {
    const scaleX = bitmap.width / bounds.viewportWidth;
    const scaleY = bitmap.height / bounds.viewportHeight;
    const left = Math.max(0, bounds.left);
    const top = Math.max(0, bounds.top);
    const right = Math.min(bounds.viewportWidth, bounds.right);
    const bottom = Math.min(bounds.viewportHeight, bounds.bottom);
    const crop = {
      x: Math.round(left * scaleX),
      y: Math.round(top * scaleY),
      width: Math.max(1, Math.round((right - left) * scaleX)),
      height: Math.max(1, Math.round((bottom - top) * scaleY)),
    };
    if (right <= left || bottom <= top) throw new Error('The selected image is outside the visible area. Scroll it into view and try again.');
    const processed = await makeScreeningImage(screenshot, crop);
    const analysis = await postImageForAnalysis(processed);
    return { ...analysis, capture_method: 'right_clicked_visible_image_crop' };
  } finally {
    bitmap.close();
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== IMAGE_MENU_ID) return;
  (async () => {
    // Trigger Chrome's optional host permission prompt directly from the
    // context-menu gesture, before any awaited storage or tab operations.
    const analysisTask = analyzeSelectedImage(info, tab)
      .then((analysis) => ({ analysis }))
      .catch((error) => ({ error: error.message || String(error) }));
    await showImageResult({ state: 'loading', startedAt: new Date().toISOString() });
    const outcome = await analysisTask;
    await chrome.storage.session.set({ lastImageAnalysis: outcome.analysis
      ? { state: 'completed', analysis: outcome.analysis, completedAt: new Date().toISOString() }
      : { state: 'error', message: outcome.error, completedAt: new Date().toISOString() } });
  })();
});

chrome.action.onClicked.addListener(async (tab) => {
  const app = tab.url?.startsWith('https://mail.google.com/') ? 'gmail' : tab.url?.startsWith('https://web.telegram.org/') ? 'telegram' : null;
  if (!app) {
    await chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: 'Trustlock Message Guard', message: 'Open Gmail or Telegram Web, then click the toolbar icon to toggle monitoring.' });
    return;
  }
  const granted = await chrome.permissions.request({ origins: [APPS[app].origin, ...API_ORIGINS] });
  if (!granted) {
    const currentState = await enabledIntegrations();
    if (currentState[app]) {
      await disableIntegration(app);
      await chrome.action.setBadgeText({ text: '' });
      await chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: 'Trustlock monitoring off', message: `${APPS[app].title} monitoring is disabled.` });
      return;
    }
    await chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: 'Permission needed', message: 'Trustlock needs permission for this messaging site and the local Trustlock service.' });
    return;
  }
  const enabled = await enabledIntegrations();
  if (enabled[app]) {
    await disableIntegration(app);
    await chrome.action.setBadgeText({ text: '' });
    await chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: 'Trustlock monitoring off', message: `${APPS[app].title} monitoring is disabled.` });
    return;
  }
  const result = await enableIntegration(app);
  await chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: 'Trustlock monitoring on', message: `${APPS[app].title} alerts will appear in the existing Trustlock Live Stream Feed. Alert sender, a 500-character preview, and scores are sent to the local Trustlock API.` });
  if (!result.enabled) await chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: 'Could not enable monitoring', message: result.message });
});
