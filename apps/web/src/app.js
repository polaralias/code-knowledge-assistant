import { DEMO_REVIEW, withReviewState } from './fixtures.js';
import { getStateCopy } from './state-view.js';
import { createReviewClient, endpointFromDocument } from './live-client.js';
import { apiEndpointFromDocument, createUploadClient, DEFAULT_MAX_UPLOAD_BYTES, validateGitHubRef, validateGitHubUrl, validateZipFile } from './upload-client.js';

const app = document.querySelector('#app');
const evidenceDialog = document.querySelector('#evidence-dialog');
const evidencePanel = document.querySelector('#evidence-panel');
const uploadDialog = document.querySelector('#upload-dialog');
const uploadPanel = document.querySelector('#upload-panel');
const reviewClient = createReviewClient(DEMO_REVIEW, { endpoint: endpointFromDocument(document) });
const uploadClient = createUploadClient({ endpoint: apiEndpointFromDocument(document), fallback: DEMO_REVIEW });
let activeReviewMode = reviewClient.mode === 'live' ? 'demo' : 'fixture';
let fixture = reviewClient.mode === 'live' ? withReviewState(DEMO_REVIEW, 'loading') : DEMO_REVIEW;
const reviewSessions = new Map([['demo', { label: `${DEMO_REVIEW.repository.owner}/${DEMO_REVIEW.repository.name}`, review: fixture, mode: activeReviewMode }]]);
let activeReviewKey = 'demo';
let selectedDocument = fixture.documents[0].id;
let selectedAnswer = fixture.chatExamples[0];
let questionPending = false;
let uploadFile = null;
let uploadMode = 'zip';
let gitRepositoryUrl = '';
let gitRef = '';
let reviewAccessCode = '';
let uploadProgress = { state: 'idle' };
let pendingReviewLabel = '';
let uploadAbortController = null;
let activeTab = 'review';
const expandedFindings = new Set();
const awaitingQuestion = { id: 'awaiting-question', question: 'Ask a focused repository question.', answer: 'The live review is ready. Answers will appear here with the source spans that support them.', confidence: 'low', citations: [] };

function applyReview(next) {
  fixture = next;
  selectedDocument = next.documents[0]?.id ?? '';
  selectedAnswer = next.chatExamples[0] ?? awaitingQuestion;
}

function saveReviewSession(key, label, review, mode) {
  reviewSessions.set(key, { label, review, mode });
  activeReviewKey = key;
}

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function renderTopbar() {
  const tabs = [
    { id: 'review', label: 'Review', detail: 'Chat and context' },
    { id: 'findings', label: 'Findings', detail: `${fixture.documents.length} documents` },
    { id: 'map', label: 'Map', detail: 'Future view' },
  ];
  return `<header class="topbar" aria-label="Primary navigation">
    <a class="brand" href="./" aria-label="Code Atlas home"><span class="brand-mark" aria-hidden="true">CA</span><span class="brand-name">Code Atlas</span></a>
    <div class="repo-context" aria-label="Current repository"><span>${escapeHtml(fixture.repository.owner)}</span><span aria-hidden="true">/</span><strong>${escapeHtml(fixture.repository.name)}</strong></div>
    <div class="top-actions">
      <label class="review-switcher"><span class="sr-only">Switch review</span><select id="review-switcher" aria-label="Switch review">${[...reviewSessions].map(([key, session]) => `<option value="${escapeHtml(key)}" ${key === activeReviewKey ? 'selected' : ''}>${escapeHtml(session.label)}</option>`).join('')}${pendingReviewLabel ? `<option disabled>${escapeHtml(pendingReviewLabel)} · processing</option>` : '<option disabled>New review to add another</option>'}</select></label>
      <span class="top-note">${reviewClient.mode === 'live' || uploadClient.mode === 'live' ? 'Live review' : 'Local preview'}</span>
      <button class="upload-trigger" type="button" id="upload-trigger">New review</button>
      <label class="state-control"><span class="sr-only">Preview state</span><select id="state-select" aria-label="Preview workspace state">
        ${['ready', 'loading', 'empty', 'failure', 'network-error', 'invalid-response', 'expired', 'abuse-limit'].map((state) => `<option value="${state}" ${fixture.state === state ? 'selected' : ''}>${state === 'abuse-limit' ? 'Abuse limit' : state === 'network-error' ? 'Network error' : state === 'invalid-response' ? 'Invalid response' : state[0].toUpperCase() + state.slice(1)}</option>`).join('')}
      </select></label>
    </div>
  </header>
  <nav class="tabbar" role="tablist" aria-label="Workspace views">
    ${tabs.map((tab) => `<button class="tab-button ${activeTab === tab.id ? 'is-active' : ''}" id="tab-${tab.id}" type="button" role="tab" data-tab="${tab.id}" aria-selected="${activeTab === tab.id}" aria-controls="workspace-view-${tab.id}"><span>${tab.label}</span><small>${tab.detail}</small></button>`).join('')}
  </nav>`;
}

