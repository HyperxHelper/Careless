const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');

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
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

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

// ── HEALTH ──
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT NOW()');
    res.json({ status: 'healthy', database: 'connected', timestamp: new Date().toISOString(), version: '1.0.0' });
  } catch (e) {
    res.status(500).json({ status: 'unhealthy', database: 'disconnected', error: e.message });
  }
});

// ── AUTH: REGISTER ──
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email: rawEmail, password, full_name, phone, role, governorate, city, bio, hourly_rate, specialties } = req.body;
    const email = (rawEmail || '').toLowerCase().trim();
    if (!email || !password || !full_name || !role) {
      return res.status(400).json({ error: 'Email, password, full name and role are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, phone, role, governorate, city, bio, hourly_rate, specialties)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       RETURNING id, email, full_name, role, governorate, created_at`,
      [email, hash, full_name, phone || null, role, governorate || null, city || null, bio || null, hourly_rate || null, JSON.stringify(specialties || [])]
    );
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
      `SELECT id, email, full_name, role, password_hash, kyc_status, is_verified, is_active, is_banned
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
        id: user.id, email: user.email, full_name: user.full_name,
        role: user.role, kyc_status: user.kyc_status, is_verified: !!user.is_verified,
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
      `SELECT id, email, full_name, role, governorate, city, phone,
              bio, hourly_rate, specialties, rating, review_count,
              kyc_status, is_verified, license_number, license_issuer, created_at
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

// ── FEED: PROVIDERS ──
app.get('/api/feed/providers', async (req, res) => {
  try {
    const { governorate, role, min_rate, max_rate, search } = req.query;
    let sql = `SELECT id, full_name, role, governorate, city, bio, hourly_rate,
                      specialties, rating, review_count, is_verified, license_issuer, created_at
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
    let sql = `SELECT cn.*, u.full_name as patient_name, u.governorate as patient_governorate
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
              cn.title as need_title,
              (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
              (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
              (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender_id != $1 AND is_read = FALSE) as unread_count
       FROM conversations c
       JOIN users p ON c.patient_id = p.id
       JOIN users pr ON c.provider_id = pr.id
       LEFT JOIN care_needs cn ON c.need_id = cn.id
       WHERE c.patient_id = $1 OR c.provider_id = $1
       ORDER BY last_message_at DESC NULLS LAST`,
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
        return res.status(409).json({
          already_paid: false, pending: true, fee_id: prev.id,
          amount_tnd: parseFloat(prev.amount_tnd),
          platform_cut: parseFloat(prev.platform_cut),
          provider_amount: parseFloat(prev.provider_amount),
          platform_fee_percent: 15,
          message: 'A payment for this connection is already pending. Complete it to unlock chat.',
        });
      }
    }

    const amount = Math.max(parseFloat(amount_tnd), 20);
    const platformCut = Math.round(amount * 15) / 100;
    const providerAmount = Math.round((amount - platformCut) * 100) / 100;

    const fee = await client.query(
      `INSERT INTO platform_fees (patient_id, provider_id, need_id, fee_type, amount_tnd, platform_cut, provider_amount, status)
       VALUES ($1, $2, $3, 'first_connection', $4, $5, $6, 'pending') RETURNING *`,
      [user.userId, provider_id, need_id || null, amount, platformCut, providerAmount]
    );
    await client.query('COMMIT');
    res.status(201).json({
      fee_id: fee.rows[0].id, amount_tnd: amount, platform_cut: platformCut,
      provider_amount: providerAmount, platform_fee_percent: 15,
      message: 'Please complete payment to unlock chat and video consultation',
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
      'SELECT patient_id, provider_id FROM platform_fees WHERE id = $1',
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
      await client.query(
        'UPDATE conversations SET is_chat_unlocked = TRUE, first_transaction_id = $1 WHERE patient_id = $2 AND provider_id = $3',
        [fee_id, fee.rows[0].patient_id, fee.rows[0].provider_id]
      );
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

// ── START ──
app.listen(PORT, () => {
  console.log(`Careless API running on http://localhost:${PORT}`);
});
