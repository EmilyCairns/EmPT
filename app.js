import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import * as config from './config.js';

const { SUPABASE_URL, SUPABASE_ANON_KEY, APP_NAME, TRAINER_NAME } = config;
// Optional settings: older config.js files may not have them.
const ROUND_TO_KG = Number(config.ROUND_TO_KG) > 0 ? Number(config.ROUND_TO_KG) : 2.5;
// Plates in the gym, heaviest first, and the bars to choose from.
const PLATES_KG = (Array.isArray(config.PLATES_KG) && config.PLATES_KG.length ? config.PLATES_KG : [25, 20, 15, 10, 5, 2.5, 1.25])
  .map(Number).filter((n) => n > 0).sort((a, b) => b - a);
const BARS_KG = [20, 15];
const LATE_CANCEL_HOURS = Number(config.LATE_CANCEL_HOURS) >= 0 && config.LATE_CANCEL_HOURS != null ? Number(config.LATE_CANCEL_HOURS) : 24;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const $app = document.getElementById('app');
const configured = !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_ANON_KEY.startsWith('YOUR-');
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const state = {
  session: null,
  isTrainer: false,
  me: null,            // client row when a client is signed in
  clients: [],         // trainer: all clients
  selectedId: null,    // trainer: client being viewed
  view: 'client',      // trainer: 'client', 'library', 'notices', 'calendar' or 'community'
  library: [],         // exercise library (both roles)
  lifting: true,       // false until the database has the lifting tables
  notices: null,       // notice board posts; null until/unless the table exists
  community: null,     // Team wins: client { member } / trainer { members }; null until the tables exist
  sessions: null,      // booked sessions; null until/unless the table exists
  cal: { month: null, day: null }, // calendar position (first of month, 'YYYY-MM-DD')
  activeWorkout: null, // client: id of the workout open in "Start workout" mode
  activeProgram: null, // client: id of the program overview being shown
  myPrograms: null,    // client: their programs (null when the database has none yet)
  tab: 'workouts',
  chatChannel: null,
  inboxChannel: null,
  unread: new Set(),   // trainer: client ids with unseen messages
};
const ui = {};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// Builds DOM elements. Text is always inserted as text, never as HTML.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

// replaceChildren() would print null as text, so drop empty slots first.
const fill = (el, ...nodes) => el.replaceChildren(...nodes.flat(Infinity).filter((n) => n != null && n !== false));
const mount = (...nodes) => fill($app, ...nodes);
const field = (label, input, hint) =>
  h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'muted small' }, hint) : null);

function toast(message, isError = false) {
  // One message at a time: a new one replaces any still showing.
  document.querySelectorAll('.toast').forEach((old) => old.remove());
  const t = h('div', { class: 'toast' + (isError ? ' error' : ''), role: 'status' }, message);
  document.body.append(t);
  setTimeout(() => t.remove(), isError ? 6000 : 3500);
}

function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
const formatDate = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const formatDateTime = (ts) =>
  new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const goalsBox = (label, text) => h('div', { class: 'goals' }, h('p', { class: 'eyebrow' }, label), h('p', {}, text));
const firstName = (name) => (name || '').trim().split(/\s+/)[0] || 'there';
const clientName = (id) => state.clients.find((c) => c.id === id)?.full_name || 'a client';

// altSubmitLabel adds a second, outlined submit button; onSubmit is then
// called with 'alt' when that one was pressed and 'primary' otherwise.
function openDialog({ title, fields, submitLabel = 'Save', altSubmitLabel, cancelLabel = 'Cancel', onSubmit, extra, wide, danger }) {
  const dlg = h('dialog', { class: 'dialog' + (wide ? ' wide' : '') });
  const err = h('p', { class: 'error', role: 'alert' });
  const save = h('button', { type: 'submit', class: danger ? 'btn danger' : 'btn primary', 'data-action': 'primary' }, submitLabel);
  const alt = altSubmitLabel ? h('button', { type: 'submit', class: 'btn', 'data-action': 'alt' }, altSubmitLabel) : null;
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const action = e.submitter?.dataset.action || 'primary';
      save.disabled = true;
      if (alt) alt.disabled = true;
      err.textContent = '';
      try {
        const problem = await onSubmit(action);
        if (problem) err.textContent = problem;
        else dlg.close();
      } catch (x) {
        err.textContent = x.message || String(x);
      } finally {
        save.disabled = false;
        if (alt) alt.disabled = false;
      }
    },
  },
    h('h2', {}, title),
    fields,
    err,
    h('div', { class: 'dialog-actions' },
      extra || h('span'),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close() }, cancelLabel),
        alt,
        save)));
  dlg.append(form);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

function tabs(items, onChange) {
  return h('div', { class: 'tabs', role: 'tablist' },
    items.map(([key, label]) =>
      h('button', {
        class: 'tab' + (state.tab === key ? ' active' : ''),
        role: 'tab',
        'aria-selected': String(state.tab === key),
        onclick: () => { if (state.tab !== key) { state.tab = key; onChange(); } },
      }, label)));
}

function header() {
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, h('img', { src: 'icon.svg', alt: '', width: '28', height: '28' }), APP_NAME),
    h('div', { class: 'topbar-right' },
      h('span', { class: 'muted small hide-narrow' }, state.session.user.email),
      h('button', { class: 'btn ghost small', onclick: async () => { await flushPendingSaves(); sb.auth.signOut(); } }, 'Sign out')));
}

function closeChat() {
  if (state.chatChannel) { sb.removeChannel(state.chatChannel); state.chatChannel = null; }
}
function cleanupChannels() {
  closeChat();
  if (state.inboxChannel) { sb.removeChannel(state.inboxChannel); state.inboxChannel = null; }
}

// ---------------------------------------------------------------------------
// Sign in / routing
// ---------------------------------------------------------------------------

function friendlyAuthError(error) {
  const msg = error?.message || '';
  if (/database error|not been invited/i.test(msg)) return "That email isn't registered yet. Ask your trainer to add you, then try again.";
  if (/rate limit|too many|seconds/i.test(msg)) return 'Too many sign-in emails were requested. Please wait a few minutes and try again.';
  return msg || 'Something went wrong. Please try again.';
}

function renderSetupNeeded() {
  mount(h('main', { class: 'center' }, h('div', { class: 'card narrow' },
    h('h1', {}, `${APP_NAME} needs setting up`),
    h('p', {}, 'Add your Supabase project URL and key to config.js. The README explains each step.'))));
}

function renderLogin() {
  const email = h('input', { type: 'email', id: 'email', required: true, placeholder: 'you@example.com', autocomplete: 'email' });
  const status = h('p', { class: 'muted', 'aria-live': 'polite' });
  const btn = h('button', { type: 'submit', class: 'btn primary block' }, 'Email me a sign-in link');
  const form = h('form', {
    class: 'narrow login',
    onsubmit: async (e) => {
      e.preventDefault();
      const address = email.value.trim();
      btn.disabled = true;
      status.className = 'muted';
      status.textContent = 'Sending…';
      const { error } = await sb.auth.signInWithOtp({
        email: address,
        options: { emailRedirectTo: location.origin + location.pathname },
      });
      btn.disabled = false;
      if (error) {
        status.className = 'error';
        status.textContent = friendlyAuthError(error);
      } else {
        status.textContent = `Check ${address} for your sign-in link. Open it on this device.`;
      }
    },
  },
    h('div', { class: 'login-brand brand' }, h('img', { src: 'icon.svg', alt: '', width: '32', height: '32' }), APP_NAME),
    h('p', { class: 'eyebrow' }, 'Personal training'),
    h('h1', { class: 'display' }, 'Your training, ', h('em', {}, 'personalised'), '.'),
    h('p', { class: 'lead' }, `Sign in to see your workouts and chat with ${TRAINER_NAME}. No password needed.`),
    field('Email', email),
    btn,
    status);
  mount(h('main', { class: 'center' }, form));
}

function renderNotLinked() {
  mount(header(), h('main', { class: 'center' }, h('div', { class: 'card narrow' },
    h('h1', {}, 'Almost there'),
    h('p', {}, `You're signed in as ${state.session.user.email}, but that email isn't linked to a client profile. Ask ${TRAINER_NAME} to check the email they added for you.`))));
}

function renderError(error) {
  mount(h('main', { class: 'center' }, h('div', { class: 'card narrow' },
    h('h1', {}, 'Something went wrong'),
    h('p', { class: 'error' }, error.message || String(error)),
    h('button', { class: 'btn ghost', onclick: () => location.reload() }, 'Try again'),
    ' ',
    h('button', { class: 'btn ghost', onclick: () => sb.auth.signOut() }, 'Sign out'))));
}

async function route(session) {
  cleanupChannels();
  state.session = session;
  state.selectedId = null;
  state.view = 'client';
  state.activeWorkout = null;
  state.unread.clear();
  state.tab = 'workouts';
  if (!session) return renderLogin();

  mount(h('main', { class: 'center' }, h('p', { class: 'muted' }, 'Loading…')));
  const { data: isTrainer, error } = await sb.rpc('is_trainer');
  if (error) return renderError(error);
  state.isTrainer = !!isTrainer;
  if (state.isTrainer) return startTrainer();

  const { data: me, error: meError } = await sb.from('clients').select('*').maybeSingle();
  if (meError) return renderError(meError);
  if (!me) return renderNotLinked();
  state.me = me;
  state.tab = 'home';
  await Promise.all([loadLibrary(), loadNotices(), loadSessions(me.id), loadPrograms(me.id).then((p) => { state.myPrograms = p; }), loadCommunity()]);
  renderClientApp();
}

// ---------------------------------------------------------------------------
// Trainer
// ---------------------------------------------------------------------------

async function loadClients() {
  const [{ data, error }, pay] = await Promise.all([
    sb.from('clients').select('*').order('full_name'),
    // How each client pays. Stored with the private consult notes, so only
    // the trainer can ever read it. null = that column isn't in the database yet.
    sb.from('client_notes').select('client_id,payment_method'),
  ]);
  if (error) { toast(error.message, true); return; }
  state.clients = data;
  state.payMethods = pay.error ? null : new Map(pay.data.map((r) => [r.client_id, r.payment_method]));
}

// How a client pays (trainer only). Keys are stored; labels can change.
const PAY_METHODS = [
  ['ezidebit', 'Ezidebit'],
  ['stripe', 'Stripe (in the app)'],
  ['transfer', 'Bank transfer'],
  ['other', 'Other'],
];
const payLabel = (clientId) => {
  const key = state.payMethods?.get(clientId);
  return key ? `Pays by ${PAY_METHODS.find(([k]) => k === key)?.[1] || key}` : null;
};

async function startTrainer() {
  await Promise.all([loadClients(), loadLibrary(), loadNotices(), loadSessions(), loadCommunity()]);
  // Hear about new client messages anywhere in the app.
  state.inboxChannel = sb.channel(`inbox-${Date.now()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: m }) => {
      if (m.sender !== 'client') return;
      // A client cancelling a session posts a chat message (see cancel_session).
      const cancelled = m.body.startsWith("I've cancelled my session");
      if (cancelled && state.sessions) {
        loadSessions().then(() => {
          renderClientList();
          if (state.view === 'calendar' || (state.view === 'client' && state.tab === 'sessions')) renderPanel();
        });
      }
      if (state.selectedId === m.client_id && state.tab === 'chat') return;
      state.unread.add(m.client_id);
      renderClientList();
      toast(cancelled ? `${clientName(m.client_id)} cancelled a session. See their chat for details.` : `New message from ${clientName(m.client_id)}`);
    })
    .subscribe();
  renderTrainerApp();
}

function renderTrainerApp() {
  ui.list = h('nav', { class: 'client-list', 'aria-label': 'Clients' });
  ui.panel = h('section', { class: 'panel' });
  ui.layout = h('div', { class: 'layout' },
    h('aside', { class: 'sidebar' },
      ui.libNav = h('nav', { class: 'client-list sidebar-nav', 'aria-label': 'Library' }),
      h('div', { class: 'sidebar-head' },
        h('h2', { class: 'eyebrow' }, 'Clients'),
        h('button', { class: 'btn primary small', onclick: () => openClientDialog() }, '+ New client')),
      ui.list),
    ui.panel);
  mount(header(), ui.layout);
  renderClientList();
  renderPanel();
}

function renderClientList() {
  ui.layout.classList.toggle('has-selection', !!state.selectedId || state.view !== 'client');
  const navItem = (view, title, detail) => h('button', {
    class: 'client-item' + (state.view === view ? ' active' : ''),
    onclick: () => { flushPendingSaves(); state.view = view; state.selectedId = null; renderClientList(); renderPanel(); },
  }, h('span', { class: 'client-name' }, title), h('span', { class: 'muted small' }, detail));
  fill(ui.libNav,
    state.lifting ? navItem('library', 'Exercise library', `${state.library.length} exercise${state.library.length === 1 ? '' : 's'}`) : null,
    state.sessions ? navItem('calendar', 'Calendar', upcomingLabel(state.sessions)) : null,
    state.notices ? navItem('notices', 'Notice board', `${state.notices.length} post${state.notices.length === 1 ? '' : 's'}`) : null,
    state.community ? navItem('community', 'Team wins', `${state.community.members.size} sharing`) : null);
  ui.libNav.hidden = !ui.libNav.children.length;
  if (!state.clients.length) {
    ui.list.replaceChildren(h('p', { class: 'muted pad' }, 'No clients yet. Tap "+ New client" to start their consult notes.'));
    return;
  }
  ui.list.replaceChildren(...state.clients.map((c) =>
    h('button', {
      class: 'client-item' + (c.id === state.selectedId ? ' active' : ''),
      onclick: () => selectClient(c.id),
    },
      h('span', { class: 'client-name' }, c.full_name, state.unread.has(c.id) ? h('span', { class: 'dot', title: 'New message' }) : null),
      h('span', { class: 'muted small' }, [c.email || 'No account yet', payLabel(c.id)].filter(Boolean).join(' · ')))));
}

function selectClient(id) {
  const c = state.clients.find((x) => x.id === id);
  state.view = 'client';
  state.selectedId = id;
  state.tab = state.unread.has(id) ? 'chat' : c?.email ? 'workouts' : 'notes';
  renderClientList();
  renderPanel();
}

// Autosaving fields register a flush function here, so switching client,
// tab or page never loses what was just typed.
const pendingSaves = new Set();
function flushPendingSaves() {
  return Promise.all([...pendingSaves].map((flush) => flush()));
}
window.addEventListener('beforeunload', (e) => {
  if (!pendingSaves.size) return;
  flushPendingSaves();
  e.preventDefault();
});

function autosaver(save, statusEl) {
  let timer = null;
  let running = Promise.resolve();
  const flush = () => {
    if (!timer) return running;
    clearTimeout(timer);
    timer = null;
    pendingSaves.delete(flush);
    statusEl.textContent = 'Saving…';
    running = running.then(save).then(
      () => { statusEl.textContent = `Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; },
      (err) => { statusEl.textContent = 'Not saved'; toast(`Couldn't save: ${err.message}`, true); });
    return running;
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, 800);
    pendingSaves.add(flush);
    statusEl.textContent = 'Editing…';
  };
  return { schedule, flush };
}

function renderPanel() {
  closeChat();
  flushPendingSaves();
  if (state.view === 'library') return renderLibraryPanel();
  if (state.view === 'notices') return renderNoticesPanel();
  if (state.view === 'calendar') return renderCalendarPanel();
  if (state.view === 'community') return renderCommunityPanel();
  const c = state.clients.find((x) => x.id === state.selectedId);
  if (!c) {
    ui.panel.replaceChildren(h('div', { class: 'empty' }, h('p', { class: 'muted' }, 'Choose a client to see their notes, workouts and chat.')));
    return;
  }
  const hasAccount = !!c.email;
  const tabList = [['notes', 'Consult notes'], ['workouts', 'Workouts']];
  if (state.sessions) tabList.splice(2, 0, ['sessions', 'Sessions']);
  if (state.lifting) tabList.push(['lifts', 'Lifts']);
  if (hasAccount) tabList.push(['chat', 'Chat']);
  if (!tabList.some(([key]) => key === state.tab)) state.tab = 'notes';
  if (state.tab === 'chat' && state.unread.delete(c.id)) renderClientList();

  const body = h('div', { class: 'tab-body' });
  fill(ui.panel,
    h('div', { class: 'panel-head' },
      h('button', {
        class: 'btn ghost small back',
        onclick: () => { flushPendingSaves(); state.selectedId = null; renderClientList(); renderPanel(); },
      }, '← Clients'),
      h('div', { class: 'panel-title' },
        h('h2', {}, c.full_name),
        h('p', { class: 'muted small' }, [c.email || 'No account yet', payLabel(c.id)].filter(Boolean).join(' · '))),
      h('button', { class: 'btn ghost small', onclick: () => openClientDialog(c) }, 'Edit client')),
    hasAccount ? null : h('div', { class: 'callout' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'No account yet'),
        h('p', {}, `When you're ready, add ${firstName(c.full_name)}'s email to create their account. They can then sign in to see their workouts and goals.`)),
      h('button', { class: 'btn primary small', onclick: () => openClientDialog(c, { focusEmail: true }) }, 'Add email')),
    tabs(tabList, renderPanel),
    body);

  if (state.tab === 'notes') renderConsultNotes(body, c);
  else if (state.tab === 'workouts') renderTrainerWorkouts(body, c);
  else if (state.tab === 'lifts') renderLifts(body, c, { asTrainer: true });
  else if (state.tab === 'sessions') renderSessions(body, { client: c, asTrainer: true });
  else renderChat(body, c.id, 'trainer');
}

function openClientDialog(c, { focusEmail = false } = {}) {
  const name = h('input', { required: true, maxlength: '100', value: c?.full_name || '', autocomplete: 'off' });
  const email = h('input', { type: 'email', value: c?.email || '', autocomplete: 'off', placeholder: 'Add now or later' });
  const currentPay = c ? state.payMethods?.get(c.id) || '' : '';
  const pay = state.payMethods ? h('select', {},
    h('option', { value: '' }, 'Not set'),
    PAY_METHODS.map(([key, label]) => h('option', { value: key, selected: currentPay === key || null }, label))) : null;
  let dlg;
  const extra = c ? h('button', {
    type: 'button',
    class: 'btn danger',
    onclick: async () => {
      if (!confirm(`Delete ${c.full_name}? This also deletes their consult notes, workouts and chat history.`)) return;
      const { error } = await sb.from('clients').delete().eq('id', c.id);
      if (error) return toast(error.message, true);
      dlg.close();
      state.selectedId = null;
      await loadClients();
      renderClientList();
      renderPanel();
      toast('Client deleted');
    },
  }, 'Delete client') : null;

  const emailHint = c?.email
    ? 'This is the email they sign in with. Clearing it removes their access.'
    : "Adding an email creates their account. Then send them the app link so they can sign in.";

  dlg = openDialog({
    title: c ? 'Edit client' : 'New client',
    fields: [
      field('Full name', name),
      field('Email (optional)', email, emailHint),
      pay ? field('How they pay (only you see this)', pay) : null,
    ],
    extra,
    onSubmit: async () => {
      const row = { full_name: name.value.trim(), email: email.value.trim().toLowerCase() || null };
      const query = c
        ? sb.from('clients').update(row).eq('id', c.id).select().single()
        : sb.from('clients').insert(row).select().single();
      const { data, error } = await query;
      if (error) return error.code === '23505' ? 'A client with that email already exists.' : error.message;
      const payValue = pay?.value || null;
      if (pay && payValue !== (state.payMethods.get(data.id) || null)) {
        const { error: payError } = await sb.from('client_notes').upsert({ client_id: data.id, payment_method: payValue });
        if (payError) toast(`Saved, but the payment method didn't save: ${payError.message}`, true);
      }
      await loadClients();
      state.selectedId = data.id;
      if (!c) state.tab = 'notes';
      renderClientList();
      renderPanel();
      if (!c) toast(`${row.full_name} added. Start your consult notes.`);
      else if (!c.email && row.email) toast(`Account created. Send ${firstName(row.full_name)} the app link to sign in.`);
      else toast('Client updated');
    },
  });
  if (focusEmail) email.focus();
}

// ---------------------------------------------------------------------------
// Trainer: private consult notes
// ---------------------------------------------------------------------------

const NOTE_FIELDS = [
  ['injuries', 'Injuries and conditions', 'e.g. L knee ACL repair 2022, no deep lunges yet. Asthma, carries inhaler.'],
  ['goals', 'Goals (in their words)', 'e.g. 10k in May, feel stronger, lift the kids without back pain'],
  ['lifestyle', 'Training history and lifestyle', 'e.g. Ran at uni, gym on and off. Desk job. Free Mon/Wed eve + Sat am'],
  ['other', 'Other notes', 'Anything else worth remembering'],
];

