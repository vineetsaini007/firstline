const $ = id => document.getElementById(id);
const form = $('composer');
let config = { configured: false, authenticated: true };
let latestInput = null;
let busy = false;
let uploadBusy = false;
let toastTimer;

const example = {
  company: 'Linear', role: 'Frontend Engineer', name: 'Alex Morgan', recipient: '',
  jobDescription: 'Linear is looking for a Frontend Engineer to build fast, intuitive product experiences. You will work with designers and engineers to ship polished interfaces using React and TypeScript. We value attention to detail, accessible interactions, performance, and ownership from idea to release. Experience building complex web applications and collaborating across functions is important.',
  resume: 'Alex Morgan — Frontend Engineer\nBuilt a React and TypeScript dashboard used by 200 internal users at a logistics company. Reduced dashboard load time from 4 seconds to 1.5 seconds by optimizing data fetching and code splitting. Partnered with a designer to create accessible components and introduced keyboard navigation across the dashboard. Built and shipped a personal task management app. Two years of professional frontend development experience.',
  context: 'I enjoy turning complex workflows into calm, intuitive interfaces. My task management project made me especially interested in product tools.',
  link: '', experience: 'early', tone: 'professional', length: 'brief',
};

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
}

function formError(message, field) {
  $('form-error').textContent = message;
  $('form-error').hidden = !message;
  form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  if (field && $(field)) { $(field).setAttribute('aria-invalid', 'true'); $(field).focus(); }
}

async function api(path, body, { multipart = false } = {}) {
  const response = await fetch(path, {
    method: 'POST', headers: multipart ? {} : { 'Content-Type': 'application/json' },
    body: multipart ? body : JSON.stringify(body), signal: AbortSignal.timeout(75000),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && config.protected) { config.authenticated = false; $('unlock-dialog').showModal(); }
    const error = new Error(data.error || 'Something went wrong. Please try again.');
    error.field = data.field;
    throw error;
  }
  return data;
}

function getInput() {
  return Object.fromEntries(new FormData(form).entries());
}

function validate(input) {
  if (!input.company.trim()) return ['Add the company you’re applying to.', 'company'];
  if (!input.role.trim()) return ['Add the position you’re applying for.', 'role'];
  if (input.jobDescription.trim().length < 50) return ['Paste at least 50 characters of the job description.', 'jobDescription'];
  if (!input.name.trim()) return ['Add your name for the email sign-off.', 'name'];
  if (input.resume.trim().length < 30 && input.context.trim().length < 30) return ['Upload a resume or add at least 30 characters about your experience.', 'context'];
  if (input.link) {
    try { if (!['http:', 'https:'].includes(new URL(input.link).protocol)) throw new Error(); }
    catch { return ['Use a full portfolio URL starting with https:// or http://.', 'link']; }
  }
  return null;
}

function setBusy(value) {
  busy = value;
  $('generate-button').disabled = value || uploadBusy;
  $('generate-button').querySelector('span').textContent = value ? 'Crafting your introduction…' : 'Write my introduction';
  ['regenerate-button', 'shorten-button', 'example-button', 'copy-button', 'download-button'].forEach(id => { $(id).disabled = value; });
  $('loading-state').hidden = !value;
  $('email-card').setAttribute('aria-busy', String(value));
  form.setAttribute('aria-busy', String(value));
}

function countWords() {
  const words = $('email-body').value.trim().split(/\s+/).filter(Boolean).length;
  $('word-count').textContent = `${words} words · ${words > 120 ? 'Consider trimming a little' : 'Short. Personal. Ready to review.'}`;
}