function renderWorkspaceLead() {
  const { repository, status } = fixture;
  const displayStatus = fixture.state === 'ready' ? status : {
    loading: { label: 'Review in progress', detail: 'The snapshot is being inspected now.', tone: 'warn' },
    empty: { label: 'Awaiting a source', detail: 'No indexed review is available for this repository.', tone: 'warn' },
    failure: { label: 'Review unavailable', detail: 'The retained snapshot could not be read.', tone: 'bad' },
    'network-error': { label: 'Review service unreachable', detail: 'The live endpoint did not respond.', tone: 'bad' },
    'invalid-response': { label: 'Invalid review response', detail: 'The live endpoint did not match the review contract.', tone: 'bad' },
    expired: { label: 'Review expired', detail: 'The source snapshot is outside its retention window.', tone: 'warn' },
    'abuse-limit': { label: 'Question limit reached', detail: 'Documents remain available while access resets.', tone: 'warn' },
  }[fixture.state];
  return `<section class="workspace-lead" aria-labelledby="workspace-title">
    <div class="lead-copy">
      <p class="lead-label">Repository review</p>
      <h1 id="workspace-title">Understand the system before you change it.</h1>
      <p class="repo-subtitle">A retained, evidence-linked review of ${escapeHtml(repository.name)}. Read the generated guide, inspect its source spans, then ask a focused question.</p>
      <div class="repo-meta"><span><strong>branch</strong> ${escapeHtml(repository.branch)}</span><span><strong>commit</strong> ${escapeHtml(repository.commit)}</span><span><strong>captured</strong> ${escapeHtml(repository.capturedAt)}</span><span><strong>size</strong> ${escapeHtml(repository.size)}</span></div>
    </div>
    <div class="status-block" aria-label="Review status"><div class="status-heading"><span class="status-dot ${displayStatus.tone === 'good' ? '' : displayStatus.tone}" aria-hidden="true"></span><span>${escapeHtml(displayStatus.label)}</span></div><p class="status-detail">${escapeHtml(displayStatus.detail)}</p></div>
  </section>`;
}

function renderFindingsRail() {
  return `<aside class="findings-rail" aria-label="Generated findings">
    <div class="rail-header"><div><h2>Findings</h2><p>Generated documents</p></div><span class="rail-count">${fixture.documents.length}</span></div>
    <div class="finding-list">${fixture.documents.map((doc) => {
      const selected = selectedDocument === doc.id;
      const expanded = selected || expandedFindings.has(doc.id);
      return `<article class="finding-item ${selected ? 'is-selected' : ''}"><button class="finding-button" type="button" data-document="${escapeHtml(doc.id)}" aria-current="${selected ? 'page' : 'false'}" aria-expanded="${expanded}"><span class="finding-marker" aria-hidden="true"></span><span class="finding-copy"><strong>${escapeHtml(doc.title)}</strong><span>${escapeHtml(doc.summary)}</span></span><span class="finding-arrow" aria-hidden="true">${selected ? '↗' : '+'}</span></button>${expanded ? `<div class="finding-preview">${doc.sections.length} sections <span aria-hidden="true">·</span> cited source available</div>` : ''}</article>`;
    }).join('')}</div>
    <div class="rail-note"><strong>Evidence first</strong><span>Every answer points back to a retained source span.</span></div>
  </aside>`;
}

function renderFindingsDocument() {
  const document = fixture.documents.find((candidate) => candidate.id === selectedDocument) ?? fixture.documents[0];
  if (!document) return '<section class="detail-pane"><p>No generated findings are available for this review.</p></section>';
  return `<article class="detail-pane" aria-labelledby="document-title"><header class="detail-header"><div><p class="detail-context">Finding</p><h2 id="document-title">${escapeHtml(document.title)}</h2><p class="panel-summary">${escapeHtml(document.summary)}</p></div><button type="button" class="text-button" data-tab="review">Back to chat</button></header><div class="document-body">${document.sections.map((section) => `<section class="doc-section"><h3>${escapeHtml(section.heading)}</h3><p>${escapeHtml(section.body)}</p>${section.bullets ? `<ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>` : ''}</section>`).join('')}</div></article>`;
}

