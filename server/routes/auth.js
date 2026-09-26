const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, created_at: u.created_at });
const sign = (u) => jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '7d' });

router.post('/signup', (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const role = req.body.role === 'staff' ? 'staff' : 'manager';
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
    return res.status(409).json({ error: 'An account with this email already exists' });
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email, bcrypt.hashSync(password, 10), role);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ token: sign(user), user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(req.body.password || '', user.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });
  res.json({ token: sign(user), user: publicUser(user) });
});

// --- Forgot password: OTP by email ---
async function sendOtpEmail(to, code) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return false;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({
    from: `StockSense <${process.env.SMTP_USER}>`,
    to,
    subject: 'Your StockSense password reset code',
    text: `Your OTP is ${code}. It expires in 10 minutes.`,
    html: `<p>Your StockSense password reset code is:</p><h2 style="letter-spacing:4px">${code}</h2><p>It expires in 10 minutes.</p>`,
  });
  return true;
}

router.post('/forgot-password', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const generic = { message: 'If that email is registered, an OTP has been sent.' };
  if (!user) return res.json(generic); // don't reveal which emails exist

  const code = String(crypto.randomInt(100000, 1000000));
  db.prepare('UPDATE otp_codes SET used = 1 WHERE user_id = ?').run(user.id);
  db.prepare(
    "INSERT INTO otp_codes (user_id, code_hash, expires_at) VALUES (?, ?, datetime('now', '+10 minutes'))"
  ).run(user.id, bcrypt.hashSync(code, 8));

  let sent = false;
  try {
    sent = await sendOtpEmail(email, code);
  } catch (e) {
    console.error('Email send failed:', e.message);
  }
  if (!sent) {
    // Dev/demo fallback when SMTP is not configured.
    console.log(`\n[OTP] Password reset code for ${email}: ${code}\n`);
    return res.json({ ...generic, dev_otp: process.env.NODE_ENV === 'production' ? undefined : code });
  }
  res.json(generic);
});

router.post('/reset-password', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const { otp, password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const row = user
    ? db
        .prepare(
          "SELECT * FROM otp_codes WHERE user_id = ? AND used = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1"
        )
        .get(user.id)
    : null;
  if (!row || !bcrypt.compareSync(String(otp || ''), row.code_hash))
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(row.id);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), user.id);
  res.json({ message: 'Password updated. You can log in now.' });
});

// --- Profile ---
router.get('/me', requireAuth, (req, res) => res.json(publicUser(req.user)));

router.put('/me', requireAuth, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
  if (req.body.new_password) {
    if (!bcrypt.compareSync(req.body.current_password || '', req.user.password_hash))
      return res.status(400).json({ error: 'Current password is incorrect' });
    if (req.body.new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(req.body.new_password, 10), req.user.id);
  }
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
});

module.exports = router;