function renderDraft(result, input) {
  $('subject').readOnly = false;
  $('email-body').readOnly = false;
  $('subject').value = result.subject;
  $('email-body').value = result.body;
  $('preview-recipient').textContent = input.recipient || `${input.company} hiring team`;
  document.querySelector('.recipient-tag').textContent = input.role;
  $('preview-badge').textContent = 'Your draft';
  $('preview-badge').classList.add('ready');
  $('copy-button').disabled = false;
  $('output-actions').hidden = false;
  $('quiet-note').hidden = true;
  $('preview-disclaimer').textContent = 'Review every claim before sending. Edit the subject and body directly.';
  $('subject-buttons').replaceChildren();
  result.alternatives.forEach(subject => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = subject;
    button.addEventListener('click', () => { $('subject').value = subject; toast('Subject updated'); });
    $('subject-buttons').append(button);
  });
  $('alternative-subjects').hidden = !result.alternatives.length;
  $('matches').replaceChildren();
  result.matches.forEach(match => {
    const container = document.createElement('div'); container.className = 'match';
    const title = document.createElement('strong'); title.textContent = match.requirement;
    const evidence = document.createElement('p'); evidence.textContent = match.evidence;
    container.append(title, evidence); $('matches').append(container);
  });
  $('model-note').textContent = result.note;
  $('model-note').hidden = !result.note;
  $('matches-panel').hidden = !result.matches.length && !result.note;
  $('connection-status').textContent = `Generated with ${result.model} · free model`;
  countWords();
  $('email-body').style.height = 'auto';
  $('email-body').style.height = `${Math.max(380, $('email-body').scrollHeight)}px`;
}

