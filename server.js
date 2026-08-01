const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// ── DB ──
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'careless',
  user: process.env.DB_USER || 'careless_admin',
  password: process.env.DB_PASS || 'careless_pass_2026',
});

// ── JWT CONFIG ──
const JWT_SECRET = process.env.JWT_SECRET || 'a7f3e2c9b1d4f6e8a0c2d5b7e9f1a3c6d8e0b2f4a6c8d1e3f5b7a9c0d2e4f6';
const JWT_EXPIRES = 7 * 24 * 60 * 60; // 7 days

// ── MIDDLEWARE ──
app.use(express.json({ limit: '8mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

app.use(express.static(path.join(__dirname, 'public')));

// ── HELPERS ──
function base64urlEncode(data) {
  return Buffer.from(data).toString('base64url');
}

function jwtEncode(payload) {
  const header = base64urlEncode(JSON.stringify({ typ: 'JWT', alg: 'HS256' }));
  const now = Math.floor(Date.now() / 1000);
  const claims = { ...payload, iat: now, exp: now + JWT_EXPIRES };
  const encodedPayload = base64urlEncode(JSON.stringify(claims));
  const signature = crypto.createHmac('sha256', JWT_SECRET)
    .update(`${header}.${encodedPayload}`)
    .digest('base64url');
  return `${header}.${encodedPayload}.${signature}`;
}

function jwtDecode(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET)
      .update(`${parts[0]}.${parts[1]}`)
      .digest('base64url');
    if (expected !== parts[2]) return null;
    return payload;
  } catch { return null; }
}

function requireAuth(req, res) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/Bearer\s+(\S+)/);
  if (!match) { res.status(401).json({ error: 'Authentication required' }); return null; }
  const user = jwtDecode(match[1]);
  if (!user) { res.status(401).json({ error: 'Invalid or expired token' }); return null; }
  return user;
}

function optionalAuth(req) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/Bearer\s+(\S+)/);
  if (!match) return null;
  return jwtDecode(match[1]);
}

function youtubeId(url) {
  if (typeof url !== 'string') return null;
  const m = url.trim().match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/
  );
  return m ? m[1] : null;
}

// ── HEALTH ──
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT NOW()');
    res.json({ status: 'healthy', database: 'connected', timestamp: new Date().toISOString(), version: '1.0.0' });
  } catch (e) {
    res.status(500).json({ status: 'unhealthy', database: 'disconnected', error: e.message });
  }
});

