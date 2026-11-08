import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_NAME, TRAINER_NAME } from './config.js';

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

function openDialog({ title, fields, submitLabel = 'Save', onSubmit, extra, wide }) {
  const dlg = h('dialog', { class: 'dialog' + (wide ? ' wide' : '') });
  const err = h('p', { class: 'error', role: 'alert' });
  const save = h('button', { type: 'submit', class: 'btn primary' }, submitLabel);
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      save.disabled = true;
      err.textContent = '';
      try {
        const problem = await onSubmit();
        if (problem) err.textContent = problem;
        else dlg.close();
      } catch (x) {
        err.textContent = x.message || String(x);
      } finally {
        save.disabled = false;
      }
    },
  },
    h('h2', {}, title),
    fields,
    err,
    h('div', { class: 'dialog-actions' },
      extra || h('span'),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close() }, 'Cancel'),
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
  await loadClients();
  // Hear about new client messages anywhere in the app.
  state.inboxChannel = sb.channel(`inbox-${Date.now()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: m }) => {
      if (m.sender !== 'client') return;
      if (state.selectedId === m.client_id && state.tab === 'chat') return;
      state.unread.add(m.client_id);
      renderClientList();
      toast(`New message from ${clientName(m.client_id)}`);
    })
    .subscribe();
  renderTrainerApp();
}

function renderTrainerApp() {
  ui.list = h('nav', { class: 'client-list', 'aria-label': 'Clients' });
  ui.panel = h('section', { class: 'panel' });
  ui.layout = h('div', { class: 'layout' },
    h('aside', { class: 'sidebar' },
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
  ui.layout.classList.toggle('has-selection', !!state.selectedId);
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
  const c = state.clients.find((x) => x.id === state.selectedId);
  if (!c) {
    ui.panel.replaceChildren(h('div', { class: 'empty' }, h('p', { class: 'muted' }, 'Choose a client to see their notes, workouts and chat.')));
    return;
  }
  const hasAccount = !!c.email;
  const tabList = [['notes', 'Consult notes'], ['workouts', 'Workouts']];
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
  body.replaceChildren(
    reminder,
    h('div', { class: 'row-between' },
      h('h3', {}, 'Workouts'),
      h('button', { class: 'btn primary', onclick: () => openWorkoutEditor(c, null, refresh) }, '+ New workout')),
    list);
  // A private reminder of injuries while planning (from the consult notes).
  sb.from('client_notes').select('injuries').eq('client_id', c.id).maybeSingle().then(({ data }) => {
    if (data?.injuries?.trim() && reminder.isConnected) reminder.replaceWith(goalsBox('Injuries and conditions · private', data.injuries.trim()));
  });

  const { data, error } = await sb.from('workouts').select('*').eq('client_id', c.id)
    .order('workout_date', { ascending: false, nullsFirst: true })
    .order('created_at', { ascending: false });
  if (!list.isConnected) return;
  if (error) { list.replaceChildren(h('p', { class: 'error' }, error.message)); return; }
  if (!data.length) {
    list.replaceChildren(h('p', { class: 'muted' }, `No workouts yet. Create ${firstName(c.full_name)}'s first one.`));
    return;
  }
  list.replaceChildren(...data.map((w) => workoutCard(w, {
    onChange: refresh,
    actions: [
      ['Edit', () => openWorkoutEditor(c, w, refresh)],
      ['Duplicate', () => openWorkoutEditor(c, { ...w, id: undefined, title: `${w.title} (copy)`, workout_date: today(), completed_at: null }, refresh)],
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

const blankExercise = () => ({ name: '', sets: '', reps: '', load: '', rest: '', notes: '' });

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
      const input = (key, placeholder, cls) =>
        h('input', { value: r[key] || '', placeholder, 'aria-label': placeholder, class: cls, oninput: (e) => { r[key] = e.target.value; } });
      return h('div', { class: 'ex-row' },
        h('div', { class: 'ex-row-head' },
          h('span', { class: 'eyebrow' }, `Exercise ${String(i + 1).padStart(2, '0')}`),
          h('div', { class: 'actions' },
            iconBtn('Move up', '↑', i === 0, () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; drawRows(); }),
            iconBtn('Move down', '↓', i === rows.length - 1, () => { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; drawRows(); }),
            iconBtn('Remove exercise', '✕', false, () => { rows.splice(i, 1); drawRows(); }))),
        input('name', 'Exercise name', 'ex-name'),
        h('div', { class: 'ex-grid' },
          input('sets', 'Sets'),
          input('reps', 'Reps / time'),
          input('load', 'Load (e.g. 20 kg)'),
          input('rest', 'Rest (e.g. 90s)')),
        input('notes', 'Coaching notes (optional)'));
    }));
  }
  drawRows();

  openDialog({
    title: isNew ? `New workout for ${client.full_name}` : 'Edit workout',
    wide: true,
    fields: [
      field('Title', title),
      field('Date', date, 'Leave empty for a workout they can do any time.'),
      field('Notes', notes),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Exercises'), exList,
        h('button', { type: 'button', class: 'btn', onclick: () => { rows.push(blankExercise()); drawRows(); exList.lastChild?.querySelector('input')?.focus(); } }, '+ Add exercise')),
    ],
    onSubmit: async () => {
      const exercises = rows
        .filter((r) => r.name.trim())
        .map((r) => Object.fromEntries(Object.keys(blankExercise()).map((k) => [k, String(r[k] || '').trim()])));
      const payload = {
        client_id: client.id,
        title: title.value.trim(),
        workout_date: date.value || null,
        notes: notes.value.trim(),
        exercises,
      };
      const { error } = isNew
        ? await sb.from('workouts').insert(payload)
        : await sb.from('workouts').update(payload).eq('id', workout.id);
      if (error) return error.message;
      toast(isNew ? 'Workout saved' : 'Workout updated');
      onSaved();
    },
  });
}

