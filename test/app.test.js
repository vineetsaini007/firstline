import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { generateEmail } from '../server/generation.js';
import JSZip from 'jszip';

const input = {
  company: 'Acme', role: 'Frontend Engineer', name: 'Alex', recipient: '',
  jobDescription: 'Build accessible React and TypeScript interfaces. Collaborate with designers and improve web application performance.',
  resume: 'Built a React and TypeScript dashboard for 200 users. Reduced page load times from 4 seconds to 1.5 seconds.',
  context: '', link: '', tone: 'professional', experience: 'early', length: 'brief',
};
const draft = {
  subject: 'Frontend Engineer at Acme — Alex',
  body: 'Hi Acme team,\n\nI’m Alex, and I’m interested in your Frontend Engineer position. Your need for React and TypeScript interfaces connects with my dashboard built for 200 users. I also reduced page load times from 4 seconds to 1.5 seconds, relevant to your performance focus.\n\nI’d welcome the chance to discuss how I could contribute to your team. Would you be open to a brief conversation?\n\nBest,\nAlex',
  alternatives: ['An introduction for your frontend team', 'React and TypeScript experience — Alex'],
  matches: [{ requirement: 'React and TypeScript interfaces', evidence: 'Built a React and TypeScript dashboard for 200 users.', focus: 'React and TypeScript', connection: 'Your need for React and TypeScript interfaces connects with my dashboard built for 200 users.' }], note: '',
};
const provider = content => async () => new Response(JSON.stringify({ model: 'example/model:free', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }), { headers: { 'Content-Type': 'application/json' } });
async function serve(t, options = {}) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return (path, options) => fetch(base + path, options);
}
const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('serves workspace and reports missing AI setup without exposing configuration secrets', async t => {
  const request = await serve(t, { env: {} });
  assert.equal((await request('/')).status, 200);
  const config = await (await request('/api/config')).json();
  assert.equal(config.configured, false);
  assert.ok(!Object.keys(config).some(key => /key|password/i.test(key)));
  const response = await request('/api/generate', post(input));
  assert.equal(response.status, 503);
});
test('validates context and rejects non-web portfolio URLs before calling AI', async t => {
  let calls = 0;
  const request = await serve(t, { env: { OPENROUTER_API_KEY: 'test-key' }, fetchImpl: async () => { calls++; } });
  for (const data of [{ ...input, resume: '' }, { ...input, link: 'javascript:alert(1)' }, { ...input, jobDescription: 'too short' }]) {
    assert.equal((await request('/api/generate', post(data))).status, 400);
  }
  assert.equal(calls, 0);
});
test('generates a validated draft and enforces free-only routing and the daily request cap', async t => {
  let calls = 0;
  const request = await serve(t, { env: { OPENROUTER_API_KEY: 'test-key', DAILY_GENERATION_LIMIT: '1' }, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'openrouter/free');
    assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0 });
    assert.ok(body.messages[0].content.includes('Never invent'));
    return provider(draft)();
  } });
  const response = await request('/api/generate', post(input));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.subject, draft.subject);
  assert.ok(body.wordCount <= 90);
  assert.equal((await request('/api/generate', post(input))).status, 429);
  assert.equal(calls, 1);
});
test('never calls a paid model', async () => {
  let calls = 0;
  await assert.rejects(generateEmail(input, { apiKey: 'test', model: 'paid/model', fetchImpl: async () => { calls++; } }), /Only free models/);
  assert.equal(calls, 0);
});
test('rejects fabricated source quotes, disconnected emails, and stale connections from a different JD', async () => {
  const options = { apiKey: 'test', model: 'openrouter/free' };
  const match = draft.matches[0];
  for (const changed of [
    { ...match, requirement: 'React and TypeScript interfaces with GraphQL' },
    { ...match, evidence: 'Built a React dashboard for 20,000 users.' },
    { ...match, connection: 'My work with React and TypeScript is impressive and relevant to your company.' },
    { ...match, focus: 'GraphQL' },
  ]) {
    await assert.rejects(generateEmail(input, { ...options, fetchImpl: provider({ ...draft, matches: [changed] }) }), /did not clearly connect/);
  }
  await assert.rejects(generateEmail({ ...input, jobDescription: 'Build Python data pipelines and collaborate with analysts to maintain reliable warehouse reporting.' }, { ...options, fetchImpl: provider(draft) }), /did not clearly connect/);
  await assert.rejects(generateEmail(input, { ...options, fetchImpl: provider({ ...draft, matches: [] }) }), /incomplete/);
});
test('grounds connections in extra context without a resume and tolerates source line wrapping', async () => {
  const contextInput = { ...input, resume: '', context: 'Built a React and TypeScript\ndashboard for 200 users. Reduced page load times from 4 seconds to 1.5 seconds.' };
  const result = await generateEmail(contextInput, { apiKey: 'test', model: 'openrouter/free', fetchImpl: provider(draft) });
  assert.equal(result.matches[0].connection, draft.matches[0].connection);
});
test('handles provider limits, malformed output, truncated output and overlong drafts honestly', async () => {
  await assert.rejects(generateEmail(input, { apiKey: 'test', model: 'openrouter/free', fetchImpl: async () => new Response('', { status: 429 }) }), /free AI limit/);
  await assert.rejects(generateEmail(input, { apiKey: 'test', model: 'openrouter/free', fetchImpl: provider({ subject: 'Missing body' }) }), /incomplete/);
  await assert.rejects(generateEmail(input, { apiKey: 'test', model: 'openrouter/free', fetchImpl: provider({ ...draft, body: 'word '.repeat(121) }) }), /overly long/);
  await assert.rejects(generateEmail(input, { apiKey: 'test', model: 'openrouter/free', fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(draft) } }] })) }), /incomplete/);
});
test('upload extracts text, rejects fake PDFs, unsupported files, short content and oversized uploads', async t => {
  const request = await serve(t, { env: {} });
  async function upload(bytes, name) {
    const data = new FormData(); data.append('resume', new Blob([bytes]), name);
    return request('/api/resume', { method: 'POST', body: data });
  }
  const valid = await upload(input.resume, 'resume.txt');
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).text, input.resume);
  assert.equal((await upload('not a pdf', 'resume.pdf')).status, 422);
  assert.equal((await upload('few', 'resume.txt')).status, 422);
  assert.equal((await upload('not supported', 'resume.exe')).status, 415);
  assert.equal((await upload(new Uint8Array(5 * 1024 * 1024 + 1), 'resume.txt')).status, 400);
});
test('extracts real PDF and DOCX resumes', async t => {
  const request = await serve(t, { env: {} });
  const text = 'Alex Morgan built React dashboards and improved web performance.';
  const stream = `BT /F1 12 Tf 50 750 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  for (const [bytes, filename] of [[Buffer.from(pdf), 'resume.pdf'], [await zip.generateAsync({ type: 'nodebuffer' }), 'resume.docx']]) {
    const data = new FormData(); data.append('resume', new Blob([bytes]), filename);
    const response = await request('/api/resume', { method: 'POST', body: data });
    const result = await response.json();
    assert.equal(response.status, 200, result.error);
    assert.ok(result.text.includes(text));
  }
});
test('password protection signs an HttpOnly cookie and blocks unauthenticated generation', async t => {
  const request = await serve(t, { env: { APP_PASSWORD: 'a-long-test-password', OPENROUTER_API_KEY: 'test' }, fetchImpl: provider(draft) });
  assert.equal((await request('/api/generate', post(input))).status, 401);
  assert.equal((await request('/api/unlock', post({ password: 123 }))).status, 401);
  assert.equal((await request('/api/unlock', post({ password: 'wrong' }))).status, 401);
  const response = await request('/api/unlock', post({ password: 'a-long-test-password' }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie.includes('HttpOnly'));
  const result = await request('/api/generate', { ...post(input), headers: { 'Content-Type': 'application/json', Cookie: cookie.split(';')[0] } });
  assert.equal(result.status, 200);
});
test('rejects cross-site posts and limits repeat AI calls', async t => {
  const request = await serve(t, { env: { OPENROUTER_API_KEY: 'test' }, fetchImpl: provider(draft) });
  assert.equal((await request('/api/generate', { ...post(input), headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' } })).status, 403);
  for (let i = 0; i < 5; i++) assert.equal((await request('/api/generate', post(input))).status, 200);
  assert.equal((await request('/api/generate', post(input))).status, 429);
});
