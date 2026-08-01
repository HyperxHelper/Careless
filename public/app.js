'use strict';

const API_BASE = '/api';
const TOKEN_KEY = 'careless_token';
const USER_KEY = 'careless_user';

const GOVERNORATES = [
  'Tunis', 'Ariana', 'Ben Arous', 'Manouba', 'Nabeul', 'Zaghouan', 'Bizerte',
  'Beja', 'Jendouba', 'Kef', 'Siliana', 'Sousse', 'Monastir', 'Mahdia',
  'Sfax', 'Kairouan', 'Kasserine', 'Sidi Bouzid', 'Gabes', 'Medenine',
  'Tataouine', 'Gafsa', 'Tozeur', 'Kebili',
];

const ROLE_LABELS = {
  patient: 'Patient',
  nurse: 'Nurse',
  doctor: 'Doctor',
  nursing_student: 'Nursing Student',
  medical_student: 'Medical Student',
  clinic: 'Clinic',
  admin: 'Admin',
};

const state = {
  view: 'home',
  user: null,
  providers: [],
  needs: [],
  conversations: [],
  activeConv: null,
  profile: null,
  feedTab: 'providers',
  filters: { search: '', governorate: '', role: '' },
  authMode: 'login',
  pendingPayment: null,
  toastTimer: null,
  waitlistCount: null,
};

const I = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  feed: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  post: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  messages: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  doctors: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>',
};

function icon(id, cls) {
  return `<svg class="${cls || 'nav-icon'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[id] || ''}</svg>`;
}

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2).replace(/\.00$/, '') : '--';
}

function roleLabel(role) {
  return ROLE_LABELS[role] || 'Provider';
}

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 604800) return Math.floor(s / 86400) + 'd';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function toast(message, type) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast show' + (type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : '');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