async function generate(override = null) {
  if (busy || uploadBusy) return;
  const input = override || getInput();
  const invalid = validate(input);
  if (invalid) return formError(...invalid);
  formError('');
  if (config.protected && !config.authenticated) return $('unlock-dialog').showModal();
  if (!config.configured) return formError('AI generation is not connected yet. The owner needs to set OPENROUTER_API_KEY on the server. You can still explore the interface with “Try an example”.');
  if (override && !$('email-body').readOnly && !window.confirm('Generate a new version? This will replace your current email edits.')) return;
  setBusy(true);
  if (window.matchMedia('(max-width: 700px)').matches) $('email-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
  try {
    const result = await api('/api/generate', input);
    latestInput = structuredClone(input);
    renderDraft(result, input);
    toast('Your introduction is ready to review');
  } catch (error) {
    formError(error.name === 'TimeoutError' ? 'The model took too long. Please try again in a moment.' : error.message, error.field);
  } finally { setBusy(false); if ($('email-body').readOnly) $('copy-button').disabled = true; }
}

form.addEventListener('submit', event => { event.preventDefault(); generate(); });
$('jobDescription').addEventListener('input', () => { $('jd-count').textContent = `${$('jobDescription').value.length.toLocaleString()} / 18,000`; });
$('email-body').addEventListener('input', countWords);
$('regenerate-button').addEventListener('click', () => { if (latestInput) generate(getInput()); });
$('shorten-button').addEventListener('click', () => {
  if (latestInput) { const input = getInput(); input.length = 'brief'; form.querySelector('[name=length][value=brief]').checked = true; generate(input); }
});
$('example-button').addEventListener('click', () => {
  if (busy || uploadBusy) return;
  const hasInput = $('company').value || $('jobDescription').value || $('resume').value || $('context').value || $('name').value;
  if (hasInput && !window.confirm('Replace your current context with the example? Your email preview will also be replaced.')) return;
  for (const [key, value] of Object.entries(example)) {
    const element = $(key);
    if (element) element.value = value;
    else form.querySelector(`[name="${key}"][value="${value}"]`).checked = true;
  }
  $('jobDescription').dispatchEvent(new Event('input'));
  $('resume-file').value = '';
  $('upload-title').textContent = 'Example resume loaded';
  $('upload-subtitle').textContent = 'Fictional example · Review the text below';
  $('upload-button').classList.add('has-file');
  $('resume-details').querySelector('summary').firstChild.textContent = 'Review example resume text ';
  $('resume-status').hidden = true;
  renderDraft({ subject: 'Frontend Engineer at Linear — Alex Morgan', body: 'Hi Linear team,\n\nI’m Alex, a frontend engineer interested in your Frontend Engineer role. I built a React and TypeScript dashboard for 200 internal users, reducing load time from 4 seconds to 1.5 seconds. I also partnered with a designer to improve accessibility and keyboard navigation.\n\nYour focus on fast, thoughtful product experiences aligns with the work I enjoy. I’d love to share more about my approach and learn what your team is building.\n\nWould you be open to a brief conversation?\n\nBest,\nAlex Morgan', alternatives: ['React, TypeScript, and thoughtful interfaces — an introduction', 'An introduction for Linear’s Frontend Engineer role'], matches: [{ requirement: 'Fast, polished React and TypeScript interfaces', evidence: 'Built a dashboard for 200 internal users and reduced load time from 4 seconds to 1.5 seconds.' }, { requirement: 'Accessibility and cross-functional collaboration', evidence: 'Partnered with a designer to add accessible components and keyboard navigation.' }], note: 'This is a prewritten example with a fictional applicant, not an AI-generated result.', model: 'illustrative example' }, example);
  latestInput = null;
  $('output-actions').hidden = true;
  $('preview-badge').textContent = 'Example';
  $('preview-disclaimer').textContent = 'Prewritten example · Fictional applicant · Edit the context to make it yours.';
  $('connection-status').textContent = config.configured ? 'Free AI is connected · Generate to create a real draft' : 'Example preview · Live AI needs a server API key';
  formError(''); toast('Example loaded. Make the context your own.');
});

async function uploadResume(file) {
  if (!file || busy || uploadBusy) return;
  if (config.protected && !config.authenticated) return $('unlock-dialog').showModal();
  const setStatus = (message, isError = false) => { $('resume-status').textContent = message; $('resume-status').classList.toggle('error', isError); $('resume-status').hidden = false; };
  if (!/\.(pdf|docx|txt)$/i.test(file.name)) { $('resume-file').value = ''; return setStatus('Choose a PDF, DOCX, or TXT resume.', true); }
  if (file.size > 5 * 1024 * 1024) { $('resume-file').value = ''; return setStatus('Choose a resume smaller than 5 MB.', true); }
  uploadBusy = true; $('upload-button').disabled = true; $('generate-button').disabled = true; $('example-button').disabled = true;
  setStatus('Reading your resume…');
  try {
    const body = new FormData(); body.append('resume', file);
    const result = await api('/api/resume', body, { multipart: true });
    $('resume').value = result.text;
    $('upload-title').textContent = file.name;
    $('upload-subtitle').textContent = `${Math.ceil(file.size / 1024)} KB · Ready to review`;
    $('upload-button').classList.add('has-file');
    $('resume-details').querySelector('summary').firstChild.textContent = 'Review extracted resume text ';
    $('resume-details').open = true;
    setStatus(`${result.characters.toLocaleString()} characters extracted. Check the text below for accuracy.`);
  } catch (error) { setStatus(error.message, true); }
  finally { uploadBusy = false; $('upload-button').disabled = false; $('generate-button').disabled = busy; $('example-button').disabled = busy; $('resume-file').value = ''; }
}
$('upload-button').addEventListener('click', () => $('resume-file').click());
$('resume-file').addEventListener('change', () => uploadResume($('resume-file').files[0]));
['dragenter', 'dragover'].forEach(type => $('upload-button').addEventListener(type, event => { event.preventDefault(); $('upload-button').classList.add('dragging'); }));
['dragleave', 'drop'].forEach(type => $('upload-button').addEventListener(type, event => { event.preventDefault(); $('upload-button').classList.remove('dragging'); }));
$('upload-button').addEventListener('drop', event => {
  if (event.dataTransfer.files.length !== 1) { $('resume-status').hidden = false; $('resume-status').textContent = 'Drop one resume at a time.'; $('resume-status').classList.add('error'); return; }
  uploadResume(event.dataTransfer.files[0]);
});
$('clear-resume').addEventListener('click', () => {
  $('resume').value = ''; $('resume-file').value = ''; $('upload-button').classList.remove('has-file');
  $('upload-title').textContent = 'Drop your resume, or browse'; $('upload-subtitle').textContent = 'PDF, DOCX, or TXT · Up to 5 MB';
  $('resume-details').querySelector('summary').firstChild.textContent = 'Or paste your resume text ';
  $('resume-status').hidden = true; toast('Resume cleared');
});

const draftText = () => `Subject: ${$('subject').value}\n\n${$('email-body').value}`;
$('copy-button').addEventListener('click', async () => {
  const text = draftText();
  try {
    await Promise.race([navigator.clipboard.writeText(text), new Promise((_, reject) => setTimeout(() => reject(new Error('Clipboard timeout')), 1500))]);
    toast('Email copied');
  } catch {
    const temporary = document.createElement('textarea');
    temporary.value = text; temporary.className = 'sr-only'; document.body.append(temporary); temporary.select();
    const copied = document.execCommand('copy'); temporary.remove();
    if (copied) toast('Email copied');
    else { $('email-body').focus(); $('email-body').select(); toast('Clipboard unavailable. Select and copy the email manually.'); }
  }
});
$('download-button').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([draftText()], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url;
  anchor.download = `firstline-${(latestInput?.company || 'draft').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.txt`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Draft downloaded');
});