async function renderConsultNotes(body, c) {
  body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  const { data, error } = await sb.from('client_notes').select('*').eq('client_id', c.id).maybeSingle();
  if (!body.isConnected) return;
  if (error) { body.replaceChildren(h('p', { class: 'error' }, error.message)); return; }
  const notes = data || {};
  const first = firstName(c.full_name);

  // Private notes: only the trainer can read these (enforced by the database).
  const status = h('span', { class: 'muted small', 'aria-live': 'polite' });
  const inputs = {};
  const saveNotes = autosaver(async () => {
    const row = { client_id: c.id, consult_date: inputs.consult_date.value || null };
    for (const [key] of NOTE_FIELDS) row[key] = inputs[key].value;
    const { error: saveError } = await sb.from('client_notes').upsert(row);
    if (saveError) throw saveError;
  }, status);
  const autosave = { oninput: saveNotes.schedule, onblur: saveNotes.flush };
  inputs.consult_date = h('input', { type: 'date', value: notes.consult_date || (data ? '' : today()), ...autosave });
  for (const [key, , placeholder] of NOTE_FIELDS) {
    inputs[key] = h('textarea', { rows: '4', value: notes[key] || '', placeholder, ...autosave });
  }

  // Goals the client sees on their own page.
  const sharedStatus = h('span', { class: 'muted small', 'aria-live': 'polite' });
  const goals = h('textarea', { rows: '4', value: c.goals || '', placeholder: 'e.g. Run your first 10k in May, feeling strong and pain-free.' });
  const saveGoals = autosaver(async () => {
    const value = goals.value.trim();
    const { error: saveError } = await sb.from('clients').update({ goals: value }).eq('id', c.id);
    if (saveError) throw saveError;
    c.goals = value;
  }, sharedStatus);
  goals.addEventListener('input', saveGoals.schedule);
  goals.addEventListener('blur', saveGoals.flush);

  const copyNotes = async () => {
    const text = [
      `Client: ${c.full_name}`,
      `Consult date: ${inputs.consult_date.value ? formatDate(inputs.consult_date.value) : 'not set'}`,
      ...NOTE_FIELDS.map(([key, label]) => `## ${label}\n${inputs[key].value.trim() || '(none)'}`),
      `## Goals shown to ${first}\n${goals.value.trim() || '(none yet)'}`,
    ].join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Notes copied. Paste them into a chat with Claude to plan workouts or polish the goals.');
    } catch {
      toast("Couldn't copy automatically. Select the text and copy it instead.", true);
    }
  };

  body.replaceChildren(h('div', { class: 'stack' },
    h('section', { class: 'card notes-card' },
      h('div', { class: 'row-between' }, h('p', { class: 'eyebrow' }, 'Private · only you see this'), status),
      h('h4', {}, 'Initial consult'),
      h('p', { class: 'muted small' }, 'Quick notes are fine. They save as you type.'),
      field('Consult date', inputs.consult_date),
      NOTE_FIELDS.map(([key, label]) => field(label, inputs[key])),
      h('div', { class: 'row-end' }, h('button', { class: 'btn small', onclick: copyNotes }, 'Copy notes'))),
    h('section', { class: 'card shared-card' },
      h('div', { class: 'row-between' }, h('p', { class: 'eyebrow' }, `Visible to ${first}`), sharedStatus),
      h('h4', {}, 'Their goals'),
      h('p', { class: 'muted small' }, `This appears at the top of ${first}'s page as "Your goals". Rewrite the key points from your notes in a friendly, encouraging way.`),
      field('Goals', goals))));
}

// The trainer's view of a client's streak: seals, a high five, and rest weeks.
function trainerStreakCard(c, workouts, excused, refresh) {
  const stats = streakStats(workouts, excused);
  const name = firstName(c.full_name);
  const highFive = c.email ? h('button', { class: 'btn small', onclick: () => openHighFive(c, stats) }, 'Send a high five') : null;
  let restWeeks = null;
  if (excused) {
    // This week, the 7 before (to forgive a past week) and 4 ahead (to plan a holiday).
    const starts = Array.from({ length: 12 }, (_, i) => addDays(stats.weekStart, 7 * (4 - i)));
    const byStart = new Map(stats.weeks.map((w) => [w.start, w]));
    restWeeks = h('details', { class: 'rest-weeks' },
      h('summary', {}, `Rest weeks${excused.size ? ` (${excused.size})` : ''}`),
      h('p', { class: 'muted small' }, `Holiday, illness or a deload? A rest week pauses ${name}'s streak instead of breaking it. ${name} sees it marked "Rest".`),
      h('ul', { class: 'rest-list' }, starts.map((start) => {
        const w = byStart.get(start);
        const isRest = excused.has(start);
        const when = start > stats.weekStart ? 'Coming up' : start === stats.weekStart ? 'This week' : w?.planned ? `${w.done} of ${w.planned} done` : 'Nothing planned';
        return h('li', { class: isRest ? 'is-rest' : null },
          h('span', {}, h('b', {}, `Week of ${shortDay(start)}`), h('span', { class: 'muted small' }, isRest ? `${when} · rest week` : when)),
          h('button', {
            class: 'btn ghost small',
            onclick: async () => {
              const q = sb.from('excused_weeks');
              const { error } = isRest
                ? await q.delete().eq('client_id', c.id).eq('week_start', start)
                : await q.insert({ client_id: c.id, week_start: start });
              if (error) return toast(error.message, true);
              toast(isRest ? 'Rest week removed.' : `Rest week added. ${name}'s streak is safe.`);
              refresh();
            },
          }, isRest ? 'Undo' : 'Make rest week'));
      })));
  }
  return h('section', { class: 'card streak-card' },
    h('div', { class: 'row-between' }, h('p', { class: 'eyebrow' }, 'Streak'), highFive),
    h('p', { class: 'streak-line' }, h('b', {}, String(stats.streak)), ` ${stats.streak === 1 ? 'week' : 'weeks'} in a row · best ${stats.best}`),
    stats.justSealed ? h('p', { class: 'badge' }, `Just earned the ${stats.streak}-week seal`) : null,
    sealRow(stats),
    h('p', { class: 'muted small' }, nextSealText(stats).replace('your', 'the')),
    restWeeks);
}

// A quick message of encouragement, sent into the client's chat.
function openHighFive(c, stats) {
  const name = firstName(c.full_name);
  const text = stats.justSealed
    ? `High five, ${name}! ${stats.streak} weeks in a row and your ${stats.streak}-week seal is earned. So proud of you.`
    : stats.streak > 1
      ? `High five, ${name}! ${stats.streak} weeks in a row. Keep it going!`
      : `High five, ${name}! Great work this week.`;
  const message = h('textarea', { rows: '3', maxlength: '4000', required: true }, text);
  openDialog({
    title: `High five for ${name}`,
    fields: field('Message', message, 'Sent in your chat with them. Change it however you like.'),
    submitLabel: 'Send',
    onSubmit: async () => {
      const body = message.value.trim();
      if (!body) return 'Write a message first.';
      const { error } = await sb.from('messages').insert({ client_id: c.id, sender: 'trainer', body: `🙌 ${body}` });
      if (error) return error.message;
      toast(`High five sent to ${name}.`);
      return null;
    },
  });
}

async function renderTrainerWorkouts(body, c) {
  const list = h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Loading…'));
  const refresh = () => renderTrainerWorkouts(body, c);
  const reminder = h('div');
  const publishAll = h('span');
  const programsEl = h('div');
  const streakEl = h('div');
  const newProgram = h('button', { class: 'btn', hidden: true, onclick: () => openProgramDialog(c, null, refresh) }, '+ New program');
  body.replaceChildren(
    reminder,
    streakEl,
    programsEl,
    h('div', { class: 'row-between' },
      h('h3', {}, 'Workouts'),
      h('div', { class: 'actions' },
        publishAll,
        newProgram,
        h('button', { class: 'btn primary', onclick: () => openWorkoutEditor(c, null, refresh) }, '+ New workout'))),
    list);
  // Programs (hidden until the database has them).
  loadPrograms(c.id).then((programs) => {
    if (!programs || !programsEl.isConnected) return;
    newProgram.hidden = false;
    if (programs.length) {
      fill(programsEl, h('h3', {}, 'Programs'), h('div', { class: 'stack' }, programs.map((pr) => programCard(c, pr, refresh))));
    }
  });
  // A private reminder of injuries while planning (from the consult notes).
  sb.from('client_notes').select('injuries').eq('client_id', c.id).maybeSingle().then(({ data }) => {
    if (data?.injuries?.trim() && reminder.isConnected) reminder.replaceWith(goalsBox('Injuries and conditions · private', data.injuries.trim()));
  });

  const [{ data, error }, ctx, excused] = await Promise.all([
    sb.from('workouts').select('*').eq('client_id', c.id)
      .order('workout_date', { ascending: false, nullsFirst: true })
      .order('created_at', { ascending: false }),
    loadTrainingData(c.id),
    loadExcused(c.id),
  ]);
  if (!list.isConnected) return;
  if (error) { list.replaceChildren(h('p', { class: 'error' }, error.message)); return; }
  const published = data.filter((w) => !w.is_draft);
  if (published.length) streakEl.replaceWith(trainerStreakCard(c, published, excused, refresh));
  if (!data.length) {
    list.replaceChildren(h('p', { class: 'muted' }, `No workouts yet. Create ${firstName(c.full_name)}'s first one.`));
    return;
  }
  const drafts = data.filter((w) => w.is_draft);
  if (drafts.length) {
    publishAll.replaceWith(h('button', {
      class: 'btn',
      onclick: async () => {
        if (!confirm(`Publish ${drafts.length} draft${drafts.length === 1 ? '' : 's'}? ${firstName(c.full_name)} will be able to see ${drafts.length === 1 ? 'it' : 'them'} straight away.`)) return;
        const { error: pubError } = await sb.from('workouts').update({ is_draft: false }).in('id', drafts.map((w) => w.id));
        if (pubError) return toast(pubError.message, true);
        toast(`Published. ${firstName(c.full_name)} can see ${drafts.length === 1 ? 'it' : 'them'} now.`);
        refresh();
      },
    }, `Publish all drafts (${drafts.length})`));
  }
  list.replaceChildren(...data.map((w) => workoutCard(w, {
    onChange: refresh,
    trainerFor: c,
    ...ctx,
    actions: [
      ...(w.is_draft || !state.lifting ? [] : [['Log', () => openLogDialog(w, { clientId: c.id, ...ctx, asTrainer: true, onSaved: refresh })]]),
      ['Edit', () => openWorkoutEditor(c, w, refresh)],
      ['Duplicate', () => openWorkoutEditor(c, { ...w, id: undefined, title: `${w.title} (copy)`, workout_date: today(), completed_at: null, is_draft: true }, refresh)],
      ...(w.is_draft ? [] : [['Unpublish', async () => {
        const { error: upError } = await sb.from('workouts').update({ is_draft: true }).eq('id', w.id);
        if (upError) return toast(upError.message, true);
        toast(`Moved back to drafts. ${firstName(c.full_name)} can't see it now.`);
        refresh();
      }]]),
      ['Delete', async () => {
        if (!confirm(`Delete "${w.title}"?`)) return;
        const { error: delError } = await sb.from('workouts').delete().eq('id', w.id);
        if (delError) return toast(delError.message, true);
        toast('Workout deleted');
        refresh();
      }],
    ],
  })));
}

const blankExercise = () => ({ name: '', exercise_id: '', sets: '', reps: '', pct: '', rm: '1', load: '', rest: '', notes: '' });
const RM_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10];

// opts.template = { label, onSave(payload) } edits a program's workout
// template instead: no date and no publishing; onSave stores it and may
// return an error message.
function openWorkoutEditor(client, workout, onSaved, opts = {}) {
  const tpl = opts.template;
  const isNew = !workout?.id;
  const title = h('input', { required: true, maxlength: '120', value: workout?.title || '', placeholder: 'e.g. Lower body strength' });
  const date = h('input', { type: 'date', value: workout ? (workout.workout_date || '') : today() });
  const notes = h('textarea', { rows: '3', value: workout?.notes || '', placeholder: 'Warm-up, focus points, how it should feel…' });
  const rows = (workout?.exercises || []).map((e) => ({ ...blankExercise(), ...e }));
  if (!rows.length) rows.push(blankExercise());

  const exList = h('div', { class: 'ex-editor' });
  const iconBtn = (label, text, disabled, onclick) =>
    h('button', { type: 'button', class: 'btn ghost icon', 'aria-label': label, title: label, disabled, onclick }, text);

  function drawRows() {
    exList.replaceChildren(...rows.map((r, i) => {
      const input = (key, placeholder, cls, extra = {}) =>
        h('input', { value: r[key] || '', placeholder, 'aria-label': placeholder, class: cls, oninput: (e) => { r[key] = e.target.value; }, ...extra });
      // Small visible labels, so filled-in boxes still say what they are.
      const mini = (label, control) => h('label', { class: 'mini-field' }, h('span', { 'aria-hidden': 'true' }, label), control);
      const rmSelect = h('select', { 'aria-label': 'Percentage of which rep max', onchange: (e) => { r.rm = e.target.value; } },
        RM_CHOICES.map((n) => h('option', { value: String(n), selected: String(r.rm || '1') === String(n) }, `of ${n}RM`)));
      return h('div', { class: 'ex-row' },
        h('div', { class: 'ex-row-head' },
          h('span', { class: 'eyebrow' }, `Exercise ${String(i + 1).padStart(2, '0')}`),
          h('div', { class: 'actions' },
            iconBtn('Move up', '↑', i === 0, () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; drawRows(); }),
            iconBtn('Move down', '↓', i === rows.length - 1, () => { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; drawRows(); }),
            iconBtn('Remove exercise', '✕', false, () => { rows.splice(i, 1); drawRows(); }))),
        input('name', 'Exercise name', 'ex-name', { list: 'library-names', autocomplete: 'off' }),
        h('div', { class: 'ex-grid' },
          mini('Sets', input('sets', 'Sets')),
          mini('Reps', input('reps', 'Reps / time')),
          state.lifting ? mini('% of max', input('pct', '% of max (e.g. 70)', '', { inputmode: 'decimal' })) : null,
          state.lifting ? mini('Of', rmSelect) : null,
          mini('Load', input('load', 'Load (e.g. 20 kg)')),
          mini('Rest', input('rest', 'Rest (e.g. 90s)'))),
        input('notes', 'Coaching notes (optional)'));
    }));
  }
  drawRows();

  openDialog({
    title: tpl ? tpl.label : isNew ? `New workout for ${client.full_name}` : 'Edit workout',
    wide: true,
    altSubmitLabel: tpl ? null : 'Save as draft',
    submitLabel: tpl ? 'Save workout' : workout?.id && !workout.is_draft ? 'Save' : 'Publish',
    fields: [
      field('Title', title),
      tpl ? null : field('Date', date, 'Leave empty for a workout they can do any time.'),
      field('Notes', notes),
      libraryDatalist(),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Exercises'),
        h('span', { class: 'muted small' }, 'Pick from your library or type a new name (new names are added to the library). For a percentage, fill in "% of max" and choose which rep max; the client sees the weight worked out for them.'),
        exList,
        h('button', { type: 'button', class: 'btn', onclick: () => { rows.push(blankExercise()); drawRows(); exList.lastChild?.querySelector('input')?.focus(); } }, '+ Add exercise')),
    ],
    onSubmit: async (action) => {
      const named = rows.filter((r) => r.name.trim());
      for (const r of named) {
        const pct = String(r.pct || '').trim();
        if (pct && !(Number(pct) > 0 && Number(pct) <= 150)) return `"${r.name.trim()}": the percentage should be a number such as 70.`;
      }
      // New exercise names join the library, so it builds itself as you write.
      const newNames = new Map();
      for (const r of named) {
        const key = libKey(r.name);
        if (!state.library.some((x) => libKey(x.name) === key)) newNames.set(key, r.name.trim());
      }
      if (newNames.size && state.lifting) {
        const { error: libError } = await sb.from('exercises').insert([...newNames.values()].map((name) => ({ name })));
        if (libError && libError.code !== '23505') return libError.message;
        await loadLibrary();
      }
      const exercises = named.map((r) => {
        const clean = Object.fromEntries(Object.keys(blankExercise()).map((k) => [k, String(r[k] || '').trim()]));
        clean.exercise_id = findLib({ name: clean.name })?.id || '';
        clean.rm = clean.pct ? clean.rm || '1' : '';
        return clean;
      });
      if (tpl) {
        const problem = await tpl.onSave({ title: title.value.trim(), notes: notes.value.trim(), exercises });
        if (problem) return problem;
        onSaved?.();
        return;
      }
      const payload = {
        client_id: client.id,
        title: title.value.trim(),
        workout_date: date.value || null,
        notes: notes.value.trim(),
        exercises,
        is_draft: action === 'alt',
      };
      const { error } = isNew
        ? await sb.from('workouts').insert(payload)
        : await sb.from('workouts').update(payload).eq('id', workout.id);
      if (error) return error.message;
      toast(payload.is_draft
        ? `Saved as a draft. ${firstName(client.full_name)} can't see it yet.`
        : `Published. ${firstName(client.full_name)} can see it now.`);
      onSaved();
    },
  });
}

// ---------------------------------------------------------------------------
// Shared: workout card
// ---------------------------------------------------------------------------

