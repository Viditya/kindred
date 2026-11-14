const id = (value) => document.getElementById(value);
const authForm = id('auth-form');
const planForm = id('plan-form');
const dialog = id('dialog');
let signingUp = true;
let member;
let config;
let dialogAction;
let refreshVersion = 0;

function node(tag, value, className) {
  const element = document.createElement(tag);
  if (value) element.textContent = value;
  if (className) element.className = className;
  return element;
}

async function api(path, method = 'GET', body = {}) {
  const options = method === 'GET' ? {} : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  };
  let response;
  try {
    response = await fetch('/api' + path, options);
  } catch {
    throw new Error('Kindred is unreachable. Check your connection and try again.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && member) showAuth();
    throw Object.assign(new Error(data.error || 'Kindred couldn’t complete that request. Try again.'), { status: response.status });
  }
  return data;
}

function notice(message = '', error = false) {
  id('notice').textContent = message;
  id('notice').classList.toggle('error', error);
}

function authMode(joining) {
  signingUp = joining;
  for (const label of authForm.querySelectorAll('[data-join]')) {
    label.hidden = !joining;
    const input = label.querySelector('input');
    if (input) input.disabled = !joining;
  }
  authForm.elements.password.autocomplete = joining ? 'new-password' : 'current-password';
  id('auth-title').textContent = joining ? 'Join with an invite' : 'Sign in';
  id('auth-submit').textContent = joining ? 'Join Kindred' : 'Sign in';
  id('auth-switch').textContent = joining ? 'Already joined? Sign in' : 'Have an invite? Join Kindred';
}

function showAuth(joining = false) {
  member = null;
  refreshVersion++;
  id('auth').hidden = false;
  id('app').hidden = true;
  document.querySelector('.account').hidden = true;
  id('matches').replaceChildren();
  id('invitations').replaceChildren();
  planForm.reset();
  authForm.reset();
  if (dialog.open) dialog.close();
  authMode(joining);
}

function fillPlan(current) {
  planForm.reset();
  const fields = planForm.elements;
  fields.name.value = current.name;
  fields.day.min = config.today;
  fields.day.max = config.lastDay;
  if (current.plan) {
    const { interests, ...fieldsToFill } = current.plan;
    for (const [key, value] of Object.entries(fieldsToFill)) fields[key].value = value;
    fields.interests.value = interests.join(', ');
  }
  id('pause').hidden = !current.plan;
}

async function enter(current) {
  member = current;
  id('member').textContent = current.name;
  document.querySelector('.account').hidden = false;
  id('app').hidden = false;
  id('auth').hidden = true;
  fillPlan(current);
  await refresh();
}

function button(label, style, handler) {
  const element = node('button', label, style);
  element.type = 'button';
  element.addEventListener('click', handler);
  return element;
}

function empty(message) {
  return node('p', message, 'empty');
}

function dateLabel(day) {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
    .format(new Date(day + 'T12:00:00+05:30'));
}

function modal(title, copy, label, action, fields = []) {
  dialogAction = action;
  id('dialog-title').textContent = title;
  id('dialog-copy').textContent = copy;
  id('dialog-submit').textContent = label;
  id('dialog-error').textContent = '';
  id('dialog-fields').replaceChildren(...fields);
  dialog.showModal();
}

function field(label, name, options, tag = 'input') {
  const wrapper = node('label', label);
  const input = Object.assign(node(tag), { name, required: true, ...options });
  wrapper.append(input);
  return wrapper;
}

function tools(peer) {
  return [
    button('Block', 'link', () => modal('Block ' + peer.name + '?', 'Your profiles and invitations will disappear from each other’s views.', 'Block member', async () => {
      await api('/members/' + peer.id + '/block', 'POST');
      return 'Member blocked.';
    })),
    button('Report', 'link danger', () => modal('Report ' + peer.name, 'Your report goes to the pilot organizer, and this member will be blocked.', 'Send report', async (data) => {
      await api('/members/' + peer.id + '/report', 'POST', data);
      return 'Report sent and member blocked.';
    }, [field('What happened?', 'reason', { minLength: 4, maxLength: 400 }, 'textarea')])),
  ];
}

function matchCard(match) {
  const card = node('article', '', 'card');
  const why = [member.plan.activity + ' · ' + match.area, 'Free ' + match.overlap.from + '–' + match.overlap.until + ' IST'];
  if (match.shared.length) why.push('You both like ' + match.shared.join(', '));
  const actions = node('div', '', 'actions');
  actions.append(button('Invite', 'primary', () => modal(
    'Invite ' + match.name,
    dateLabel(member.plan.day) + ' · ' + match.overlap.from + '–' + match.overlap.until + ' IST. Pick a public location.',
    'Send invitation',
    async (data) => {
      await api('/invitations/' + match.id, 'POST', data);
      return 'Invitation sent. Refresh Invitations to check for a reply.';
    },
    [field('Meetup time (IST)', 'time', { type: 'time', min: match.overlap.from, max: match.overlap.until }),
      field('Public meeting spot', 'place', { minLength: 3, maxLength: 120, placeholder: 'Café name and neighborhood' })],
  )), ...tools(match));
  card.append(node('h3', match.name), node('p', why.join(' · ')), actions);
  return card;
}