function renderCoverage() {
  const { capability, coverage } = fixture;
  return `<section class="detail-pane" aria-labelledby="coverage-title"><header class="detail-header"><div><p class="detail-context">Scope and limits</p><h2 id="coverage-title">What this review can explain</h2><p class="panel-summary">${escapeHtml(capability.detail)}</p></div></header><div class="coverage-grid"><div class="coverage-card"><h3>Capability</h3><div class="coverage-list">${capability.supported.map((item) => `<span class="coverage-chip">${escapeHtml(item)}</span>`).join('')}${capability.partial.map((item) => `<span class="coverage-chip partial">${escapeHtml(item)}</span>`).join('')}${capability.excluded.map((item) => `<span class="coverage-chip excluded">${escapeHtml(item)}</span>`).join('')}</div></div><div class="coverage-card"><h3>Indexed languages</h3><div class="language-list">${coverage.languages.map((language) => `<div class="language-row"><strong>${escapeHtml(language.name)}</strong><span class="language-bar" aria-hidden="true"><span style="width:${language.percentage}%"></span></span><span>${language.percentage}%</span></div>`).join('')}</div></div></div></section>`;
}

function renderUncertainty() {
  return `<section class="detail-pane" aria-labelledby="uncertainty-title"><header class="detail-header"><div><p class="detail-context">Read before relying on it</p><h2 id="uncertainty-title">Uncertainty, kept visible</h2><p class="panel-summary">These notes describe where the snapshot is partial, inferred, or unable to answer a historical question.</p></div></header><div class="uncertainty-list">${fixture.uncertainty.map((item) => `<div class="uncertainty"><span class="uncertainty-mark ${item.severity}" aria-hidden="true"></span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div></div>`).join('')}</div></section>`;
}

function renderChat() {
  const answer = selectedAnswer;
  const answerBody = questionPending
    ? '<div class="chat-pending" role="status"><span class="pending-bar" aria-hidden="true"></span><span>Searching retained evidence...</span></div>'
    : `<p class="answer-copy">${escapeHtml(answer.answer)}</p><span class="confidence ${answer.confidence}">${escapeHtml(answer.confidence)} confidence</span><div class="citations" aria-label="Cited evidence">${answer.citations.map((citation, index) => `<button type="button" class="citation" data-citation="${escapeHtml(answer.id)}-${index}"><span><span class="citation-path">${escapeHtml(citation.path)}</span><span class="citation-line">lines ${citation.lineStart}-${citation.lineEnd}</span></span><span class="citation-arrow" aria-hidden="true">↗</span></button>`).join('')}</div>`;
  return `<section class="chat-pane" aria-labelledby="chat-title">
    <header class="chat-header"><div><p class="detail-context">Conversation</p><h2 id="chat-title">Ask about this snapshot</h2></div><span class="chat-scope">evidence only</span><p>Answers stay inside the indexed source and show the spans that support them.</p></header>
    <div class="prompt-list" aria-label="Example questions">${fixture.prompts.map((prompt) => `<button type="button" class="prompt-button" data-prompt="${escapeHtml(prompt.id)}">${escapeHtml(prompt.question)}</button>`).join('')}</div>
    <div class="answer" aria-live="polite" aria-busy="${questionPending}"><p class="answer-question">${escapeHtml(answer.question)}</p>${answerBody}</div>
    <form class="chat-form" id="chat-form"><label for="question">Ask a question</label><div class="chat-controls"><input id="question" class="chat-input" name="question" autocomplete="off" placeholder="e.g. Where is retry policy defined?" ${questionPending ? 'disabled' : ''} /><button class="chat-submit" type="submit" ${questionPending ? 'disabled' : ''}>${questionPending ? 'Searching' : 'Ask'}</button></div><p class="limit-note">${fixture.limits.remainingQuestions} questions remain for this review. ${escapeHtml(fixture.limits.resetAt)}.</p></form>
  </section>`;
}

