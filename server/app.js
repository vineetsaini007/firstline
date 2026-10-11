import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inputSchema, generateEmail, AppError, DEFAULT_MODEL } from './generation.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } });
const equal = (a, b) => {
  const one = Buffer.from(a || ''), two = Buffer.from(b || '');
  return one.length === two.length && timingSafeEqual(one, two);
};

export function createApp({ env = process.env, fetchImpl = fetch } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { 'script-src': ["'self'"], 'style-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'connect-src': ["'self'"], 'font-src': ["'self'"], 'upgrade-insecure-requests': env.NODE_ENV === 'production' ? [] : null } } }));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', (req, res, next) => {
    if (req.method === 'POST' && req.headers.origin) {
      let origin;
      try { origin = new URL(req.headers.origin); } catch { return res.status(403).json({ error: 'Invalid request origin.' }); }
      if (origin.host !== req.get('host')) return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
    }
    next();
  });
  const signature = value => createHmac('sha256', env.APP_PASSWORD || 'unused').update(value).digest('hex');
  const authenticated = req => {
    if (!env.APP_PASSWORD) return true;
    const cookie = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('firstline_session='))?.slice(18);
    const [expires, sig] = (cookie || '').split('.');
    return Number(expires) > Date.now() && Number(expires) <= Date.now() + 13 * 3600000 && equal(sig, signature(expires));
  };
  const protect = (req, res, next) => authenticated(req) ? next() : res.status(401).json({ error: 'Enter the app password to continue.' });
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/config', (req, res) => res.json({ configured: Boolean(env.OPENROUTER_API_KEY), protected: Boolean(env.APP_PASSWORD), authenticated: authenticated(req), model: env.OPENROUTER_MODEL || DEFAULT_MODEL }));
  app.post('/api/unlock', rateLimit({ windowMs: 15 * 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many password attempts. Try again in 15 minutes.' } }), (req, res) => {
    if (!env.APP_PASSWORD || typeof req.body?.password !== 'string' || !equal(req.body.password, env.APP_PASSWORD)) return res.status(401).json({ error: 'That password doesn’t match. Try again.' });
    const expires = String(Date.now() + 12 * 3600000);
    res.cookie('firstline_session', `${expires}.${signature(expires)}`, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 12 * 3600000, path: '/' });
    res.json({ ok: true });
  });
  app.post('/api/resume', protect, rateLimit({ windowMs: 10 * 60000, limit: 15, message: { error: 'Too many uploads. Try again in a few minutes.' } }), upload.single('resume'), async (req, res) => {
    if (!req.file) throw new AppError(400, 'Choose a PDF, DOCX, or TXT resume.');
    const extension = req.file.originalname.split('.').pop().toLowerCase();
    let text;
    try {
      if (extension === 'txt') {
        if (req.file.buffer.includes(0)) throw new Error('Binary content');
        text = new TextDecoder('utf-8', { fatal: true }).decode(req.file.buffer);
      } else if (extension === 'pdf') {
        if (!req.file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Invalid PDF');
        const parser = new PDFParse({ data: new Uint8Array(req.file.buffer) });
        try {
          const info = await parser.getInfo();
          if (info.total > 20) throw new AppError(422, 'Use a resume with 20 pages or fewer, or paste the relevant text.');
          text = (await parser.getText()).text;
        } finally { await parser.destroy(); }
      } else if (extension === 'docx') {
        if (req.file.buffer[0] !== 0x50 || req.file.buffer[1] !== 0x4b) throw new Error('Invalid DOCX');
        text = (await mammoth.extractRawText({ buffer: req.file.buffer })).value;
      } else throw new AppError(415, 'Use a PDF, DOCX, or TXT file.');
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(422, 'We couldn’t read that file. Try an unprotected, text-based resume or paste its text instead.');
    }
    text = text.replace(/\u0000/g, '').trim();
    if (text.length < 30) throw new AppError(422, 'This resume has too little readable text. For scanned PDFs, paste your resume text instead.');
    if (text.length > 22000) throw new AppError(422, 'The resume is too long. Paste the most relevant sections (up to 22,000 characters).');
    res.json({ text, characters: text.length });
  });
  let used = 0, day = new Date().toISOString().slice(0, 10);
  const configuredDailyLimit = Number(env.DAILY_GENERATION_LIMIT || 45);
  const dailyLimit = Number.isInteger(configuredDailyLimit) && configuredDailyLimit > 0 ? configuredDailyLimit : 45;
  app.post('/api/generate', protect, rateLimit({ windowMs: 60000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Please wait a minute before generating another draft.' } }), async (req, res) => {
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message, field: parsed.error.issues[0].path[0] });
    if (!env.OPENROUTER_API_KEY) throw new AppError(503, 'AI generation is not connected yet. Add an OpenRouter API key to the server environment.');
    const today = new Date().toISOString().slice(0, 10);
    if (day !== today) { day = today; used = 0; }
    if (used >= dailyLimit) throw new AppError(429, 'This app’s daily free-model allowance is used up. Please try tomorrow.');
    used++;
    res.json(await generateEmail(parsed.data, { apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL || DEFAULT_MODEL, fetchImpl }));
  });
  app.use(express.static(publicDir));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'The resume must be smaller than 5 MB.' : 'Upload one resume file at a time.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'That request is too large. Shorten the resume or job description.' });
    if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Invalid request data.' });
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Something went wrong. Please try again.' });
  });
  return app;
}