// ── STATS ──
app.get('/api/stats', async (req, res) => {
  try {
    const roles = await pool.query(
      `SELECT role, COUNT(*)::int AS count
       FROM users
       WHERE is_active = TRUE AND is_banned = FALSE
       GROUP BY role`
    );
    const byRole = {};
    roles.rows.forEach((r) => { byRole[r.role] = r.count; });

    const cases = await pool.query(
      `SELECT
         COUNT(*)::int AS open_cases,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_cases
       FROM care_needs`
    );
    const connections = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM platform_fees
       WHERE status IN ('held', 'released')`
    );

    const nurses = byRole.nurse || 0;
    const doctors = byRole.doctor || 0;
    const students = (byRole.nursing_student || 0) + (byRole.medical_student || 0);
    const clinics = byRole.clinic || 0;

    res.json({
      nurses,
      doctors,
      students,
      clinics,
      providers: nurses + doctors + students + clinics,
      open_cases: cases.rows[0].open_cases,
      completed_cases: cases.rows[0].completed_cases,
      connections: connections.rows[0].count,
    });
  } catch (e) {
    console.error('Stats error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── AUTH: REGISTER ──
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email: rawEmail, password, full_name, username: rawUsername, phone, role, governorate, city, bio, hourly_rate, specialties } = req.body;
    const email = (rawEmail || '').toLowerCase().trim();
    let username = (rawUsername || '').toLowerCase().trim().replace(/^@/, '');
    if (!email || !password || !full_name || !role || !username) {
      return res.status(400).json({ error: 'Email, password, full name, username and role are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!/^[a-z0-9._]{3,30}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-30 characters using letters, numbers, dots or underscores.' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 12);
    let result;
    try {
      result = await pool.query(
        `INSERT INTO users (email, password_hash, full_name, username, phone, role, governorate, city, bio, hourly_rate, specialties)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
         RETURNING id, email, full_name, username, role, governorate, created_at`,
        [email, hash, full_name, username, phone || null, role, governorate || null, city || null, bio || null, hourly_rate || null, JSON.stringify(specialties || [])]
      );
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'That username is already taken.' });
      throw e;
    }
    const user = result.rows[0];
    const token = jwtEncode({ userId: user.id, role: user.role });
    res.status(201).json({ token, user });
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── AUTH: LOGIN ──
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email: rawEmail, password } = req.body;
    const email = (rawEmail || '').toLowerCase().trim();
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await pool.query(
      `SELECT id, email, full_name, username, role, password_hash, kyc_status, is_verified, is_active, is_banned, profile_image
       FROM users WHERE email = $1`, [email]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!user.is_active) return res.status(403).json({ error: 'Account deactivated' });
    if (user.is_banned) return res.status(403).json({ error: 'Account suspended' });

    const token = jwtEncode({ userId: user.id, role: user.role });
    res.json({
      token,
      user: {
        id: user.id, email: user.email, full_name: user.full_name, username: user.username,
        role: user.role, kyc_status: user.kyc_status, is_verified: !!user.is_verified,
        profile_image: user.profile_image,
      },
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── AUTH: ME ──
app.get('/api/auth/me', async (req, res) => {
  try {
    const user = requireAuth(req, res);
    if (!user) return;

    const result = await pool.query(
      `SELECT id, email, full_name, username, role, governorate, city, phone,
              bio, hourly_rate, specialties, rating, review_count,
              kyc_status, is_verified, license_number, license_issuer, created_at, profile_image, youtube_url
       FROM users WHERE id = $1`, [user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const profile = result.rows[0];
    profile.specialties = typeof profile.specialties === 'string' ? JSON.parse(profile.specialties) : (profile.specialties || []);
    profile.is_verified = !!profile.is_verified;
    res.json(profile);
  } catch (e) {
    console.error('Me error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── AUTH: PROFILE IMAGE UPLOAD ──
app.post('/api/auth/profile-image', async (req, res) => {
  try {
    const user = requireAuth(req, res);
    if (!user) return;

    const { image } = req.body || {};
    if (!image) return res.status(400).json({ error: 'No image provided' });

    const match = /^data:(image\/(?:png|jpe?g|gif|webp));base64,(.+)$/i.exec(image);
    if (!match) return res.status(400).json({ error: 'Unsupported image format. Use PNG, JPEG, GIF or WebP.' });

    const buf = Buffer.from(match[2], 'base64');
    if (buf.length === 0) return res.status(400).json({ error: 'Empty image' });
    if (buf.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max 5 MB)' });

    const ext = match[1].replace('image/', '').replace('jpeg', 'jpg');
    const filename = user.userId + '-' + Date.now() + '.' + ext;
    const filepath = path.join(UPLOADS_DIR, filename);
    fs.writeFileSync(filepath, buf);

    const prev = await pool.query('SELECT profile_image FROM users WHERE id = $1', [user.userId]);
    if (prev.rows.length && prev.rows[0].profile_image) {
      const oldPath = path.join(UPLOADS_DIR, path.basename(prev.rows[0].profile_image));
      if (path.basename(prev.rows[0].profile_image).startsWith(user.userId + '-') && fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    const publicUrl = '/uploads/' + filename;
    await pool.query('UPDATE users SET profile_image = $1 WHERE id = $2', [publicUrl, user.userId]);
    res.json({ profile_image: publicUrl });
  } catch (e) {
    console.error('Profile image error:', e);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// ── FEED: PROVIDERS ──
app.get('/api/feed/providers', async (req, res) => {
  try {
    const { governorate, role, min_rate, max_rate, search } = req.query;
    let sql = `SELECT id, full_name, username, role, governorate, city, bio, hourly_rate,
                      specialties, rating, review_count, is_verified, license_issuer, created_at, profile_image
               FROM users
               WHERE role IN ('nurse','doctor','nursing_student','medical_student','clinic')
                 AND is_active = TRUE AND is_banned = FALSE`;
    const params = [];
    let i = 1;

    if (governorate) { sql += ` AND governorate = $${i++}`; params.push(governorate); }
    if (role) { sql += ` AND role = $${i++}`; params.push(role); }
    if (min_rate) { sql += ` AND hourly_rate >= $${i++}`; params.push(parseFloat(min_rate)); }
    if (max_rate) { sql += ` AND hourly_rate <= $${i++}`; params.push(parseFloat(max_rate)); }
    if (search) {
      sql += ` AND (full_name ILIKE $${i} OR bio ILIKE $${i} OR specialties::text ILIKE $${i})`;
      params.push(`%${search}%`); i++;
    }

    sql += ` ORDER BY CASE WHEN is_verified THEN 0 ELSE 1 END, rating DESC NULLS LAST, created_at DESC LIMIT 50`;
    const result = await pool.query(sql, params);
    const rows = result.rows.map(r => ({
      ...r,
      specialties: typeof r.specialties === 'string' ? JSON.parse(r.specialties) : (r.specialties || []),
      is_verified: !!r.is_verified,
    }));
    res.json(rows);
  } catch (e) {
    console.error('Providers error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── FEED: NEEDS ──
app.get('/api/feed/needs', async (req, res) => {
  try {
    const { governorate, urgency, status = 'open', search } = req.query;
    let sql = `SELECT cn.*, u.full_name as patient_name, u.username as patient_username, u.governorate as patient_governorate
               FROM care_needs cn JOIN users u ON cn.patient_id = u.id WHERE 1=1`;
    const params = [];
    let i = 1;

    if (governorate) { sql += ` AND cn.governorate = $${i++}`; params.push(governorate); }
    if (urgency) { sql += ` AND cn.urgency = $${i++}`; params.push(urgency); }
    if (status) { sql += ` AND cn.status = $${i++}`; params.push(status); }
    if (search) {
      sql += ` AND (cn.title ILIKE $${i} OR cn.description ILIKE $${i})`;
      params.push(`%${search}%`); i++;
    }

    sql += ` ORDER BY CASE cn.urgency WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, cn.created_at DESC LIMIT 50`;
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (e) {
    console.error('Needs error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── FEED: POST NEED ──
app.post('/api/feed/needs', async (req, res) => {
  try {
    const user = optionalAuth(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const { title, description, governorate, city, budget_amount, budget_period, schedule, urgency, required_role } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const result = await pool.query(
      `INSERT INTO care_needs (patient_id, title, description, governorate, city, budget_amount, budget_period, schedule, urgency, required_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [user.userId, title, description || null, governorate || null, city || null,
       budget_amount || null, budget_period || null, schedule || null, urgency || 'normal', required_role || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    console.error('Post need error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── MESSAGES: CONVERSATIONS ──
app.get('/api/messages/conversations', async (req, res) => {
  try {
    const user = requireAuth(req, res);
    if (!user) return;

    const result = await pool.query(
      `SELECT c.*,
              p.full_name as patient_name, pr.full_name as provider_name,
              p.username as patient_username, pr.username as provider_username,
              p.profile_image as patient_image, pr.profile_image as provider_image,
              cn.title as need_title,
              (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
              (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender_id != $1 AND is_read = FALSE) as unread_count
       FROM conversations c
       JOIN users p ON c.patient_id = p.id
       JOIN users pr ON c.provider_id = pr.id
       LEFT JOIN care_needs cn ON c.need_id = cn.id
       WHERE c.patient_id = $1 OR c.provider_id = $1
       ORDER BY c.last_message_at DESC NULLS LAST`,
      [user.userId]
    );
    res.json(result.rows.map(r => ({ ...r, is_chat_unlocked: !!r.is_chat_unlocked })));
  } catch (e) {
    console.error('Conversations error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── MESSAGES: GET / POST by conversation ID ──
app.get('/api/messages/:id', async (req, res) => {
  try {
    const user = requireAuth(req, res);
    if (!user) return;
    const { id } = req.params;

    const conv = await pool.query(
      'SELECT * FROM conversations WHERE id = $1 AND (patient_id = $2 OR provider_id = $2)',
      [id, user.userId]
    );
    if (conv.rows.length === 0) return res.status(403).json({ error: 'Access denied' });
    if (!conv.rows[0].is_chat_unlocked) {
      return res.status(403).json({ error: 'Chat locked', message: 'Complete a paid video consultation first to unlock messaging.' });
    }

    const messages = await pool.query(
      `SELECT m.*, u.full_name as sender_name, u.role as sender_role
       FROM messages m JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = $1 ORDER BY m.created_at ASC`, [id]
    );
    await pool.query('UPDATE messages SET is_read = TRUE WHERE conversation_id = $1 AND sender_id != $2', [id, user.userId]);
    res.json(messages.rows);
  } catch (e) {
    console.error('Get messages error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/messages/:id', async (req, res) => {
  try {
    const user = requireAuth(req, res);
    if (!user) return;
    const { id } = req.params;
    const { content, message_type = 'text' } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });

    const conv = await pool.query(
      'SELECT is_chat_unlocked, patient_id, provider_id FROM conversations WHERE id = $1',
      [id]
    );
    if (conv.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });
    if (conv.rows[0].patient_id !== user.userId && conv.rows[0].provider_id !== user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!conv.rows[0].is_chat_unlocked) {
      return res.status(403).json({ error: 'Chat locked', message: 'Complete a paid video consultation first.' });
    }

    const result = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, content, message_type)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, user.userId, content, message_type]
    );
    await pool.query('UPDATE conversations SET last_message_at = NOW() WHERE id = $1', [id]);
    res.status(201).json(result.rows[0]);
  } catch (e) {
    console.error('Send message error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── FEES ──
app.post('/api/fees/initiate', async (req, res) => {
  const client = await pool.connect();
  try {
    const user = requireAuth(req, res);
    if (!user) return;
    const { provider_id, need_id, amount_tnd = 20 } = req.body;

    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id, status, amount_tnd, platform_cut, provider_amount FROM platform_fees
       WHERE patient_id = $1 AND provider_id = $2 AND fee_type = 'first_connection'`,
      [user.userId, provider_id]
    );
    if (existing.rows.length > 0) {
      const prev = existing.rows[0];
      if (prev.status === 'held' || prev.status === 'released') {
        await client.query(
          'UPDATE conversations SET is_chat_unlocked = TRUE WHERE patient_id = $1 AND provider_id = $2',
          [user.userId, provider_id]
        );
        await client.query('COMMIT');
        return res.json({ already_paid: true, fee_id: prev.id, message: 'Connection already established. Chat is unlocked.' });
      }
      if (prev.status === 'pending') {
        await client.query('COMMIT');
        const prevAmount = parseFloat(prev.amount_tnd) || 0;
        const prevCut = parseFloat(prev.platform_cut) || 0;
        return res.status(409).json({
          already_paid: false, pending: true, fee_id: prev.id,
          amount_tnd: prevAmount,
          platform_cut: prevCut,
          provider_amount: parseFloat(prev.provider_amount),
          platform_fee_percent: Math.round((prevCut / Math.max(prevAmount, 1)) * 100),
          message: 'A payment for this connection is already pending. Complete it to unlock chat.',
        });
      }
    }

    const amount = Math.max(parseFloat(amount_tnd), 20);
    const platformCut = 0;
    const providerAmount = Math.round(amount * 100) / 100;

    const fee = await client.query(
      `INSERT INTO platform_fees (patient_id, provider_id, need_id, fee_type, amount_tnd, platform_cut, provider_amount, status)
       VALUES ($1, $2, $3, 'first_connection', $4, $5, $6, 'pending') RETURNING *`,
      [user.userId, provider_id, need_id || null, amount, platformCut, providerAmount]
    );
    await client.query('COMMIT');
    res.status(201).json({
      fee_id: fee.rows[0].id, amount_tnd: amount, platform_cut: platformCut,
      provider_amount: providerAmount, platform_fee_percent: 0,
      message: 'Payment is transferred directly to the provider. Careless does not hold funds or assume responsibility for the care provided.',
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Fees initiate error:', e);
    res.status(500).json({ error: 'Failed to initiate connection' });
  } finally { client.release(); }
});

app.post('/api/fees/confirm', async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;

  const client = await pool.connect();
  try {
    const { fee_id, payment_reference, payment_status } = req.body;
    if (!fee_id) return res.status(400).json({ error: 'fee_id is required' });

    const fee = await client.query(
      'SELECT patient_id, provider_id, need_id FROM platform_fees WHERE id = $1',
      [fee_id]
    );
    if (fee.rows.length === 0) return res.status(404).json({ error: 'Fee not found' });
    if (fee.rows[0].patient_id !== user.userId) {
      return res.status(403).json({ error: 'Not authorized to confirm this payment' });
    }

    const success = payment_status === 'success';
    const status = success ? 'held' : 'failed';

    await client.query('BEGIN');
    await client.query(
      'UPDATE platform_fees SET status = $1, payment_reference = $2, updated_at = NOW() WHERE id = $3',
      [status, payment_reference || null, fee_id]
    );
    if (success) {
      const pId = fee.rows[0].patient_id;
      const vId = fee.rows[0].provider_id;
      const nId = fee.rows[0].need_id;
      const created = await client.query(
        `INSERT INTO conversations (patient_id, provider_id, need_id, is_chat_unlocked, first_transaction_id)
         SELECT $1, $2, $3, TRUE, $4
         WHERE NOT EXISTS (
           SELECT 1 FROM conversations
           WHERE patient_id = $1 AND provider_id = $2 AND need_id IS NOT DISTINCT FROM $3
         ) RETURNING id`,
        [pId, vId, nId, fee_id]
      );
      if (created.rows.length === 0) {
        await client.query(
          `UPDATE conversations SET is_chat_unlocked = TRUE, first_transaction_id = $1
           WHERE patient_id = $2 AND provider_id = $3 AND need_id IS NOT DISTINCT FROM $4`,
          [fee_id, pId, vId, nId]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ success });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Payment confirmation error:', e);
    res.status(500).json({ error: 'Payment confirmation failed' });
  } finally { client.release(); }
});

app.post('/api/fees/release', async (req, res) => {
  try {
    const user = requireAuth(req, res);
    if (!user) return;
    const { fee_id } = req.body;

    const fee = await pool.query(
      'SELECT * FROM platform_fees WHERE id = $1 AND provider_id = $2',
      [fee_id, user.userId]
    );
    if (fee.rows.length === 0) return res.status(403).json({ error: 'Not authorized' });

    await pool.query("UPDATE platform_fees SET status = 'released', released_at = NOW() WHERE id = $1", [fee_id]);
    res.json({ message: 'Payment released to provider' });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/fees/:feeId', async (req, res) => {
  try {
    const user = requireAuth(req, res);
    if (!user) return;

    const fee = await pool.query(
      `SELECT f.*, p.full_name as patient_name, pr.full_name as provider_name
       FROM platform_fees f JOIN users p ON f.patient_id = p.id JOIN users pr ON f.provider_id = pr.id
       WHERE f.id = $1 AND (f.patient_id = $2 OR f.provider_id = $2)`,
      [req.params.feeId, user.userId]
    );
    if (fee.rows.length === 0) return res.status(404).json({ error: 'Fee not found' });
    res.json(fee.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DOCTORS WAITLIST ──
app.post('/api/doctors/waitlist', async (req, res) => {
  try {
    const { email: rawEmail, role_type } = req.body;
    const email = (rawEmail || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Valid email is required' });

    const result = await pool.query(
      'INSERT INTO doctor_waitlist (email, role_type) VALUES ($1, $2) RETURNING *',
      [email, role_type || null]
    );
    res.status(201).json({ message: 'Added to doctor waitlist', entry: result.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already on waitlist' });
    res.status(500).json({ error: 'Failed to join waitlist' });
  }
});

app.get('/api/doctors/waitlist/count', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) as count FROM doctor_waitlist');
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PROFILE: UPDATE ──
app.patch('/api/auth/profile', async (req, res) => {
  try {
    const user = requireAuth(req, res);
    if (!user) return;

    const { username: rawUsername, phone, governorate, city, bio, hourly_rate, youtube_url: rawYoutube } = req.body;
    const updates = [];
    const params = [];
    let i = 1;

    if (rawUsername !== undefined) {
      const username = String(rawUsername).toLowerCase().trim().replace(/^@/, '');
      if (!/^[a-z0-9._]{3,30}$/.test(username)) {
        return res.status(400).json({ error: 'Username must be 3-30 characters using letters, numbers, dots or underscores.' });
      }
      updates.push(`username = $${i++}`);
      params.push(username);
    }
    if (phone !== undefined) { updates.push(`phone = $${i++}`); params.push(phone ? String(phone).trim() : null); }
    if (governorate !== undefined) { updates.push(`governorate = $${i++}`); params.push(governorate ? String(governorate).trim() : null); }
    if (city !== undefined) { updates.push(`city = $${i++}`); params.push(city ? String(city).trim() : null); }
    if (bio !== undefined) { updates.push(`bio = $${i++}`); params.push(bio ? String(bio).slice(0, 2000) : null); }
    if (hourly_rate !== undefined) {
      const rate = hourly_rate === '' || hourly_rate === null ? null : Number(hourly_rate);
      if (rate !== null && (!Number.isFinite(rate) || rate < 0)) return res.status(400).json({ error: 'Invalid hourly rate' });
      updates.push(`hourly_rate = $${i++}`);
      params.push(rate);
    }
    if (rawYoutube !== undefined) {
      const trimmed = typeof rawYoutube === 'string' ? rawYoutube.trim() : '';
      if (trimmed && !youtubeId(trimmed)) {
        return res.status(400).json({ error: 'Please provide a valid YouTube presentation link.' });
      }
      updates.push(`youtube_url = $${i++}`);
      params.push(trimmed || null);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    params.push(user.userId);
    let result;
    try {
      result = await pool.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, username, phone, governorate, city, bio, hourly_rate, profile_image, youtube_url`,
        params
      );
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'That username is already taken.' });
      throw e;
    }
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ ...result.rows[0], hourly_rate: result.rows[0].hourly_rate !== null ? Number(result.rows[0].hourly_rate) : null });
  } catch (e) {
    console.error('Profile update error:', e);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ── PUBLIC PROFILE ──
app.get('/api/users/:username', async (req, res) => {
  try {
    const username = decodeURIComponent(req.params.username).toLowerCase().replace(/^@/, '');
    const me = optionalAuth(req);

    const result = await pool.query(
      `SELECT id, username, full_name, role, governorate, city, bio, hourly_rate,
              specialties, rating, review_count, is_verified, license_issuer, profile_image, created_at, phone, youtube_url
       FROM users
       WHERE username = $1 AND is_active = TRUE AND is_banned = FALSE`, [username]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const u = result.rows[0];
    u.specialties = typeof u.specialties === 'string' ? JSON.parse(u.specialties) : (u.specialties || []);
    u.is_verified = !!u.is_verified;
    u.hourly_rate = u.hourly_rate !== null ? Number(u.hourly_rate) : null;

    let isFollowing = false;
    if (me) {
      const ff = await pool.query('SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2', [me.userId, u.id]);
      isFollowing = ff.rows.length > 0;
    }
    u.is_following = isFollowing;

    const isOwner = me && me.userId === u.id;
    if (!isOwner && !isFollowing) {
      u.phone = null;
      u.phone_locked = true;
    }

    const counts = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM follows WHERE following_id = $1)::int AS followers,
         (SELECT COUNT(*) FROM follows WHERE follower_id = $1)::int AS following,
         (SELECT COUNT(*) FROM reels WHERE user_id = $1)::int AS reels_count`,
      [u.id]
    );
    u.follower_count = counts.rows[0].followers;
    u.following_count = counts.rows[0].following;
    u.reels_count = counts.rows[0].reels_count;

    res.json(u);
  } catch (e) {
    console.error('Public profile error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── FOLLOW ──
app.post('/api/users/:id/follow', async (req, res) => {
  try {
    const user = requireAuth(req, res);
    if (!user) return;
    const targetId = req.params.id;
    if (targetId === user.userId) return res.status(400).json({ error: 'You cannot follow yourself' });

    try {
      await pool.query(
        'INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [user.userId, targetId]
      );
    } catch (e) {
      if (e.code === '23503') return res.status(404).json({ error: 'User not found' });
      throw e;
    }
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM follows WHERE following_id = $1', [targetId]);
    res.json({ following: true, follower_count: count.rows[0].n });
  } catch (e) {
    console.error('Follow error:', e);
    res.status(500).json({ error: 'Failed to follow user' });
  }
});

app.delete('/api/users/:id/follow', async (req, res) => {
  try {
    const user = requireAuth(req, res);
    if (!user) return;
    await pool.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [user.userId, req.params.id]);
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM follows WHERE following_id = $1', [req.params.id]);
    res.json({ following: false, follower_count: count.rows[0].n });
  } catch (e) {
    console.error('Unfollow error:', e);
    res.status(500).json({ error: 'Failed to unfollow user' });
  }
});

// ── FOLLOWERS / FOLLOWING LISTS ──
app.get('/api/users/:id/followers', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.full_name, u.role, u.governorate, u.city, u.profile_image
       FROM follows f JOIN users u ON u.id = f.follower_id
       WHERE f.following_id = $1 AND u.is_active = TRUE AND u.is_banned = FALSE
       ORDER BY f.created_at DESC LIMIT 50`, [req.params.id]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/users/:id/following', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.full_name, u.role, u.governorate, u.city, u.profile_image
       FROM follows f JOIN users u ON u.id = f.following_id
       WHERE f.follower_id = $1 AND u.is_active = TRUE AND u.is_banned = FALSE
       ORDER BY f.created_at DESC LIMIT 50`, [req.params.id]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── SEARCH USERS ──
app.get('/api/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const like = '%' + q + '%';
    const prefix = q + '%';
    const me = optionalAuth(req);

    const result = await pool.query(
      `SELECT id, username, full_name, role, governorate, city, profile_image, is_verified,
              (SELECT COUNT(*) FROM follows f WHERE f.following_id = users.id)::int AS follower_count
       FROM users
       WHERE is_active = TRUE AND is_banned = FALSE
         AND (full_name ILIKE $1 OR username ILIKE $1 OR phone ILIKE $1)
       ORDER BY CASE WHEN full_name ILIKE $2 THEN 0 WHEN username ILIKE $2 THEN 1 ELSE 2 END,
                follower_count DESC
       LIMIT 30`, [like, prefix]
    );
    const rows = result.rows;
    rows.forEach((r) => { r.is_verified = !!r.is_verified; r.is_following = false; });

    if (me && rows.length) {
      const ids = rows.map((r) => r.id);
      const ff = await pool.query('SELECT following_id FROM follows WHERE follower_id = $1 AND following_id = ANY($2)', [me.userId, ids]);
      const set = new Set(ff.rows.map((r) => r.following_id));
      rows.forEach((r) => { r.is_following = set.has(r.id); });
    }
    res.json(rows);
  } catch (e) {
    console.error('Search error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── API 404 ──
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ── SPA FALLBACK: serve index.html for any other GET route ──
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── START ──
app.listen(PORT, () => {
  console.log(`Careless API running on http://localhost:${PORT}`);
});