function workoutCard(w, { actions = [], onChange, trainerFor, maxes = [], logs = [], feedback = null, onLog }) {
  const exercises = Array.isArray(w.exercises) ? w.exercises : [];
  const done = !!w.completed_at;
  const draft = !!w.is_draft;
  const myLogs = logs.filter((l) => l.workout_id === w.id);
  const hasLogs = myLogs.length > 0;
  const who = trainerFor ? firstName(trainerFor.full_name) : null;

  const logBtn = onLog && !draft ? h('button', { class: 'btn' + (!done && !hasLogs ? ' primary' : done ? ' ghost' : ''), onclick: onLog },
    done ? 'View workout' : hasLogs ? 'Continue workout' : 'Start workout') : null;
  const toggle = h('button', {
    class: 'btn' + (done || (onLog && !hasLogs) ? '' : ' primary'),
    onclick: async () => {
      toggle.disabled = true;
      const { error } = await sb.rpc('set_workout_completed', { p_workout_id: w.id, p_done: !done });
      toggle.disabled = false;
      if (error) return toast(error.message, true);
      if (!done) toast('Nice work! Workout marked as done.');
      // Clients get the optional "how were you feeling?" check-in.
      if (!done && !trainerFor && feedback) {
        openCheckinDialog(w, { clientId: w.client_id, existing: feedback.find((f) => f.workout_id === w.id), includeComment: true, onDone: onChange });
      } else onChange();
    },
  }, done ? 'Mark as not done' : 'Mark as done');
  const fb = feedback?.find((f) => f.workout_id === w.id);

  const publish = draft ? h('button', {
    class: 'btn primary',
    onclick: async () => {
      publish.disabled = true;
      const { error } = await sb.from('workouts').update({ is_draft: false }).eq('id', w.id);
      publish.disabled = false;
      if (error) return toast(error.message, true);
      toast(`Published. ${firstName(trainerFor?.full_name)} can see it now.`);
      onChange();
    },
  }, 'Publish') : null;

  return h('article', { class: 'card workout' + (draft ? ' draft' : done ? ' done' : '') },
    h('div', { class: 'row-between top' },
      h('div', {},
        h('p', { class: 'eyebrow' }, [w.workout_date ? formatDate(w.workout_date) : 'Any day', w.program_week ? `Week ${w.program_week}` : null].filter(Boolean).join(' · ')),
        h('h4', {}, w.title),
        draft ? h('span', { class: 'badge' }, `Draft · not visible to ${firstName(trainerFor?.full_name)}`) : null,
        !draft && done ? h('span', { class: 'badge' }, `✓ Done · ${formatDateTime(w.completed_at)}`) : null),
      actions.length ? h('div', { class: 'actions' },
        actions.map(([label, fn]) => h('button', { class: 'btn ghost small' + (label === 'Delete' ? ' danger-text' : ''), onclick: fn }, label))) : null),
    w.notes ? h('p', { class: 'notes' }, w.notes) : null,
    exercises.length
      ? h('ol', { class: 'exercise-list' }, exercises.map((e, i) => {
          const target = state.lifting ? targetFor(e, maxes) : null;
          const sets = myLogs.filter((l) => l.exercise_index === i).sort((a, b) => a.set_number - b.set_number);
          return h('li', {},
            h('span', { class: 'ex-title' }, e.name),
            prescription(e) ? h('span', { class: 'ex-meta' }, prescription(e)) : null,
            target ? h('span', { class: 'ex-target' }, targetText(target, who)) : null,
            e.notes ? h('span', { class: 'ex-notes' }, e.notes) : null,
            sets.length ? h('span', { class: 'ex-logged' }, h('strong', {}, 'Logged: '), sets.map(setText).join(' · ')) : null,
            howTo(e));
        }))
      : h('p', { class: 'muted small' }, 'No exercises listed.'),
    fb ? feedbackBox(fb, who) : null,
    h('div', { class: 'row-end actions' }, draft ? publish : [logBtn, toggle]));
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function renderClientApp() {
  closeChat();
  if (state.activeWorkout) return renderWorkoutPage();
  if (state.activeProgram) return renderProgramPage();
  if (state.tab === 'sessions') state.tab = 'calendar'; // sessions now live on the calendar
  if (state.tab === 'workouts') state.tab = 'program';  // workouts now live under Program
  const body = h('div', { class: 'tab-body' });
  mount(header(), h('main', { class: 'client-main' },
    h('h1', {}, 'Hi ', h('em', {}, firstName(state.me.full_name))),
    tabs([
      // Short labels so all five tabs fit on a phone. Notices live on Home
      // (with a "See all" link), so they don't need a tab of their own.
      ['home', ['Home', unseenNotices() ? h('span', { class: 'dot', title: 'New post' }) : null]],
      ['calendar', 'Calendar'],
      ['program', 'Program'],
      state.lifting ? ['lifts', 'Lifts'] : null,
      ['chat', 'Chat'],
    ].filter(Boolean), renderClientApp),
    body));
  if (state.tab === 'home' || (state.tab === 'notices' && !state.notices) || (state.tab === 'wins' && !state.community)) renderClientHome(body);
  else if (state.tab === 'wins') renderClientWins(body);
  else if (state.tab === 'calendar') renderClientCalendar(body);
  else if (state.tab === 'program' || (state.tab === 'lifts' && !state.lifting)) renderClientProgramTab(body);
  else if (state.tab === 'lifts') renderLifts(body, state.me, { asTrainer: false });
  else if (state.tab === 'notices') renderClientNotices(body);
  else renderChat(body, state.me.id, 'client');
}

// ---------------------------------------------------------------------------
// Client: Program tab (current program, other workouts, past programs)
// ---------------------------------------------------------------------------

// Splits scheduled programs into the current one and past ones. A program
// stays "current" until a week after its last workout.
function sortPrograms(programs, workouts) {
  const todayK = today();
  const scheduled = (programs || []).filter((p) => p.status === 'scheduled').map((p) => {
    const ws = workouts.filter((w) => w.program_id === p.id);
    const dates = ws.map((w) => w.workout_date).filter(Boolean).sort();
    return { p, ws, first: dates[0] || p.start_date, last: dates.at(-1) || p.start_date };
  }).sort((a, b) => (b.first || '').localeCompare(a.first || ''));
  const current = scheduled.find((x) => x.last && x.last >= addDays(todayK, -7)) || null;
  return { current, past: scheduled.filter((x) => x !== current) };
}

// The week a client is up to: the first week with something left to do.
const currentWeekOf = (pr, ws) => Math.min(...ws.filter((w) => !w.completed_at).map((w) => w.program_week || pr.weeks), pr.weeks);

// One workout in a program week.
function programRow(w) {
  const todayK = today();
  const done = !!w.completed_at;
  const isToday = w.workout_date === todayK;
  const missed = !done && w.workout_date && w.workout_date < todayK;
  const n = (w.exercises || []).length;
  const d = w.workout_date ? dateOf(w.workout_date) : null;
  return h('li', { class: 'prog-row' + (done ? ' done' : '') + (isToday ? ' today' : '') + (missed ? ' missed' : '') },
    h('div', { class: 'prog-row-date' },
      h('span', {}, d ? d.toLocaleDateString(undefined, { weekday: 'short' }) : 'Any'),
      h('b', {}, d ? String(d.getDate()) : '–')),
    h('div', { class: 'prog-row-main' },
      h('b', {}, w.title),
      h('span', {}, [`${n} exercise${n === 1 ? '' : 's'}`, done ? '✓ Done' : isToday ? 'Today' : missed ? 'Missed' : null].filter(Boolean).join(' · '))),
    h('button', {
      class: 'btn small' + (!done && (isToday || missed) ? ' primary' : done ? ' ghost' : ''),
      onclick: () => { state.activeWorkout = w.id; renderClientApp(); },
    }, done ? 'View' : isToday || missed ? 'Start' : 'Preview'));
}

// A program's workouts, week by week; the week the client is up to is open.
function programWeeks(pr, ws, openWeek) {
  const byDate = (a, b) => (a.workout_date || '').localeCompare(b.workout_date || '');
  return Array.from({ length: pr.weeks }, (_, i) => i + 1).map((n) => {
    const list = ws.filter((w) => w.program_week === n).sort(byDate);
    if (!list.length) return null;
    const done = list.filter((w) => w.completed_at).length;
    const dates = list.map((w) => w.workout_date).filter(Boolean);
    const range = dates.length ? `${dateOf(dates[0]).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${dateOf(dates.at(-1)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : '';
    return h('details', { class: 'prog-week', open: n === openWeek || null },
      h('summary', {},
        h('span', { class: 'prog-week-title' }, `Week ${n}`),
        h('span', { class: 'muted small' }, range),
        h('span', { class: 'prog-week-count' + (done === list.length ? ' complete' : '') }, done === list.length ? '✓ Done' : `${done}/${list.length}`)),
      h('ol', { class: 'prog-rows' }, list.map(programRow)));
  });
}

// Week number, workouts done and training days as three tiles.
function programFacts(pr, ws) {
  const done = ws.filter((w) => w.completed_at).length;
  const week = ws.length ? currentWeekOf(pr, ws) : 1;
  return h('div', { class: 'program-facts' },
    h('div', {}, h('b', {}, `${done === ws.length && ws.length ? pr.weeks : week}/${pr.weeks}`), h('span', {}, 'weeks')),
    h('div', {}, h('b', {}, `${done}/${ws.length}`), h('span', {}, 'workouts done')),
    h('div', {}, h('b', { class: 'facts-days' }, daysText(pr.training_days) || '–'), h('span', {}, 'training days')));
}

const aimBox = (pr) => (pr.notes ? h('div', { class: 'goals program-aim' }, h('p', { class: 'eyebrow' }, `From ${TRAINER_NAME}`), h('p', {}, pr.notes)) : null);

async function renderClientProgramTab(body) {
  body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  const [{ data, error }, ctx, programs] = await Promise.all([
    sb.from('workouts').select('*').eq('client_id', state.me.id).eq('is_draft', false)
      .order('workout_date', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true }),
    loadTrainingData(state.me.id),
    state.myPrograms !== null ? loadPrograms(state.me.id) : Promise.resolve(null),
  ]);
  if (!body.isConnected) return;
  if (error) { body.replaceChildren(h('p', { class: 'error' }, error.message)); return; }
  if (programs) state.myPrograms = programs;
  const refresh = () => renderClientProgramTab(body);
  const { current, past } = sortPrograms(programs, data);
  const offered = (programs || []).find((p) => p.status === 'offered');
  const inPrograms = new Set([current, ...past].filter(Boolean).flatMap((x) => x.ws.map((w) => w.id)));
  const others = data.filter((w) => !inPrograms.has(w.id));

  const offerCard = offered ? h('section', { class: 'card program-offer' },
    h('p', { class: 'eyebrow' }, `New program from ${TRAINER_NAME}`),
    h('h2', {}, offered.title),
    h('p', { class: 'muted small' }, `${offered.weeks} week${offered.weeks === 1 ? '' : 's'} · ${offered.days_per_week} workout${offered.days_per_week === 1 ? '' : 's'} a week`),
    h('button', { class: 'btn primary block', onclick: () => { state.activeProgram = offered.id; renderClientApp(); } }, 'See it and pick your days →')) : null;

  const currentBlock = current ? h('section', { class: 'program-current' },
    h('p', { class: 'eyebrow' }, `Your program · Week ${currentWeekOf(current.p, current.ws)} of ${current.p.weeks}`),
    h('h2', { class: 'program-title' }, current.p.title),
    aimBox(current.p),
    programFacts(current.p, current.ws),
    h('div', { class: 'stack prog-weeks' }, programWeeks(current.p, current.ws, currentWeekOf(current.p, current.ws))),
    h('div', { class: 'row-end' }, h('button', { class: 'btn ghost small', onclick: () => { state.tab = 'calendar'; renderClientApp(); } }, 'See it on my calendar →')))
    : offered ? null
      : h('div', { class: 'empty' }, h('p', { class: 'muted' }, `No program yet. When ${TRAINER_NAME} sets one up, it'll appear here.`));

  // One-off workouts that aren't part of a program.
  const otherUpcoming = others.filter((w) => !w.completed_at && (!w.workout_date || w.workout_date >= today()));
  const otherPast = others.filter((w) => !otherUpcoming.includes(w)).reverse().slice(0, 10);
  const card = (w) => workoutCard(w, { onChange: refresh, ...ctx, onLog: state.lifting ? () => { state.activeWorkout = w.id; renderClientApp(); } : null });
  const otherBlock = others.length ? h('section', {},
    h('h3', {}, current || offered ? 'Other workouts' : 'Your workouts'),
    otherUpcoming.length ? h('div', { class: 'stack' }, otherUpcoming.map(card)) : null,
    otherPast.length ? h('details', { class: 'prog-week' },
      h('summary', {}, h('span', { class: 'prog-week-title' }, 'Done and past'), h('span', { class: 'muted small' }, `${otherPast.length}`)),
      h('div', { class: 'stack' }, otherPast.map(card))) : null) : null;

  const pastBlock = past.length ? h('section', {},
    h('h3', {}, 'Past programs'),
    h('div', { class: 'stack' }, past.map(({ p, ws, first, last }) => {
      const done = ws.filter((w) => w.completed_at).length;
      return h('button', { class: 'past-program', onclick: () => { state.activeProgram = p.id; renderClientApp(); } },
        h('span', { class: 'past-program-main' },
          h('b', {}, p.title),
          h('span', { class: 'muted small' }, [first && last ? `${shortDay(first)} – ${shortDay(last)}` : null, `${p.weeks} week${p.weeks === 1 ? '' : 's'}`].filter(Boolean).join(' · '))),
        h('span', { class: 'past-program-score' }, `${done}/${ws.length}`, h('small', {}, 'done')));
    }))) : null;

  fill(body, h('div', { class: 'stack program-tab' }, offerCard, currentBlock, otherBlock, pastBlock));
}

// ---------------------------------------------------------------------------
// Client: Home (today, this week, next session, notices, consistency)
// ---------------------------------------------------------------------------

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const dateOf = (key) => new Date(`${key}T12:00`);
const shortDay = (key) => dateOf(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
// Monday of the week a date falls in, as 'YYYY-MM-DD'.
function mondayKey(key) {
  const d = dateOf(key);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(d);
}
const addDays = (key, n) => { const d = dateOf(key); d.setDate(d.getDate() + n); return dayKey(d); };

// ---- Streaks ----
// A week counts when every planned workout in it is done. Weeks with nothing
// planned, and rest weeks the trainer has marked, pause the streak instead of
// breaking it. Seals are earned from the best streak ever, so they're kept
// even after a streak ends.
const STREAK_SEALS = [2, 4, 8, 12, 26, 52];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Rest weeks for a client as a Set of Monday keys, or null when the database
// doesn't have them yet.
async function loadExcused(clientId) {
  const { data, error } = await sb.from('excused_weeks').select('week_start').eq('client_id', clientId);
  if (error) {
    if (!isMissingTable(error)) toast(error.message, true);
    return null;
  }
  return new Set(data.map((r) => r.week_start));
}

// workouts: published workouts only.
function streakStats(workouts, excused, todayK = today()) {
  const weekStart = mondayKey(todayK);
  const countedOn = (w) => w.workout_date || (w.completed_at ? dayKey(new Date(w.completed_at)) : null);
  const planned = new Map();
  const done = new Map();
  const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);
  let first = addDays(weekStart, -7 * 11);
  for (const w of workouts) {
    if (w.workout_date) bump(planned, mondayKey(w.workout_date));
    const k = w.completed_at && countedOn(w);
    if (k) bump(done, mondayKey(k));
    for (const d of [w.workout_date, k]) if (d && mondayKey(d) < first) first = mondayKey(d);
  }
  const weeks = [];
  for (let start = first; start <= weekStart; start = addDays(start, 7)) {
    const p = planned.get(start) || 0;
    const d = done.get(start) || 0;
    weeks.push({ start, keys: Array.from({ length: 7 }, (_, i) => addDays(start, i)), planned: p, done: d, hit: p > 0 && d >= p, excused: !!excused?.has(start) });
  }
  const thisWeek = weeks[weeks.length - 1];
  // A paused week neither adds to nor breaks the streak.
  const paused = (w) => !w.hit && (w.planned === 0 || w.excused);
  let streak = 0;
  for (let i = weeks.length - 2; i >= 0; i--) {
    if (paused(weeks[i])) continue;
    if (weeks[i].hit) streak++; else break;
  }
  if (thisWeek.hit) streak++;
  let best = 0;
  let run = 0;
  for (const w of weeks) {
    if (paused(w)) continue;
    run = w.hit ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const nextSeal = STREAK_SEALS.find((m) => m > best) || null;
  return { weeks, thisWeek, weekStart, streak, best, nextSeal, justSealed: thisWeek.hit && STREAK_SEALS.includes(streak) && streak === best };
}

// The row of milestone seals: earned ones stamped in terracotta, the rest outlined.
function sealRow(stats) {
  return h('ol', { class: 'seals', 'aria-label': 'Streak seals' }, STREAK_SEALS.map((m) => {
    const earned = stats.best >= m;
    return h('li', { class: 'seal' + (earned ? ' earned' : ''), 'aria-label': `${m}-week seal: ${earned ? 'earned' : 'not yet'}` },
      h('i', { 'aria-hidden': 'true' }, h('b', {}, String(m))), h('span', { 'aria-hidden': 'true' }, 'weeks'));
  }));
}
const nextSealText = (stats) => (stats.nextSeal
  ? `${plural(stats.nextSeal - stats.streak, 'more week')} to your ${stats.nextSeal}-week seal.`
  : 'Every seal earned. Incredible.');

// A wax seal stamps onto the screen the first time a week is completed.
function celebrateWeek(stats) {
  const key = `empt-sealed:${state.me.id}:${stats.weekStart}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch { /* storage blocked: celebrate anyway */ }
  const dlg = h('dialog', { class: 'dialog celebrate', 'aria-labelledby': 'celebrate-title' },
    h('div', { class: 'big-seal', 'aria-hidden': 'true' }, h('b', {}, String(stats.streak)), h('span', {}, stats.streak === 1 ? 'week' : 'weeks')),
    h('h2', { id: 'celebrate-title' }, 'Week sealed!'),
    h('p', {}, stats.streak > 1 ? `That's ${stats.streak} weeks in a row. Every workout done.` : 'Every workout done this week. That’s the start of a streak.'),
    stats.justSealed ? h('p', { class: 'seal-earned' }, `You’ve earned your ${stats.streak}-week seal.`) : null,
    h('form', { method: 'dialog' }, h('button', { class: 'btn primary block' }, 'Keep it going')));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// "Back squat 4×8" style lines for a workout, the first few only.
function exerciseLines(w, limit = 4) {
  const list = Array.isArray(w.exercises) ? w.exercises : [];
  const line = (e) => h('li', {}, h('span', {}, e.name), e.sets || e.reps ? h('b', {}, [e.sets, e.reps].filter(Boolean).join('×')) : null);
  return h('ul', { class: 'ex-lines' },
    (list.length > limit ? list.slice(0, limit - 1) : list).map(line),
    list.length > limit ? h('li', { class: 'muted' }, `+${list.length - limit + 1} more`) : null);
}

async function renderClientHome(body) {
  body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  const [{ data, error }, excused, latestWins] = await Promise.all([
    sb.from('workouts').select('id,title,workout_date,exercises,completed_at,created_at,program_id').eq('client_id', state.me.id).eq('is_draft', false),
    loadExcused(state.me.id),
    state.community ? loadWins(2) : [],
    state.notices ? loadNotices() : null,
    state.sessions ? loadSessions(state.me.id) : null,
    state.myPrograms ? loadPrograms(state.me.id).then((p) => { state.myPrograms = p; }) : null,
  ]);
  if (!body.isConnected) return;
  if (error) { body.replaceChildren(h('p', { class: 'error' }, error.message)); return; }

  const workouts = data;
  const todayK = today();
  const weekStart = mondayKey(todayK);
  const open = (w) => { state.activeWorkout = w.id; renderClientApp(); };
  const goTab = (tab) => { state.tab = tab; renderClientApp(); };
  // A workout counts on the day it was planned for; undated ones on the day they were done.
  const countedOn = (w) => w.workout_date || (w.completed_at ? dayKey(new Date(w.completed_at)) : null);
  const plannedOn = (k) => workouts.filter((w) => w.workout_date === k);
  const doneOn = (k) => workouts.filter((w) => w.completed_at && countedOn(w) === k);
  const byDate = (a, b) => (a.workout_date || '9999').localeCompare(b.workout_date || '9999');
  const upcoming = workouts.filter((w) => !w.completed_at && (!w.workout_date || w.workout_date > todayK)).sort(byDate);
  const missedThisWeek = workouts.filter((w) => !w.completed_at && w.workout_date && w.workout_date < todayK && w.workout_date >= weekStart).sort(byDate);
  const nextLine = (w) => (w ? `Next up: ${w.workout_date ? shortDay(w.workout_date) : 'any day'} · ${w.title}` : 'Nothing else planned yet.');

  // ---- Today ----
  const todays = plannedOn(todayK);
  const todo = todays.find((w) => !w.completed_at);
  const sessionToday = (state.sessions || []).find((x) => x.status === 'booked' && dayKey(new Date(x.starts_at)) === todayK && new Date(x.starts_at) > new Date());
  const sessionLine = sessionToday
    ? h('p', { class: 'today-session' }, `Session with ${TRAINER_NAME} at ${timeText(new Date(sessionToday.starts_at))}${sessionToday.location ? ` · ${sessionToday.location}` : ''}`)
    : null;
  let todayCard;
  if (todo) {
    todayCard = h('section', { class: 'card today-card' },
      h('p', { class: 'eyebrow' }, `Today · ${shortDay(todayK)}`),
      h('h2', {}, todo.title),
      exerciseLines(todo),
      todays.filter((w) => !w.completed_at).length > 1 ? h('p', { class: 'muted small' }, `+ ${todays.filter((w) => !w.completed_at).length - 1} more workout today`) : null,
      sessionLine,
      state.lifting ? h('button', { class: 'btn primary block', onclick: () => open(todo) }, 'Start workout →')
        : h('button', { class: 'btn primary block', onclick: () => goTab('program') }, 'See workout →'));
  } else if (todays.length) {
    const doneW = todays[todays.length - 1];
    todayCard = h('section', { class: 'card today-card done' },
      h('p', { class: 'eyebrow' }, `Today · ${shortDay(todayK)}`),
      h('h2', {}, doneW.title),
      h('span', { class: 'badge' }, '✓ Done'),
      h('p', { class: 'today-msg' }, 'Nice work. That one’s in the bank.'),
      h('p', { class: 'muted small' }, nextLine(upcoming[0])),
      sessionLine,
      h('button', { class: 'btn block', onclick: () => (state.lifting ? open(doneW) : goTab('program')) }, 'View workout'));
  } else if (workouts.length) {
    const catchUp = missedThisWeek[0];
    todayCard = h('section', { class: 'card today-card rest' },
      h('p', { class: 'eyebrow' }, `Today · ${shortDay(todayK)}`),
      h('h2', {}, sessionToday ? 'Session day' : 'Rest day'),
      h('p', { class: 'today-msg' }, sessionToday ? 'No workout of your own today.' : 'Recover well: eat, sleep, move gently.'),
      sessionLine,
      catchUp
        ? [h('p', { class: 'muted small' }, `Missed ${dateOf(catchUp.workout_date).toLocaleDateString(undefined, { weekday: 'long' })}'s ${catchUp.title}? Today's a good day to catch up.`),
          h('button', { class: 'btn primary block', onclick: () => (state.lifting ? open(catchUp) : goTab('program')) }, 'Catch up →')]
        : [h('p', { class: 'muted small' }, nextLine(upcoming[0])),
          h('button', { class: 'btn block', onclick: () => goTab('program') }, 'See my program')]);
  } else {
    todayCard = h('section', { class: 'card today-card rest' },
      h('p', { class: 'eyebrow' }, `Today · ${shortDay(todayK)}`),
      h('h2', {}, 'Welcome'),
      h('p', { class: 'today-msg' }, `Your first workout is on its way. ${TRAINER_NAME} will add it here.`),
      sessionLine);
  }

  // ---- Weeks and streak (the chart shows this week and the 11 before) ----
  const stats = streakStats(workouts, excused, todayK);
  const { thisWeek, streak, best } = stats;
  const weeks = stats.weeks.slice(-12);
  const total12 = weeks.reduce((n, w) => n + w.done, 0);

  // ---- This week card ----
  const target = thisWeek.planned;
  const left = Math.max(0, target - thisWeek.done);
  let weekMsg;
  if (!target) weekMsg = thisWeek.done ? `${thisWeek.done} done this week, with nothing else planned.` : 'Nothing planned this week yet.';
  else if (!left) weekMsg = streak > 1 ? `Week done! That's ${streak} weeks in a row.` : 'Week done! Great work.';
  else if (thisWeek.excused) weekMsg = `${TRAINER_NAME} has made this a rest week, so your streak is paused, not lost.`;
  else if (streak > 0) weekMsg = `${left} more to keep your ${streak}-week streak going.`;
  else weekMsg = `${left} to go this week.`;
  const R = 34;
  const C = 2 * Math.PI * R;
  const pct = target ? Math.min(1, thisWeek.done / target) : thisWeek.done ? 1 : 0;
  const ring = svgEl('svg', { viewBox: '0 0 84 84', class: 'ring', role: 'img', 'aria-label': `${thisWeek.done} of ${target} planned workouts done this week` },
    svgEl('circle', { cx: 42, cy: 42, r: R, class: 'ring-bg' }),
    svgEl('circle', { cx: 42, cy: 42, r: R, class: 'ring-fg', 'stroke-dasharray': C.toFixed(2), 'stroke-dashoffset': (C * (1 - pct)).toFixed(2), transform: 'rotate(-90 42 42)' }),
    svgEl('text', { x: 42, y: 41, 'text-anchor': 'middle', class: 'ring-n' }, target ? `${thisWeek.done}/${target}` : String(thisWeek.done)),
    svgEl('text', { x: 42, y: 56, 'text-anchor': 'middle', class: 'ring-l' }, 'workouts'));
  const dots = h('ol', { class: 'week-dots', 'aria-label': 'This week' }, thisWeek.keys.map((k, i) => {
    const planned = plannedOn(k).length;
    const done = doneOn(k).length;
    const state_ = done ? 'done' : k === todayK ? 'today' : planned && k < todayK ? 'missed' : planned ? 'planned' : 'rest';
    const label = { done: 'done', today: planned ? 'today, workout planned' : 'today', missed: 'missed', planned: 'workout planned', rest: 'no workout' }[state_];
    return h('li', { class: `wd ${state_}`, 'aria-label': `${dateOf(k).toLocaleDateString(undefined, { weekday: 'long' })}: ${label}` },
      h('i', { 'aria-hidden': 'true' }, state_ === 'done' ? '✓' : ''), h('span', { 'aria-hidden': 'true' }, DAY_LETTERS[i]));
  }));
  const weekCard = h('section', { class: 'card week-card' },
    h('p', { class: 'eyebrow' }, 'This week'),
    h('div', { class: 'week-top' }, ring, h('div', { class: 'week-side' }, h('p', { class: 'week-msg' }, weekMsg), dots)),
    thisWeek.hit ? h('div', { class: 'week-seal', role: 'img', 'aria-label': `Week sealed: ${plural(streak, 'week')} in a row` },
      h('b', { 'aria-hidden': 'true' }, String(streak)), h('span', { 'aria-hidden': 'true' }, 'in a row')) : null);

  // ---- Next session (when it isn't today) ----
  const nextSession = (state.sessions || []).find((x) => x.status === 'booked' && new Date(x.starts_at) > new Date() && x !== sessionToday);
  const sessionCard_ = nextSession ? h('div', { class: 'callout session-callout' },
    h('div', {}, h('p', { class: 'eyebrow' }, 'Next session'), h('p', {}, sessionLabel(nextSession) + (nextSession.location ? ` · ${nextSession.location}` : ''))),
    h('button', { class: 'btn small', onclick: () => goTab('calendar') }, 'View calendar')) : null;

  // ---- A new program waiting for its days to be picked ----
  const offered = (state.myPrograms || []).find((p) => p.status === 'offered');
  const offerCard = offered ? h('section', { class: 'card program-offer' },
    h('p', { class: 'eyebrow' }, `New program from ${TRAINER_NAME}`),
    h('h2', {}, offered.title),
    h('p', { class: 'muted small' }, `${offered.weeks} week${offered.weeks === 1 ? '' : 's'} · ${offered.days_per_week} workout${offered.days_per_week === 1 ? '' : 's'} a week`),
    h('button', { class: 'btn primary block', onclick: () => { state.activeProgram = offered.id; renderClientApp(); } }, 'See it and pick your days →')) : null;

  // ---- From the trainer: pinned first, newest next ----
  const posts = (state.notices || []).slice(0, 2);
  const noticesBlock = posts.length ? h('section', {},
    h('div', { class: 'row-between' },
      h('h3', {}, `From ${TRAINER_NAME}`),
      h('button', { class: 'btn ghost small', onclick: () => goTab('notices') }, 'See all')),
    h('div', { class: 'stack' }, posts.map((n) => noticeCard(n, { isNew: isUnseen(n), compact: true })))) : null;

  // ---- Consistency ----
  const maxBar = Math.max(1, ...weeks.map((w) => Math.max(w.done, w.planned)));
  const consistency = workouts.length ? h('section', { class: 'card consistency' },
    h('div', { class: 'row-between' }, h('p', { class: 'eyebrow' }, 'Consistency'), h('span', { class: 'muted small' }, 'Last 12 weeks')),
    h('div', { class: 'stats' },
      h('div', {}, h('b', {}, String(streak)), h('span', {}, `week${streak === 1 ? '' : 's'} in a row`)),
      h('div', {}, h('b', {}, String(best)), h('span', {}, 'best streak')),
      h('div', {}, h('b', {}, String(total12)), h('span', {}, 'workouts done'))),
    sealRow(stats),
    h('p', { class: 'muted small' }, `${nextSealText(stats)} Seals are yours to keep, even if a streak ends.`),
    h('div', { class: 'bars', role: 'img', 'aria-label': `Workouts done per week for the last 12 weeks: ${weeks.map((w) => w.done).join(', ')}` },
      weeks.map((w, i) => h('div', { class: 'bar-col' + (w.excused ? ' rest' : ''), title: `Week of ${shortDay(w.start)}: ${w.done} of ${w.planned} done${w.excused ? ' (rest week)' : ''}` },
        h('div', { class: 'bar-track' },
          w.planned ? h('div', { class: 'bar-plan', style: null, 'data-h': w.planned }) : null,
          h('div', { class: `bar ${w.hit ? 'hit' : w.done ? 'part' : ''}`, 'data-h': w.done })),
        h('span', { 'aria-hidden': 'true' }, i === 11 ? 'Now' : w.excused ? 'Rest' : '')))),
    h('p', { class: 'muted small' }, 'Filled bars: every planned workout done that week. The outline shows what was planned.',
      weeks.some((w) => w.excused) ? ` "Rest" weeks from ${TRAINER_NAME} don't break your streak.` : '')) : null;

  fill(body,
    h('div', { class: 'stack home' },
      state.me.goals ? goalsBox('Your goals', state.me.goals) : null,
      offerCard,
      todayCard,
      workouts.length ? weekCard : null,
      sessionCard_,
      noticesBlock,
      winsPreview(latestWins),
      consistency));
  // Bar heights as a share of the tallest week (set here, not inline in the markup).
  for (const el of body.querySelectorAll('[data-h]')) el.style.height = `${(Number(el.dataset.h) / maxBar) * 100}%`;
  if (thisWeek.hit) celebrateWeek(stats);
  shareNewWins(workouts, stats);
}

// ---------------------------------------------------------------------------
// Shared: exercise library, rep maxes and load maths
// ---------------------------------------------------------------------------

// Until the lifting tables exist in the database (supabase/schema.sql), the
// library, lifts and logging features stay hidden instead of showing errors.
const isMissingTable = (error) => ['PGRST205', '42P01', 'PGRST200'].includes(error?.code) || /does not exist|could not find the table/i.test(error?.message || '');

async function loadLibrary() {
  const { data, error } = await sb.from('exercises').select('*').order('name');
  if (error) {
    if (isMissingTable(error)) { state.lifting = false; state.library = []; return; }
    toast(error.message, true);
    return;
  }
  state.lifting = true;
  state.library = data;
}

const libKey = (name) => String(name || '').trim().toLowerCase();
// Finds the library entry for a workout exercise: by id, else by name.
function findLib(e) {
  return state.library.find((x) => e.exercise_id && x.id === e.exercise_id)
    || state.library.find((x) => libKey(x.name) === libKey(e.name))
    || null;
}
const libraryDatalist = () => h('datalist', { id: 'library-names' }, state.library.map((x) => h('option', { value: x.name })));

// Only http(s) links are ever turned into clickable links.
function safeUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

function howTo(e) {
  const lib = findLib(e);
  const video = safeUrl(lib?.video_url);
  if (!lib || (!lib.cues && !video)) return null;
  return h('details', { class: 'howto' },
    h('summary', {}, 'How to'),
    lib.cues ? h('p', {}, lib.cues) : null,
    video ? h('a', { class: 'btn small', href: video, target: '_blank', rel: 'noopener noreferrer' }, 'Watch demo ↗') : null);
}

// Everything the workout cards need besides the workouts themselves.
// feedback is null when the database doesn't have that table yet, which
// hides the comments and check-in features.
async function loadTrainingData(clientId) {
  const fbRes = await sb.from('workout_feedback').select('*').eq('client_id', clientId);
  const feedback = fbRes.error ? (isMissingTable(fbRes.error) ? null : (toast(fbRes.error.message, true), [])) : fbRes.data;
  if (!state.lifting) return { maxes: [], logs: [], feedback };
  const [maxRes, logRes] = await Promise.all([
    sb.from('client_maxes').select('*').eq('client_id', clientId).order('tested_on', { ascending: false }),
    sb.from('set_logs').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(2000),
  ]);
  if (maxRes.error) toast(maxRes.error.message, true);
  if (logRes.error) toast(logRes.error.message, true);
  return { maxes: maxRes.data || [], logs: logRes.data || [], feedback };
}

// Load maths. Weights are rounded to ROUND_TO_KG (set in config.js) so they
// can be loaded with real plates. Missing maxes are estimated from other rep
// maxes with the Epley formula: 1RM = weight × (1 + reps ÷ 30).
const roundLoad = (kg) => Math.round(kg / ROUND_TO_KG) * ROUND_TO_KG;
const kg = (n) => `${Number(Number(n).toFixed(2))} kg`;
const epley1rm = (weight, reps) => (reps <= 1 ? weight : weight * (1 + reps / 30));
const epleyRm = (oneRm, reps) => (reps <= 1 ? oneRm : oneRm / (1 + reps / 30));

// The current (most recent) max for each rep count of one exercise.
function latestMaxes(maxes, exerciseId) {
  const latest = new Map();
  for (const m of maxes) {
    if (m.exercise_id !== exerciseId) continue;
    const cur = latest.get(m.reps);
    if (!cur || m.tested_on > cur.tested_on || (m.tested_on === cur.tested_on && m.created_at > cur.created_at)) latest.set(m.reps, m);
  }
  return latest;
}
const bestE1rm = (latest) => Math.max(0, ...[...latest.values()].map((m) => epley1rm(Number(m.weight_kg), m.reps)));

// For "70% of 1RM" style prescriptions: the weight to lift.
function targetFor(e, maxes) {
  const pct = Number(e.pct);
  if (!(pct > 0)) return null;
  const rm = parseInt(e.rm, 10) || 1;
  const lib = findLib(e);
  const latest = lib ? latestMaxes(maxes, lib.id) : new Map();
  const exact = latest.get(rm);
  if (exact) return { pct, rm, base: Number(exact.weight_kg), estimated: false, kg: roundLoad((Number(exact.weight_kg) * pct) / 100) };
  const one = bestE1rm(latest);
  if (!one) return { pct, rm, missing: true };
  const base = epleyRm(one, rm);
  return { pct, rm, base, estimated: true, kg: roundLoad((base * pct) / 100) };
}

function prescription(e) {
  return [
    e.sets && `${e.sets} sets`,
    e.reps && `${e.reps} reps`,
    Number(e.pct) > 0 && `${e.pct}% of ${parseInt(e.rm, 10) || 1}RM`,
    e.load,
    e.rest && `rest ${e.rest}`,
  ].filter(Boolean).join(' · ');
}

// who = client's first name when the trainer is looking, null for the client.
function targetText(t, who) {
  if (t.missing) return who ? `No ${t.rm}RM recorded for ${who} yet` : `Add your ${t.rm}RM in the Lifts tab to see your weight`;
  const basis = `${t.estimated ? 'estimated ' : ''}${t.rm}RM ${kg(Math.round(t.base * 10) / 10)}`;
  return `${who ? `${who}: ` : 'Your weight: '}${kg(t.kg)} (${t.pct}% of ${basis})`;
}

const setText = (l) => [l.weight_kg != null ? kg(l.weight_kg) : null, l.reps != null ? `× ${l.reps}` : null].filter(Boolean).join(' ')
  + (l.rpe != null ? ` @ ${Number(l.rpe)}` : '');

const SOURCE_LABEL = { trainer: `Set by ${TRAINER_NAME}`, client: 'Added by you', logged: 'From a workout' };

// ---------------------------------------------------------------------------
// Shared: logging a workout
// ---------------------------------------------------------------------------

function openLogDialog(w, { clientId, maxes, logs, feedback = null, asTrainer, onSaved }) {
  const exercises = Array.isArray(w.exercises) ? w.exercises : [];
  const done = !!w.completed_at;
  const existing = logs.filter((l) => l.workout_id === w.id);
  const askFeedback = !asTrainer && !!feedback;
  const existingFb = feedback?.find((f) => f.workout_id === w.id);
  const comment = askFeedback ? h('textarea', { rows: '3', maxlength: '4000', value: existingFb?.comment || '', placeholder: 'How did it go? Anything you want to tell me: what felt good, what felt hard, any pain…' }) : null;

  const blocks = exercises.map((e, i) => {
    const target = targetFor(e, maxes);
    const previous = previousSets(w, e, logs);
    const planKg = target && !target.missing ? target.kg : previous?.at(-1)?.weight_kg ?? '';
    const planReps = Number.isFinite(parseInt(e.reps, 10)) ? parseInt(e.reps, 10) : '';
    const logged = existing.filter((l) => l.exercise_index === i).sort((a, b) => a.set_number - b.set_number);
    const rows = logged.length
      ? logged.map((l) => ({ weight: l.weight_kg ?? '', reps: l.reps ?? '', rpe: l.rpe ?? '' }))
      : Array.from({ length: Math.min(Math.max(parseInt(e.sets, 10) || 1, 1), 10) }, () => ({ weight: '', reps: '', rpe: '' }));

    const setsEl = h('div', { class: 'set-rows' });
    const num = (r, key, placeholder, step, label) => h('input', {
      type: 'number', inputmode: 'decimal', min: '0', step, value: r[key], placeholder: String(placeholder), 'aria-label': label,
      oninput: (ev) => { r[key] = ev.target.value; },
    });
    const draw = () => setsEl.replaceChildren(
      h('div', { class: 'set-row set-head', 'aria-hidden': 'true' }, h('span', {}, 'Set'), h('span', {}, 'kg'), h('span', {}, 'Reps'), h('span', {}, 'Effort'), h('span')),
      ...rows.map((r, j) => h('div', { class: 'set-row' },
        h('span', { class: 'set-num' }, String(j + 1)),
        num(r, 'weight', planKg, '0.5', `${e.name} set ${j + 1} weight in kg`),
        num(r, 'reps', planReps, '1', `${e.name} set ${j + 1} reps`),
        num(r, 'rpe', '1–10', '0.5', `${e.name} set ${j + 1} effort out of 10`),
        h('button', { type: 'button', class: 'btn icon', 'aria-label': `Remove set ${j + 1}`, title: 'Remove set', onclick: () => { rows.splice(j, 1); draw(); } }, '✕'))));
    draw();

    const el = h('section', { class: 'log-ex' },
      h('p', { class: 'eyebrow' }, String(i + 1).padStart(2, '0')),
      h('h4', {}, e.name),
      prescription(e) ? h('p', { class: 'ex-meta' }, prescription(e)) : null,
      target ? h('p', { class: 'ex-target' }, targetText(target, asTrainer ? 'Target' : null)) : null,
      previous ? h('p', { class: 'muted small' }, `Last time: ${previous.map(setText).join(' · ')}`) : null,
      setsEl,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn small', onclick: () => { rows.push({ weight: rows.at(-1)?.weight ?? '', reps: '', rpe: '' }); draw(); } }, '+ Add set'),
        planKg !== '' || planReps !== '' ? h('button', {
          type: 'button', class: 'btn ghost small',
          onclick: () => { for (const r of rows) { if (r.weight === '') r.weight = planKg; if (r.reps === '') r.reps = planReps; } draw(); },
        }, 'Fill in the plan') : null));
    return { e, i, rows, el };
  });

  openDialog({
    title: w.title,
    wide: true,
    submitLabel: done ? 'Save' : 'Save and mark as done',
    altSubmitLabel: done ? null : 'Save',
    fields: [
      h('p', { class: 'muted small' }, 'Enter what you actually lifted. Empty sets are skipped. Effort is how hard it felt out of 10 (10 = nothing left). Grey numbers are the plan.'),
      exercises.length ? blocks.map((b) => b.el) : h('p', { class: 'muted' }, 'This workout has no exercises to log.'),
      comment ? h('div', { class: 'log-ex' }, field(`Comments for ${TRAINER_NAME} (optional)`, comment)) : null,
    ],
    onSubmit: async (action) => {
      const { rowsToSave, problem } = collectLogRows(blocks, w, clientId);
      if (problem) return problem;
      const { error: saveError, prs } = await saveLog(w, { clientId, rowsToSave, maxes, comment: comment ? comment.value.trim() : null });
      if (saveError) return saveError;
      if (action === 'primary' && !done) {
        const { error: doneError } = await sb.rpc('set_workout_completed', { p_workout_id: w.id, p_done: true });
        if (doneError) toast(doneError.message, true);
      }
      toast(prs.length
        ? `New best! ${prs.map((p) => `${p.name} ${p.reps}RM ${kg(p.weight)}`).join(', ')}`
        : asTrainer ? 'Log saved.' : action === 'primary' && !done ? 'Nice work! Workout logged and marked as done.' : 'Log saved.');
      if (askFeedback) {
        // Opens once the log dialog has closed. Skipping still refreshes.
        setTimeout(() => openCheckinDialog(w, { clientId, existing: existingFb, onDone: onSaved }), 0);
      } else onSaved();
    },
  });
}

// The sets from the most recent other workout in which this exercise was logged.
function previousSets(w, e, logs) {
  const lib = findLib(e);
  const same = logs.filter((l) => l.workout_id !== w.id
    && ((lib && l.exercise_id === lib.id) || libKey(l.exercise_name) === libKey(e.name)));
  if (!same.length) return null;
  const newest = same.reduce((a, b) => (a.created_at > b.created_at ? a : b));
  return same.filter((l) => l.workout_id === newest.workout_id).sort((a, b) => a.set_number - b.set_number);
}

// Turns entered sets into rows for set_logs. Empty sets are skipped.
function collectLogRows(blocks, w, clientId) {
  const rowsToSave = [];
  for (const b of blocks) {
    const lib = findLib(b.e);
    let n = 0;
    for (const r of b.rows) {
      const weight = r.weight === '' || r.weight == null ? null : Number(r.weight);
      const reps = r.reps === '' || r.reps == null ? null : parseInt(r.reps, 10);
      const rpe = r.rpe === '' || r.rpe == null ? null : Number(r.rpe);
      if (weight == null && reps == null) continue;
      if (rpe != null && !(rpe >= 1 && rpe <= 10)) return { problem: `${b.e.name}: effort should be between 1 and 10.` };
      if (weight != null && !(weight >= 0 && weight < 1000)) return { problem: `${b.e.name}: check the weight.` };
      rowsToSave.push({
        client_id: clientId, workout_id: w.id, exercise_index: b.i, exercise_id: lib?.id ?? null,
        exercise_name: b.e.name, set_number: ++n, weight_kg: weight, reps, rpe,
      });
    }
  }
  return { rowsToSave };
}

// Replaces the saved sets for a workout (and the client's comment, when
// given), then records any new bests. Returns { error } or { prs }.
async function saveLog(w, { clientId, rowsToSave, maxes, comment = null }) {
  const { error: delError } = await sb.from('set_logs').delete().eq('workout_id', w.id).eq('client_id', clientId);
  if (delError) return { error: delError.message };
  if (rowsToSave.length) {
    const { error: insError } = await sb.from('set_logs').insert(rowsToSave);
    if (insError) return { error: insError.message };
  }
  if (comment != null) {
    const { error: fbError } = await sb.from('workout_feedback').upsert({ workout_id: w.id, client_id: clientId, comment });
    if (fbError) return { error: fbError.message };
  }
  return { prs: await recordNewBests(rowsToSave, maxes, clientId) };
}

// A logged set counts as a new best when it beats the strongest current max
// for that exercise (compared as an estimated 1RM). It is then saved as a
// rep max for its rep count. Exercises with no maxes yet are skipped, so
// ordinary working sets never turn into "maxes".
async function recordNewBests(rows, maxes, clientId) {
  const best = new Map();
  for (const r of rows) {
    if (!r.exercise_id || !(r.weight_kg > 0) || !(r.reps >= 1 && r.reps <= 10)) continue;
    const latest = latestMaxes(maxes, r.exercise_id);
    const current = bestE1rm(latest);
    if (!current || epley1rm(r.weight_kg, r.reps) <= current + 1e-9) continue;
    const key = `${r.exercise_id}:${r.reps}`;
    const sameReps = latest.get(r.reps);
    if (sameReps && r.weight_kg <= Number(sameReps.weight_kg)) continue;
    if (!best.has(key) || r.weight_kg > best.get(key).weight) best.set(key, { exercise_id: r.exercise_id, name: r.exercise_name, reps: r.reps, weight: r.weight_kg });
  }
  if (!best.size) return [];
  const { error } = await sb.from('client_maxes').insert([...best.values()].map((b) => ({
    client_id: clientId, exercise_id: b.exercise_id, reps: b.reps, weight_kg: b.weight, tested_on: today(), source: 'logged',
  })));
  if (error) { toast(error.message, true); return []; }
  for (const b of best.values()) {
    postWin(clientId, 'pb', `pb:${b.exercise_id}:${b.reps}:${b.weight}`, `hit a new ${b.reps}RM: ${b.name || 'a lift'} ${b.weight} kg`);
  }
  return [...best.values()];
}

// ---------------------------------------------------------------------------
// Client: "Start workout" page with rest timer and plate calculator
// ---------------------------------------------------------------------------

// Barbell exercises show the plate calculator. The library's tick box wins;
// without one, the name is used as a guide.
const BARBELL_HINT = /\b(barbell|bb)\b|back squat|front squat|deadlift|bench press|overhead press|military press|good ?morning|hip thrust|clean|snatch|jerk|pendlay|zercher/i;
const NOT_BARBELL = /dumbbell|\bdb\b|kettlebell|\bkb\b|goblet|cable|machine|smith|trap bar|hex bar|band|bodyweight|landmine/i;
const guessBarbell = (name) => BARBELL_HINT.test(name || '') && !NOT_BARBELL.test(name || '');
function isBarbell(e) {
  const lib = 'is_barbell' in e ? e : findLib(e);
  return typeof lib?.is_barbell === 'boolean' ? lib.is_barbell : guessBarbell(e.name);
}

// "90s", "2 min", "1:30", "2-3 min" -> seconds (the lower end of a range).
function parseRest(text) {
  const t = String(text || '').toLowerCase().replace(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*\d+(?:\.\d+)?/g, '$1').trim();
  const clock = t.match(/^(\d+):(\d{1,2})$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  let total = 0;
  for (const [, n, unit] of t.matchAll(/(\d+(?:\.\d+)?)\s*(m(?:in(?:ute)?s?)?\b|s(?:ec(?:ond)?s?)?\b)?/g)) {
    total += unit && unit.startsWith('m') ? Number(n) * 60 : Number(n);
  }
  return total > 0 && total <= 1800 ? Math.round(total) : null;
}
const clockText = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

// Small per-device memory (timer length, bar choice, unfinished entries).
function remember(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(`empt:${key}`));
    if (value === null) localStorage.removeItem(`empt:${key}`); else localStorage.setItem(`empt:${key}`, JSON.stringify(value));
  } catch { return null; }
  return null;
}

// Rest timer: set the length with - / +, then Start rest. Counts down from a
// fixed end time, so it stays right even if the phone throttles the page.
function restTimer() {
  let duration = Number(remember('rest-seconds')) || 90;
  let endsAt = null;
  let ticker = null;
  let audio = null;
  const time = h('span', { class: 'timer-time' });
  const label = h('span', { class: 'eyebrow' }, 'Rest timer');
  const announce = h('span', { class: 'sr-only', 'aria-live': 'assertive' });
  const step = (d) => h('button', { type: 'button', class: 'btn icon timer-step', 'aria-label': d < 0 ? 'Shorter rest (15 seconds)' : 'Longer rest (15 seconds)', onclick: () => setDuration(duration + d) }, d < 0 ? '−' : '+');
  const startBtn = h('button', { type: 'button', class: 'btn primary small', onclick: () => start() }, 'Start rest');
  const addBtn = h('button', { type: 'button', class: 'btn small', onclick: () => { endsAt += 15000; update(); } }, '+15s');
  const stopBtn = h('button', { type: 'button', class: 'btn ghost small', onclick: () => stop() }, 'Stop');
  const idle = h('div', { class: 'timer-controls' }, step(-15), time, step(15), startBtn);
  const running = h('div', { class: 'timer-controls', hidden: true }, addBtn, stopBtn);
  const el = h('div', { class: 'rest-bar', role: 'timer' }, label, idle, running, announce);

  function show() {
    const isRunning = endsAt != null;
    el.classList.toggle('running', isRunning);
    running.hidden = !isRunning;
    for (const b of idle.querySelectorAll('button')) b.hidden = isRunning;
    if (!isRunning) time.textContent = clockText(duration);
  }
  function setDuration(sec) {
    duration = Math.min(Math.max(Math.round(sec / 5) * 5, 15), 600);
    remember('rest-seconds', duration);
    show();
  }
  function start(sec) {
    if (sec) setDuration(sec);
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { audio = null; }
    el.classList.remove('finished');
    label.textContent = 'Resting';
    endsAt = Date.now() + duration * 1000;
    clearInterval(ticker);
    ticker = setInterval(update, 250);
    show();
    update();
  }
  function update() {
    if (endsAt == null) return;
    const left = Math.ceil((endsAt - Date.now()) / 1000);
    if (left <= 0) return finish();
    time.textContent = clockText(left);
  }
  function stop() {
    clearInterval(ticker);
    endsAt = null;
    label.textContent = 'Rest timer';
    show();
  }
  function finish() {
    stop();
    el.classList.add('finished');
    label.textContent = 'Rest over';
    time.textContent = 'Go!';
    announce.textContent = 'Rest over. Time for your next set.';
    try { navigator.vibrate?.([300, 150, 300]); } catch { /* not supported */ }
    if (audio) {
      for (const t of [0, 0.35, 0.7]) {
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, audio.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.3, audio.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.25);
        o.connect(g).connect(audio.destination);
        o.start(audio.currentTime + t);
        o.stop(audio.currentTime + t + 0.3);
      }
    }
    setTimeout(() => { if (endsAt == null) { el.classList.remove('finished'); show(); } }, 5000);
  }
  show();
  return { el, start, setDuration, destroy: () => { clearInterval(ticker); audio?.close?.(); } };
}

// Which plates go on each side of the bar.
function platesFor(total, bar) {
  if (!(total > 0)) return null;
  if (total < bar) return { tooLight: true };
  let side = (total - bar) / 2;
  const plates = [];
  for (const p of PLATES_KG) {
    while (side >= p - 1e-9) { plates.push(p); side -= p; }
  }
  const loaded = bar + 2 * plates.reduce((a, b) => a + b, 0);
  return { plates, loaded, exact: Math.abs(loaded - total) < 1e-6 };
}

const svgEl = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids.flat());
  return el;
};