async function api(endpoint, options) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(API_BASE + endpoint, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(options && options.headers ? options.headers : {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const feedAPI = {
  providers: (p) => {
    const qs = new URLSearchParams();
    if (p.search) qs.set('search', p.search);
    if (p.governorate) qs.set('governorate', p.governorate);
    if (p.role) qs.set('role', p.role);
    const s = qs.toString();
    return api('/feed/providers' + (s ? '?' + s : ''));
  },
  needs: (p) => {
    const qs = new URLSearchParams();
    if (p.search) qs.set('search', p.search);
    if (p.governorate) qs.set('governorate', p.governorate);
    const s = qs.toString();
    return api('/feed/needs' + (s ? '?' + s : ''));
  },
};

/* ═══════════ APP SHELL ═══════════ */

function renderApp() {
  const app = document.getElementById('app');
  const user = state.user;
  const v = state.view;

  const navItems = [
    ['home', 'Home'], ['feed', 'Care Feed'], ['post', 'Post a Need'],
    ['messages', 'Messages'], ['doctors', 'Doctors'],
  ];
  if (user) navItems.push(['profile', 'Profile']);

  const topNav = navItems.map(([id, label]) =>
    `<button class="nav-link${v === id ? ' active' : ''}" data-nav="${id}">${icon(id)}<span>${label}</span></button>`
  ).join('');

  const authZone = user
    ? `<span class="user-chip" title="${esc(user.full_name)}"><span class="avatar">${esc(initials(user.full_name))}</span><span class="user-name">${esc(user.full_name.split(' ')[0])}</span></span>
       <button class="btn btn-ghost btn-sm" data-action="logout">Sign Out</button>`
    : `<button class="btn btn-ghost btn-sm" data-action="login">Sign In</button>
       <button class="btn btn-primary btn-sm" data-action="signup">Sign Up</button>`;

  const bottomNav = navItems.slice(0, 5).map(([id, label]) =>
    `<button class="nav-item${v === id ? ' active' : ''}" data-nav="${id}">${icon(id)}<span>${label === 'Care Feed' ? 'Feed' : label === 'Post a Need' ? 'Post' : label}</span>${id === 'doctors' ? '<span class="nav-item-badge">Soon</span>' : ''}</button>`
  ).join('');

  app.innerHTML = `
    <header class="site-header">
      <div class="container header-inner">
        <button class="brand" data-nav="home">
          <span class="brand-mark">C</span>
          <span class="brand-text">
            <span class="brand-title">Careless</span>
            <span class="brand-sub">Tunisia Healthcare Network</span>
          </span>
        </button>
        <nav class="topnav" aria-label="Primary">${topNav}</nav>
        <div class="auth-zone">${authZone}</div>
      </div>
    </header>

    <main class="main">
      <div class="container">${renderView()}</div>
    </main>

    <footer class="page-footer">
      <div class="container footer-grid">
        <div class="footer-brand">
          <div class="brand" style="pointer-events:none;">
            <span class="brand-mark">C</span>
            <span class="brand-text"><span class="brand-title">Careless</span><span class="brand-sub" style="color:rgba(255,255,255,.6);">Tunisia Healthcare Network</span></span>
          </div>
          <p>An open-source marketplace connecting patients and families with independent nurses, doctors and caregivers across Tunisia. Transparent pricing in TND. Video-first trust.</p>
        </div>
        <div>
          <h4>Platform</h4>
          ${navItems.map(([id, label]) => `<button class="footer-link" data-nav="${id}">${esc(label)}</button>`).join('')}
        </div>
        <div>
          <h4>Safety</h4>
          <span class="footer-link-static">Emergency: SAMU 190</span>
          <span class="footer-link-static">Providers are independent contractors</span>
          <span class="footer-link-static">Video-first verification</span>
        </div>
      </div>
      <div class="container footer-bottom">Careless &mdash; Open-source. Independent. Built for Tunisia. Not a medical provider.</div>
    </footer>

    <nav class="bottom-nav" aria-label="Mobile">${bottomNav}</nav>
  `;

  bindShell();
  bindView();
}

function bindShell() {
  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', () => go(el.dataset.nav));
  });
  document.querySelectorAll('[data-action]').forEach((el) => {
    el.addEventListener('click', () => {
      const a = el.dataset.action;
      if (a === 'login') openAuthModal('login');
      else if (a === 'signup') openAuthModal('signup');
      else if (a === 'logout') logout();
    });
  });
}

function go(view) {
  if ((view === 'messages' || view === 'profile') && !state.user) {
    openAuthModal('login');
    toast('Please sign in to continue.');
    return;
  }
  state.view = view;
  window.scrollTo({ top: 0 });
  renderApp();
}

/* ═══════════ VIEWS ═══════════ */

function renderView() {
  switch (state.view) {
    case 'feed': return viewFeed();
    case 'post': return viewPost();
    case 'messages': return viewMessages();
    case 'doctors': return viewDoctors();
    case 'profile': return viewProfile();
    default: return viewHome();
  }
}

/* ── HOME ── */
function viewHome() {
  return `
    <section class="view">
      <div class="hero">
        <span class="hero-badge">&#10003; Trusted open healthcare network</span>
        <h1 class="hero-title">Healthcare that <em>stays</em> in Tunisia</h1>
        <p class="hero-sub">Connect with verified nurses, doctors and caregivers across all 24 governorates. Clear TND pricing, no hidden fees, and a secure video-first consultation before any physical visit.</p>
        <div class="hero-actions">
          <button class="btn btn-primary btn-lg" data-role="patient">I Need Care</button>
          <button class="btn btn-outline btn-lg" data-role="provider">I'm a Healthcare Provider</button>
        </div>
      </div>

      <div class="trust-strip">
        <div class="trust-item"><strong>24</strong><span>Governorates covered</span></div>
        <div class="trust-item"><strong>15%</strong><span>One-time platform fee</span></div>
        <div class="trust-item"><strong>Video-first</strong><span>Safety gate</span></div>
        <div class="trust-item"><strong>TND</strong><span>Transparent pricing</span></div>
      </div>

      <section class="section">
        <div class="section-head"><h2 class="section-title">How Careless works</h2><p class="section-sub">From first contact to trusted care relationship.</p></div>
        <div class="grid-3">
          <div class="step"><div class="step-num">01</div><h4 class="step-title">Create your profile</h4><p class="step-desc">Register as a patient or healthcare provider. Students in S5+ can join with academic credentials.</p></div>
          <div class="step"><div class="step-num">02</div><h4 class="step-title">Complete KYC verification</h4><p class="step-desc">Upload your CIN, nursing license, or medical diploma. Verification protects both parties.</p></div>
          <div class="step"><div class="step-num">03</div><h4 class="step-title">Connect &amp; consult</h4><p class="step-desc">Start with a paid video consultation, then message freely and arrange home visits.</p></div>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2 class="section-title">Why Careless exists</h2></div>
        <div class="grid-4">
          <div class="feature">
            <div class="feature-icon-wrap" style="background:#ecfdf5;color:#059669;">${iconSafe('shield')}</div>
            <h4 class="feature-title">Keep talent in Tunisia</h4>
            <p class="feature-desc">Professionals deserve local opportunities, not only paths abroad.</p>
          </div>
          <div class="feature">
            <div class="feature-icon-wrap" style="background:#fef3c7;color:#d97706;">${iconSafe('cash')}</div>
            <h4 class="feature-title">Fair pricing in TND</h4>
            <p class="feature-desc">Providers set their own rates. Patients see costs upfront.</p>
          </div>
          <div class="feature">
            <div class="feature-icon-wrap" style="background:#eff6ff;color:#2563eb;">${iconSafe('clock')}</div>
            <h4 class="feature-title">24/7 availability</h4>
            <p class="feature-desc">Care requests and availability across every governorate.</p>
          </div>
          <div class="feature">
            <div class="feature-icon-wrap" style="background:#fdf2f8;color:#db2777;">${iconSafe('video')}</div>
            <h4 class="feature-title">Video-first verification</h4>
            <p class="feature-desc">Every relationship starts with a secure consultation.</p>
          </div>
        </div>
      </section>

      <div class="banner">
        <div class="banner-icon">${iconSafe('graduation')}</div>
        <div>
          <h3>For S5+ Nursing Students</h3>
          <p>Admitted to your S5 semester and working toward graduation? Join with your academic credentials, gain real-world experience and earn while you learn.</p>
        </div>
      </div>

      <div class="safety-note">
        <div class="safety-icon">${iconSafe('alert')}</div>
        <div>
          <strong class="safety-title">Safety Notice</strong>
          <p class="safety-text">Careless is a marketplace connecting patients with independent providers. We do not employ or supervise providers, and we do not verify medical competence. For medical emergencies, call SAMU at <strong>190</strong> immediately.</p>
        </div>
      </div>
    </section>
  `;
}

const EXTRA_ICONS = {
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  cash: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  graduation: '<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 1.66 4 3 9 3s9-1.34 9-3v-5"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  heart: '<path d="M4.318 6.318a4.5 4.5 0 0 0 0 6.364L12 20.364l7.682-7.682a4.5 4.5 0 0 0-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 0 0-6.364 0z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
};

function iconSafe(name) {
  return `<svg class="feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${EXTRA_ICONS[name] || ''}</svg>`;
}

/* ── FEED ── */
function viewFeed() {
  const isProviders = state.feedTab === 'providers';
  return `
    <section class="view">
      <div class="view-head">
        <h1>Care Feed</h1>
        <p>Browse verified providers or posted care needs across Tunisia.</p>
      </div>
      <div class="segment" role="tablist">
        <button class="segment-btn${isProviders ? ' active' : ''}" data-feed="providers">Available Providers</button>
        <button class="segment-btn${!isProviders ? ' active' : ''}" data-feed="needs">Care Needs</button>
      </div>
      <div class="toolbar">
        <input class="form-input search" id="feed-search" type="search" placeholder="${isProviders ? 'Search by name, specialty, bio...' : 'Search care needs...'}" value="${esc(state.filters.search)}" />
        <select class="form-select" id="feed-governorate">
          <option value="">All governorates</option>
          ${GOVERNORATES.map((g) => `<option value="${g}"${state.filters.governorate === g ? ' selected' : ''}>${g}</option>`).join('')}
        </select>
        ${isProviders ? `
        <select class="form-select" id="feed-role">
          <option value="">All roles</option>
          ${['nurse', 'doctor', 'nursing_student', 'medical_student', 'clinic'].map((r) => `<option value="${r}"${state.filters.role === r ? ' selected' : ''}>${roleLabel(r)}</option>`).join('')}
        </select>` : ''}
        <button class="btn btn-ghost" id="feed-clear" type="button">Clear</button>
      </div>
      <div class="grid-cards" id="feed-grid">
        ${skeletonCards(3)}
      </div>
    </section>
  `;
}

function skeletonCards(n) {
  return Array.from({ length: n }, () => '<div class="card skeleton-card skeleton"></div>').join('');
}

async function loadFeed() {
  const grid = document.getElementById('feed-grid');
  if (!grid) return;
  grid.innerHTML = skeletonCards(3);
  try {
    if (state.feedTab === 'providers') {
      const providers = await feedAPI.providers(state.filters);
      state.providers = providers;
      grid.innerHTML = providers.length
        ? providers.map(providerCard).join('')
        : emptyState('No providers found', 'Try adjusting your filters, or check back soon.', 'feed');
    } else {
      const needs = await feedAPI.needs(state.filters);
      state.needs = needs;
      grid.innerHTML = needs.length
        ? needs.map(needCard).join('')
        : emptyState('No care needs found', 'Try adjusting your filters or post a new care need.', 'post');
    }
  } catch (e) {
    grid.innerHTML = emptyState('Unable to load the care feed', e.message || 'Please try again.', null);
  }
}

function emptyState(title, sub, ctaView) {
  return `
    <div class="empty">
      <div class="empty-icon">&#128137;</div>
      <h3>${esc(title)}</h3>
      <p>${esc(sub)}</p>
      ${ctaView ? `<button class="btn btn-primary" data-empty-cta="${ctaView}">Go there</button>` : ''}
    </div>
  `;
}

function providerCard(p) {
  const verified = p.is_verified
    ? '<span class="badge badge-verified">&#10003; Verified</span>'
    : '<span class="badge badge-pending">Unverified</span>';
  const rating = p.rating && Number(p.rating) > 0
    ? `<span class="badge badge-rating">&#9733; ${Number(p.rating).toFixed(1)}${Number(p.review_count) ? ' (' + p.review_count + ')' : ''}</span>`
    : '<span class="badge badge-new">New</span>';
  const role = esc(roleLabel(p.role));
  const gov = p.governorate ? esc(p.governorate) : 'Tunisia';
  const specs = Array.isArray(p.specialties) && p.specialties.length
    ? esc(p.specialties.join(', ')) : 'General care';
  const rate = p.hourly_rate
    ? `<div class="rate"><span class="rate-amount">${esc(money(p.hourly_rate))} TND</span><span class="rate-period">/ hour</span></div>`
    : '<div class="rate"><span class="rate-none">Rate on request</span></div>';
  return `
    <article class="card provider-card">
      <div class="card-head">
        <div class="provider-avatar">${esc(initials(p.full_name))}</div>
        <div>
          <h3 class="card-title">${esc(p.full_name)}</h3>
          <p class="card-meta">${role} &middot; ${gov} &middot; ${specs}</p>
        </div>
      </div>
      <div class="badges">${verified}${rating}</div>
      ${rate}
      <p class="bio">${esc(p.bio || 'No bio available yet.')}</p>
      <div class="card-actions">
        <button class="btn btn-secondary" data-message-provider="${esc(p.id)}">Message</button>
        <button class="btn btn-primary" data-video-provider="${esc(p.id)}">Book Video Consult</button>
      </div>
    </article>
  `;
}

function needCard(n) {
  const urgent = n.urgency === 'urgent'
    ? '<span class="badge badge-urgent">Urgent</span>'
    : '<span class="badge badge-normal">Open</span>';
  const budget = n.budget_amount
    ? `<span class="badge badge-budget">${esc(money(n.budget_amount))} TND${n.budget_period ? ' / ' + esc(n.budget_period) : ''}</span>`
    : '';
  const schedule = n.schedule ? `<span class="badge badge-schedule">${esc(n.schedule)}</span>` : '';
  const loc = n.governorate ? `<span class="badge badge-location">${esc(n.governorate)}</span>` : '';
  const roleReq = n.required_role ? `<span class="badge badge-role">Needs: ${esc(roleLabel(n.required_role))}</span>` : '';
  return `
    <article class="card need-card">
      <div class="card-head">
        <div>
          <h3 class="card-title">${esc(n.title)}</h3>
          <p class="card-meta">Patient &middot; ${esc(n.governorate || 'Tunisia')} &middot; ${esc(timeAgo(n.created_at))}</p>
        </div>
        ${urgent}
      </div>
      <div class="badges">${loc}${budget}${schedule}${roleReq}</div>
      <p class="bio">${esc(n.description || 'No description provided.')}</p>
      <div class="card-actions">
        <button class="btn btn-secondary" data-apply-need="${esc(n.id)}">Apply</button>
      </div>
    </article>
  `;
}

/* ── POST NEED ── */
function viewPost() {
  const roleOptions = ['nurse', 'doctor', 'nursing_student', 'medical_student', 'clinic']
    .map((r) => `<option value="${r}">${roleLabel(r)}</option>`).join('');
  return `
    <section class="view">
      <div class="view-head">
        <h1>Post a Care Need</h1>
        <p>Describe the care required. Providers in your governorate will be notified.</p>
      </div>
      <form class="form-card" id="post-form" novalidate>
        <div class="form-field">
          <label class="form-label" for="f-title">Care need title</label>
          <input class="form-input" id="f-title" name="title" type="text" placeholder="e.g. Daily insulin injections at home" required />
        </div>
        <div class="grid-2">
          <div class="form-field">
            <label class="form-label" for="f-governorate">Governorate</label>
            <select class="form-select" id="f-governorate" name="governorate" required>
              <option value="">Select governorate</option>
              ${GOVERNORATES.map((g) => `<option value="${g}">${g}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label class="form-label" for="f-city">City</label>
            <input class="form-input" id="f-city" name="city" type="text" placeholder="e.g. La Marsa" />
          </div>
        </div>
        <div class="grid-2">
          <div class="form-field">
            <label class="form-label" for="f-budget">Budget (TND)</label>
            <input class="form-input" id="f-budget" name="budget_amount" type="number" min="0" step="1" placeholder="e.g. 50" />
          </div>
          <div class="form-field">
            <label class="form-label" for="f-period">Budget period</label>
            <select class="form-select" id="f-period" name="budget_period">
              <option value="">Per hour</option>
              <option value="visit">Per visit</option>
              <option value="week">Per week</option>
              <option value="month">Per month</option>
            </select>
          </div>
        </div>
        <div class="grid-2">
          <div class="form-field">
            <label class="form-label" for="f-urgency">Urgency</label>
            <select class="form-select" id="f-urgency" name="urgency">
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label" for="f-role">Preferred provider</label>
            <select class="form-select" id="f-role" name="required_role">
              <option value="any">Any provider</option>
              ${roleOptions}
            </select>
          </div>
        </div>
        <div class="form-field">
          <label class="form-label" for="f-schedule">Schedule</label>
          <input class="form-input" id="f-schedule" name="schedule" type="text" placeholder="e.g. Daily 9:00–10:00, 7 days" />
        </div>
        <div class="form-field">
          <label class="form-label" for="f-desc">Detailed description</label>
          <textarea class="form-textarea" id="f-desc" name="description" rows="5" placeholder="Describe the patient situation, type of care, and any preferences. Do not share sensitive medical documents in public posts."></textarea>
        </div>
        <label class="checkbox">
          <input type="checkbox" id="post-agree" required />
          <span>I understand that a paid video consultation is required before any home visit. This protects both parties.</span>
        </label>
        <button class="btn btn-primary btn-block btn-lg" type="submit">Post Care Need</button>
      </form>
      <div class="safety-note">
        <div class="safety-icon">${iconSafe('lock')}</div>
        <div>
          <strong class="safety-title">Privacy Reminder</strong>
          <p class="safety-text">Never share sensitive medical documents or personal identifiers in public posts. Use secure messaging and video calls after connecting with a provider.</p>
        </div>
      </div>
    </section>
  `;
}

/* ── MESSAGES ── */
function viewMessages() {
  return `
    <section class="view">
      <div class="view-head">
        <h1>Messages</h1>
        <p>Chat unlocks after the first paid video consultation.</p>
      </div>
      <div class="msg-layout">
        <aside class="conv-list" id="conv-list" aria-label="Conversations">
          <div class="loading"><span class="spinner spinner-dark"></span> Loading conversations...</div>
        </aside>
        <section class="chat-panel" id="chat-panel">
          <div class="chat-body"><div class="chat-empty"><h3>Select a conversation</h3><p>Your conversations with patients and providers will appear here.</p></div></div>
        </section>
      </div>
    </section>
  `;
}

async function loadConversations() {
  const list = document.getElementById('conv-list');
  try {
    const convs = await api('/messages/conversations');
    state.conversations = convs;
    renderConversations();
  } catch (e) {
    list.innerHTML = emptyState('Unable to load conversations', e.message || 'Please try again.', null);
  }
}

function renderConversations() {
  const list = document.getElementById('conv-list');
  if (!list) return;
  if (!state.conversations.length) {
    list.innerHTML = emptyState('No conversations yet', 'Start by booking a first video consultation with a provider.', 'feed');
    return;
  }
  list.innerHTML = state.conversations.map((c) => {
    const isPatient = c.patient_id === state.user.id;
    const otherName = isPatient ? c.provider_name : c.patient_name;
    const otherId = isPatient ? c.provider_id : c.patient_id;
    const unread = Number(c.unread_count) > 0 ? `<span class="unread-dot">${c.unread_count}</span>` : '';
    const preview = c.is_chat_unlocked
      ? (c.last_message || 'Start the conversation')
      : '<span style="color:var(--warning)">&#128274; Locked — book first video consult</span>';
    return `
      <button class="conv-row${state.activeConv === c.id ? ' active' : ''}" data-conv="${esc(c.id)}" data-other="${esc(otherId)}">
        <span class="conv-avatar">${esc(initials(otherName))}</span>
        <span class="conv-info">
          <span class="conv-name">${esc(otherName)}${unread}</span>
          <span class="conv-preview">${preview}</span>
        </span>
        <span class="conv-meta">${esc(timeAgo(c.last_message_at))}</span>
      </button>
    `;
  }).join('');
}

async function selectConversation(id) {
  state.activeConv = id;
  renderConversations();
  const panel = document.getElementById('chat-panel');
  const conv = state.conversations.find((c) => c.id === id);
  if (!conv) { panel.innerHTML = ''; return; }

  const isPatient = conv.patient_id === state.user.id;
  const otherName = isPatient ? conv.provider_name : conv.patient_name;
  const otherId = isPatient ? conv.provider_id : conv.patient_id;

  if (!conv.is_chat_unlocked) {
    panel.innerHTML = `
      <div class="chat-body">
        <div class="locked">
          <div class="lock-icon">&#128274;</div>
          <h3>Chat is locked</h3>
          <p>Message access is protected. Complete a paid video consultation with ${esc(otherName)} to unlock direct messaging.</p>
          <button class="btn btn-primary" data-video-provider="${esc(otherId)}">Book First Video Consult</button>
        </div>
      </div>
    `;
    return;
  }

  panel.innerHTML = `
    <div class="chat-head">
      <div><strong>${esc(otherName)}</strong><span class="chat-sub">${esc(isPatient ? 'Provider' : 'Patient')}</span></div>
      <button class="btn btn-secondary btn-sm" data-video-provider="${esc(otherId)}">${icon('video', 'btn-icon')} Video</button>
    </div>
    <div class="chat-body" id="chat-body"><div class="loading"><span class="spinner spinner-dark"></span> Loading messages...</div></div>
    <div class="chat-foot">
      <input class="chat-input" id="chat-input" type="text" placeholder="Type a message..." autocomplete="off" />
      <button class="btn btn-primary" id="chat-send">Send</button>
    </div>
  `;

  try {
    const msgs = await api('/messages/' + id);
    const body = document.getElementById('chat-body');
    body.innerHTML = msgs.length
      ? msgs.map((m) => messageHtml(m)).join('')
      : '<div class="chat-empty"><h3>No messages yet</h3><p>Say hello and introduce yourself.</p></div>';
    body.scrollTop = body.scrollHeight;
  } catch (e) {
    if (e.status === 403) {
      document.getElementById('chat-body').innerHTML = `
        <div class="locked">
          <div class="lock-icon">&#128274;</div>
          <h3>Chat is locked</h3>
          <p>${esc(e.data.message || 'Complete a paid video consultation first.')}</p>
          <button class="btn btn-primary" data-video-provider="${esc(otherId)}">Book First Video Consult</button>
        </div>
      `;
    } else {
      document.getElementById('chat-body').innerHTML = `<div class="chat-empty"><h3>Error</h3><p>${esc(e.message)}</p></div>`;
    }
  }
}

function messageHtml(m) {
  const mine = m.sender_id === state.user.id;
  const sender = !mine ? `<span class="msg-sender">${esc(m.sender_name)}</span>` : '';
  return `
    <div class="msg ${mine ? 'msg-sent' : 'msg-received'}">
      ${sender}
      <p>${esc(m.content)}</p>
      <span class="msg-time">${esc(fmtTime(m.created_at))}</span>
    </div>
  `;
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  if (!input || !state.activeConv) return;
  const content = input.value.trim();
  if (!content) return;
  input.value = '';
  try {
    const msg = await api('/messages/' + state.activeConv, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    const body = document.getElementById('chat-body');
    if (!body) return;
    body.insertAdjacentHTML('beforeend', messageHtml(msg));
    body.scrollTop = body.scrollHeight;
  } catch (e) {
    toast(e.message || 'Failed to send message', 'error');
  }
}

/* ── DOCTORS ── */
function viewDoctors() {
  const count = state.waitlistCount;
  return `
    <section class="view">
      <div class="doctors-hero">
        <span class="doctors-badge">Coming Soon</span>
        <h1>Licensed Doctors Are Joining Careless</h1>
        <p>We are expanding to include licensed physicians for secure video consultations and coordinated care between patients, nurses and doctors.</p>
        ${count !== null ? `<div class="waitlist-count">${count} healthcare professionals are already on the waitlist</div>` : ''}
      </div>
      <section class="section">
        <div class="grid-4">
          <div class="d-point"><strong>Video consultations</strong><span>Secure, paid consultations with licensed physicians.</span></div>
          <div class="d-point"><strong>Care coordination</strong><span>Nurses and patients connect with doctors when guidance is needed.</span></div>
          <div class="d-point"><strong>Local trust</strong><span>From Tunis to Sfax, talent stays connected to Tunisian patients.</span></div>
          <div class="d-point"><strong>Transparent fees</strong><span>Doctors set their own rates in TND.</span></div>
        </div>
      </section>
      <section class="section">
        <div class="form-card" style="max-width:640px;">
          <div class="section-head"><h2 class="section-title">Join the Doctor Waitlist</h2><p class="section-sub">Be first to know when doctor consultations launch.</p></div>
          <form id="waitlist-form" novalidate>
            <div class="form-field">
              <label class="form-label" for="w-email">Email address</label>
              <input class="form-input" id="w-email" name="email" type="email" placeholder="doctor@clinic.tn" required />
            </div>
            <div class="form-field">
              <label class="form-label" for="w-role">I am a...</label>
              <select class="form-select" id="w-role" name="role" required>
                <option value="">Select role</option>
                <option>Licensed Doctor</option>
                <option>Medical Resident</option>
                <option>Clinic Representative</option>
                <option>Patient interested in doctor consultations</option>
              </select>
            </div>
            <button class="btn btn-primary btn-block btn-lg" type="submit">Join Waitlist</button>
          </form>
        </div>
      </section>
      <div class="safety-note">
        <div class="safety-icon">${iconSafe('alert')}</div>
        <div>
          <strong class="safety-title">Important</strong>
          <p class="safety-text">Careless connects patients with independent providers and does not provide emergency care. For emergencies, call SAMU at <strong>190</strong>.</p>
        </div>
      </div>
    </section>
  `;
}

async function loadWaitlistCount() {
  try {
    const data = await api('/doctors/waitlist/count');
    state.waitlistCount = data.count;
    const el = document.querySelector('.waitlist-count');
    if (el) el.textContent = data.count + ' healthcare professionals are already on the waitlist';
  } catch (e) { /* optional */ }
}

/* ── PROFILE ── */
function viewProfile() {
  const p = state.profile;
  if (!p) return '<section class="view"><div class="loading"><span class="spinner spinner-dark"></span> Loading profile...</div></section>';
  const role = esc(roleLabel(p.role));
  const loc = [p.governorate, p.city].filter(Boolean).join(', ') || 'Tunisia';
  const verified = p.is_verified
    ? '<span class="badge badge-verified">&#10003; Verified</span>'
    : '<span class="badge badge-pending">' + esc(p.kyc_status === 'unverified' ? 'Verification pending' : p.kyc_status) + '</span>';
  const rating = p.rating && Number(p.rating) > 0
    ? `<span class="badge badge-rating">&#9733; ${Number(p.rating).toFixed(1)} (${Number(p.review_count) || 0})</span>` : '';
  const specs = Array.isArray(p.specialties) && p.specialties.length ? esc(p.specialties.join(', ')) : '—';
  return `
    <section class="view">
      <div class="profile-head">
        <div class="provider-avatar big">${esc(initials(p.full_name))}</div>
        <div>
          <h1>${esc(p.full_name)}</h1>
          <p>${role} &middot; ${esc(loc)}</p>
          <div class="badges" style="margin-top:8px;">${verified}${rating}</div>
        </div>
      </div>
      <div class="grid-2">
        <div class="form-card">
          <h2 class="section-title" style="font-size:1.1rem; margin-bottom:14px;">Account</h2>
          <div class="kv-item"><span class="kv-label">Email</span><span class="kv-value">${esc(p.email)}</span></div>
          <div class="kv-item"><span class="kv-label">Phone</span><span class="kv-value">${esc(p.phone || '—')}</span></div>
          <div class="kv-item"><span class="kv-label">Location</span><span class="kv-value">${esc(loc)}</span></div>
          <div class="kv-item"><span class="kv-label">Member since</span><span class="kv-value">${esc(new Date(p.created_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))}</span></div>
          ${p.hourly_rate ? `<div class="kv-item"><span class="kv-label">Hourly rate</span><span class="kv-value">${esc(money(p.hourly_rate))} TND / hour</span></div>` : ''}
        </div>
        <div class="form-card">
          <h2 class="section-title" style="font-size:1.1rem; margin-bottom:14px;">Professional</h2>
          <div class="kv-item"><span class="kv-label">Specialties</span><span class="kv-value">${specs}</span></div>
          <div class="kv-item"><span class="kv-label">License</span><span class="kv-value">${esc(p.license_number || 'Not provided')}</span></div>
          <div class="kv-item"><span class="kv-label">License issuer</span><span class="kv-value">${esc(p.license_issuer || '—')}</span></div>
          <div class="kv-item"><span class="kv-label">KYC status</span><span class="kv-value">${esc(p.kyc_status || 'unverified')}</span></div>
          <p class="bio" style="margin-top:14px;">${esc(p.bio || 'No bio yet.')}</p>
        </div>
      </div>
    </section>
  `;
}

async function loadProfile() {
  try {
    state.profile = await api('/auth/me');
    renderApp();
  } catch (e) {
    toast('Could not load your profile.', 'error');
  }
}

/* ═══════════ EVENT BINDING ═══════════ */

function bindView() {
  const v = state.view;

  document.querySelectorAll('[data-role]').forEach((el) => {
    el.addEventListener('click', () => {
      if (!state.user) {
        openAuthModal('signup');
        toast('Create an account to continue.');
      } else {
        toast('Welcome. Browse the care feed to get started.', 'success');
        go('feed');
      }
    });
  });

  document.querySelectorAll('[data-empty-cta]').forEach((el) => {
    el.addEventListener('click', () => go(el.dataset.emptyCta));
  });

  if (v === 'feed') bindFeed();
  else if (v === 'post') bindPost();
  else if (v === 'messages') bindMessages();
  else if (v === 'doctors') bindDoctors();
}

function bindFeed() {
  const search = document.getElementById('feed-search');
  const governorate = document.getElementById('feed-governorate');
  const role = document.getElementById('feed-role');
  const clear = document.getElementById('feed-clear');
  const grid = document.getElementById('feed-grid');

  document.querySelectorAll('[data-feed]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.feedTab = btn.dataset.feed;
      renderApp();
      loadFeed();
    });
  });

  let timer;
  if (search) {
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.filters.search = search.value.trim();
        loadFeed();
      }, 350);
    });
  }
  if (governorate) {
    governorate.addEventListener('change', () => {
      state.filters.governorate = governorate.value;
      loadFeed();
    });
  }
  if (role) {
    role.addEventListener('change', () => {
      state.filters.role = role.value;
      loadFeed();
    });
  }
  if (clear) {
    clear.addEventListener('click', () => {
      state.filters = { search: '', governorate: '', role: '' };
      renderApp();
      loadFeed();
    });
  }

  if (grid) {
    grid.addEventListener('click', (e) => {
      const ctaBtn = e.target.closest('[data-empty-cta]');
      if (ctaBtn) return go(ctaBtn.dataset.emptyCta);
      const videoBtn = e.target.closest('[data-video-provider]');
      const msgBtn = e.target.closest('[data-message-provider]');
      const applyBtn = e.target.closest('[data-apply-need]');
      if (videoBtn) startVideoFlow(videoBtn.dataset.videoProvider);
      else if (msgBtn) messageProvider(msgBtn.dataset.messageProvider);
      else if (applyBtn) applyNeed();
    });
  }

  loadFeed();
}