function renderProgressRail() {
  const { coverage, capability } = fixture;
  const filePercent = coverage.totalFiles ? Math.round((coverage.indexedFiles / coverage.totalFiles) * 100) : 0;
  const linePercent = coverage.totalLines ? Math.round((coverage.indexedLines / coverage.totalLines) * 100) : 0;
  const stages = [
    { label: 'Read', value: `${coverage.indexedFiles} / ${coverage.totalFiles} files`, detail: `${filePercent}% indexed` },
    { label: 'Shape', value: `${fixture.documents.length} documents`, detail: `${Math.round(coverage.indexedLines / 1000)}k lines retained` },
    { label: 'Verify', value: `${fixture.chatExamples.length ? 'Cited answers ready' : 'Awaiting a question'}`, detail: `${fixture.limits.remainingQuestions} questions remain` },
  ];
  return `<aside class="progress-rail" aria-label="Review progress and sources"><div class="rail-header"><div><h2>Review context</h2><p>What is available now</p></div><span class="status-dot ${fixture.status.tone === 'good' ? '' : fixture.status.tone}" aria-hidden="true"></span></div><div class="progress-list">${stages.map((stage) => `<div class="progress-item"><span class="progress-line" aria-hidden="true"></span><div><strong>${stage.label}</strong><span>${escapeHtml(stage.value)}</span><small>${escapeHtml(stage.detail)}</small></div></div>`).join('')}</div><div class="source-block"><h3>Sources</h3><p>${escapeHtml(capability.label)}</p><div class="source-chips">${coverage.languages.map((language) => `<span>${escapeHtml(language.name)}</span>`).join('')}</div></div><div class="context-note"><strong>Indexed lines</strong><span>${coverage.indexedLines.toLocaleString()} of ${coverage.totalLines.toLocaleString()} source lines (${linePercent}%).</span></div></aside>`;
}

function renderMapTab() {
  return `<section class="map-pane" id="workspace-view-map" aria-labelledby="map-title"><div class="map-empty"><span class="map-mark" aria-hidden="true">+</span><p class="detail-context">Reserved view</p><h2 id="map-title">Relationship map is next</h2><p>The current review proves evidence spans and document coverage. It does not claim a complete call graph, so this view stays deliberately honest until relationship extraction is ready.</p><div class="map-boundary"><strong>Available now</strong><span>Open a finding, inspect its retained source, or ask a cited question from the Review tab.</span></div><button type="button" class="text-button" data-tab="review">Return to review</button></div></section>`;
}

function renderState(state) {
  const copy = getStateCopy(state);
  return `<section class="panel state-panel" aria-live="polite"><div><div class="state-icon" aria-hidden="true">${copy.icon}</div><h2>${copy.title}</h2><p>${copy.body}</p>${copy.action ? `<button class="retry-button" type="button" id="state-action">${copy.action}</button>` : ''}</div></section>`;
}

function uploadCopy(state) {
  const source = uploadMode === 'github' ? 'GitHub repository' : 'repository ZIP';
  return {
    idle: { title: uploadMode === 'github' ? 'Review a public GitHub repository' : 'Upload a repository ZIP', body: uploadMode === 'github' ? 'Resolve a public GitHub URL to one immutable commit. The server fetches and reviews it without executing repository content.' : 'Create a new review from a source snapshot. The browser only sends the selected ZIP to the configured review service.', action: uploadMode === 'github' ? 'Review GitHub repository' : 'Upload ZIP' },
    'invalid-file': { title: 'Choose a valid ZIP', body: uploadProgress.message ?? 'The browser checks the extension, non-empty size, and disclosed limit before the server sees the file.', action: 'Upload ZIP' },
    'invalid-github-url': { title: 'Check the GitHub URL', body: uploadProgress.message ?? 'Use a public HTTPS repository URL without credentials, query parameters, or fragments.', action: 'Review GitHub repository' },
    'invalid-github-ref': { title: 'Check the GitHub ref', body: uploadProgress.message ?? 'Use a branch, tag, or commit ref without control characters.', action: 'Review GitHub repository' },
    unauthorized: { title: 'Access code not accepted', body: 'That review access code was not accepted. Check the code and try again.', action: 'Try again' },
    conflict: { title: 'Review already in progress', body: 'A review for this source is already in progress. Wait for it to finish or use the existing review.', action: 'Try again' },
    uploading: { title: `Acquiring ${source}`, body: uploadMode === 'github' ? 'The server is resolving and shallow-fetching an immutable commit. Repository contents are not stored in this browser.' : 'The ZIP is being transferred. Repository contents are not stored in this browser.', action: 'Cancel' },
    queued: { title: 'Review queued', body: `Job ${uploadProgress.jobId ?? 'accepted'} is waiting for an available worker.`, action: 'Cancel' },
    processing: { title: 'Building the review', body: 'The worker is extracting source, indexing evidence, and preparing the review workspace.', action: 'Cancel' },
    ready: { title: 'Review ready', body: 'The completed review is opening with its generated documents and evidence chat.', action: 'Close' },
    failed: { title: 'Review generation failed', body: 'The server could not build a review from this snapshot. Try the same ZIP again or choose another source.', action: 'Try again' },
    expired: { title: 'Upload job expired', body: 'The worker no longer retains this job. Start a new upload to create a fresh snapshot.', action: 'Upload another ZIP' },
    deleted: { title: 'Upload job was deleted', body: 'This review job is no longer available. Nothing was recovered from the deleted job.', action: 'Upload another ZIP' },
    'rate-limited': { title: 'Upload limit reached', body: 'The service is rate-limiting uploads. Wait for the limit to reset, then try again.', action: 'Close' },
    'network-error': { title: 'Review service unreachable', body: 'The live endpoint did not respond. Check the service and try again.', action: 'Try again' },
    'invalid-response': { title: 'Review response is invalid', body: 'The service responded with data outside the documented job contract. No partial review was opened.', action: 'Try again' },
  }[state] ?? { title: 'Review repository', body: 'Choose a ZIP or public GitHub repository to begin.', action: 'Upload ZIP' };
}