// Real-world sizes in mm: [diameter, thickness]. Bumper plates from 10 to
// 25 kg are all 450 mm across and differ in thickness; change plates
// (5 kg and lighter) are much smaller.
const PLATE_MM = { 25: [450, 60], 20: [450, 52], 15: [450, 42], 10: [450, 32], 5: [230, 26], 2.5: [190, 21], 1.25: [160, 16] };
// Bars: shaft and sleeve diameter, loadable sleeve length (mm).
const BAR_MM = { 20: { shaft: 28, sleeve: 50, sleeveLength: 415 }, 15: { shaft: 25, sleeve: 50, sleeveLength: 320 } };
// Light writing on red, blue and green plates; dark writing on yellow,
// white and silver ones.
const DARK_PLATES = new Set([25, 20, 10, 2.5]);

// Draws ONE side of the bar to scale: part of the shaft, the collar, then
// the sleeve with the plates on it. (The other side is loaded the same.)
function barbellPicture(plates, bar) {
  const mm = 0.3;               // drawing units per mm
  const thick = 0.45;           // plate thickness is exaggerated a little so the numbers fit
  const minThick = 13;
  const dims = BAR_MM[bar] || BAR_MM[20];
  const shaftLen = 250 * mm, collarLen = 30 * mm, collarDia = 70 * mm;
  const sleeveLen = dims.sleeveLength * mm;
  const W = shaftLen + collarLen + BAR_MM[20].sleeveLength * mm + 4;
  const H = 450 * mm + 12;
  const mid = H / 2;
  const sleeveStart = shaftLen + collarLen;
  const shape = (p) => {
    const [dia, t] = PLATE_MM[p] || [Math.min(450, 120 + p * 14), 20];
    return [dia * mm, Math.max(t * thick, minThick)];
  };
  // Squeeze if a very heavy load would run off the sleeve.
  const totalThick = plates.reduce((a, p) => a + shape(p)[1] + 1.5, 0);
  const squeeze = Math.min(1, (sleeveLen - 4) / Math.max(totalThick, 1));
  const parts = [
    svgEl('rect', { class: 'bar-shaft', x: 0, y: mid - (dims.shaft * mm) / 2, width: shaftLen, height: dims.shaft * mm }),
    svgEl('rect', { class: 'bar-collar', x: shaftLen, y: mid - collarDia / 2, width: collarLen, height: collarDia, rx: 1.5 }),
    svgEl('rect', { class: 'bar-sleeve', x: sleeveStart, y: mid - (dims.sleeve * mm) / 2, width: sleeveLen, height: dims.sleeve * mm, rx: 2 }),
    svgEl('text', { class: 'bar-label', x: shaftLen / 2, y: mid - 10, 'text-anchor': 'middle' }, `${bar} kg bar`),
  ];
  // Heaviest plates go on first, next to the collar.
  let x = sleeveStart + 1;
  for (const p of plates) {
    const [ph, pt] = shape(p);
    const t = pt * squeeze;
    const cx = x + t / 2;
    const cls = `plate plate-${String(p).replace('.', '-')}`;
    parts.push(
      svgEl('rect', { class: cls, x, y: mid - ph / 2, width: t, height: ph, rx: 2.5 }),
      svgEl('rect', { class: 'plate-rim', x: x + 2, y: mid - ph / 2 + 2, width: Math.max(t - 4, 1), height: ph - 4, rx: 2 }),
      svgEl('text', {
        class: `plate-label ${DARK_PLATES.has(p) ? 'on-dark' : 'on-light'}`,
        x: cx, y: mid, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        transform: `rotate(-90 ${cx} ${mid})`,
      }, String(p)),
    );
    x += t + 1.5;
  }
  return svgEl('svg', { viewBox: `0 0 ${W.toFixed(1)} ${H.toFixed(1)}`, class: 'barbell-svg', 'aria-hidden': 'true', focusable: 'false' }, parts);
}