function bindPost() {
  document.getElementById('post-form').addEventListener('submit', handlePostNeed);
}

function bindMessages() {
  const list = document.getElementById('conv-list');
  if (list) list.addEventListener('click', (e) => {
    const row = e.target.closest('[data-conv]');
    if (row) selectConversation(row.dataset.conv);
  });
  const send = document.getElementById('chat-send');
  if (send) send.addEventListener('click', sendMessage);
  const input = document.getElementById('chat-input');
  if (input) input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
  const panel = document.getElementById('chat-panel');
  if (panel) panel.addEventListener('click', (e) => {
    const videoBtn = e.target.closest('[data-video-provider]');
    if (videoBtn) startVideoFlow(videoBtn.dataset.videoProvider);
  });
  loadConversations();
}

function bindDoctors() {
  document.getElementById('waitlist-form').addEventListener('submit', handleWaitlist);
  loadWaitlistCount();
}

/* ═══════════ ACTIONS ═══════════ */

async function handlePostNeed(e) {
  e.preventDefault();
  if (!state.user) { openAuthModal('login'); return; }
  if (!document.getElementById('post-agree').checked) {
    toast('Please confirm the video consultation requirement.', 'error');
    return;
  }
  const data = Object.fromEntries(new FormData(e.target).entries());
  const payload = {
    title: data.title.trim(),
    description: data.description || null,
    governorate: data.governorate || null,
    city: data.city || null,
    budget_amount: data.budget_amount ? Number(data.budget_amount) : null,
    budget_period: data.budget_period || null,
    schedule: data.schedule || null,
    urgency: data.urgency || 'normal',
    required_role: data.required_role === 'any' ? null : data.required_role || null,
  };
  if (!payload.title) { toast('Please enter a title for the care need.', 'error'); return; }
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Posting...';
  try {
    await api('/feed/needs', { method: 'POST', body: JSON.stringify(payload) });
    toast('Care need posted. Providers in your governorate will be notified.', 'success');
    e.target.reset();
    state.feedTab = 'needs';
    state.filters = { search: '', governorate: '', role: '' };
    go('feed');
  } catch (err) {
    toast(err.message || 'Failed to post care need.', 'error');
    btn.disabled = false;
    btn.textContent = 'Post Care Need';
  }
}