function renderExtractionStages(state) {
  const stages = [
    ['Acquire snapshot', 'Resolve the immutable commit and copy it into an isolated workspace.'],
    ['Inventory files', 'Read eligible text files; skip metadata, dependencies, build output, binaries, and secrets.'],
    ['Build evidence', 'Extract supported-language structure and bounded evidence spans for the review.'],
    ['Generate concepts', 'Ask the configured model for a concise, evidence-linked overview.'],
  ];
  const active = state === 'queued' ? -1 : 1;
  return `<ol class="extraction-stages" aria-label="Review extraction steps">${stages.map(([title, detail], index) => {
    const done = state === 'processing' && index === 0;
    const current = index === active;
    return `<li class="extraction-stage ${done ? 'is-done' : ''} ${current ? 'is-active' : ''}"><span class="stage-mark" aria-hidden="true"></span><div><strong>${title}</strong><span>${detail}</span></div></li>`;
  }).join('')}</ol>`;
}

function renderUploadPanel() {
  if (!uploadPanel) return;
  const state = uploadProgress.state;
  const copy = uploadCopy(state);
  const busy = ['uploading', 'queued', 'processing'].includes(state);
  const terminalError = ['failed', 'expired', 'deleted', 'rate-limited', 'network-error', 'invalid-response', 'invalid-github-url', 'invalid-github-ref', 'unauthorized', 'conflict'].includes(state);
  const formReady = state === 'idle' || state === 'invalid-file' || terminalError;
  const modeTabs = `<div class="intake-modes" role="tablist" aria-label="Repository source"><button type="button" class="intake-mode ${uploadMode === 'zip' ? 'is-active' : ''}" id="mode-zip" role="tab" aria-selected="${uploadMode === 'zip'}">ZIP upload</button><button type="button" class="intake-mode ${uploadMode === 'github' ? 'is-active' : ''}" id="mode-github" role="tab" aria-selected="${uploadMode === 'github'}">Public GitHub</button></div>`;
  const accessCodeField = `<div class="access-code-field"><label for="review-access-code">Review access code <span class="field-hint">optional for local demos</span></label><input class="chat-input" id="review-access-code" name="review-access-code" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" value="${escapeHtml(reviewAccessCode)}" aria-describedby="review-access-code-hint" /><p class="field-hint" id="review-access-code-hint">Sent in memory only when creating a hosted ZIP or Git review.</p></div>`;
  const form = uploadMode === 'github'
    ? `<div class="github-fields"><label for="git-repository-url">Repository URL</label><input class="chat-input" id="git-repository-url" name="repository-url" type="url" inputmode="url" autocomplete="url" placeholder="https://github.com/org/repository" value="${escapeHtml(gitRepositoryUrl)}" /><label for="git-ref">Ref <span class="field-hint">optional</span></label><input class="chat-input" id="git-ref" name="ref" type="text" autocomplete="off" placeholder="main, tag, or commit" value="${escapeHtml(gitRef)}" />${accessCodeField}<p class="upload-feedback ${terminalError ? 'is-error' : ''}" id="upload-feedback" role="status" aria-live="polite">${terminalError ? escapeHtml(copy.body) : 'Only credential-free GitHub HTTPS URLs are accepted. The server resolves the final commit.'}</p></div>`
    : `<label class="upload-drop" for="zip-file"><span class="upload-drop-title">Choose repository ZIP</span><span class="upload-drop-copy">.zip only, up to ${Math.round(DEFAULT_MAX_UPLOAD_BYTES / (1024 * 1024))} MB. Server validation remains authoritative.</span><input class="upload-input" id="zip-file" name="zip-file" type="file" accept=".zip,application/zip" /></label><p class="upload-file-name" id="upload-file-name">${uploadFile ? escapeHtml(uploadFile.name) : 'No file selected'}</p>${accessCodeField}<p class="upload-feedback ${state === 'invalid-file' || terminalError ? 'is-error' : ''}" id="upload-feedback" role="status" aria-live="polite">${state === 'invalid-file' || terminalError ? escapeHtml(copy.body) : 'The browser will check the file before upload.'}</p>`;
  uploadPanel.innerHTML = `<div class="upload-panel"><div class="evidence-top"><div><p class="panel-kicker">New repository review</p><h2 id="upload-title">${escapeHtml(copy.title)}</h2><p class="panel-summary">${escapeHtml(copy.body)}</p></div><button class="evidence-close" type="button" id="close-upload">Close</button></div>${modeTabs}${formReady ? `<form class="upload-form" id="upload-form" novalidate>${form}<div class="upload-actions"><button class="chat-submit" type="submit">${escapeHtml(state === 'idle' ? copy.action : terminalError && ['failed', 'network-error', 'invalid-response'].includes(state) ? 'Try again' : copy.action)}</button><button class="evidence-close" type="button" id="cancel-upload">Cancel</button></div></form>` : `<div class="upload-progress" role="status" aria-live="polite" aria-busy="${busy}"><p class="upload-progress-lead">${state === 'queued' ? 'Waiting for a worker to begin.' : 'The worker is reading the snapshot in an isolated workspace.'}</p>${renderExtractionStages(state)}<p class="upload-progress-detail">${escapeHtml(copy.body)}</p><button class="evidence-close" type="button" id="cancel-upload">${escapeHtml(copy.action)}</button></div>`}</div>`;
  bindUploadEvents();
}