// "20 kg bar", "2 × 25 kg plates each side", … heaviest first.
function plateLines(plates, bar) {
  const counts = new Map();
  for (const p of plates) counts.set(p, (counts.get(p) || 0) + 1);
  return [
    `${bar} kg bar`,
    ...[...counts].map(([p, n]) => `${n} × ${p} kg plate${n === 1 ? '' : 's'} each side`),
  ];
}

// The plate calculator for one exercise. update(kg) redraws it.
function plateCalculator(signal) {
  const body = h('div', { class: 'plates-body' });
  const barChoice = () => (BARS_KG.includes(Number(remember('bar-kg'))) ? Number(remember('bar-kg')) : BARS_KG[0]);
  const toggles = BARS_KG.map((b) => h('button', {
    type: 'button',
    class: 'chip-toggle',
    'aria-pressed': String(barChoice() === b),
    onclick: () => { remember('bar-kg', b); document.dispatchEvent(new Event('empt-bar-change')); },
  }, `${b} kg bar`));
  let current = null;
  const el = h('div', { class: 'plates' },
    h('div', { class: 'row-between' }, h('p', { class: 'eyebrow' }, 'Plates'), h('div', { class: 'chips', role: 'group', 'aria-label': 'Bar weight' }, toggles)),
    body);
  function update(kgValue) {
    current = Number(kgValue) > 0 ? Number(kgValue) : null;
    const bar = barChoice();
    toggles.forEach((t, i) => t.setAttribute('aria-pressed', String(BARS_KG[i] === bar)));
    if (current == null) {
      fill(body, h('p', { class: 'muted small' }, 'Enter a weight to see which plates to load.'));
      return;
    }
    const r = platesFor(current, bar);
    if (r.tooLight) {
      fill(body, h('p', { class: 'small' }, `${kg(current)} is lighter than the ${bar} kg bar. Use a lighter bar or dumbbells.`));
      return;
    }
    fill(body,
      h('div', { class: 'plates-picture' }, barbellPicture(r.plates, bar), h('p', { class: 'plates-caption' }, 'One side shown')),
      h('div', { class: 'plates-list' },
        h('p', { class: 'plates-total' }, kg(r.exact ? current : r.loaded)),
        h('ul', {}, plateLines(r.plates, bar).map((line) => h('li', {}, line))),
        r.plates.length ? null : h('p', { class: 'muted small' }, 'Just the bar, no plates.'),
        r.exact ? null : h('p', { class: 'muted small' }, `${kg(current)} can't be made exactly with standard plates, so this is the closest.`)));
  }
  document.addEventListener('empt-bar-change', () => update(current), { signal });
  return { el, update };
}

// Keeps the screen on during a workout, where the phone allows it.
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock?.request('screen');
    else { await wakeLock?.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => { if (state.activeWorkout) keepAwake(true); });

async function renderWorkoutPage() {
  const id = state.activeWorkout;
  const clientId = state.me.id;
  mount(header(), h('main', { class: 'client-main workout-page' }, h('p', { class: 'muted' }, 'Loading…')));
  const [{ data: w, error }, ctx] = await Promise.all([
    sb.from('workouts').select('*').eq('id', id).maybeSingle(),
    loadTrainingData(clientId),
  ]);
  if (state.activeWorkout !== id) return;
  if (error || !w) {
    toast(error?.message || 'That workout is no longer available.', true);
    state.activeWorkout = null;
    return renderClientApp();
  }

  const page = new AbortController();
  const timer = restTimer();
  keepAwake(true);
  const leave = () => {
    page.abort();
    timer.destroy();
    keepAwake(false);
    state.activeWorkout = null;
    renderClientApp();
  };

  const exercises = Array.isArray(w.exercises) ? w.exercises : [];
  const done = !!w.completed_at;
  const existing = ctx.logs.filter((l) => l.workout_id === w.id);
  const fb = ctx.feedback?.find((f) => f.workout_id === w.id);
  const draftKey = `workout-draft:${w.id}`;
  const draft = remember(draftKey);
  if (draft) toast('Picked up where you left off on this device.');
  const persist = () => remember(draftKey, { rows: blocks.map((b) => b.rows), comment: comment?.value ?? '' });

  const blocks = exercises.map((e, i) => {
    const target = targetFor(e, ctx.maxes);
    const previous = previousSets(w, e, ctx.logs);
    const planKg = target && !target.missing ? target.kg : previous?.at(-1)?.weight_kg ?? '';
    const planReps = Number.isFinite(parseInt(e.reps, 10)) ? parseInt(e.reps, 10) : '';
    const rest = parseRest(e.rest);
    const logged = existing.filter((l) => l.exercise_index === i).sort((a, b) => a.set_number - b.set_number);
    const rows = draft?.rows?.[i]
      || (logged.length
        ? logged.map((l) => ({ weight: l.weight_kg ?? '', reps: l.reps ?? '', rpe: l.rpe ?? '', done: true }))
        : Array.from({ length: Math.min(Math.max(parseInt(e.sets, 10) || 1, 1), 10) }, () => ({ weight: '', reps: '', rpe: '', done: false })));
    const plates = isBarbell(e) ? plateCalculator(page.signal) : null;
    const latestWeight = () => [...rows].reverse().find((r) => r.weight !== '' && r.weight != null)?.weight ?? planKg;

    const setsEl = h('div', { class: 'set-rows' });
    const num = (r, key, placeholder, stepSize, label) => h('input', {
      type: 'number', inputmode: 'decimal', min: '0', step: stepSize, value: r[key] ?? '', placeholder: String(placeholder), 'aria-label': label,
      oninput: (ev) => { r[key] = ev.target.value; persist(); if (key === 'weight') plates?.update(ev.target.value || planKg); },
      onfocus: () => { if (key === 'weight') plates?.update(r.weight || planKg); },
    });
    const draw = () => setsEl.replaceChildren(
      h('div', { class: 'set-row set-head', 'aria-hidden': 'true' }, h('span', {}, 'Set'), h('span', {}, 'kg'), h('span', {}, 'Reps'), h('span', {}, 'Effort'), h('span', {}, 'Done')),
      ...rows.map((r, j) => h('div', { class: 'set-row' + (r.done ? ' done' : '') },
        h('span', { class: 'set-num' }, String(j + 1)),
        num(r, 'weight', planKg, '0.5', `${e.name} set ${j + 1} weight in kg`),
        num(r, 'reps', planReps, '1', `${e.name} set ${j + 1} reps`),
        num(r, 'rpe', '1–10', '0.5', `${e.name} set ${j + 1} effort out of 10`),
        h('button', {
          type: 'button',
          class: 'set-check',
          'aria-pressed': String(!!r.done),
          'aria-label': `Set ${j + 1} of ${e.name} done${rest ? `, then rest ${clockText(rest)}` : ''}`,
          title: r.done ? 'Done' : 'Mark as done and start rest',
          onclick: () => {
            r.done = !r.done;
            if (r.done) {
              if (r.weight === '' || r.weight == null) r.weight = planKg;
              if (r.reps === '' || r.reps == null) r.reps = planReps;
              timer.start(rest || undefined);
            }
            persist();
            draw();
            plates?.update(latestWeight());
          },
        }, '✓'))));
    draw();
    plates?.update(latestWeight());

    const el = h('section', { class: 'card log-ex' },
      h('p', { class: 'eyebrow' }, String(i + 1).padStart(2, '0')),
      h('h2', {}, e.name),
      prescription(e) ? h('p', { class: 'ex-meta' }, prescription(e)) : null,
      target ? h('p', { class: 'ex-target' }, targetText(target, null)) : null,
      e.notes ? h('p', { class: 'ex-notes' }, e.notes) : null,
      previous ? h('p', { class: 'muted small' }, `Last time: ${previous.map(setText).join(' · ')}`) : null,
      howTo(e),
      rest ? h('button', { type: 'button', class: 'btn ghost small rest-pick', onclick: () => timer.setDuration(rest) }, `Use ${clockText(rest)} rest`) : null,
      plates?.el,
      setsEl,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn small', onclick: () => { rows.push({ weight: rows.at(-1)?.weight ?? '', reps: '', rpe: '', done: false }); persist(); draw(); } }, '+ Add set'),
        rows.length ? h('button', { type: 'button', class: 'btn ghost small', onclick: () => { if (rows.length) { rows.pop(); persist(); draw(); } } }, '− Remove last set') : null,
        planKg !== '' || planReps !== '' ? h('button', {
          type: 'button', class: 'btn ghost small',
          onclick: () => { for (const r of rows) { if (r.weight === '') r.weight = planKg; if (r.reps === '') r.reps = planReps; } persist(); draw(); plates?.update(latestWeight()); },
        }, 'Fill in the plan') : null));
    return { e, i, rows, el };
  });

  const comment = ctx.feedback ? h('textarea', {
    rows: '3', maxlength: '4000', value: draft?.comment ?? fb?.comment ?? '',
    placeholder: 'How did it go? Anything you want to tell me: what felt good, what felt hard, any pain…',
  }) : null;
  comment?.addEventListener('input', persist);

  const saveBtn = h('button', { class: 'btn', onclick: () => finish(false) }, done ? 'Save changes' : 'Save for later');
  const finishBtn = done ? null : h('button', { class: 'btn primary', onclick: () => finish(true) }, 'Finish workout');
  async function finish(markDone) {
    const { rowsToSave, problem } = collectLogRows(blocks, w, clientId);
    if (problem) return toast(problem, true);
    saveBtn.disabled = true;
    if (finishBtn) finishBtn.disabled = true;
    const { error: saveError, prs } = await saveLog(w, { clientId, rowsToSave, maxes: ctx.maxes, comment: comment ? comment.value.trim() : null });
    saveBtn.disabled = false;
    if (finishBtn) finishBtn.disabled = false;
    if (saveError) return toast(saveError, true);
    if (markDone) {
      const { error: doneError } = await sb.rpc('set_workout_completed', { p_workout_id: w.id, p_done: true });
      if (doneError) toast(doneError.message, true);
    }
    remember(draftKey, null);
    toast(prs.length
      ? `New best! ${prs.map((p) => `${p.name} ${p.reps}RM ${kg(p.weight)}`).join(', ')}`
      : markDone ? 'Nice work! Workout finished.' : 'Saved. Come back to it any time.');
    if (markDone && ctx.feedback) openCheckinDialog(w, { clientId, existing: fb, onDone: leave });
    else leave();
  }

  mount(header(), h('main', { class: 'client-main workout-page' },
    timer.el,
    h('button', { class: 'btn ghost small back-link', onclick: leave }, '← Back'),
    h('p', { class: 'eyebrow' }, [w.workout_date ? formatDate(w.workout_date) : 'Any day', w.program_week ? `Week ${w.program_week}` : null].filter(Boolean).join(' · ')),
    h('h1', {}, w.title),
    w.notes ? h('p', { class: 'lead' }, w.notes) : null,
    h('p', { class: 'muted small' }, 'Enter what you lift as you go, and tap ✓ when a set is done: it starts your rest timer. Grey numbers are the plan. Effort is how hard it felt out of 10.'),
    exercises.length ? h('div', { class: 'stack' }, blocks.map((b) => b.el)) : h('p', { class: 'muted' }, 'This workout has no exercises listed.'),
    comment ? h('section', { class: 'card' }, field(`Comments for ${TRAINER_NAME} (optional)`, comment)) : null,
    h('div', { class: 'row-end actions workout-finish' }, saveBtn, finishBtn)));
}

// ---------------------------------------------------------------------------
// Client: "how were you feeling?" check-in after a workout
// ---------------------------------------------------------------------------

// Keys are stored in the database; labels can be reworded freely.
const FACTORS = [
  ['period', 'On my period'],
  ['night_shift', 'Night shift'],
  ['poor_sleep', 'Poor sleep'],
  ['tired', 'Tired'],
  ['stressed', 'Stressed'],
  ['unwell', 'Feeling unwell'],
  ['sore', 'Still sore'],
  ['niggle', 'Pain or niggle'],
  ['under_fuelled', 'Not eaten enough'],
  ['short_on_time', 'Short on time'],
  ['felt_great', 'Felt great'],
];
const factorLabel = (key) => FACTORS.find(([k]) => k === key)?.[1] || key;

function openCheckinDialog(w, { clientId, existing, includeComment = false, onDone }) {
  const chosen = new Set(existing?.factors || []);
  const chips = FACTORS.map(([key, label]) => {
    const chip = h('button', {
      type: 'button',
      class: 'chip-toggle',
      'aria-pressed': String(chosen.has(key)),
      onclick: () => {
        if (chosen.has(key)) chosen.delete(key); else chosen.add(key);
        chip.setAttribute('aria-pressed', String(chosen.has(key)));
      },
    }, label);
    return chip;
  });
  const note = h('input', { maxlength: '1000', value: existing?.factors_note || '', placeholder: 'e.g. Third night shift in a row' });
  const comment = includeComment
    ? h('textarea', { rows: '3', maxlength: '4000', value: existing?.comment || '', placeholder: 'How did it go? What felt good, what felt hard, any pain…' })
    : null;

  const dlg = openDialog({
    title: 'How were you feeling?',
    cancelLabel: 'Skip',
    submitLabel: 'Save',
    fields: [
      h('p', { class: 'muted small' }, `Anything that might have affected today's session? Totally optional. It just helps ${TRAINER_NAME} plan your training. Only ${TRAINER_NAME} sees this.`),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Things that affected this session' }, chips),
      field('Anything else? (optional)', note),
      comment ? field(`Comments for ${TRAINER_NAME} (optional)`, comment) : null,
    ],
    onSubmit: async () => {
      const row = { workout_id: w.id, client_id: clientId, factors: [...chosen], factors_note: note.value.trim() };
      if (comment) row.comment = comment.value.trim();
      const { error } = await sb.from('workout_feedback').upsert(row);
      if (error) return error.message;
      toast(`Thanks! ${TRAINER_NAME} will see this.`);
    },
  });
  // Runs whether they saved or skipped.
  dlg.addEventListener('close', () => onDone?.());
}

// who = client's first name when the trainer is looking, null for the client.
function feedbackBox(fb, who) {
  const factors = fb.factors || [];
  if (!factors.length && !fb.factors_note && !fb.comment) return null;
  return h('div', { class: 'feedback' },
    h('p', { class: 'eyebrow' }, who ? `${who}'s notes` : 'Your notes'),
    factors.length ? h('div', { class: 'chips' }, factors.map((k) => h('span', { class: 'chip' }, factorLabel(k)))) : null,
    fb.factors_note ? h('p', { class: 'small' }, fb.factors_note) : null,
    fb.comment ? h('p', { class: 'feedback-comment' }, fb.comment) : null);
}

// ---------------------------------------------------------------------------
// Shared: lifts (rep maxes)
// ---------------------------------------------------------------------------

async function renderLifts(body, c, { asTrainer }) {
  body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  const { data, error } = await sb.from('client_maxes').select('*').eq('client_id', c.id)
    .order('tested_on', { ascending: false }).order('created_at', { ascending: false });
  if (!body.isConnected) return;
  if (error) { body.replaceChildren(h('p', { class: 'error' }, error.message)); return; }
  const refresh = () => renderLifts(body, c, { asTrainer });
  const first = firstName(c.full_name);

  const byExercise = new Map();
  for (const m of data) {
    if (!byExercise.has(m.exercise_id)) byExercise.set(m.exercise_id, []);
    byExercise.get(m.exercise_id).push(m);
  }
  const nameOf = (id) => state.library.find((x) => x.id === id)?.name || 'Exercise';
  const cards = [...byExercise.entries()]
    .sort(([a], [b]) => nameOf(a).localeCompare(nameOf(b)))
    .map(([exerciseId, rows]) => {
      const latest = latestMaxes(rows, exerciseId);
      const chips = [...latest.values()].sort((a, b) => a.reps - b.reps)
        .map((m) => h('span', { class: 'chip' }, `${m.reps}RM ${kg(m.weight_kg)}`));
      if (!latest.has(1)) chips.unshift(h('span', { class: 'chip estimate' }, `Est. 1RM ${kg(Math.round(bestE1rm(latest) * 10) / 10)}`));
      return h('article', { class: 'card' },
        h('h4', {}, nameOf(exerciseId)),
        h('div', { class: 'chips' }, chips),
        h('details', { class: 'howto' },
          h('summary', {}, `History (${rows.length})`),
          rows.map((m) => h('div', { class: 'history-row' },
            h('span', {}, `${formatDate(m.tested_on)} · ${m.reps}RM ${kg(m.weight_kg)}`),
            h('span', { class: 'muted small' }, asTrainer ? { trainer: 'Set by you', client: `Added by ${first}`, logged: 'From a workout' }[m.source] : SOURCE_LABEL[m.source]),
            asTrainer || m.source !== 'trainer' ? h('button', {
              class: 'btn ghost small danger-text',
              onclick: async () => {
                if (!confirm(`Remove this ${m.reps}RM (${kg(m.weight_kg)})?`)) return;
                const { error: delError } = await sb.from('client_maxes').delete().eq('id', m.id);
                if (delError) return toast(delError.message, true);
                refresh();
              },
            }, 'Remove') : null))));
    });

  fill(body,
    h('div', { class: 'row-between' },
      h('h3', {}, 'Rep maxes'),
      h('button', { class: 'btn primary', onclick: () => openMaxDialog(c, { asTrainer, onSaved: refresh }) }, '+ Add a max')),
    h('p', { class: 'muted small' }, asTrainer
      ? `Record ${first}'s 1RM, 3RM, 5RM and so on. Workouts prescribed as a % of a max show ${first} the weight to use. New bests ${first} logs are added automatically.`
      : `Your best lifts. When ${TRAINER_NAME} sets a weight as a % of one of these, the app works out the weight for you. New bests you log are added automatically.`),
    cards.length ? h('div', { class: 'stack' }, cards) : h('p', { class: 'muted' }, 'No maxes recorded yet.'));
}