async function handleWaitlist(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Joining...';
  try {
    const data = Object.fromEntries(new FormData(e.target).entries());
    await api('/doctors/waitlist', {
      method: 'POST',
      body: JSON.stringify({ email: data.email.trim(), role_type: data.role || null }),
    });
    toast('You are on the doctor waitlist. We will reach out soon.', 'success');
    e.target.reset();
    loadWaitlistCount();
  } catch (err) {
    toast(err.message || 'Failed to join waitlist.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Join Waitlist';
  }
}

function messageProvider(providerId) {
  if (!state.user) { openAuthModal('login'); return; }
  go('messages');
  toast('Message access unlocks after the first paid video consultation.');
}

function applyNeed() {
  if (!state.user) { openAuthModal('login'); return; }
  if (state.user.role === 'patient') {
    toast('Only healthcare providers can apply to care needs.');
    return;
  }
  go('messages');
  toast('Connect with the patient through a first paid video consultation to unlock messaging.');
}

async function startVideoFlow(providerId) {
  if (!state.user) { openAuthModal('login'); return; }
  try {
    const data = await api('/fees/initiate', {
      method: 'POST',
      body: JSON.stringify({ provider_id: providerId }),
    });
    if (data.already_paid) {
      toast(data.message || 'Connection already established — chat is unlocked.', 'success');
      return;
    }
    openPaymentModal(data, providerId);
  } catch (err) {
    if (err.status === 409 && err.data && err.data.fee_id) {
      openPaymentModal(err.data, providerId);
      return;
    }
    toast(err.message || 'Unable to initiate the consultation.', 'error');
  }
}

/* ═══════════ AUTH ═══════════ */

function openAuthModal(mode) {
  state.authMode = mode === 'signup' ? 'signup' : 'login';
  const modal = document.getElementById('auth-modal');
  document.getElementById('auth-error').className = 'alert alert-error hidden';
  document.querySelectorAll('[data-auth-tab]').forEach((t) => t.classList.toggle('active', t.dataset.authTab === state.authMode));
  document.getElementById('auth-fields-login').classList.toggle('hidden', state.authMode !== 'login');
  document.getElementById('auth-fields-signup').classList.toggle('hidden', state.authMode !== 'signup');
  document.getElementById('auth-title').textContent = state.authMode === 'login' ? 'Welcome Back' : 'Create Account';
  const submit = document.getElementById('auth-submit');
  submit.textContent = state.authMode === 'login' ? 'Sign In' : 'Create Account';
  openModal(modal);
  const focus = document.getElementById(state.authMode === 'login' ? 'auth-email' : 'auth-full-name');
  setTimeout(() => focus && focus.focus(), 60);
}

function openModal(el) {
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
}

function closeModal(id) {
  const el = document.getElementById(id);
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
}

async function handleAuth(e) {
  e.preventDefault();
  const errorEl = document.getElementById('auth-error');
  const isLogin = state.authMode === 'login';

  const email = (isLogin
    ? document.getElementById('auth-email').value
    : document.getElementById('auth-email-signup').value).trim().toLowerCase();
  const password = isLogin
    ? document.getElementById('auth-password').value
    : document.getElementById('auth-password-signup').value;

  if (!email || !password) return showAuthError('Please enter your email and password.');

  let body;
  if (isLogin) {
    body = { email, password };
  } else {
    const fullName = document.getElementById('auth-full-name').value.trim();
    if (!fullName) return showAuthError('Please enter your full name.');
    if (password.length < 6) return showAuthError('Password must be at least 6 characters.');
    body = {
      email, password,
      full_name: fullName,
      role: document.getElementById('auth-role').value,
    };
  }

  const submit = document.getElementById('auth-submit');
  submit.disabled = true;
  submit.innerHTML = '<span class="spinner"></span> Please wait...';

  try {
    const data = await api('/auth/' + (isLogin ? 'login' : 'register'), {
      method: 'POST',
      body: JSON.stringify(body),
    });
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    state.user = data.user;
    state.profile = null;
    closeModal('auth-modal');
    toast(isLogin ? 'Welcome back, ' + data.user.full_name + '!' : 'Account created. Welcome, ' + data.user.full_name + '!', 'success');
    renderApp();
  } catch (err) {
    showAuthError(err.message || 'Authentication failed. Please try again.');
  } finally {
    submit.disabled = false;
    submit.textContent = isLogin ? 'Sign In' : 'Create Account';
  }
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.className = 'alert alert-error';
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  state.user = null;
  state.profile = null;
  state.conversations = [];
  state.activeConv = null;
  toast('Signed out successfully.');
  go('home');
}

/* ═══════════ PAYMENT ═══════════ */

function openPaymentModal(data, providerId) {
  const provider = state.providers.find((p) => p.id === providerId);
  const conv = state.conversations.find((c) => c.provider_id === providerId || c.patient_id === providerId);
  let name = provider ? provider.full_name : (conv ? (conv.provider_id === providerId ? conv.provider_name : conv.patient_name) : null);
  if (!name) {
    const isPatient = conv && conv.patient_id === state.user.id;
    name = conv ? (isPatient ? conv.provider_name : conv.patient_name) : 'the provider';
  }
  state.pendingPayment = { feeId: data.fee_id, providerId };
  document.getElementById('pay-details').innerHTML = `
    <div class="pay-row"><span class="lbl">Provider</span><span class="val">${esc(name)}</span></div>
    <div class="pay-row"><span class="lbl">First video consultation</span><span class="val">${esc(money(data.amount_tnd))} TND</span></div>
    <div class="pay-row"><span class="lbl">Platform facilitation fee (${Number(data.platform_fee_percent) || 15}%)</span><span class="val">-${esc(money(data.platform_cut))} TND</span></div>
    <div class="pay-row total"><span class="lbl">Provider receives</span><span class="val">${esc(money(data.provider_amount))} TND</span></div>
  `;
  const confirm = document.getElementById('pay-confirm');
  confirm.disabled = false;
  confirm.textContent = 'Confirm & Pay';
  openModal(document.getElementById('pay-modal'));
}

async function confirmPayment() {
  const payment = state.pendingPayment;
  if (!payment) return;
  const confirm = document.getElementById('pay-confirm');
  confirm.disabled = true;
  confirm.innerHTML = '<span class="spinner"></span> Processing...';
  try {
    await api('/fees/confirm', {
      method: 'POST',
      body: JSON.stringify({
        fee_id: payment.feeId,
        payment_reference: 'TND-' + Date.now(),
        payment_status: 'success',
      }),
    });
    state.pendingPayment = null;
    closeModal('pay-modal');
    toast('Payment confirmed. Your video consultation and chat are unlocked.', 'success');
    go('messages');
  } catch (err) {
    toast(err.message || 'Payment confirmation failed.', 'error');
    confirm.disabled = false;
    confirm.textContent = 'Confirm & Pay';
  }
}

/* ═══════════ INIT ═══════════ */

function init() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    try { state.user = JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { state.user = null; }
    if (!state.user) {
      api('/auth/me')
        .then((profile) => {
          const u = { id: profile.id, email: profile.email, full_name: profile.full_name, role: profile.role };
          state.user = u;
          localStorage.setItem(USER_KEY, JSON.stringify(u));
          renderApp();
        })
        .catch(() => {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          renderApp();
        });
    } else {
      renderApp();
    }
  } else {
    renderApp();
  }

  document.getElementById('auth-form').addEventListener('submit', handleAuth);
  document.querySelectorAll('[data-auth-tab]').forEach((tab) => {
    tab.addEventListener('click', () => openAuthModal(tab.dataset.authTab));
  });
  document.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', () => closeModal(el.dataset.close));
  });
  document.getElementById('pay-confirm').addEventListener('click', confirmPayment);
}

document.addEventListener('DOMContentLoaded', init);
