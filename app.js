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
  view: 'client',      // trainer: 'client', 'library', 'notices' or 'calendar'
  library: [],         // exercise library (both roles)
  lifting: true,       // false until the database has the lifting tables
  notices: null,       // notice board posts; null until/unless the table exists
  sessions: null,      // booked sessions; null until/unless the table exists
  cal: { month: null, day: null }, // calendar position (first of month, 'YYYY-MM-DD')
  activeWorkout: null, // client: id of the workout open in "Start workout" mode
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
  await Promise.all([loadLibrary(), loadNotices(), loadSessions(me.id)]);
  renderClientApp();
}

// ---------------------------------------------------------------------------
// Trainer
// ---------------------------------------------------------------------------

async function loadClients() {
  const { data, error } = await sb.from('clients').select('*').order('full_name');
  if (error) { toast(error.message, true); return; }
  state.clients = data;
}

async function startTrainer() {
  await Promise.all([loadClients(), loadLibrary(), loadNotices(), loadSessions()]);
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
    state.notices ? navItem('notices', 'Notice board', `${state.notices.length} post${state.notices.length === 1 ? '' : 's'}`) : null);
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
      h('span', { class: 'muted small' }, c.email || 'No account yet'))));
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
        h('p', { class: 'muted small' }, c.email || 'No account yet')),
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
    ],
    extra,
    onSubmit: async () => {
      const row = { full_name: name.value.trim(), email: email.value.trim().toLowerCase() || null };
      const query = c
        ? sb.from('clients').update(row).eq('id', c.id).select().single()
        : sb.from('clients').insert(row).select().single();
      const { data, error } = await query;
      if (error) return error.code === '23505' ? 'A client with that email already exists.' : error.message;
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

async function renderTrainerWorkouts(body, c) {
  const list = h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Loading…'));
  const refresh = () => renderTrainerWorkouts(body, c);
  const reminder = h('div');
  const publishAll = h('span');
  body.replaceChildren(
    reminder,
    h('div', { class: 'row-between' },
      h('h3', {}, 'Workouts'),
      h('div', { class: 'actions' },
        publishAll,
        h('button', { class: 'btn primary', onclick: () => openWorkoutEditor(c, null, refresh) }, '+ New workout'))),
    list);
  // A private reminder of injuries while planning (from the consult notes).
  sb.from('client_notes').select('injuries').eq('client_id', c.id).maybeSingle().then(({ data }) => {
    if (data?.injuries?.trim() && reminder.isConnected) reminder.replaceWith(goalsBox('Injuries and conditions · private', data.injuries.trim()));
  });

  const [{ data, error }, ctx] = await Promise.all([
    sb.from('workouts').select('*').eq('client_id', c.id)
      .order('workout_date', { ascending: false, nullsFirst: true })
      .order('created_at', { ascending: false }),
    loadTrainingData(c.id),
  ]);
  if (!list.isConnected) return;
  if (error) { list.replaceChildren(h('p', { class: 'error' }, error.message)); return; }
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

function openWorkoutEditor(client, workout, onSaved) {
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
    title: isNew ? `New workout for ${client.full_name}` : 'Edit workout',
    wide: true,
    altSubmitLabel: 'Save as draft',
    submitLabel: workout?.id && !workout.is_draft ? 'Save' : 'Publish',
    fields: [
      field('Title', title),
      field('Date', date, 'Leave empty for a workout they can do any time.'),
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
        h('p', { class: 'eyebrow' }, w.workout_date ? formatDate(w.workout_date) : 'Any day'),
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
  const body = h('div', { class: 'tab-body' });
  mount(header(), h('main', { class: 'client-main' },
    h('h1', {}, 'Hi ', h('em', {}, firstName(state.me.full_name))),
    state.me.goals ? goalsBox('Your goals', state.me.goals) : null,
    tabs([
      // Short labels so all four tabs fit on a phone.
      ['workouts', 'Workouts'],
      state.sessions ? ['sessions', 'Sessions'] : null,
      state.lifting ? ['lifts', 'Lifts'] : null,
      state.notices ? ['notices', ['Notices', unseenNotices() ? h('span', { class: 'dot', title: 'New post' }) : null]] : null,
      ['chat', 'Chat'],
    ].filter(Boolean), renderClientApp),
    body));
  if (state.tab === 'workouts' || (state.tab === 'lifts' && !state.lifting) || (state.tab === 'notices' && !state.notices)
    || (state.tab === 'sessions' && !state.sessions)) renderClientWorkouts(body);
  else if (state.tab === 'sessions') renderSessions(body, { client: state.me, asTrainer: false });
  else if (state.tab === 'lifts') renderLifts(body, state.me, { asTrainer: false });
  else if (state.tab === 'notices') renderClientNotices(body);
  else renderChat(body, state.me.id, 'client');
}

async function renderClientWorkouts(body) {
  body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  const [{ data, error }, ctx] = await Promise.all([
    sb.from('workouts').select('*').eq('client_id', state.me.id).eq('is_draft', false)
      .order('workout_date', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true }),
    loadTrainingData(state.me.id),
  ]);
  if (!body.isConnected) return;
  if (error) { body.replaceChildren(h('p', { class: 'error' }, error.message)); return; }
  // Pinned notice board posts sit at the top of the workouts page.
  const pinned = (state.notices || []).filter((n) => n.pinned)
    .map((n) => noticeCard(n, { isNew: isUnseen(n), compact: true }));
  const next = (state.sessions || []).find((x) => x.status === 'booked' && new Date(x.starts_at) > new Date());
  if (next) {
    pinned.unshift(h('div', { class: 'callout' },
      h('div', {}, h('p', { class: 'eyebrow' }, 'Next session'), h('p', {}, sessionLabel(next) + (next.location ? ` · ${next.location}` : ''))),
      h('button', { class: 'btn small', onclick: () => { state.tab = 'sessions'; renderClientApp(); } }, 'View sessions')));
  }
  if (!data.length) {
    fill(body, pinned.length ? h('div', { class: 'stack pinned-notices' }, pinned) : null,
      h('div', { class: 'empty' }, h('p', { class: 'muted' }, `No workouts yet. ${TRAINER_NAME} will add them here.`)));
    return;
  }
  const now = today();
  const upcoming = data.filter((w) => !w.completed_at && (!w.workout_date || w.workout_date >= now));
  const past = data.filter((w) => !upcoming.includes(w)).reverse();
  const refresh = () => renderClientWorkouts(body);
  const card = (w) => workoutCard(w, {
    onChange: refresh,
    ...ctx,
    onLog: state.lifting ? () => { state.activeWorkout = w.id; renderClientApp(); } : null,
  });
  fill(body,
    pinned.length ? h('div', { class: 'stack pinned-notices' }, pinned) : null,
    h('h3', {}, 'Up next'),
    upcoming.length
      ? h('div', { class: 'stack' }, upcoming.map(card))
      : h('p', { class: 'muted' }, "You're all caught up."),
    past.length ? h('h3', {}, 'Past and completed') : null,
    past.length ? h('div', { class: 'stack' }, past.map(card)) : null);
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
    h('button', { class: 'btn ghost small back-link', onclick: leave }, '← Back to workouts'),
    h('p', { class: 'eyebrow' }, w.workout_date ? formatDate(w.workout_date) : 'Any day'),
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
  // Clear the dot on the tab now that they've been seen.
  body.closest('main')?.querySelector('.tab.active .dot')?.remove();
  fill(body, posts.length
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