function openMaxDialog(c, { asTrainer, onSaved }) {
  const exercise = h('input', { required: true, list: 'library-names', autocomplete: 'off', placeholder: 'e.g. Back squat' });
  const reps = h('select', {}, RM_CHOICES.map((n) => h('option', { value: String(n) }, n === 1 ? '1RM (one rep max)' : `${n}RM (${n} rep max)`)));
  const weight = h('input', { type: 'number', inputmode: 'decimal', min: '0.5', step: '0.5', required: true, placeholder: 'e.g. 80' });
  const date = h('input', { type: 'date', value: today(), required: true });
  openDialog({
    title: 'Add a max',
    submitLabel: 'Save',
    fields: [libraryDatalist(), field('Exercise', exercise), field('Rep max', reps), field('Weight (kg)', weight), field('Date', date)],
    onSubmit: async () => {
      let lib = findLib({ name: exercise.value });
      if (!lib) {
        if (!asTrainer) return `Choose an exercise from the list. Ask ${TRAINER_NAME} to add it if it isn't there.`;
        const { error: libError } = await sb.from('exercises').insert({ name: exercise.value.trim() });
        if (libError && libError.code !== '23505') return libError.message;
        await loadLibrary();
        lib = findLib({ name: exercise.value });
        if (!lib) return 'Could not add that exercise to the library.';
      }
      const value = Number(weight.value);
      if (!(value > 0 && value < 1000)) return 'Enter the weight in kg.';
      const { error } = await sb.from('client_maxes').insert({
        client_id: c.id, exercise_id: lib.id, reps: Number(reps.value), weight_kg: value, tested_on: date.value,
        source: asTrainer ? 'trainer' : 'client',
      });
      if (error) return error.message;
      toast(`${lib.name} ${reps.value}RM saved.`);
      onSaved();
    },
  });
}

// ---------------------------------------------------------------------------
// Sessions and calendar
// ---------------------------------------------------------------------------

// Trainer: every session. Client: their own (the database filters them).
async function loadSessions(clientId) {
  let query = sb.from('sessions').select('*').order('starts_at');
  if (clientId) query = query.eq('client_id', clientId);
  const { data, error } = await query;
  if (error) {
    if (!isMissingTable(error)) toast(error.message, true);
    state.sessions = null;
    return;
  }
  state.sessions = data;
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const timeText = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
// e.g. "Tue 3 Dec, 6:00 pm" in the viewer's own time zone.
function sessionLabel(x) {
  const d = new Date(x.starts_at);
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${timeText(d)}`;
}
function upcomingLabel(sessions) {
  const n = sessions.filter((x) => x.status === 'booked' && new Date(x.starts_at) > new Date()).length;
  return n ? `${n} upcoming session${n === 1 ? '' : 's'}` : 'No upcoming sessions';
}
const hoursUntil = (x) => (new Date(x.starts_at) - new Date()) / 3600000;

// A month grid (Monday first) with a dot for each session on a day.
function calendarGrid(sessions, onChange) {
  const now = new Date();
  if (!state.cal.month) state.cal.month = new Date(now.getFullYear(), now.getMonth(), 1);
  if (!state.cal.day) state.cal.day = dayKey(now);
  const month = state.cal.month;
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  if (days[35].getMonth() !== month.getMonth()) days.length = 35;
  const byDay = new Map();
  for (const x of sessions) {
    const k = dayKey(new Date(x.starts_at));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(x);
  }
  const shift = (n) => { state.cal.month = new Date(month.getFullYear(), month.getMonth() + n, 1); onChange(); };
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' }));
  return h('div', { class: 'calendar' },
    h('div', { class: 'cal-head' },
      h('button', { type: 'button', class: 'btn icon', 'aria-label': 'Previous month', onclick: () => shift(-1) }, '‹'),
      h('h4', {}, month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
      h('button', { type: 'button', class: 'btn icon', 'aria-label': 'Next month', onclick: () => shift(1) }, '›')),
    h('div', { class: 'cal-grid', role: 'grid' },
      weekdays.map((w) => h('span', { class: 'cal-weekday', 'aria-hidden': 'true' }, w)),
      days.map((d) => {
        const k = dayKey(d);
        const list = byDay.get(k) || [];
        const booked = list.filter((x) => x.status === 'booked').length;
        return h('button', {
          type: 'button',
          class: 'cal-day' + (d.getMonth() !== month.getMonth() ? ' other-month' : '') + (k === dayKey(now) ? ' today' : '') + (k === state.cal.day ? ' selected' : ''),
          'aria-pressed': String(k === state.cal.day),
          'aria-label': `${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}${list.length ? `, ${booked} session${booked === 1 ? '' : 's'}${list.length > booked ? `, ${list.length - booked} cancelled` : ''}` : ''}`,
          onclick: () => { state.cal.day = k; onChange(); },
        },
          h('span', { class: 'cal-num' }, String(d.getDate())),
          list.length ? h('span', { class: 'cal-dots', 'aria-hidden': 'true' },
            list.slice(0, 3).map((x) => h('span', { class: 'cal-dot' + (x.status === 'cancelled' ? ' cancelled' : '') }))) : null);
      })));
}

// One session. who = client name (trainer view) or null (client view).
function sessionCard(x, { who = null, actions = [] } = {}) {
  const start = new Date(x.starts_at);
  const end = new Date(start.getTime() + x.duration_min * 60000);
  const cancelled = x.status === 'cancelled';
  const byWhom = x.cancelled_by === 'trainer' ? (who ? 'you' : TRAINER_NAME) : (who ? firstName(who) : 'you');
  return h('article', { class: 'card session' + (cancelled ? ' cancelled' : '') },
    h('div', { class: 'row-between top' },
      h('div', {},
        h('p', { class: 'eyebrow' }, start.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })),
        h('h4', {}, `${timeText(start)} – ${timeText(end)}`),
        h('p', { class: 'muted small' }, [who, x.location, `${x.duration_min} min`].filter(Boolean).join(' · ')),
        cancelled ? h('span', { class: 'badge' }, `Cancelled by ${byWhom}`) : null),
      actions.length ? h('div', { class: 'actions' },
        actions.map(([label, fn, cls = '']) => h('button', { class: `btn ${cls || 'ghost small'}`, onclick: fn }, label))) : null),
    x.notes ? h('p', { class: 'notice-body' }, x.notes) : null,
    cancelled && x.cancel_reason ? h('p', { class: 'muted small' }, `Reason: ${x.cancel_reason}`) : null);
}

function openCancelDialog(x, { asTrainer, onDone }) {
  const reason = h('textarea', { rows: '3', maxlength: '500', placeholder: asTrainer ? 'Optional: the client sees this in chat' : `Optional: let ${TRAINER_NAME} know why` });
  const late = !asTrainer && hoursUntil(x) < LATE_CANCEL_HOURS;
  openDialog({
    title: 'Cancel this session?',
    submitLabel: 'Cancel session',
    cancelLabel: 'Keep it',
    danger: true,
    fields: [
      h('p', {}, h('strong', {}, sessionLabel(x)), x.location ? ` · ${x.location}` : ''),
      late ? h('p', { class: 'callout warning' }, `This is less than ${LATE_CANCEL_HOURS} hours' notice. ${TRAINER_NAME}'s cancellation policy may still apply.`) : null,
      field('Reason (optional)', reason),
      h('p', { class: 'muted small' }, asTrainer ? 'A message about the cancellation is posted in your chat with the client.' : `${TRAINER_NAME} is notified straight away with a message in your chat.`),
    ],
    onSubmit: async () => {
      const { error } = await sb.rpc('cancel_session', { p_session_id: x.id, p_reason: reason.value.trim(), p_label: sessionLabel(x) });
      if (error) return error.message;
      toast(asTrainer ? 'Session cancelled. The client has been sent a message.' : `Session cancelled. ${TRAINER_NAME} has been notified.`);
      onDone();
    },
  });
}

const DURATIONS = [30, 45, 60, 75, 90, 120];

// Book (x = null) or edit a session. client = fixed client, or null to choose one.
function openSessionDialog(x, { client = null, onSaved }) {
  const start = x ? new Date(x.starts_at) : null;
  const who = client ? null : h('select', { required: true },
    h('option', { value: '' }, 'Choose a client'),
    state.clients.map((c) => h('option', { value: c.id, selected: x?.client_id === c.id || null }, c.full_name)));
  const date = h('input', { type: 'date', required: true, value: start ? dayKey(start) : state.cal.day || today() });
  const time = h('input', { type: 'time', required: true, step: '60', value: start ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}` : '' });
  const duration = h('select', {}, DURATIONS.map((m) => h('option', { value: String(m), selected: (x?.duration_min ?? 60) === m || null }, `${m} minutes`)));
  const location = h('input', { maxlength: '200', value: x?.location || '', placeholder: 'e.g. Studio, Park, Online' });
  const notes = h('textarea', { rows: '2', maxlength: '2000', value: x?.notes || '', placeholder: 'Optional: what to bring, focus of the session…' });
  const repeat = x ? null : h('select', {}, [1, 2, 4, 6, 8, 12].map((n) => h('option', { value: String(n) }, n === 1 ? 'Just this once' : `Every week for ${n} weeks`)));
  openDialog({
    title: x ? 'Edit session' : client ? `Book a session for ${client.full_name}` : 'Book a session',
    submitLabel: x ? 'Save' : 'Book',
    fields: [
      who ? field('Client', who) : null,
      h('div', { class: 'two-col' }, field('Date', date), field('Start time', time)),
      field('Length', duration),
      field('Location', location),
      field('Notes', notes),
      repeat ? field('Repeat', repeat) : null,
    ],
    onSubmit: async () => {
      const clientId = client?.id || who.value;
      if (!clientId) return 'Choose a client.';
      const first = new Date(`${date.value}T${time.value}`);
      if (Number.isNaN(first.getTime())) return 'Check the date and time.';
      const base = { client_id: clientId, duration_min: Number(duration.value), location: location.value.trim(), notes: notes.value.trim() };
      if (x) {
        const { error } = await sb.from('sessions').update({ ...base, starts_at: first.toISOString() }).eq('id', x.id);
        if (error) return error.message;
        toast('Session updated');
      } else {
        const weeks = Number(repeat.value);
        const rows = Array.from({ length: weeks }, (_, i) => {
          const d = new Date(first);
          d.setDate(d.getDate() + 7 * i); // keeps the same local time across clock changes
          return { ...base, starts_at: d.toISOString() };
        });
        const { error } = await sb.from('sessions').insert(rows);
        if (error) return error.message;
        toast(weeks === 1 ? 'Session booked' : `${weeks} weekly sessions booked`);
      }
      state.cal.day = date.value;
      state.cal.month = new Date(first.getFullYear(), first.getMonth(), 1);
      onSaved();
    },
  });
}

// Client view (asTrainer false), one client (trainer), or everyone (client null).
async function renderSessions(body, { client, asTrainer }) {
  const refresh = async () => {
    await loadSessions(asTrainer ? undefined : client.id);
    if (asTrainer) renderClientList();
    if (body.isConnected) renderSessions(body, { client, asTrainer });
  };
  const all = state.sessions || [];
  const mine = client ? all.filter((x) => x.client_id === client.id) : all;
  const nameOf = (x) => (asTrainer && !client ? state.clients.find((c) => c.id === x.client_id)?.full_name || 'Client' : null);
  const now = new Date();
  const actionsFor = (x) => {
    if (x.status !== 'booked') return asTrainer ? [['Delete', () => deleteSession(x, refresh), 'ghost small danger-text']] : [];
    if (!asTrainer) return new Date(x.starts_at) > now ? [['Cancel session', () => openCancelDialog(x, { asTrainer: false, onDone: refresh }), 'small danger']] : [];
    return [
      ['Edit', () => openSessionDialog(x, { client, onSaved: refresh })],
      ['Cancel', () => openCancelDialog(x, { asTrainer: true, onDone: refresh })],
      ['Delete', () => deleteSession(x, refresh), 'ghost small danger-text'],
    ];
  };
  const card = (x) => sessionCard(x, { who: asTrainer ? (nameOf(x) || client?.full_name) : null, actions: actionsFor(x) });

  const upcoming = mine.filter((x) => x.status === 'booked' && new Date(x.starts_at) > now).slice(0, client ? 5 : 10);
  const onDay = mine.filter((x) => dayKey(new Date(x.starts_at)) === (state.cal.day || dayKey(now)));
  const rerender = () => renderSessions(body, { client, asTrainer });
  const selectedLabel = new Date(`${state.cal.day || dayKey(now)}T12:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  fill(body,
    h('div', { class: 'row-between' },
      h('h3', {}, 'Upcoming'),
      asTrainer ? h('button', { class: 'btn primary', onclick: () => openSessionDialog(null, { client, onSaved: refresh }) }, '+ Book session') : null),
    upcoming.length
      ? h('div', { class: 'stack' }, upcoming.map(card))
      : h('p', { class: 'muted' }, asTrainer ? 'No upcoming sessions booked.' : `No upcoming sessions. ${TRAINER_NAME} will book them here.`),
    h('h3', {}, 'Calendar'),
    h('div', { class: 'cal-wrap' },
      calendarGrid(mine, rerender),
      h('div', { class: 'cal-day-list' },
        h('p', { class: 'eyebrow' }, selectedLabel),
        onDay.length ? h('div', { class: 'stack' }, onDay.map(card)) : h('p', { class: 'muted small' }, 'Nothing booked on this day.'))));
}

async function deleteSession(x, onDone) {
  if (!confirm(`Delete the session on ${sessionLabel(x)}? This removes it completely (the client is not sent a message). To let them know, use Cancel instead.`)) return;
  const { error } = await sb.from('sessions').delete().eq('id', x.id);
  if (error) return toast(error.message, true);
  toast('Session deleted');
  onDone();
}

function renderCalendarPanel() {
  const body = h('div', { class: 'tab-body' });
  fill(ui.panel,
    h('div', { class: 'panel-head' },
      h('button', { class: 'btn ghost small back', onclick: () => { state.view = 'client'; renderClientList(); renderPanel(); } }, '← Clients'),
      h('div', { class: 'panel-title' },
        h('h2', {}, 'Calendar'),
        h('p', { class: 'muted small' }, 'All booked sessions. Clients can cancel their own; you get a message in their chat when they do.'))),
    body);
  renderSessions(body, { client: null, asTrainer: true });
}

// ---------------------------------------------------------------------------
// Programs: a block of the same workouts each week (only loads change)
// ---------------------------------------------------------------------------

const WEEKDAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
const isoDow = (key) => ((dateOf(key).getDay() + 6) % 7) + 1;
const letter = (i) => String.fromCharCode(65 + i); // A, B, C…
const daysText = (days) => (days || []).map((d) => WEEKDAYS[d - 1]?.[1]).filter(Boolean).join(', ');

// null when the database doesn't have programs yet (the features stay hidden).
async function loadPrograms(clientId) {
  const { data, error } = await sb.from('programs').select('*').eq('client_id', clientId).order('created_at', { ascending: false });
  if (error) {
    if (!isMissingTable(error)) toast(error.message, true);
    return null;
  }
  return data;
}

// The dates schedule_program() will use: the picked weekdays from the start
// date onwards, in order, until every workout has a day.
function previewSchedule(days, start, count) {
  const out = [];
  let k = start;
  for (let guard = 0; out.length < count && guard < 400; guard++) {
    if (days.includes(isoDow(k))) out.push(k);
    k = addDays(k, 1);
  }
  return out;
}

// Seven day toggles; exactly `need` of them can be on.
function dayPicker(need, initial = []) {
  const chosen = new Set(initial);
  const listeners = [];
  const count = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const update = () => {
    count.textContent = chosen.size === need ? `${need} of ${need} picked.` : `${chosen.size} of ${need} picked. Pick ${need - chosen.size} more.`;
    listeners.forEach((f) => f());
  };
  const buttons = WEEKDAYS.map(([n, label]) => {
    const b = h('button', {
      type: 'button',
      class: 'chip-toggle day-chip',
      'aria-pressed': String(chosen.has(n)),
      onclick: () => {
        if (chosen.has(n)) chosen.delete(n);
        else if (chosen.size < need) chosen.add(n);
        else return toast(`That's ${need} days already. Untick one to swap it.`);
        b.setAttribute('aria-pressed', String(chosen.has(n)));
        update();
      },
    }, label);
    return b;
  });
  update();
  return {
    el: h('div', {}, h('div', { class: 'chips day-chips', role: 'group', 'aria-label': 'Training days' }, buttons), count),
    days: () => [...chosen].sort((a, b) => a - b),
    onChange: (f) => listeners.push(f),
  };
}

// Day picker + start date + a sentence previewing the plan.
function schedulePicker(pr) {
  const n = pr.days_per_week;
  const total = pr.weeks * n;
  const picker = dayPicker(n, pr.training_days || []);
  const start = h('input', { type: 'date', value: today(), min: today(), required: true });
  const preview = h('p', { class: 'program-preview', 'aria-live': 'polite' });
  const ready = () => picker.days().length === n && !!start.value;
  const refresh = () => {
    if (!ready()) { preview.textContent = `Pick ${n} day${n === 1 ? '' : 's'} to see the plan.`; return; }
    const dates = previewSchedule(picker.days(), start.value, total);
    const first = pr.templates?.[0]?.title || 'Workout A';
    preview.textContent = `First workout: ${first} on ${shortDay(dates[0])}. Last of ${total}: ${shortDay(dates.at(-1))}.`;
  };
  picker.onChange(refresh);
  start.addEventListener('input', refresh);
  refresh();
  return {
    el: h('div', { class: 'schedule-picker' }, picker.el, field('Start on', start), preview),
    ready,
    onChange: (f) => { picker.onChange(f); start.addEventListener('input', f); },
    schedule: () => sb.rpc('schedule_program', { p_program_id: pr.id, p_days: picker.days(), p_start: start.value }),
  };
}

const templatesDone = (pr) => (pr.templates || []).length === pr.days_per_week && pr.templates.every((t) => t && t.title);

// Trainer: one program, with its workout slots and actions.
function programCard(c, pr, refresh) {
  const n = pr.days_per_week;
  const who = firstName(c.full_name);
  const ready = templatesDone(pr);
  const status = {
    draft: `Draft · not visible to ${who}`,
    offered: `Sent · waiting for ${who} to pick days`,
    scheduled: `On the calendar · ${daysText(pr.training_days)} from ${pr.start_date ? shortDay(pr.start_date) : ''}`,
  }[pr.status];
  const editTemplate = (i) => {
    const t = pr.templates?.[i];
    openWorkoutEditor(c, t ? { title: t.title, notes: t.notes, exercises: t.exercises } : null, refresh, {
      template: {
        label: `${pr.title}: workout ${letter(i)}`,
        onSave: async (payload) => {
          const templates = Array.from({ length: n }, (_, k) => pr.templates?.[k] || null);
          templates[i] = payload;
          const { error } = await sb.from('programs').update({ templates }).eq('id', pr.id);
          if (error) return error.message;
          toast(`Workout ${letter(i)} saved.`);
          return null;
        },
      },
    });
  };
  const slots = h('ol', { class: 'program-slots' }, Array.from({ length: n }, (_, i) => {
    const t = pr.templates?.[i];
    return h('li', {},
      h('span', { class: 'slot-letter', 'aria-hidden': 'true' }, letter(i)),
      h('span', { class: 'slot-name' }, t?.title || h('span', { class: 'muted' }, 'Not written yet'),
        t ? h('span', { class: 'muted small' }, ` · ${t.exercises?.length || 0} exercise${t.exercises?.length === 1 ? '' : 's'}`) : null),
      pr.status === 'scheduled' ? null : h('button', { class: 'btn ghost small', onclick: () => editTemplate(i) }, t ? 'Edit' : 'Write'));
  }));
  const actions = [
    ['Edit details', () => openProgramDialog(c, pr, refresh)],
    pr.status === 'draft' && ready && c.email ? [`Send to ${who}`, async () => {
      if (!confirm(`Send "${pr.title}" to ${who}? They'll be asked to pick their training days.`)) return;
      const { error } = await sb.from('programs').update({ status: 'offered' }).eq('id', pr.id);
      if (error) return toast(error.message, true);
      toast(`Sent. ${who} will see it on their Home page.`);
      refresh();
    }, 'primary small'] : null,
    pr.status !== 'scheduled' && ready ? ['Choose days for them', () => openScheduleDialog(c, pr, refresh)] : null,
    ['Delete', async () => {
      if (!confirm(`Delete "${pr.title}"? Its upcoming workouts that haven't been done are deleted too. Finished ones stay in their history.`)) return;
      const { error: wErr } = await sb.from('workouts').delete().eq('program_id', pr.id).is('completed_at', null);
      if (wErr) return toast(wErr.message, true);
      const { error } = await sb.from('programs').delete().eq('id', pr.id);
      if (error) return toast(error.message, true);
      toast('Program deleted');
      refresh();
    }, 'ghost small danger-text'],
  ].filter(Boolean);
  return h('article', { class: 'card program' + (pr.status === 'draft' ? ' draft' : '') },
    h('p', { class: 'eyebrow' }, status),
    h('h4', {}, pr.title),
    h('p', { class: 'muted small' }, `${pr.weeks} week${pr.weeks === 1 ? '' : 's'} · ${n} workout${n === 1 ? '' : 's'} a week · the same workouts each week`),
    pr.notes ? h('p', { class: 'notice-body' }, pr.notes) : null,
    slots,
    pr.status === 'scheduled'
      ? h('p', { class: 'muted small' }, `To change weights for a particular week, edit that week's workouts below (they're labelled Week 1, Week 2…).`)
      : !ready ? h('p', { class: 'muted small' }, `Write all ${n} workouts, then send it to ${who}.`)
        : !c.email && pr.status === 'draft' ? h('p', { class: 'muted small' }, `${who} has no account yet: add their email to send it, or choose days for them.`) : null,
    h('div', { class: 'row-end actions' }, actions.map(([label, fn, cls]) => h('button', { class: `btn ${cls || 'ghost small'}`, onclick: fn }, label))));
}