function openUploadDialog() {
  if (!uploadDialog) return;
  uploadAbortController?.abort();
  uploadAbortController = null;
  uploadFile = null;
  uploadMode = 'zip';
  gitRepositoryUrl = '';
  gitRef = '';
  reviewAccessCode = '';
  uploadProgress = { state: 'idle' };
  renderUploadPanel();
  uploadDialog.showModal();
  document.querySelector('#zip-file')?.focus();
}

function uploadFailureState(error) {
  return ['failed', 'expired', 'deleted', 'rate-limited', 'unauthorized', 'conflict', 'network-error', 'invalid-response', 'invalid-github-url', 'invalid-github-ref'].includes(error?.code) ? error.code : 'network-error';
}

async function submitUpload() {
  const validation = validateZipFile(uploadFile, uploadClient.maxBytes);
  if (!validation.ok) {
    uploadProgress = { state: 'invalid-file', message: validation.message };
    renderUploadPanel();
    return;
  }
  uploadAbortController?.abort();
  uploadAbortController = new AbortController();
  uploadProgress = { state: 'uploading' };
  renderUploadPanel();
  try {
    const result = await uploadClient.uploadAndPoll(validation.file, {
      accessCode: reviewAccessCode,
      onAccepted: () => { reviewAccessCode = ''; },
      signal: uploadAbortController.signal,
      onState: (next) => { uploadProgress = next; renderUploadPanel(); },
    });
    const key = `upload-${result.reviewId}`;
    saveReviewSession(key, `${result.review.repository.owner}/${result.review.repository.name}`, result.review, uploadClient.mode === 'live' ? 'upload' : 'fixture');
    applyReview(result.review);
    activeReviewMode = uploadClient.mode === 'live' ? 'upload' : 'fixture';
    reviewAccessCode = '';
    uploadProgress = { state: 'ready', reviewId: result.reviewId };
    pendingReviewLabel = '';
    uploadAbortController = null;
    uploadDialog?.close();
    render();
  } catch (error) {
    uploadAbortController = null;
    if (error?.code === 'aborted') return;
    uploadProgress = { state: uploadFailureState(error), message: error?.message };
    pendingReviewLabel = '';
    renderUploadPanel();
  }
}