function inviteCard(invite) {
  const { id: inviteId, peer, status, outgoing, past } = invite;
  const card = node('article', '', 'card');
  const statuses = {
    pending: outgoing ? 'Awaiting their reply' : 'They invited you',
    accepted: 'Accepted by both',
    declined: 'Declined',
    cancelled: 'Cancelled',
    expired: 'Expired',
  };
  const actions = node('div', '', 'actions');
  const change = (action, label, style) => button(label, style, async (event) => {
    await run(event.currentTarget, async () => {
      await api('/invitations/' + inviteId + '/' + action, 'POST');
      await refresh();
    });
  });
  if (status === 'pending' && !outgoing) actions.append(change('accept', 'Accept', 'primary'), change('decline', 'Decline', 'secondary'));
  if (!past && (status === 'accepted' || (status === 'pending' && outgoing))) actions.append(change('cancel', 'Cancel', 'link'));
  if (past && status === 'accepted' && !invite.attended) actions.append(change('attended', 'We met', 'primary'));
  actions.append(...tools(peer));
  const attendance = invite.bothAttended ? ' · Both confirmed you met' : invite.attended ? ' · You confirmed you met' : '';
  card.append(node('h3', peer.name), node('p', statuses[status] + attendance),
    node('p', [invite.activity, dateLabel(invite.day), invite.time + ' IST', invite.place].join(' · ')), actions);
  return card;
}

async function refresh() {
  const version = ++refreshVersion;
  const [matches, invitations] = await Promise.all([api('/matches'), api('/invitations')]);
  if (!member || version !== refreshVersion) return;
  id('matches').replaceChildren(...(matches.length ? matches.map(matchCard) : [
    empty(member.plan ? 'No overlapping plans yet. Ask another tester to save a plan for the same activity and date, then refresh.' : 'Save a plan to see who’s free at the same time.'),
  ]));
  id('invitations').replaceChildren(...(invitations.length ? invitations.map(inviteCard) : [
    empty('Sent and received invitations will appear here.'),
  ]));
}

async function run(control, task, dialogError = false) {
  control.disabled = true;
  notice();
  try {
    await task();
  } catch (error) {
    if (dialogError && dialog.open) id('dialog-error').textContent = error.message;
    else notice(error.message, true);
  } finally {
    control.disabled = false;
  }
}

id('auth-switch').addEventListener('click', () => { notice(); authMode(!signingUp); });
authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await run(event.submitter, async () => {
    const data = Object.fromEntries(new FormData(authForm));
    if (signingUp) data.adult = authForm.elements.adult.checked;
    const current = await api(signingUp ? '/signup' : '/login', 'POST', data);
    authForm.reset();
    await enter(current);
  });
});
planForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await run(event.submitter, async () => {
    const { name, interests, ...plan } = Object.fromEntries(new FormData(planForm));
    plan.interests = interests.split(',').map((item) => item.trim()).filter(Boolean);
    await enter(await api('/me', 'PUT', { name, plan }));
    notice('Plan saved. Your availability is shown in IST.');
  });
});
id('pause').addEventListener('click', () => modal('Remove your plan?', 'Your profile stops appearing in search. Pending invitations tied to this plan are withdrawn. Accepted meetup plans remain in Invitations.', 'Remove plan', async () => {
  await enter(await api('/me', 'PUT', { name: member.name, plan: null }));
  return 'Plan removed.';
}));
id('refresh').addEventListener('click', (event) => run(event.currentTarget, async () => {
  await refresh();
  notice('Matches and invitations refreshed.');
}));
id('logout').addEventListener('click', (event) => run(event.currentTarget, async () => {
  await api('/logout', 'POST');
  showAuth();
}));
id('delete').addEventListener('click', () => modal('Delete your Kindred account?', 'This removes your account, plan and invitations from the pilot.', 'Delete my account', async () => {
  await api('/me', 'DELETE');
  showAuth(true);
  return 'Your account was deleted.';
}));
id('dialog-close').addEventListener('click', () => dialog.close());
id('dialog-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  id('dialog-error').textContent = '';
  await run(event.submitter, async () => {
    const result = await dialogAction(Object.fromEntries(new FormData(event.target)));
    dialog.close();
    if (member) await refresh();
    notice(result);
  }, true);
});

try {
  config = await api('/config');
  const activity = planForm.elements.activity;
  activity.append(new Option('Choose an activity', ''), ...config.activities.map((name) => new Option(name, name)));
  try {
    await enter(await api('/me'));
  } catch (error) {
    if (error.status !== 401) throw error;
    showAuth(true);
  }
} catch (error) {
  notice(error.message, true);
}