function openProgramDialog(c, pr, refresh) {
  const scheduled = pr?.status === 'scheduled';
  const title = h('input', { required: true, maxlength: '120', value: pr?.title || '', placeholder: 'e.g. Strength block 1' });
  const notes = h('textarea', { rows: '3', maxlength: '2000', value: pr?.notes || '', placeholder: 'e.g. Build a strength base before your 10k: steady loads, perfect technique, 3 sessions a week.' });
  const weeks = h('select', { disabled: scheduled || null }, Array.from({ length: 16 }, (_, i) => i + 1)
    .map((w) => h('option', { value: String(w), selected: (pr?.weeks ?? 4) === w || null }, `${w} week${w === 1 ? '' : 's'}`)));
  const perWeek = h('select', { disabled: scheduled || null }, [1, 2, 3, 4, 5, 6, 7]
    .map((d) => h('option', { value: String(d), selected: (pr?.days_per_week ?? 3) === d || null }, `${d} workout${d === 1 ? '' : 's'} a week`)));
  openDialog({
    title: pr ? 'Edit program' : `New program for ${c.full_name}`,
    submitLabel: pr ? 'Save' : 'Create',
    fields: [
      field('Name', title),
      field('Aim of the program / note for the client (optional)', notes, 'Shown in a box at the top of their Program tab.'),
      h('div', { class: 'two-col' }, field('Length', weeks), field('Workouts per week', perWeek)),
      scheduled
        ? h('p', { class: 'muted small' }, 'This program is already on the calendar, so its length can no longer change.')
        : h('p', { class: 'muted small' }, 'Next you write one workout for each training day. The client does the same workouts every week; you can change the weights for any week later.'),
    ],
    onSubmit: async () => {
      const row = { title: title.value.trim(), notes: notes.value.trim() };
      if (!scheduled) {
        row.weeks = Number(weeks.value);
        row.days_per_week = Number(perWeek.value);
        if (pr) row.templates = (pr.templates || []).slice(0, row.days_per_week);
      }
      const { error } = pr
        ? await sb.from('programs').update(row).eq('id', pr.id)
        : await sb.from('programs').insert({ ...row, client_id: c.id, status: 'draft', templates: [] });
      if (error) return error.message;
      toast(pr ? 'Program updated' : 'Program created. Now write its workouts.');
      refresh();
    },
  });
}

// Trainer: pick the days on the client's behalf.
function openScheduleDialog(c, pr, refresh) {
  const sp = schedulePicker(pr);
  openDialog({
    title: `Choose ${firstName(c.full_name)}'s training days`,
    submitLabel: 'Add to calendar',
    fields: [h('p', { class: 'muted small' }, `${pr.title}: pick ${pr.days_per_week} day${pr.days_per_week === 1 ? '' : 's'} a week.`), sp.el],
    onSubmit: async () => {
      if (!sp.ready()) return `Pick ${pr.days_per_week} days first.`;
      const { error } = await sp.schedule();
      if (error) return error.message;
      toast(`${pr.title} is on ${firstName(c.full_name)}'s calendar.`);
      refresh();
    },
  });
}

// Client: the overview of a program, and picking training days.
async function renderProgramPage() {
  const id = state.activeProgram;
  mount(header(), h('main', { class: 'client-main program-page' }, h('p', { class: 'muted' }, 'Loading…')));
  state.myPrograms = await loadPrograms(state.me.id);
  if (state.activeProgram !== id) return;
  const pr = state.myPrograms?.find((p) => p.id === id);
  const leave = () => { state.activeProgram = null; renderClientApp(); };
  if (!pr) { toast('That program is no longer available.', true); return leave(); }
  const n = pr.days_per_week;
  const total = pr.weeks * n;
  // A program already on the calendar (current or past): show how it went.
  if (pr.status === 'scheduled') {
    const { data: ws } = await sb.from('workouts').select('*').eq('client_id', state.me.id).eq('program_id', pr.id).eq('is_draft', false);
    if (state.activeProgram !== id) return;
    const list = ws || [];
    const { current } = sortPrograms(state.myPrograms, list);
    const isCurrent = current?.p.id === pr.id;
    mount(header(), h('main', { class: 'client-main program-page' },
      h('button', { class: 'btn ghost small back-link', onclick: leave }, '← Back'),
      h('p', { class: 'eyebrow' }, isCurrent ? 'Your program' : 'Past program'),
      h('h1', {}, pr.title),
      aimBox(pr),
      programFacts(pr, list),
      h('h3', {}, isCurrent ? 'Week by week' : 'How it went'),
      h('div', { class: 'stack prog-weeks' }, programWeeks(pr, list, isCurrent ? currentWeekOf(pr, list) : null))));
    return;
  }
  let action;
  {
    const sp = schedulePicker(pr);
    const add = h('button', { class: 'btn primary block', disabled: true }, 'Add to my calendar');
    sp.onChange(() => { add.disabled = !sp.ready(); });
    add.disabled = !sp.ready();
    add.addEventListener('click', async () => {
      add.disabled = true;
      const { error } = await sp.schedule();
      if (error) { add.disabled = false; return toast(error.message, true); }
      toast(`${pr.title} is on your calendar.`);
      state.activeProgram = null;
      state.tab = 'calendar';
      renderClientApp();
    });
    action = h('section', { class: 'card pick-days' },
      h('h2', {}, 'Pick your training days'),
      h('p', { class: 'muted small' }, `Choose ${n} day${n === 1 ? '' : 's'} that suit your week. If something comes up, you can move a single workout later.`),
      sp.el,
      add);
  }
  mount(header(), h('main', { class: 'client-main program-page' },
    h('button', { class: 'btn ghost small back-link', onclick: leave }, '← Back'),
    h('p', { class: 'eyebrow' }, `New program from ${TRAINER_NAME}`),
    h('h1', {}, pr.title),
    aimBox(pr),
    h('div', { class: 'program-facts' },
      h('div', {}, h('b', {}, String(pr.weeks)), h('span', {}, `week${pr.weeks === 1 ? '' : 's'}`)),
      h('div', {}, h('b', {}, String(n)), h('span', {}, 'a week')),
      h('div', {}, h('b', {}, String(total)), h('span', {}, 'workouts'))),
    h('h3', {}, 'The workouts'),
    h('p', { class: 'muted small' }, 'You do the same workouts every week. The weights go up as you get stronger.'),
    h('div', { class: 'stack' }, (pr.templates || []).map((t, i) => t && h('article', { class: 'card' },
      h('p', { class: 'eyebrow' }, `Workout ${letter(i)}`),
      h('h4', {}, t.title),
      t.notes ? h('p', { class: 'notice-body' }, t.notes) : null,
      exerciseLines(t, 8)))),
    action));
}

// ---------------------------------------------------------------------------
// Client: Calendar (weeks of workouts and sessions; move workouts)
// ---------------------------------------------------------------------------

const MOVE_DAYS = 14;
const workoutAnchor = (w) => w.planned_date || w.workout_date;
// Days a client may move a workout to: within 14 days of its planned day,
// from today onwards (the database checks the same rule).
function canMoveTo(w, key) {
  const anchor = workoutAnchor(w);
  if (!anchor) return key >= today();
  return key >= today() && key >= addDays(anchor, -MOVE_DAYS) && key <= addDays(anchor, MOVE_DAYS);
}

async function moveWorkout(w, key, onDone) {
  if (key === w.workout_date) return;
  const { error } = await sb.rpc('move_workout', { p_workout_id: w.id, p_date: key });
  if (error) return toast(error.message, true);
  toast(`${w.title} moved to ${shortDay(key)}.`);
  onDone();
}

function openMoveDialog(w, onDone) {
  const anchor = workoutAnchor(w) || today();
  let from = addDays(anchor, -MOVE_DAYS);
  if (from < today()) from = today();
  const to = addDays(anchor, MOVE_DAYS);
  let chosen = null;
  const chips = [];
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const key = k;
    const b = h('button', {
      type: 'button',
      class: 'chip-toggle date-chip' + (key === w.workout_date ? ' current' : ''),
      'aria-pressed': 'false',
      disabled: key === w.workout_date || null,
      onclick: () => { chosen = key; chips.forEach((c) => c.setAttribute('aria-pressed', String(c === b))); },
    }, h('span', {}, dateOf(key).toLocaleDateString(undefined, { weekday: 'short' })), h('b', {}, dateOf(key).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })));
    chips.push(b);
  }
  openDialog({
    title: `Move ${w.title}`,
    submitLabel: 'Move',
    fields: [
      h('p', { class: 'muted small' }, `Now on ${w.workout_date ? shortDay(w.workout_date) : 'no set day'}. You can move it up to 2 weeks either side of its planned day.`),
      h('div', { class: 'date-chips', role: 'group', 'aria-label': 'New day' }, chips),
    ],
    onSubmit: async () => {
      if (!chosen) return 'Pick a new day.';
      const { error } = await sb.rpc('move_workout', { p_workout_id: w.id, p_date: chosen });
      if (error) return error.message;
      toast(`${w.title} moved to ${shortDay(chosen)}.`);
      onDone();
    },
  });
}

function openSessionDetails(x, onDone) {
  const cancellable = x.status === 'booked' && new Date(x.starts_at) > new Date();
  openDialog({
    title: `Session with ${TRAINER_NAME}`,
    submitLabel: cancellable ? 'Cancel session' : 'OK',
    cancelLabel: 'Close',
    danger: cancellable,
    fields: [sessionCard(x)],
    onSubmit: async () => {
      if (cancellable) setTimeout(() => openCancelDialog(x, { asTrainer: false, onDone }), 0);
    },
  });
}