const info = {
  how: '<div class="dialog-icon"><svg><use href="#i-spark"/></svg></div><h2>A better introduction.<br>In three small steps.</h2><ol><li><strong>The opportunity.</strong> Paste a job description and add the company and role.</li><li><strong>Your story.</strong> Upload a resume or add your experience. Review extracted resume text.</li><li><strong>Your first line.</strong> Choose a tone and length. Generate, edit, and copy your email.</li></ol><p>Every draft aims to connect real evidence to the job. Always review it before sending. Firstline doesn’t send emails or attach resumes.</p>',
  privacy: '<div class="dialog-icon"><svg><use href="#i-lock"/></svg></div><h2>Your context, handled thoughtfully.</h2><p>Uploaded files are parsed in server memory and are not saved by Firstline. Extracted text stays in this browser tab until you refresh or clear it.</p><p>When you generate, the resume text, job description, name, link, and extra context are sent to OpenRouter and the selected AI provider. Their retention policies apply. Remove sensitive information you don’t want included before generating.</p><p>Firstline does not store your context or drafts in a database, browser storage, or application logs. Downloaded and copied emails are under your control.</p><p><a href="https://openrouter.ai/privacy" target="_blank" rel="noopener noreferrer">OpenRouter privacy policy ↗</a></p>',
};
function showInfo(type) { $('info-content').innerHTML = info[type]; $('info-dialog').showModal(); }
$('how-button').addEventListener('click', () => showInfo('how'));
$('privacy-button').addEventListener('click', () => showInfo('privacy'));
$('close-info').addEventListener('click', () => $('info-dialog').close());
$('info-dialog').addEventListener('click', event => { if (event.target === $('info-dialog')) { const r = $('info-dialog').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('info-dialog').close(); } });
$('unlock-form').addEventListener('submit', async event => {
  event.preventDefault(); $('unlock-error').hidden = true;
  const button = event.currentTarget.querySelector('button'); button.disabled = true;
  try { await api('/api/unlock', { password: $('app-password').value }); config.authenticated = true; $('app-password').value = ''; $('unlock-dialog').close(); toast('Workspace unlocked'); }
  catch (error) { $('unlock-error').textContent = error.message; $('unlock-error').hidden = false; }
  finally { button.disabled = false; }
});

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error();
    config = await response.json();
    $('connection-status').classList.toggle('pending', !config.configured);
    $('connection-status').lastChild.textContent = config.configured ? 'Free AI connected · Ready for your introduction' : 'Preview ready · AI connection pending';
    if (config.protected && !config.authenticated) $('unlock-dialog').showModal();
  } catch { $('connection-status').textContent = 'Connection unavailable · Refresh to try again'; }
}
loadConfig();
