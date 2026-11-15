const resultNode = document.querySelector('#result');

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function list(title, values) {
  if (!Array.isArray(values) || !values.length) return null;
  const section = document.createElement('section');
  section.append(element('h3', 'section-title', title));
  const ul = document.createElement('ul');
  values.forEach((value) => ul.append(element('li', '', String(value))));
  section.append(ul);
  return section;
}

function renderLoading() {
  resultNode.replaceChildren(
    element('div', 'spinner'),
    element('h2', '', 'Screening the selected image'),
    element('p', '', 'Trustlock is running a still-image model through your local backend. The image itself is not retained.'),
  );
}

function renderError(message) {
  resultNode.replaceChildren(
    element('h2', '', 'Image screening could not run'),
    element('p', 'callout warning', message || 'An unexpected error occurred.'),
    element('p', '', 'Confirm that the Trustlock backend is running, then right-click the image again.'),
  );
}

function renderAnalysis(analysis) {
  if (!analysis || analysis.status !== 'completed' || typeof analysis.deepfake_score !== 'number') {
    renderError(analysis?.message || 'The image model is unavailable or could not decode this image. Check model weights in Trustlock Media Check.');
    return;
  }

  const report = analysis.report || {};
  const score = analysis.deepfake_score;
  const band = score > 0.65 ? 'elevated' : score < 0.35 ? 'lower' : 'inconclusive';
  const scoreNode = element('div', `score ${band}`, `${Math.round(score * 100)}%`);
  scoreNode.setAttribute('aria-label', `AI-like model screening score ${Math.round(score * 100)} out of 100`);
  const scoreRow = element('div', 'score-row');
  scoreRow.append(scoreNode);
  const summary = document.createElement('div');
  summary.append(
    element('p', 'verdict', report.assessment || analysis.verdict?.replaceAll('_', ' ') || 'Screening complete'),
    element('p', 'label', 'AI-like model signal · not a probability'),
  );
  scoreRow.append(summary);

  resultNode.replaceChildren(
    element('p', 'eyebrow', 'SCREENING RESULT'),
    element('h2', '', 'Still-image review'),
    scoreRow,
    element('p', 'callout', report.summary || 'This score is a model signal. It does not prove that a person is genuine or synthetic.'),
  );
  const observations = list('What the model checked', report.observations);
  const limitations = list('Limits to keep in mind', report.limitations);
  if (observations) resultNode.append(observations);
  if (limitations) resultNode.append(limitations);
  const meta = element('div', 'meta', `${analysis.model_name || 'Image model'} · ${analysis.image_width || '?'} × ${analysis.image_height || '?'} · image not saved`);
  resultNode.append(meta);
  const close = element('button', '', 'Done');
  close.addEventListener('click', () => window.close());
  resultNode.append(close);
}

async function refresh() {
  const { lastImageAnalysis } = await chrome.storage.session.get({ lastImageAnalysis: null });
  if (!lastImageAnalysis || lastImageAnalysis.state === 'loading') return renderLoading();
  if (lastImageAnalysis.state === 'error') return renderError(lastImageAnalysis.message);
  renderAnalysis(lastImageAnalysis.analysis);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'TRUSTLOCK_IMAGE_RESULT_UPDATED') refresh();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.lastImageAnalysis) refresh();
});
refresh();