async function submitGitHubReview() {
  const url = validateGitHubUrl(gitRepositoryUrl);
  if (!url.ok) { uploadProgress = { state: 'invalid-github-url', message: url.message }; renderUploadPanel(); return; }
  const ref = validateGitHubRef(gitRef);
  if (!ref.ok) { uploadProgress = { state: 'invalid-github-ref', message: ref.message }; renderUploadPanel(); return; }
  uploadAbortController?.abort();
  uploadAbortController = new AbortController();
  pendingReviewLabel = `${url.value.split('/')[3]}/${url.value.split('/')[4]}`;
  uploadProgress = { state: 'uploading' };
  renderUploadPanel();
  try {
    const result = await uploadClient.createGitHubReview({ repositoryUrl: url.value, ref: ref.value, accessCode: reviewAccessCode }, { onAccepted: () => { reviewAccessCode = ''; }, signal: uploadAbortController.signal, onState: (next) => { uploadProgress = next; renderUploadPanel(); } });
    const key = `upload-${result.reviewId}`;
    saveReviewSession(key, `${result.review.repository.owner}/${result.review.repository.name}`, result.review, uploadClient.mode === 'live' ? 'upload' : 'fixture');
    applyReview(result.review);
    activeReviewMode = uploadClient.mode === 'live' ? 'upload' : 'fixture';
    reviewAccessCode = '';
    uploadProgress = { state: 'ready', reviewId: result.reviewId };
    pendingReviewLabel = '';
    uploadAbortController = null;
    uploadDialog?.close();
    render();
  } catch (error) {
    uploadAbortController = null;
    if (error?.code === 'aborted') return;
    uploadProgress = { state: uploadFailureState(error), message: error?.message };
    pendingReviewLabel = '';
    renderUploadPanel();
  }
}

function bindUploadEvents() {
  document.querySelector('#close-upload')?.addEventListener('click', () => uploadDialog?.close());
  document.querySelector('#mode-zip')?.addEventListener('click', () => { uploadMode = 'zip'; uploadProgress = { state: 'idle' }; renderUploadPanel(); document.querySelector('#zip-file')?.focus(); });
  document.querySelector('#mode-github')?.addEventListener('click', () => { uploadMode = 'github'; uploadProgress = { state: 'idle' }; renderUploadPanel(); document.querySelector('#git-repository-url')?.focus(); });
  document.querySelector('#cancel-upload')?.addEventListener('click', () => {
    if (['uploading', 'queued', 'processing'].includes(uploadProgress.state)) { uploadAbortController?.abort(); uploadAbortController = null; uploadProgress = { state: 'idle' }; renderUploadPanel(); return; }
    if (['failed', 'network-error', 'invalid-response', 'invalid-github-url', 'invalid-github-ref', 'unauthorized', 'conflict'].includes(uploadProgress.state)) { uploadMode === 'github' ? submitGitHubReview() : submitUpload(); return; }
    if (['expired', 'deleted'].includes(uploadProgress.state)) { uploadProgress = { state: 'idle' }; renderUploadPanel(); return; }
    uploadDialog?.close();
  });
  document.querySelector('#zip-file')?.addEventListener('change', (event) => {
    const candidate = event.target.files?.[0] ?? null;
    const validation = validateZipFile(candidate, uploadClient.maxBytes);
    uploadFile = validation.ok ? validation.file : null;
    uploadProgress = validation.ok ? { state: 'idle' } : { state: 'invalid-file', message: validation.message };
    renderUploadPanel();
    document.querySelector('#zip-file')?.focus();
  });
  document.querySelector('#git-repository-url')?.addEventListener('input', (event) => { gitRepositoryUrl = event.target.value; });
  document.querySelector('#git-ref')?.addEventListener('input', (event) => { gitRef = event.target.value; });
  document.querySelector('#review-access-code')?.addEventListener('input', (event) => { reviewAccessCode = event.target.value; });
  document.querySelector('#upload-form')?.addEventListener('submit', (event) => { event.preventDefault(); uploadMode === 'github' ? submitGitHubReview() : submitUpload(); });
}

function renderReady() {
  const view = activeTab === 'findings'
    ? `<div class="findings-detail" id="workspace-view-findings" role="tabpanel" aria-labelledby="tab-findings">${renderFindingsDocument()}${renderCoverage()}${renderUncertainty()}</div>`
    : activeTab === 'map'
      ? renderMapTab()
      : `<div class="review-detail" id="workspace-view-review" role="tabpanel" aria-labelledby="tab-review">${renderChat()}</div>`;
  return `<div class="workbench-grid">${renderFindingsRail()}<section class="workspace-view" id="main-content" tabindex="-1" aria-label="Review workspace">${view}</section>${renderProgressRail()}</div>`;
}

function render() {
  if (!app) return;
  const isReady = fixture.state === 'ready';
  app.innerHTML = `${renderTopbar()}<main class="workspace" id="workspace-main">${renderWorkspaceLead()}${isReady ? renderReady() : renderState(fixture.state)}</main>`;
  bindEvents();
}