async function renderClientCalendar(body, extraWeeksBefore = 0) {
  body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  const [{ data, error }] = await Promise.all([
    sb.from('workouts').select('*').eq('client_id', state.me.id).eq('is_draft', false),
    state.sessions ? loadSessions(state.me.id) : null,
  ]);
  if (!body.isConnected) return;
  if (error) { body.replaceChildren(h('p', { class: 'error' }, error.message)); return; }
  const refresh = () => renderClientCalendar(body, extraWeeksBefore);
  const workouts = data;
  const sessions = state.sessions || [];
  const todayK = today();
  const thisMon = mondayKey(todayK);
  const canMove = state.myPrograms !== null; // move_workout arrives with programs
  // From this week (plus any earlier weeks asked for) to the last planned day, at least 4 weeks.
  const lastKey = [...workouts.map((w) => w.workout_date), ...sessions.map((x) => dayKey(new Date(x.starts_at)))].filter(Boolean).sort().at(-1);
  let endMon = addDays(thisMon, 21);
  if (lastKey && mondayKey(lastKey) > endMon) endMon = mondayKey(lastKey);
  const startMon = addDays(thisMon, -7 * extraWeeksBefore);
  const weekStarts = [];
  for (let m = startMon; m <= endMon && weekStarts.length < 60; m = addDays(m, 7)) weekStarts.push(m);
  const undated = workouts.filter((w) => !w.workout_date && !w.completed_at);

  const workoutChip = (w) => {
    const done = !!w.completed_at;
    const missed = !done && w.workout_date < todayK;
    const movable = canMove && !done;
    const n = (w.exercises || []).length;
    const meta = [`${n} exercise${n === 1 ? '' : 's'}`, w.program_week ? `Week ${w.program_week}` : null, done ? '✓ Done' : missed ? 'Missed' : null].filter(Boolean).join(' · ');
    return h('div', { class: 'cal-chip workout' + (done ? ' done' : '') + (missed ? ' missed' : '') + (movable ? ' movable' : ''), 'data-id': w.id },
      h('button', { class: 'cal-chip-main', onclick: () => { state.activeWorkout = w.id; renderClientApp(); } },
        h('b', {}, w.title), h('span', {}, meta)),
      movable ? h('button', { class: 'btn ghost small cal-move', 'aria-label': `Move ${w.title} to another day`, onclick: () => openMoveDialog(w, refresh) }, 'Move') : null);
  };
  const sessionChip = (x) => h('button', { class: 'cal-chip session' + (x.status === 'cancelled' ? ' cancelled' : ''), onclick: () => openSessionDetails(x, refresh) },
    h('b', {}, `Session with ${TRAINER_NAME}`),
    h('span', {}, [timeText(new Date(x.starts_at)), x.location, x.status === 'cancelled' ? 'Cancelled' : null].filter(Boolean).join(' · ')));

  const weekEls = weekStarts.map((mon) => {
    const keys = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
    const inWeek = workouts.filter((w) => w.workout_date && w.workout_date >= mon && w.workout_date <= keys[6]);
    const pweeks = inWeek.map((w) => w.program_week).filter(Boolean);
    const pweek = pweeks.length ? Math.max(...pweeks) : null;
    const range = `${dateOf(mon).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${dateOf(keys[6]).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
    return h('section', { class: 'cal-week' + (mon === thisMon ? ' current' : '') },
      h('div', { class: 'cal-week-head' },
        h('h3', {}, range),
        pweek ? h('span', { class: 'week-pill' }, `Week ${pweek}`) : null,
        h('span', { class: 'muted small' }, `${inWeek.length} workout${inWeek.length === 1 ? '' : 's'}`)),
      keys.map((k) => {
        const ws = inWeek.filter((w) => w.workout_date === k);
        const ss = sessions.filter((x) => dayKey(new Date(x.starts_at)) === k);
        const d = dateOf(k);
        return h('div', { class: 'cal-row' + (k === todayK ? ' today' : '') + (k < todayK ? ' past' : ''), 'data-day': k },
          h('div', { class: 'cal-date' },
            h('span', {}, d.toLocaleDateString(undefined, { weekday: 'short' })),
            h('b', {}, String(d.getDate()))),
          h('div', { class: 'cal-items' },
            ws.map(workoutChip),
            ss.map(sessionChip),
            ws.length || ss.length ? null : h('span', { class: 'cal-rest' }, 'Rest day')));
      }));
  });

  fill(body,
    h('p', { class: 'muted small cal-help' }, canMove
      ? 'Tap a workout to open it. To move one, press and hold it and drag it to another day, or tap Move.'
      : 'Tap a workout to open it.'),
    h('button', { class: 'btn ghost small', onclick: () => renderClientCalendar(body, extraWeeksBefore + 4) }, '↑ Show earlier weeks'),
    undated.length ? h('section', { class: 'cal-week' },
      h('div', { class: 'cal-week-head' }, h('h3', {}, 'Any day'), h('span', { class: 'muted small' }, 'No set day: do these when it suits you')),
      h('div', { class: 'cal-items any-day' }, undated.map(workoutChip))) : null,
    weekEls);
  if (canMove) enableCalendarDrag(body, workouts, refresh);
}

// Press-and-hold (touch) or click-and-drag (mouse) a workout onto another day.
function enableCalendarDrag(root, workouts, onDone) {
  // The calendar re-renders into the same element, so replace (don't stack)
  // the listeners from the previous render.
  root._calendarDrag?.abort();
  const listening = new AbortController();
  root._calendarDrag = listening;
  const { signal } = listening;
  const byId = new Map(workouts.map((w) => [w.id, w]));
  let drag = null;
  const rowAt = (x, y) => document.elementFromPoint(x, y)?.closest('.cal-row');
  const clearMarks = () => root.querySelectorAll('.cal-row.drop-ok, .cal-row.drop-no').forEach((r) => r.classList.remove('drop-ok', 'drop-no'));
  const end = async (commit) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    clearTimeout(d.timer);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    d.ghost?.remove();
    d.chip.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    clearMarks();
    if (commit && d.active) {
      // Swallow the click that follows a drag so it doesn't open the workout.
      d.chip.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); }, { capture: true, once: true });
      const row = rowAt(d.x, d.y);
      const key = row?.dataset.day;
      if (key && key !== d.w.workout_date) {
        if (canMoveTo(d.w, key)) await moveWorkout(d.w, key, onDone);
        else toast('Workouts can be moved up to 2 weeks either side of their planned day, from today onwards.', true);
      }
    }
  };
  const activate = () => {
    if (!drag) return;
    drag.active = true;
    const rect = drag.chip.getBoundingClientRect();
    drag.offsetX = drag.x - rect.left;
    drag.offsetY = drag.y - rect.top;
    drag.ghost = drag.chip.cloneNode(true);
    drag.ghost.classList.add('drag-ghost');
    drag.ghost.style.width = `${rect.width}px`;
    document.body.append(drag.ghost);
    drag.chip.classList.add('dragging');
    document.body.classList.add('is-dragging');
    try { navigator.vibrate?.(20); } catch { /* not supported */ }
    place();
  };
  const place = () => {
    if (!drag?.ghost) return;
    drag.ghost.style.transform = `translate(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px)`;
    clearMarks();
    const row = rowAt(drag.x, drag.y);
    if (row) row.classList.add(canMoveTo(drag.w, row.dataset.day) ? 'drop-ok' : 'drop-no');
    // Scroll the page when dragging near the top or bottom edge.
    const edge = 80;
    if (drag.y < edge) window.scrollBy(0, -12);
    else if (drag.y > window.innerHeight - edge) window.scrollBy(0, 12);
  };
  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.active) {
      if (drag.touch) { if (moved > 8) end(false); } // finger moved first: it's a scroll
      else if (moved > 6) activate();               // mouse: drag straight away
      return;
    }
    place();
  }
  function onUp() { end(true); }
  function onCancel() { end(false); }
  root.addEventListener('pointerdown', (e) => {
    const chip = e.target.closest('.cal-chip.workout.movable');
    if (!chip || e.target.closest('.cal-move') || e.button > 0) return;
    const w = byId.get(chip.dataset.id);
    if (!w) return;
    drag = { chip, w, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', active: false };
    if (drag.touch) drag.timer = setTimeout(activate, 350);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  }, { signal });
  // While dragging with a finger, stop the page scrolling under it.
  root.addEventListener('touchmove', (e) => { if (drag?.active) e.preventDefault(); }, { passive: false, signal });
  root.addEventListener('contextmenu', (e) => { if (e.target.closest('.cal-chip.workout.movable')) e.preventDefault(); }, { signal });
}

// ---------------------------------------------------------------------------
// Notice board
// ---------------------------------------------------------------------------

// Pinned first, then newest. Clients only receive posts meant for them
// (the database filters them).
async function loadNotices() {
  const { data, error } = await sb.from('announcements').select('*').order('created_at', { ascending: false });
  if (error) {
    if (!isMissingTable(error)) toast(error.message, true);
    state.notices = null;
    return;
  }
  state.notices = [...data].sort((a, b) => (b.pinned - a.pinned) || (b.created_at > a.created_at ? 1 : -1));
}

// "Seen" is remembered on the client's device; it only drives the new-post dot.
const seenKey = () => `empt:notices-seen:${state.me?.id}`;
function lastSeen() {
  try { return localStorage.getItem(seenKey()) || ''; } catch { return ''; }
}
function markNoticesSeen() {
  const newest = (state.notices || []).reduce((max, n) => (n.created_at > max ? n.created_at : max), '');
  try { if (newest) localStorage.setItem(seenKey(), newest); } catch { /* private browsing: no dot memory */ }
}
const isUnseen = (n) => !!state.me && n.created_at > lastSeen();
const unseenNotices = () => (state.notices || []).some(isUnseen);

function noticeCard(n, { actions = [], isNew = false, audience = null, compact = false } = {}) {
  return h('article', { class: 'card notice' + (n.pinned ? ' pinned' : '') + (compact ? ' compact' : '') },
    h('div', { class: 'row-between top' },
      h('div', {},
        h('p', { class: 'eyebrow' }, [n.pinned ? 'Pinned' : null, formatDate(n.created_at.slice(0, 10))].filter(Boolean).join(' · ')),
        h('h4', {}, n.title),
        isNew ? h('span', { class: 'badge' }, 'New') : null),
      actions.length ? h('div', { class: 'actions' },
        actions.map(([label, fn]) => h('button', { class: 'btn ghost small' + (label === 'Delete' ? ' danger-text' : ''), onclick: fn }, label))) : null),
    n.body ? h('p', { class: 'notice-body' }, n.body) : null,
    audience ? h('p', { class: 'muted small' }, audience) : null);
}

async function renderClientNotices(body) {
  body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  await loadNotices();
  if (!body.isConnected) return;
  const posts = state.notices || [];
  const cards = posts.map((n) => noticeCard(n, { isNew: isUnseen(n) }));
  markNoticesSeen();
  // Clear the dot on the Home tab now that they've been seen.
  body.closest('main')?.querySelector('.tab .dot')?.remove();
  fill(body,
    h('button', { class: 'btn ghost small back-link', onclick: () => { state.tab = 'home'; renderClientApp(); } }, '← Home'),
    h('h3', {}, `From ${TRAINER_NAME}`),
    posts.length
      ? h('div', { class: 'stack' }, cards)
      : h('div', { class: 'empty' }, h('p', { class: 'muted' }, `Nothing here yet. Announcements from ${TRAINER_NAME} will appear here.`)));
}

function audienceText(n) {
  if (!n.client_ids) return 'Everyone';
  const names = n.client_ids.map((id) => state.clients.find((c) => c.id === id)?.full_name).filter(Boolean);
  return names.length ? `Only: ${names.join(', ')}` : 'Only: (clients since removed)';
}

function renderNoticesPanel() {
  const refresh = async () => { await loadNotices(); renderClientList(); if (state.view === 'notices') renderNoticesPanel(); };
  const posts = state.notices || [];
  fill(ui.panel,
    h('div', { class: 'panel-head' },
      h('button', { class: 'btn ghost small back', onclick: () => { state.view = 'client'; renderClientList(); renderPanel(); } }, '← Clients'),
      h('div', { class: 'panel-title' },
        h('h2', {}, 'Notice board'),
        h('p', { class: 'muted small' }, 'Announcements for your clients: closures, events, reminders, news. Pinned posts also show at the top of their workouts page.')),
      h('button', { class: 'btn primary small', onclick: () => openNoticeDialog(null, refresh) }, '+ New post')),
    posts.length
      ? h('div', { class: 'stack' }, posts.map((n) => noticeCard(n, {
          audience: audienceText(n),
          actions: [
            ['Edit', () => openNoticeDialog(n, refresh)],
            [n.pinned ? 'Unpin' : 'Pin', async () => {
              const { error } = await sb.from('announcements').update({ pinned: !n.pinned }).eq('id', n.id);
              if (error) return toast(error.message, true);
              refresh();
            }],
            ['Delete', async () => {
              if (!confirm(`Delete "${n.title}"? Clients will no longer see it.`)) return;
              const { error } = await sb.from('announcements').delete().eq('id', n.id);
              if (error) return toast(error.message, true);
              toast('Post deleted');
              refresh();
            }],
          ],
        })))
      : h('div', { class: 'empty' }, h('p', { class: 'muted' }, 'No posts yet. Use "+ New post" to send your first announcement.')));
}

function openNoticeDialog(n, onSaved) {
  const title = h('input', { required: true, maxlength: '120', value: n?.title || '', placeholder: 'e.g. Studio closed on Bank Holiday Monday' });
  const body = h('textarea', { rows: '5', maxlength: '5000', value: n?.body || '', placeholder: 'The details…' });
  const pinned = h('input', { type: 'checkbox', checked: n?.pinned || null });
  const chosen = new Set(n?.client_ids || []);
  const everyone = h('input', { type: 'radio', name: 'audience', value: 'all', checked: !n?.client_ids || null });
  const some = h('input', { type: 'radio', name: 'audience', value: 'some', checked: !!n?.client_ids || null });
  const picks = h('div', { class: 'check-list' }, state.clients.map((c) =>
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: chosen.has(c.id) || null, onchange: (e) => { if (e.target.checked) chosen.add(c.id); else chosen.delete(c.id); } }),
      h('span', {}, c.full_name, c.email ? null : h('span', { class: 'muted small' }, ' (no account yet)')))));
  const syncPicks = () => { picks.hidden = !some.checked; };
  everyone.addEventListener('change', syncPicks);
  some.addEventListener('change', syncPicks);
  syncPicks();

  openDialog({
    title: n ? 'Edit post' : 'New post',
    submitLabel: n ? 'Save' : 'Post',
    fields: [
      field('Title', title),
      field('Message', body),
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Who sees it'),
        h('label', { class: 'check' }, everyone, h('span', {}, 'All clients')),
        h('label', { class: 'check' }, some, h('span', {}, 'Selected clients only')),
        picks),
      h('label', { class: 'check pin-option' }, pinned, h('span', {}, 'Pin to the top of their workouts page')),
    ],
    onSubmit: async () => {
      if (some.checked && !chosen.size) return 'Choose at least one client, or pick "All clients".';
      const row = {
        title: title.value.trim(),
        body: body.value.trim(),
        pinned: pinned.checked,
        client_ids: some.checked ? [...chosen] : null,
      };
      const { error } = n
        ? await sb.from('announcements').update(row).eq('id', n.id)
        : await sb.from('announcements').insert(row);
      if (error) return error.message;
      toast(n ? 'Post updated' : 'Posted. Your clients will see it next time they open the app.');
      onSaved();
    },
  });
}

// ---------------------------------------------------------------------------
// Trainer: exercise library
// ---------------------------------------------------------------------------

function renderLibraryPanel() {
  const search = h('input', { type: 'search', placeholder: 'Search exercises', 'aria-label': 'Search exercises' });
  const list = h('nav', { class: 'client-list lib-list', 'aria-label': 'Exercises' });
  const draw = () => {
    const q = libKey(search.value);
    const items = state.library.filter((x) => libKey(x.name).includes(q));
    fill(list, items.length
      ? items.map((x) => h('button', { class: 'client-item', onclick: () => openExerciseDialog(x) },
          h('span', { class: 'client-name' }, x.name),
          h('span', { class: 'muted small' }, [isBarbell(x) ? 'Barbell' : null, safeUrl(x.video_url) ? 'Demo video' : null, x.cues ? 'Coaching cues' : null].filter(Boolean).join(' · ') || 'No video or cues yet')))
      : h('p', { class: 'muted pad' }, state.library.length
          ? 'No matches.'
          : 'Your library is empty. Add exercises here, or just type new exercise names when you write a workout: they are added automatically.'));
  };
  search.addEventListener('input', draw);
  fill(ui.panel,
    h('div', { class: 'panel-head' },
      h('button', { class: 'btn ghost small back', onclick: () => { state.view = 'client'; renderClientList(); renderPanel(); } }, '← Clients'),
      h('div', { class: 'panel-title' },
        h('h2', {}, 'Exercise library'),
        h('p', { class: 'muted small' }, 'Add a demo video link and coaching cues. Clients see them under "How to" on each exercise.')),
      h('button', { class: 'btn primary small', onclick: () => openExerciseDialog() }, '+ Add exercise')),
    search,
    list);
  draw();
}

function openExerciseDialog(x) {
  const name = h('input', { required: true, maxlength: '100', value: x?.name || '', placeholder: 'e.g. Romanian deadlift' });
  const video = h('input', { type: 'url', value: x?.video_url || '', placeholder: 'https://youtube.com/…' });
  const cues = h('textarea', { rows: '4', value: x?.cues || '', placeholder: 'e.g. Soft knees. Push hips back. Bar stays close to the legs.' });
  const barbell = h('input', { type: 'checkbox', checked: (x ? isBarbell(x) : false) || null });
  // Until the user changes it, a new exercise's tick follows its name.
  let barbellTouched = !!x;
  barbell.addEventListener('change', () => { barbellTouched = true; });
  name.addEventListener('input', () => { if (!barbellTouched) barbell.checked = guessBarbell(name.value); });
  let dlg;
  const extra = x ? h('button', {
    type: 'button',
    class: 'btn danger',
    onclick: async () => {
      if (!confirm(`Delete ${x.name} from the library? Rep maxes recorded for it are deleted too. Workouts keep the exercise name.`)) return;
      const { error } = await sb.from('exercises').delete().eq('id', x.id);
      if (error) return toast(error.message, true);
      dlg.close();
      await loadLibrary();
      renderClientList();
      renderPanel();
      toast('Exercise deleted');
    },
  }, 'Delete') : null;
  dlg = openDialog({
    title: x ? 'Edit exercise' : 'Add exercise',
    fields: [
      field('Name', name),
      field('Demo video link (optional)', video, 'A YouTube, Instagram or other video link. Clients open it in a new tab.'),
      field('Coaching cues (optional)', cues),
      h('label', { class: 'check pin-option' }, barbell, h('span', {}, 'Uses a barbell (clients see which plates to load)')),
    ],
    extra,
    onSubmit: async () => {
      const url = video.value.trim();
      if (url && !safeUrl(url)) return 'The video link should start with https://';
      const row = { name: name.value.trim(), video_url: url, cues: cues.value.trim() };
      // Only send is_barbell once the database has that column.
      if (state.library.some((e) => 'is_barbell' in e)) row.is_barbell = barbell.checked;
      const { error } = x
        ? await sb.from('exercises').update(row).eq('id', x.id)
        : await sb.from('exercises').insert(row);
      if (error) return error.code === '23505' ? 'That exercise is already in your library.' : error.message;
      await loadLibrary();
      renderClientList();
      renderPanel();
      toast(x ? 'Exercise updated' : `${row.name} added to the library`);
    },
  });
}

// ---------------------------------------------------------------------------
// Team wins: a community feed of clients' wins, for clients who opt in
// ---------------------------------------------------------------------------

const REACTIONS = ['🙌', '🔥', '💪', '👏'];
const WIN_KINDS = { pb: 'Personal best', seal: 'Streak seal', program: 'Program finished', milestone: 'Milestone', shoutout: 'Shout-out' };
const WORKOUT_MILESTONES = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000];

// Client: { member } (are they sharing?). Trainer: { members } (who is).
// null when the database doesn't have the feed yet.
async function loadCommunity() {
  const { data, error } = await sb.from('community_members').select('client_id');
  if (error) {
    if (!isMissingTable(error)) toast(error.message, true);
    state.community = null;
    return;
  }
  state.community = state.isTrainer
    ? { members: new Set(data.map((r) => r.client_id)) }
    : { member: data.some((r) => r.client_id === state.me.id) };
}

// Newest wins first, each with its reactions.
async function loadWins(limit = 60) {
  const { data, error } = await sb.from('wins').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) {
    if (!isMissingTable(error)) toast(error.message, true);
    return [];
  }
  const wins = data.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
  const ids = wins.map((w) => w.id);
  const { data: reactions, error: rError } = ids.length
    ? await sb.from('win_reactions').select('win_id,client_id,emoji').in('win_id', ids)
    : { data: [] };
  if (rError) toast(rError.message, true);
  for (const w of wins) w.reactions = (reactions || []).filter((r) => r.win_id === w.id);
  return wins;
}

// Posts a win for a client who is sharing. Quietly does nothing otherwise,
// or if this win was already posted (the database rejects duplicate keys).
async function postWin(clientId, kind, key, title) {
  const c = state.community;
  if (!c || (state.isTrainer ? !c.members.has(clientId) : !c.member)) return;
  const name = firstName(state.isTrainer ? clientName(clientId) : state.me.full_name);
  // display_name is replaced by the database with the client's real first name.
  const { error } = await sb.from('wins').insert({ client_id: clientId, kind, key, title, display_name: name });
  if (error && error.code !== '23505') toast(error.message, true);
}

// Client Home: post any new streak seal, workout milestone or finished
// program. Only recent ones, so joining doesn't post a client's whole history.
function shareNewWins(workouts, stats) {
  if (!state.community?.member) return;
  const since = addDays(today(), -14);
  const doneDay = (w) => dayKey(new Date(w.completed_at));
  if (stats.justSealed) {
    postWin(state.me.id, 'seal', `seal:${stats.streak}`, `earned the ${stats.streak}-week seal: ${stats.streak} weeks in a row, every workout done`);
  }
  const done = workouts.filter((w) => w.completed_at).sort((a, b) => a.completed_at.localeCompare(b.completed_at));
  const milestone = [...WORKOUT_MILESTONES].reverse().find((n) => done.length >= n);
  if (milestone && doneDay(done[milestone - 1]) >= since) {
    postWin(state.me.id, 'milestone', `workouts:${milestone}`, `has done ${milestone} workouts with ${TRAINER_NAME}`);
  }
  for (const p of state.myPrograms || []) {
    if (p.status !== 'scheduled') continue;
    const ws = workouts.filter((w) => w.program_id === p.id);
    if (!ws.length || !ws.every((w) => w.completed_at)) continue;
    if (ws.map(doneDay).sort().at(-1) < since) continue;
    postWin(state.me.id, 'program', `program:${p.id}`, `finished the program "${p.title}": all ${plural(ws.length, 'workout')} done`);
  }
}

function winCard(w, { onRemoved } = {}) {
  const meId = state.isTrainer ? null : state.me.id;
  const canReact = state.isTrainer || !!state.community?.member;
  const isShout = w.kind === 'shoutout';
  const name = isShout ? TRAINER_NAME : w.display_name || 'A teammate';
  const isMine = (r) => (r.client_id ?? null) === meId;
  const card = h('article', { class: 'win' + (isShout ? ' shoutout' : '') });

  const toggle = async (emoji) => {
    const had = w.reactions.find((r) => r.emoji === emoji && isMine(r));
    // Show it straight away; put it back if the database says no.
    w.reactions = had ? w.reactions.filter((r) => r !== had) : [...w.reactions, { win_id: w.id, client_id: meId, emoji }];
    draw();
    let q = sb.from('win_reactions');
    if (had) {
      q = q.delete().eq('win_id', w.id).eq('emoji', emoji);
      q = meId ? q.eq('client_id', meId) : q.is('client_id', null);
    } else {
      q = q.insert({ win_id: w.id, client_id: meId, emoji });
    }
    const { error } = await q;
    if (error && error.code !== '23505') {
      toast(error.message, true);
      w.reactions = had ? [...w.reactions, had] : w.reactions.filter((r) => !(r.emoji === emoji && isMine(r)));
      draw();
    }
  };

  const remove = async () => {
    if (!confirm(state.isTrainer ? 'Remove this post from the feed for everyone?' : 'Remove this win from the feed?')) return;
    const { error } = await sb.from('wins').delete().eq('id', w.id);
    if (error) return toast(error.message, true);
    toast('Removed from the feed.');
    card.remove();
    onRemoved?.();
  };

  function draw() {
    fill(card,
      h('div', { class: 'win-avatar', 'aria-hidden': 'true' }, name.charAt(0).toUpperCase()),
      h('div', { class: 'win-body' },
        h('p', { class: 'eyebrow' }, `${WIN_KINDS[w.kind] || 'Win'} · ${formatDateTime(w.created_at)}`),
        h('p', { class: 'win-text' }, h('b', {}, name), isShout ? ': ' : ' ', w.title),
        h('div', { class: 'win-foot' },
          h('div', { class: 'reactions', role: 'group', 'aria-label': 'Reactions' }, REACTIONS.map((emoji) => {
            const count = w.reactions.filter((r) => r.emoji === emoji).length;
            const mine = w.reactions.some((r) => r.emoji === emoji && isMine(r));
            return h('button', {
              class: 'react',
              type: 'button',
              'aria-pressed': String(mine),
              disabled: !canReact || null,
              title: canReact ? (mine ? 'Remove your reaction' : 'React') : 'Share your wins to react',
              'aria-label': `${emoji} ${count}${mine ? ', including you' : ''}`,
              onclick: () => toggle(emoji),
            }, h('span', { 'aria-hidden': 'true' }, emoji), count ? h('b', { 'aria-hidden': 'true' }, String(count)) : null);
          })),
          state.isTrainer || (meId && w.client_id === meId) ? h('button', { class: 'btn ghost small', onclick: remove }, 'Remove') : null)));
  }
  draw();
  return card;
}

const SHARED_LIST = 'Your first name and your wins: personal bests (with the weight), streak seals, finished programs and workout milestones.';

async function renderClientWins(body) {
  body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  const wins = await loadWins();
  if (!body.isConnected) return;
  const again = () => renderClientWins(body);
  const setSharing = async (on) => {
    const q = sb.from('community_members');
    const { error } = on ? await q.insert({ client_id: state.me.id }) : await q.delete().eq('client_id', state.me.id);
    if (error && error.code !== '23505') return toast(error.message, true);
    state.community.member = on;
    toast(on ? "You're in! Your next win will show up here." : 'You’ve stopped sharing. Your wins are hidden from the feed.');
    again();
  };
  const name = firstName(state.me.full_name);
  const shareBox = state.community.member
    ? h('div', { class: 'share-line' },
        h('p', { class: 'muted small' }, `You're sharing your wins as ${name}.`),
        h('button', {
          class: 'btn ghost small',
          onclick: () => { if (confirm('Stop sharing your wins? They’ll be hidden from the feed. You can share again any time.')) setSharing(false); },
        }, 'Stop sharing'))
    : h('section', { class: 'card join-card' },
        h('p', { class: 'eyebrow' }, 'Share your wins?'),
        h('p', {}, `Cheer on ${TRAINER_NAME}'s other clients, and let them cheer you on. Sharing is optional.`),
        h('p', { class: 'small' }, h('b', {}, 'What’s shared: '), SHARED_LIST),
        h('p', { class: 'small' }, h('b', {}, 'Never shared: '), 'your notes, check-ins, body details, workouts or chats.'),
        h('p', { class: 'muted small' }, 'You can stop any time, and your wins disappear from the feed.'),
        h('button', { class: 'btn primary block', onclick: () => setSharing(true) }, 'Share my wins'));
  fill(body,
    h('button', { class: 'btn ghost small back-link', onclick: () => { state.tab = 'home'; renderClientApp(); } }, '← Home'),
    h('h3', {}, 'Team wins'),
    h('p', { class: 'muted small' }, `Personal bests, streaks and milestones from ${TRAINER_NAME}'s clients who choose to share.`),
    shareBox,
    wins.length
      ? h('div', { class: 'stack' }, wins.map((w) => winCard(w)))
      : h('div', { class: 'empty' }, h('p', { class: 'muted' }, 'No wins yet. They’ll appear here as people hit them.')));
}

// Home: the latest couple of wins, with "See all".
function winsPreview(wins) {
  if (!state.community) return null;
  const goWins = () => { state.tab = 'wins'; renderClientApp(); };
  return h('section', { class: 'wins-preview' },
    h('div', { class: 'row-between' },
      h('h3', {}, 'Team wins'),
      h('button', { class: 'btn ghost small', onclick: goWins }, 'See all')),
    wins.length
      ? h('div', { class: 'stack' }, wins.map((w) => winCard(w)))
      : h('p', { class: 'muted small' }, 'No wins posted yet.'),
    state.community.member ? null : h('p', { class: 'muted small share-nudge' },
      'Want to cheer each other on? ', h('button', { class: 'link', onclick: goWins }, 'Share your wins too')));
}

async function renderCommunityPanel() {
  const refresh = () => { if (state.view === 'community') renderCommunityPanel(); };
  ui.panel.replaceChildren(h('p', { class: 'muted pad' }, 'Loading…'));
  const [wins] = await Promise.all([loadWins(), loadCommunity()]);
  if (state.view !== 'community') return;
  renderClientList();
  const sharing = state.community ? [...state.community.members].map(clientName).sort() : [];
  fill(ui.panel,
    h('div', { class: 'panel-head' },
      h('button', { class: 'btn ghost small back', onclick: () => { state.view = 'client'; renderClientList(); renderPanel(); } }, '← Clients'),
      h('div', { class: 'panel-title' },
        h('h2', {}, 'Team wins'),
        h('p', { class: 'muted small' }, 'Clients who choose to share see each other’s personal bests, streak seals, finished programs and workout milestones, and can react. First names only.')),
      h('button', { class: 'btn primary small', onclick: () => openShoutOut(refresh) }, '+ Shout-out')),
    h('p', { class: 'muted small' }, sharing.length
      ? `Sharing: ${sharing.join(', ')}`
      : 'No clients are sharing yet. They can opt in from Team wins on their Home page.'),
    wins.length
      ? h('div', { class: 'stack' }, wins.map((w) => winCard(w)))
      : h('div', { class: 'empty' }, h('p', { class: 'muted' }, 'No wins yet. Wins post automatically for clients who share, or post a shout-out.')));
}

function openShoutOut(onSaved) {
  const text = h('textarea', { rows: '3', maxlength: '300', required: true, placeholder: 'Huge effort at Saturday’s bootcamp, everyone!' });
  openDialog({
    title: 'Shout-out',
    fields: field('Message', text, 'Shown to all your clients in Team wins. Only use first names.'),
    submitLabel: 'Post',
    onSubmit: async () => {
      const title = text.value.trim();
      if (!title) return 'Write a message first.';
      const { error } = await sb.from('wins').insert({ client_id: null, kind: 'shoutout', title });
      if (error) return error.message;
      toast('Shout-out posted.');
      onSaved();
      return null;
    },
  });
}

// ---------------------------------------------------------------------------
// Shared: chat
// ---------------------------------------------------------------------------

async function renderChat(body, clientId, me) {
  const list = h('div', { class: 'messages', 'aria-live': 'polite' });
  const input = h('textarea', { rows: '2', maxlength: '4000', placeholder: 'Write a message…', 'aria-label': 'Message' });
  const send = h('button', { type: 'submit', class: 'btn primary' }, 'Send');
  const seen = new Set();

  const bubble = (m) =>
    h('div', { class: 'bubble ' + (m.sender === me ? 'mine' : 'theirs') },
      h('p', {}, m.body),
      h('time', { datetime: m.created_at }, formatDateTime(m.created_at)));

  const add = (m) => {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    list.querySelector('.empty-chat')?.remove();
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.append(bubble(m));
    if (nearBottom || m.sender === me) list.scrollTop = list.scrollHeight;
  };

  const form = h('form', {
    class: 'composer',
    onsubmit: async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      send.disabled = true;
      const { data, error } = await sb.from('messages').insert({ client_id: clientId, sender: me, body: text }).select().single();
      send.disabled = false;
      if (error) return toast(error.message, true);
      input.value = '';
      add(data);
      input.focus();
    },
  }, input, send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });

  body.replaceChildren(h('div', { class: 'chat' }, list, form,
    h('p', { class: 'muted small hint' }, 'Enter to send · Shift+Enter for a new line')));

  state.chatChannel = sb.channel(`chat-${clientId}-${Date.now()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `client_id=eq.${clientId}` },
      ({ new: m }) => add(m))
    .subscribe();

  const { data, error } = await sb.from('messages').select('*').eq('client_id', clientId)
    .order('created_at', { ascending: false }).limit(200);
  if (!list.isConnected) return;
  if (error) return toast(error.message, true);

  // History goes above anything that arrived live while it was loading.
  const older = data.reverse().filter((m) => !seen.has(m.id));
  older.forEach((m) => seen.add(m.id));
  list.prepend(...older.map(bubble));
  if (!list.children.length) list.append(h('p', { class: 'muted empty-chat' }, 'No messages yet. Say hello!'));
  list.scrollTop = list.scrollHeight;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

if (!configured) {
  renderSetupNeeded();
} else {
  let currentUserId;
  sb.auth.onAuthStateChange((event, session) => {
    const uid = session?.user?.id ?? null;
    if (event === 'INITIAL_SESSION' || uid !== currentUserId) {
      currentUserId = uid;
      // Run outside the auth callback, as Supabase recommends.
      setTimeout(() => route(session), 0);
    }
  });
}