// ---------------------------------------------------------------------------
// Shared: workout card
// ---------------------------------------------------------------------------

function workoutCard(w, { actions = [], onChange }) {
  const exercises = Array.isArray(w.exercises) ? w.exercises : [];
  const done = !!w.completed_at;
  const meta = (e) => [
    e.sets && `${e.sets} sets`,
    e.reps && `${e.reps} reps`,
    e.load,
    e.rest && `rest ${e.rest}`,
  ].filter(Boolean).join(' · ');

  const toggle = h('button', {
    class: 'btn' + (done ? '' : ' primary'),
    onclick: async () => {
      toggle.disabled = true;
      const { error } = await sb.rpc('set_workout_completed', { p_workout_id: w.id, p_done: !done });
      toggle.disabled = false;
      if (error) return toast(error.message, true);
      if (!done) toast('Nice work! Workout marked as done.');
      onChange();
    },
  }, done ? 'Mark as not done' : 'Mark as done');

  return h('article', { class: 'card workout' + (done ? ' done' : '') },
    h('div', { class: 'row-between top' },
      h('div', {},
        h('p', { class: 'eyebrow' }, w.workout_date ? formatDate(w.workout_date) : 'Any day'),
        h('h4', {}, w.title),
        done ? h('span', { class: 'badge' }, `✓ Done · ${formatDateTime(w.completed_at)}`) : null),
      actions.length ? h('div', { class: 'actions' },
        actions.map(([label, fn]) => h('button', { class: 'btn ghost small' + (label === 'Delete' ? ' danger-text' : ''), onclick: fn }, label))) : null),
    w.notes ? h('p', { class: 'notes' }, w.notes) : null,
    exercises.length
      ? h('ol', { class: 'exercise-list' }, exercises.map((e) =>
          h('li', {},
            h('span', { class: 'ex-title' }, e.name),
            meta(e) ? h('span', { class: 'ex-meta' }, meta(e)) : null,
            e.notes ? h('span', { class: 'ex-notes' }, e.notes) : null)))
      : h('p', { class: 'muted small' }, 'No exercises listed.'),
    h('div', { class: 'row-end' }, toggle));
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function renderClientApp() {
  closeChat();
  const body = h('div', { class: 'tab-body' });
  mount(header(), h('main', { class: 'client-main' },
    h('h1', {}, 'Hi ', h('em', {}, firstName(state.me.full_name))),
    state.me.goals ? goalsBox('Your goals', state.me.goals) : null,
    tabs([['workouts', 'My workouts'], ['chat', `Chat with ${TRAINER_NAME}`]], renderClientApp),
    body));
  if (state.tab === 'workouts') renderClientWorkouts(body);
  else renderChat(body, state.me.id, 'client');
}

async function renderClientWorkouts(body) {
  body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  const { data, error } = await sb.from('workouts').select('*').eq('client_id', state.me.id)
    .order('workout_date', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true });
  if (!body.isConnected) return;
  if (error) { body.replaceChildren(h('p', { class: 'error' }, error.message)); return; }
  if (!data.length) {
    body.replaceChildren(h('div', { class: 'empty' }, h('p', { class: 'muted' }, `No workouts yet. ${TRAINER_NAME} will add them here.`)));
    return;
  }
  const now = today();
  const upcoming = data.filter((w) => !w.completed_at && (!w.workout_date || w.workout_date >= now));
  const past = data.filter((w) => !upcoming.includes(w)).reverse();
  const refresh = () => renderClientWorkouts(body);
  fill(body,
    h('h3', {}, 'Up next'),
    upcoming.length
      ? h('div', { class: 'stack' }, upcoming.map((w) => workoutCard(w, { onChange: refresh })))
      : h('p', { class: 'muted' }, "You're all caught up."),
    past.length ? h('h3', {}, 'Past and completed') : null,
    past.length ? h('div', { class: 'stack' }, past.map((w) => workoutCard(w, { onChange: refresh }))) : null);
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