function showEvidence(citation) {
  if (!evidenceDialog || !evidencePanel) return;
  evidencePanel.innerHTML = `<div class="evidence-panel"><div class="evidence-top"><div><p class="panel-kicker">Evidence inspection</p><h2 id="evidence-title">Source span</h2></div><button class="evidence-close" type="button" id="close-evidence">Close</button></div><div class="evidence-path">${escapeHtml(citation.path)}:${citation.lineStart}-${citation.lineEnd}</div><pre class="evidence-code"><code>${escapeHtml(citation.excerpt)}</code></pre><p class="evidence-reason">${escapeHtml(citation.reason)} This span is retained with the review so the answer can be checked against source.</p></div>`;
  evidenceDialog.showModal();
  evidencePanel.querySelector('#close-evidence')?.addEventListener('click', () => evidenceDialog.close());
}

function bindEvents() {
  document.querySelector('#upload-trigger')?.addEventListener('click', openUploadDialog);
  document.querySelector('#review-switcher')?.addEventListener('change', (event) => {
    const session = reviewSessions.get(event.target.value);
    if (!session) return;
    activeReviewKey = event.target.value;
    activeReviewMode = session.mode;
    applyReview(session.review);
    activeTab = 'review';
    render();
  });
  document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
    activeTab = button.dataset.tab ?? 'review';
    render();
    document.querySelector('#main-content')?.focus();
  }));
  document.querySelector('#state-select')?.addEventListener('change', (event) => {
    fixture = withReviewState(DEMO_REVIEW, event.target.value);
    activeTab = 'review';
    selectedDocument = fixture.documents[0]?.id ?? '';
    render();
  });
  document.querySelectorAll('[data-document]').forEach((button) => button.addEventListener('click', () => {
    selectedDocument = button.dataset.document;
    expandedFindings.add(selectedDocument);
    activeTab = 'findings';
    render();
    document.querySelector('#document-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => {
    if (reviewClient.mode === 'live') {
      const prompt = fixture.prompts.find((candidate) => candidate.id === button.dataset.prompt);
      const input = document.querySelector('#question');
      if (input && prompt) { input.value = prompt.question; input.focus(); }
      return;
    }
    const answerId = { flow: 'request-flow', risk: 'queue-risk' }[button.dataset.prompt] ?? 'request-flow';
    selectedAnswer = fixture.chatExamples.find((example) => example.id === answerId) ?? fixture.chatExamples[0];
    activeTab = 'review';
    render();
  }));
  document.querySelectorAll('[data-citation]').forEach((button) => button.addEventListener('click', () => {
    const index = Number(button.dataset.citation?.split('-').pop());
    const citation = selectedAnswer.citations[index];
    if (citation) showEvidence(citation);
  }));
  document.querySelector('#chat-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.querySelector('#question');
    const question = input?.value.trim();
    if (!question) return;
    const questionClient = activeReviewMode === 'upload' ? uploadClient : reviewClient;
    if (questionClient.mode === 'live') {
      questionPending = true;
      render();
      const questionRequest = activeReviewMode === 'upload' ? uploadClient.askQuestion(fixture.reviewId, question) : reviewClient.askQuestion(question);
      questionRequest.then((answer) => {
        selectedAnswer = answer;
        questionPending = false;
        activeTab = 'review';
        render();
      }).catch((error) => {
        questionPending = false;
        const state = error?.code === 'rate-limited' ? 'abuse-limit' : ['expired', 'abuse-limit', 'network-error', 'invalid-response'].includes(error?.code) ? error.code : 'failure';
        fixture = withReviewState(fixture, state);
        render();
      });
      return;
    }
    selectedAnswer = { id: 'local-question', question, answer: 'This local fixture does not invent an answer. Choose an example question to inspect a cited response, or connect the documented API seam to a live retrieval service.', confidence: 'low', citations: [] };
    render();
  });
  document.querySelector('#state-action')?.addEventListener('click', () => {
    activeTab = 'review';
    if (reviewClient.mode === 'live') {
      fixture = withReviewState(DEMO_REVIEW, 'loading');
      render();
      reviewClient.load().then((next) => {
        applyReview(next);
        render();
      });
      return;
    }
    fixture = withReviewState(DEMO_REVIEW, 'ready');
    render();
  });
}

render();

uploadDialog?.addEventListener('close', () => {
  uploadAbortController?.abort();
  uploadAbortController = null;
});

if (reviewClient.mode === 'live') {
  reviewClient.load().then((next) => {
    reviewSessions.set('demo', { label: `${next.repository.owner}/${next.repository.name}`, review: next, mode: 'demo' });
    applyReview(next);
    render();
  });
}
