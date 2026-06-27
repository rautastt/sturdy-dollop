'use strict';
// ── State ──────────────────────────────────────────────────────────────────────
let me = null, socket = null;
let currentChannel = null, currentServer = null, currentDM = null;
let servers = [], storeData = null;
let typingTimer = null;
let adminCache = {};

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const r = await api('/auth/me');
    me = await r.json();
    if (!r.ok) return location.href = '/login.html';
  } catch { return location.href = '/login.html'; }

  applyTheme(me.theme);
  renderSelf();
  connectSocket();
  await loadServers();
  showHome();
  showHomeTab('friends', document.querySelector('.home-tab'));
  if (me.is_admin) document.getElementById('adminBtn').style.display = 'flex';
  document.getElementById('msgInput').addEventListener('keydown', onMsgKey);
  document.getElementById('dmInput').addEventListener('keydown', onDMKey);
}

// ── API helper ─────────────────────────────────────────────────────────────────
function api(url, opts = {}) {
  return fetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...opts.headers }, ...opts });
}

// ── Toast ──────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast') || (() => {
    const t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); return t;
  })();
  el.textContent = msg;
  el.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = '', 3000);
}

// ── Theme ──────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.body.className = '';
  if (theme && theme !== 'default') document.body.classList.add('theme-' + theme);
}

// ── Render self ────────────────────────────────────────────────────────────────
function renderSelf() {
  const av = document.getElementById('selfAvatar');
  av.innerHTML = me.avatar ? `<img src="${me.avatar}" alt="">` : me.username[0].toUpperCase();
  document.getElementById('selfUsername').textContent = me.display_name || me.username;
  document.getElementById('selfTag').textContent = `Lv.${me.level} · ${me.points} pts`;
  if (me.name_color) document.getElementById('selfUsername').style.color = me.name_color;
}

// ── Socket ─────────────────────────────────────────────────────────────────────
function connectSocket() {
  socket = io({ withCredentials: true });

  socket.on('message:new', msg => {
    if (currentChannel && msg.channel_id === currentChannel.id) appendMessage(msg, document.getElementById('messages'));
  });
  socket.on('message:delete', ({ id }) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) el.remove();
  });
  socket.on('message:edit', msg => {
    const body = document.querySelector(`#msg-${msg.id} .msg-content`);
    if (body) { body.textContent = msg.content; }
  });
  socket.on('dm:message', msg => {
    if (currentDM && msg.dm_channel_id === currentDM.channelId) appendMessage(msg, document.getElementById('dmMessages'));
  });
  socket.on('typing:start', ({ userId: uid, username, channelId }) => {
    if (currentChannel && channelId === currentChannel.id && uid !== me.id) showTyping(username, 'typingBar');
  });
  socket.on('typing:stop', ({ channelId }) => {
    if (currentChannel && channelId === currentChannel.id) clearTyping('typingBar');
  });
  socket.on('typing:start:dm', ({ userId: uid, username, dmChannelId }) => {
    if (currentDM && dmChannelId === currentDM.channelId && uid !== me.id) showTyping(username, 'dmTypingBar');
  });
  socket.on('typing:stop:dm', ({ dmChannelId }) => {
    if (currentDM && dmChannelId === currentDM.channelId) clearTyping('dmTypingBar');
  });
  socket.on('presence:update', ({ userId: uid, status }) => {
    document.querySelectorAll(`.status-dot[data-uid="${uid}"]`).forEach(d => {
      d.className = `status-dot status-${status}`;
    });
  });
  socket.on('friend:request', ({ fromUsername }) => toast(`📬 ${fromUsername} sent you a friend request!`));
  socket.on('friend:accepted', ({ byUsername }) => toast(`✅ ${byUsername} accepted your friend request!`));
}

// ── Servers ────────────────────────────────────────────────────────────────────
async function loadServers() {
  const r = await api('/api/servers');
  servers = await r.json();
  renderServerList();
}

function renderServerList() {
  const el = document.getElementById('serverIcons');
  el.innerHTML = '';
  servers.forEach(s => {
    const div = document.createElement('div');
    div.className = 'server-icon';
    div.id = `server-icon-${s.id}`;
    div.title = s.name;
    div.innerHTML = s.icon ? `<img src="${s.icon}" alt="${s.name[0]}">` : `<span>${s.name[0].toUpperCase()}</span>`;
    div.onclick = () => openServer(s.id);
    el.appendChild(div);
  });
}

async function openServer(id) {
  const r = await api(`/api/servers/${id}`);
  if (!r.ok) return;
  currentServer = await r.json();

  document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
  const icon = document.getElementById(`server-icon-${id}`);
  if (icon) icon.classList.add('active');
  document.getElementById('homeBtn').classList.remove('active');

  document.getElementById('serverName').textContent = currentServer.name;
  renderChannels(currentServer.channels);

  // Auto-open first text channel
  const first = currentServer.channels.find(c => c.type === 'text');
  if (first) openChannel(first);
}

function renderChannels(channels) {
  const list = document.getElementById('channelList');
  list.innerHTML = '';
  channels.forEach(ch => {
    const div = document.createElement('div');
    div.className = 'channel-item';
    div.id = `ch-${ch.id}`;
    div.innerHTML = `<span class="channel-icon">${ch.type === 'voice' ? '🔊' : '#'}</span><span>${ch.name}</span>`;
    div.onclick = () => openChannel(ch);
    list.appendChild(div);
  });
}

async function openChannel(ch) {
  currentChannel = ch;
  currentDM = null;
  document.getElementById('homeView').style.display = 'none';
  document.getElementById('dmView').style.display = 'none';
  document.getElementById('channelView').style.display = 'flex';
  document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
  const el = document.getElementById(`ch-${ch.id}`);
  if (el) el.classList.add('active');
  document.getElementById('chatHeaderName').textContent = ch.name;
  document.getElementById('chatHeaderTopic').textContent = ch.topic || '';
  document.getElementById('chatHeaderIcon').textContent = '#';
  if (socket) socket.emit('channel:join', ch.id);
  await loadMessages(ch.id);
}

// ── Messages ───────────────────────────────────────────────────────────────────
async function loadMessages(channelId) {
  const container = document.getElementById('messages');
  container.innerHTML = '<div style="text-align:center;color:#96989d;padding:24px;font-size:14px">Loading…</div>';
  const r = await api(`/api/channels/${channelId}/messages`);
  if (!r.ok) { container.innerHTML = '<div style="text-align:center;color:#ed4245;padding:24px">Failed to load messages</div>'; return; }
  const msgs = await r.json();
  container.innerHTML = '';
  msgs.forEach(m => appendMessage(m, container, false));
  container.scrollTop = container.scrollHeight;
}

function appendMessage(msg, container, scroll = true) {
  const div = document.createElement('div');
  div.className = 'msg-group' + (me.chat_effect ? ` effect-${me.chat_effect}` : '');
  div.id = `msg-${msg.id}`;
  const isMe = msg.user_id === me.id;
  const nameColor = msg.name_color ? `style="color:${msg.name_color}"` : '';
  const badges = renderBadges(msg);
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const avatarHTML = msg.avatar
    ? `<img src="${msg.avatar}" alt="">`
    : `<span style="font-size:16px">${(msg.display_name || msg.username || '?')[0].toUpperCase()}</span>`;
  const replyHTML = msg.reply_message
    ? `<div class="msg-reply">↩ <strong>${msg.reply_message.author}</strong>: ${esc(msg.reply_message.content)}</div>` : '';
  const reactHTML = (msg.reactions || []).map(r =>
    `<span class="reaction-chip ${r.me ? 'mine' : ''}" onclick="toggleReact(${msg.id},'${r.emoji}')" title="${r.count} reaction(s)">${r.emoji} ${r.count}</span>`
  ).join('');

  div.innerHTML = `
    <div class="msg-avatar">${avatarHTML}</div>
    <div class="msg-body">
      ${replyHTML}
      <div class="msg-header">
        <span class="msg-author" ${nameColor} onclick="showUserProfile(${msg.user_id})">${badges}${esc(msg.display_name || msg.username)}</span>
        <span class="msg-time">${time}</span>
        ${msg.edited_at ? '<span class="msg-edited">(edited)</span>' : ''}
      </div>
      <div class="msg-content">${esc(msg.content)}</div>
      ${reactHTML ? `<div class="msg-reactions">${reactHTML}</div>` : ''}
    </div>
    <div class="msg-actions">
      <button class="msg-action" onclick="addReact(${msg.id})" title="React">😀</button>
      <button class="msg-action" onclick="replyTo(${msg.id},'${esc(msg.username)}')" title="Reply">↩</button>
      ${isMe ? `<button class="msg-action danger" onclick="deleteMessage(${msg.id},${currentChannel?.id})" title="Delete">🗑</button>` : ''}
    </div>`;
  container.appendChild(div);
  if (scroll) container.scrollTop = container.scrollHeight;
}

function renderBadges(user) {
  let b = '';
  if (user.badge_admin) b += '<span class="badge badge-admin" title="Admin">🛡</span> ';
  if (user.badge_gold) b += '<span class="badge badge-gold" title="Gold">⭐</span> ';
  if (user.badge_blue) b += '<span class="badge badge-blue" title="Verified">✅</span> ';
  if (user.badge_rail) b += '<span class="badge badge-rail" title="Rail">🚆</span> ';
  return b;
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let replyToId = null;
function replyTo(msgId, username) {
  replyToId = msgId;
  document.getElementById('msgInput').placeholder = `Replying to @${username}… (Esc to cancel)`;
  document.getElementById('msgInput').focus();
}

async function sendMessage() {
  const input = document.getElementById('msgInput');
  const content = input.value.trim();
  if (!content || !currentChannel) return;
  input.value = '';
  input.style.height = 'auto';
  socket?.emit('typing:stop', { channelId: currentChannel.id });
  const body = { content };
  if (replyToId) { body.replyToId = replyToId; replyToId = null; input.placeholder = 'Send a message…'; }
  const r = await api(`/api/channels/${currentChannel.id}/messages`, { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) { const d = await r.json(); toast(d.error || 'Failed to send', 'error'); }
}

async function deleteMessage(msgId, channelId) {
  if (!confirm('Delete this message?')) return;
  await api(`/api/channels/${channelId}/messages/${msgId}`, { method: 'DELETE' });
}

async function toggleReact(msgId, emoji) {
  await api(`/api/channels/${currentChannel?.id}/messages/${msgId}/react/${emoji}`, { method: 'DELETE' });
}

function addReact(msgId) {
  const emojis = ['👍','❤️','😂','😮','😢','😡','🔥','💯'];
  const popup = document.createElement('div');
  popup.style.cssText = `position:fixed;background:#2b2d31;border:1px solid #3f4147;border-radius:8px;padding:8px;display:flex;gap:6px;z-index:2000;font-size:20px;box-shadow:0 4px 20px rgba(0,0,0,.5)`;
  const msg = document.getElementById(`msg-${msgId}`);
  const rect = msg?.getBoundingClientRect() || { top: 100, left: 100 };
  popup.style.top = (rect.top - 50) + 'px';
  popup.style.left = rect.left + 'px';
  emojis.forEach(e => {
    const btn = document.createElement('button');
    btn.textContent = e;
    btn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:20px;border-radius:4px;padding:4px';
    btn.onmouseenter = () => btn.style.background = '#3f4147';
    btn.onmouseleave = () => btn.style.background = 'none';
    btn.onclick = () => { api(`/api/channels/${currentChannel?.id}/messages/${msgId}/react`, { method: 'POST', body: JSON.stringify({ emoji: e }) }); popup.remove(); };
    popup.appendChild(btn);
  });
  document.body.appendChild(popup);
  setTimeout(() => document.addEventListener('click', () => popup.remove(), { once: true }), 10);
}

function onMsgKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); return; }
  if (e.key === 'Escape') { replyToId = null; document.getElementById('msgInput').placeholder = 'Send a message…'; }
  if (socket && currentChannel) {
    socket.emit('typing:start', { channelId: currentChannel.id });
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => socket.emit('typing:stop', { channelId: currentChannel.id }), 2000);
  }
}

function onDMKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDM(); }
}

function showTyping(username, barId) { document.getElementById(barId).textContent = `${username} is typing…`; }
function clearTyping(barId) { document.getElementById(barId).textContent = ''; }

// ── Home / Friends ─────────────────────────────────────────────────────────────
function showHome() {
  document.getElementById('homeView').style.display = 'flex';
  document.getElementById('channelView').style.display = 'none';
  document.getElementById('dmView').style.display = 'none';
  document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
  document.getElementById('homeBtn').classList.add('active');
  document.getElementById('serverName').textContent = 'Home';
  document.getElementById('channelList').innerHTML = '';
  currentChannel = null; currentServer = null;
}

async function showHomeTab(tab, btn) {
  document.querySelectorAll('.home-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const container = document.getElementById('homeContent');
  container.innerHTML = '';
  if (tab === 'friends') await renderFriends(container);
  else if (tab === 'requests') await renderRequests(container);
  else if (tab === 'dms') await renderDMList(container);
}

async function renderFriends(el) {
  const r = await api('/api/friends');
  const friends = await r.json();
  const addBtn = `<button class="add-friend-btn" onclick="showModal('addFriendModal')">+ Add Friend</button>`;
  if (!friends.length) { el.innerHTML = `<div class="empty-state"><div class="icon">👥</div><div>No friends yet</div>${addBtn}</div>`; return; }
  el.innerHTML = addBtn + '<div style="height:12px"></div>';
  friends.forEach(f => {
    const div = document.createElement('div');
    div.className = 'friend-card';
    div.innerHTML = `
      <div class="friend-avatar">
        ${f.avatar ? `<img src="${f.avatar}" alt="">` : f.username[0].toUpperCase()}
        <span class="status-dot status-${f.status || 'offline'}" data-uid="${f.id}"></span>
      </div>
      <div><div class="friend-name">${esc(f.display_name||f.username)}</div><div class="friend-sub">${f.status||'offline'}</div></div>
      <div class="friend-actions">
        <button class="action-btn" title="Send DM" onclick="openDM(${f.id})">💬</button>
        <button class="action-btn danger" title="Remove friend" onclick="removeFriend(${f.id})">✖</button>
      </div>`;
    el.appendChild(div);
  });
}

async function renderRequests(el) {
  const r = await api('/api/friends/requests');
  const { incoming, outgoing } = await r.json();
  if (!incoming.length && !outgoing.length) { el.innerHTML = `<div class="empty-state"><div class="icon">📬</div><div>No pending requests</div></div>`; return; }
  if (incoming.length) {
    el.innerHTML += '<div style="font-size:13px;font-weight:600;color:#96989d;margin-bottom:8px">INCOMING</div>';
    incoming.forEach(req => {
      const div = document.createElement('div');
      div.className = 'friend-card';
      div.innerHTML = `
        <div class="friend-avatar">${req.avatar ? `<img src="${req.avatar}" alt="">` : req.username[0].toUpperCase()}</div>
        <div><div class="friend-name">${esc(req.display_name||req.username)}</div></div>
        <div class="friend-actions">
          <button class="action-btn success" title="Accept" onclick="acceptFriendReq(${req.id})">✓</button>
          <button class="action-btn danger" title="Decline" onclick="declineFriendReq(${req.id})">✖</button>
        </div>`;
      el.appendChild(div);
    });
  }
  if (outgoing.length) {
    const header = document.createElement('div');
    header.innerHTML = '<div style="font-size:13px;font-weight:600;color:#96989d;margin:12px 0 8px">OUTGOING</div>';
    el.appendChild(header);
    outgoing.forEach(req => {
      const div = document.createElement('div');
      div.className = 'friend-card';
      div.innerHTML = `
        <div class="friend-avatar">${req.avatar ? `<img src="${req.avatar}" alt="">` : req.username[0].toUpperCase()}</div>
        <div><div class="friend-name">${esc(req.display_name||req.username)}</div><div class="friend-sub">Pending…</div></div>`;
      el.appendChild(div);
    });
  }
}

async function acceptFriendReq(id) {
  const r = await api(`/api/friends/requests/${id}/accept`, { method: 'POST' });
  if (r.ok) { toast('Friend request accepted!', 'success'); showHomeTab('requests', null); }
}
async function declineFriendReq(id) {
  await api(`/api/friends/requests/${id}/decline`, { method: 'POST' });
  showHomeTab('requests', null);
}
async function removeFriend(id) {
  if (!confirm('Remove this friend?')) return;
  await api(`/api/friends/${id}`, { method: 'DELETE' });
  showHomeTab('friends', null);
}

// ── DMs ────────────────────────────────────────────────────────────────────────
async function renderDMList(el) {
  const r = await api('/api/dms');
  const dms = await r.json();
  if (!dms.length) { el.innerHTML = `<div class="empty-state"><div class="icon">💬</div><div>No DMs yet. Add a friend and message them!</div></div>`; return; }
  dms.forEach(dm => {
    const div = document.createElement('div');
    div.className = 'friend-card';
    div.innerHTML = `
      <div class="friend-avatar">
        ${dm.avatar ? `<img src="${dm.avatar}" alt="">` : dm.username[0].toUpperCase()}
        <span class="status-dot status-${dm.status||'offline'}" data-uid="${dm.id}"></span>
      </div>
      <div><div class="friend-name">${esc(dm.display_name||dm.username)}</div><div class="friend-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px">${esc(dm.last_message||'')}</div></div>`;
    div.onclick = () => openDM(dm.id, dm.dm_channel_id);
    el.appendChild(div);
  });
}

async function openDM(userId, existingChannelId) {
  let dmChannelId = existingChannelId;
  let user;
  if (!dmChannelId) {
    const r = await api('/api/dms/open', { method: 'POST', body: JSON.stringify({ userId }) });
    if (!r.ok) { toast('Failed to open DM', 'error'); return; }
    const d = await r.json();
    dmChannelId = d.dmChannelId;
    user = d.user;
  }
  if (!user) {
    const r = await api(`/api/users/${userId}`);
    user = await r.json();
  }
  currentDM = { channelId: dmChannelId, user };
  currentChannel = null;
  document.getElementById('homeView').style.display = 'none';
  document.getElementById('channelView').style.display = 'none';
  document.getElementById('dmView').style.display = 'flex';
  document.getElementById('dmHeaderName').textContent = '💬 ' + (user.display_name || user.username);
  if (socket) socket.emit('dm:join', dmChannelId);
  await loadDMMessages(dmChannelId);
  closeModal('addFriendModal');
}

async function loadDMMessages(dmId) {
  const container = document.getElementById('dmMessages');
  container.innerHTML = '';
  const r = await api(`/api/dms/${dmId}/messages`);
  if (!r.ok) return;
  const msgs = await r.json();
  msgs.forEach(m => appendMessage(m, container, false));
  container.scrollTop = container.scrollHeight;
}

async function sendDM() {
  const input = document.getElementById('dmInput');
  const content = input.value.trim();
  if (!content || !currentDM) return;
  input.value = '';
  const r = await api(`/api/dms/${currentDM.channelId}/messages`, { method: 'POST', body: JSON.stringify({ content }) });
  if (!r.ok) { const d = await r.json(); toast(d.error || 'Failed to send', 'error'); }
}

// ── Search users (friend add) ──────────────────────────────────────────────────
let searchTimer;
async function searchUsers(q, containerId) {
  clearTimeout(searchTimer);
  const el = document.getElementById(containerId);
  if (q.length < 2) { el.innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    const r = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    const users = await r.json();
    el.innerHTML = '';
    if (!users.length) { el.innerHTML = '<div style="color:#96989d;font-size:14px;padding:8px 0">No users found</div>'; return; }
    users.forEach(u => {
      const div = document.createElement('div');
      div.className = 'friend-card';
      div.style.cursor = 'pointer';
      div.innerHTML = `
        <div class="friend-avatar">${u.avatar ? `<img src="${u.avatar}" alt="">` : u.username[0].toUpperCase()}</div>
        <div><div class="friend-name">${esc(u.display_name||u.username)}</div></div>
        <div class="friend-actions">
          <button class="action-btn success" onclick="sendFriendReq(${u.id})" title="Add Friend">+</button>
          <button class="action-btn" onclick="openDM(${u.id})" title="Message">💬</button>
        </div>`;
      el.appendChild(div);
    });
  }, 350);
}

async function sendFriendReq(userId) {
  const r = await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ userId }) });
  const d = await r.json();
  toast(r.ok ? d.message : d.error, r.ok ? 'success' : 'error');
}

// ── Server CRUD ────────────────────────────────────────────────────────────────
async function createServer() {
  const name = document.getElementById('newServerName').value.trim();
  if (!name) return;
  const desc = document.getElementById('newServerDesc').value.trim();
  const r = await api('/api/servers', { method: 'POST', body: JSON.stringify({ name, description: desc }) });
  if (!r.ok) { const d = await r.json(); toast(d.error || 'Failed', 'error'); return; }
  const server = await r.json();
  closeModal('createServerModal');
  await loadServers();
  openServer(server.id);
}

async function joinServer() {
  const code = document.getElementById('joinCode').value.trim();
  if (!code) return;
  const r = await api('/api/servers/join', { method: 'POST', body: JSON.stringify({ inviteCode: code }) });
  if (!r.ok) { const d = await r.json(); toast(d.error || 'Failed', 'error'); return; }
  const server = await r.json();
  closeModal('joinServerModal');
  await loadServers();
  openServer(server.id);
}

// ── Profile modal ──────────────────────────────────────────────────────────────
async function showUserProfile(userId) {
  const r = await api(`/api/users/${userId}`);
  if (!r.ok) return;
  const user = await r.json();
  const modal = document.getElementById('profileModal');
  const isMe = userId === me.id;
  document.getElementById('profileBanner').style.background = user.banner ? `url(${user.banner}) center/cover` : 'linear-gradient(135deg,#5865f2,#eb459e)';
  document.getElementById('profileAvatar').innerHTML = user.avatar ? `<img src="${user.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : user.username[0].toUpperCase();
  const nameStyle = user.name_color ? `style="color:${user.name_color}"` : '';
  document.getElementById('profileUsername').innerHTML = `<span ${nameStyle}>${esc(user.display_name||user.username)}</span> <span style="color:#96989d;font-size:14px;font-weight:400">${esc(user.username)}</span>`;
  document.getElementById('profileBadges').innerHTML = renderBadges(user);
  document.getElementById('profileBio').textContent = user.bio || '';
  document.getElementById('profileStats').innerHTML = `<div>Lv.${user.level}</div><div>${user.points} pts</div><div>${user.xp} xp</div>`;
  const actions = document.getElementById('profileActions');
  if (isMe) {
    actions.innerHTML = `<button class="btn-primary" onclick="showSettings()">Edit Profile</button>`;
  } else {
    actions.innerHTML = `
      <button class="btn-primary" style="margin-right:8px" onclick="openDM(${userId});closeModal('profileModal')">Message</button>
      <button class="btn-secondary" onclick="sendFriendReq(${userId})">Add Friend</button>`;
  }
  showModal('profileModal');
}

// ── Settings ───────────────────────────────────────────────────────────────────
function showSettings() { showModal('settingsModal'); showSettingsTab('account', document.querySelector('.settings-tab')); }

function showSettingsTab(tab, btn) {
  document.querySelectorAll('.settings-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const body = document.getElementById('settingsBody');
  if (tab === 'account') {
    body.innerHTML = `
      <div class="settings-section"><h3>Account</h3>
        <div class="settings-info">Username: <strong>${esc(me.username)}</strong></div>
        <div class="settings-info">Email: <strong>${esc(me.email)}</strong></div>
      </div>
      <div class="settings-section"><h3>Change Username</h3>
        <div class="field"><input id="newUsername" placeholder="New username" value="${esc(me.username)}"></div>
        <button class="settings-save" onclick="saveUsername()">Save Username</button>
      </div>
      <div class="settings-section"><h3>Change Password</h3>
        <div class="field"><input type="password" id="curPwd" placeholder="Current password"></div>
        <div class="field"><input type="password" id="newPwd" placeholder="New password (min 8 chars)"></div>
        <button class="settings-save" onclick="changePassword()">Update Password</button>
      </div>
      <div class="settings-section"><h3>Danger Zone</h3>
        <button class="btn-danger" onclick="if(confirm('Log out of all devices?')) logoutAll()">Log Out Everywhere</button>
      </div>`;
  } else if (tab === 'profile') {
    body.innerHTML = `
      <div class="settings-section"><h3>Display Name</h3>
        <div class="field"><input id="displayName" placeholder="Display name" value="${esc(me.display_name||'')}"></div>
      </div>
      <div class="settings-section"><h3>Bio</h3>
        <div class="field"><textarea id="bio" rows="3" placeholder="Write something about yourself…" maxlength="500">${esc(me.bio||'')}</textarea></div>
      </div>
      <div class="settings-section"><h3>Avatar</h3>
        <input type="file" id="avatarFile" accept="image/*" style="display:none" onchange="uploadAvatar(event)">
        <button class="settings-btn" onclick="document.getElementById('avatarFile').click()">Upload Avatar</button>
      </div>
      <div class="settings-section"><h3>Profile Banner</h3>
        <input type="file" id="bannerFile" accept="image/*" style="display:none" onchange="uploadBanner(event)">
        <button class="settings-btn" onclick="document.getElementById('bannerFile').click()">Upload Banner</button>
      </div>
      <button class="settings-save" onclick="saveProfile()">Save Changes</button>`;
  } else if (tab === 'privacy') {
    body.innerHTML = `
      <div class="settings-section"><h3>Status</h3>
        <div class="field"><select id="statusSelect" onchange="setStatus(this.value)">
          <option value="online" ${me.status==='online'?'selected':''}>Online</option>
          <option value="idle" ${me.status==='idle'?'selected':''}>Idle</option>
          <option value="dnd" ${me.status==='dnd'?'selected':''}>Do Not Disturb</option>
          <option value="invisible" ${me.status==='invisible'?'selected':''}>Invisible</option>
        </select></div>
      </div>
      <div class="settings-section"><h3>My Store Items</h3>
        <div style="font-size:14px;color:#96989d">Theme: <strong>${me.theme||'default'}</strong></div>
        <div style="font-size:14px;color:#96989d;margin-top:8px">Name Color: ${me.name_color ? `<span style="color:${me.name_color}">${me.name_color}</span>` : 'None'}</div>
        <div style="font-size:14px;color:#96989d;margin-top:8px">Chat Effect: <strong>${me.chat_effect||'None'}</strong></div>
        <button class="settings-btn" style="margin-top:12px" onclick="openStore();closeModal('settingsModal')">Go to Store</button>
      </div>`;
  }
}

async function saveUsername() {
  const username = document.getElementById('newUsername').value.trim();
  if (!username) return;
  const r = await api('/api/users/me', { method: 'PUT', body: JSON.stringify({ username }) });
  if (r.ok) { const d = await r.json(); me.username = d.username; toast('Username updated!', 'success'); }
  else { const d = await r.json(); toast(d.error || 'Failed', 'error'); }
}

async function saveProfile() {
  const displayName = document.getElementById('displayName').value.trim();
  const bio = document.getElementById('bio').value.trim();
  const r = await api('/api/users/me', { method: 'PUT', body: JSON.stringify({ displayName, bio }) });
  if (r.ok) { me.display_name = displayName; me.bio = bio; renderSelf(); toast('Profile saved!', 'success'); }
  else { const d = await r.json(); toast(d.error || 'Failed', 'error'); }
}

async function changePassword() {
  const curPwd = document.getElementById('curPwd').value;
  const newPwd = document.getElementById('newPwd').value;
  if (!curPwd || newPwd.length < 8) { toast('New password must be at least 8 chars', 'error'); return; }
  const r = await api('/api/users/me/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: curPwd, newPassword: newPwd }) });
  const d = await r.json();
  toast(r.ok ? 'Password updated!' : d.error || 'Failed', r.ok ? 'success' : 'error');
}

async function setStatus(status) {
  socket?.emit('status:set', status);
  me.status = status;
}

async function uploadAvatar(e) {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData(); fd.append('avatar', file);
  const r = await fetch('/api/users/me/avatar', { method: 'POST', body: fd, credentials: 'include' });
  if (r.ok) { const d = await r.json(); me.avatar = d.avatar; renderSelf(); toast('Avatar updated!', 'success'); }
  else toast('Upload failed', 'error');
}

async function uploadBanner(e) {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData(); fd.append('banner', file);
  const r = await fetch('/api/users/me/banner', { method: 'POST', body: fd, credentials: 'include' });
  if (r.ok) { me.banner = (await r.json()).banner; toast('Banner updated!', 'success'); }
  else toast('Upload failed', 'error');
}

// ── Store ──────────────────────────────────────────────────────────────────────
async function openStore() {
  showModal('storeModal');
  await loadStore();
}

async function loadStore() {
  const r = await api('/api/store');
  if (!r.ok) { toast('Failed to load store', 'error'); return; }
  storeData = await r.json();
  document.getElementById('storePoints').textContent = `💰 Your Points: ${storeData.points}`;
  renderStoreGrid('all');
}

function filterStore(type, btn) {
  document.querySelectorAll('.store-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderStoreGrid(type);
}

function renderStoreGrid(filter) {
  if (!storeData) return;
  const grid = document.getElementById('storeGrid');
  grid.innerHTML = '';
  // Deduplicate by id just to be safe
  const seen = new Set();
  const items = storeData.items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return filter === 'all' || item.type === filter;
  });
  if (!items.length) { grid.innerHTML = '<div style="color:#96989d;font-size:14px;padding:16px;grid-column:1/-1">No items in this category</div>'; return; }
  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'store-card' + (item.owned ? ' owned' : '');
    card.innerHTML = `
      <div class="store-icon">${item.icon || '📦'}</div>
      <div class="store-name">${esc(item.name)}</div>
      <div class="store-desc">${esc(item.description)}</div>
      <div class="store-cost">${item.owned ? '' : `${item.cost} pts`}</div>
      ${item.owned
        ? `<button class="store-owned-btn">✓ Owned</button>`
        : `<button class="store-buy-btn" onclick="buyItem('${item.id}')">Buy</button>`}`;
    grid.appendChild(card);
  });
}

async function buyItem(itemId) {
  const r = await api('/api/store/buy', { method: 'POST', body: JSON.stringify({ itemId }) });
  const d = await r.json();
  if (!r.ok) { toast(d.error || 'Purchase failed', 'error'); return; }
  toast(d.message, 'success');
  // Reload me and store
  const meRes = await api('/auth/me');
  if (meRes.ok) { me = await meRes.json(); applyTheme(me.theme); renderSelf(); }
  await loadStore();
}

// ── Admin Dashboard ────────────────────────────────────────────────────────────
function openAdmin() { showModal('adminModal'); adminTab('overview', document.querySelector('.admin-tab')); }

function adminTab(tab, btn) {
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const body = document.getElementById('adminBody');
  body.innerHTML = '<div style="padding:24px;text-align:center;color:#96989d">Loading…</div>';
  if (tab === 'overview') renderAdminOverview(body);
  else if (tab === 'users') renderAdminUsers(body);
  else if (tab === 'bans') renderAdminBans(body);
  else if (tab === 'modlogs') renderAdminModlogs(body);
  else if (tab === 'servers') renderAdminServers(body);
}

async function renderAdminOverview(body) {
  const r = await api('/api/admin/stats');
  if (!r.ok) { body.innerHTML = '<div style="color:#ed4245;padding:16px">Failed to load stats</div>'; return; }
  const s = await r.json();
  body.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-num">${s.totalUsers.toLocaleString()}</div><div class="stat-label">Total Users</div></div>
      <div class="stat-card"><div class="stat-num">${s.totalServers.toLocaleString()}</div><div class="stat-label">Servers</div></div>
      <div class="stat-card"><div class="stat-num">${s.totalMessages.toLocaleString()}</div><div class="stat-label">Messages</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#ed4245">${s.activeBans}</div><div class="stat-label">Active Bans</div></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-secondary" onclick="adminTab('users',null)">Manage Users</button>
      <button class="btn-secondary" onclick="adminTab('bans',null)">View Bans</button>
      <button class="btn-secondary" onclick="adminTab('modlogs',null)">Mod Logs</button>
    </div>`;
}

async function renderAdminUsers(body, q = '') {
  const r = await api(`/api/admin/users?q=${encodeURIComponent(q)}`);
  if (!r.ok) { body.innerHTML = '<div style="color:#ed4245;padding:16px">Failed to load users</div>'; return; }
  const { users, total } = await r.json();
  body.innerHTML = `
    <input class="admin-search" placeholder="Search by username or email…" value="${esc(q)}" oninput="renderAdminUsers(document.getElementById('adminBody'), this.value)">
    <div style="color:#96989d;font-size:13px;margin-bottom:8px">${total} user(s)</div>
    <div style="overflow-x:auto">
    <table class="admin-table">
      <thead><tr><th>User</th><th>Email</th><th>Level</th><th>Points</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        ${users.map(u => `
          <tr>
            <td>
              <div style="display:flex;align-items:center;gap:8px">
                <div style="width:28px;height:28px;border-radius:50%;background:#3f4147;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:12px">
                  ${u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">` : u.username[0].toUpperCase()}
                </div>
                <div>
                  <div style="font-weight:600;font-size:13px">${esc(u.username)} ${u.is_admin ? '<span class="tag tag-admin">admin</span>' : ''}</div>
                  ${u.is_banned ? '<span class="tag tag-banned">banned</span>' : ''}
                </div>
              </div>
            </td>
            <td style="color:#96989d;font-size:12px">${esc(u.email)}</td>
            <td>Lv.${u.level}</td>
            <td>${u.points}</td>
            <td><span style="font-size:12px">${u.status||'unknown'}</span></td>
            <td>
              <div style="display:flex;gap:4px;flex-wrap:wrap">
                ${u.is_banned
                  ? `<button class="action-btn success" title="Unban" onclick="adminUnban(${u.id})" style="font-size:12px;padding:3px 8px;border-radius:4px;background:#57f287;color:#000;border:none;cursor:pointer;font-weight:600">Unban</button>`
                  : `<button class="action-btn danger" title="Ban" onclick="adminBan(${u.id},'${esc(u.username)}')" style="font-size:12px;padding:3px 8px;border-radius:4px;background:#ed4245;color:#fff;border:none;cursor:pointer;font-weight:600">Ban</button>`}
                <button title="Grant/Remove Badge" onclick="adminBadge(${u.id},'${esc(u.username)}')" style="font-size:12px;padding:3px 8px;border-radius:4px;background:#2b2d31;color:#dcddde;border:none;cursor:pointer">Badge</button>
                <button title="Adjust Points" onclick="adminPoints(${u.id},'${esc(u.username)}')" style="font-size:12px;padding:3px 8px;border-radius:4px;background:#2b2d31;color:#dcddde;border:none;cursor:pointer">Points</button>
              </div>
            </td>
          </tr>`).join('')}
      </tbody>
    </table></div>`;
}

async function adminBan(userId, username) {
  const reason = prompt(`Ban reason for ${username}:`);
  if (!reason) return;
  const r = await api(`/api/admin/users/${userId}/ban`, { method: 'POST', body: JSON.stringify({ reason }) });
  const d = await r.json();
  toast(r.ok ? 'User banned' : d.error || 'Failed', r.ok ? 'success' : 'error');
  if (r.ok) renderAdminUsers(document.getElementById('adminBody'));
}

async function adminUnban(userId) {
  const r = await api(`/api/admin/users/${userId}/unban`, { method: 'POST' });
  const d = await r.json();
  toast(r.ok ? 'User unbanned' : d.error || 'Failed', r.ok ? 'success' : 'error');
  if (r.ok) renderAdminUsers(document.getElementById('adminBody'));
}

async function adminBadge(userId, username) {
  const badge = prompt(`Badge for ${username} (badge_blue, badge_gold, badge_rail, badge_admin):`);
  if (!badge) return;
  const grant = confirm(`Grant badge "${badge}"? (Cancel = Remove)`);
  const r = await api(`/api/admin/users/${userId}/badge`, { method: 'POST', body: JSON.stringify({ badge, grant }) });
  const d = await r.json();
  toast(r.ok ? d.message : d.error || 'Failed', r.ok ? 'success' : 'error');
}

async function adminPoints(userId, username) {
  const delta = parseInt(prompt(`Points change for ${username} (use negative to remove):`));
  if (isNaN(delta)) return;
  const r = await api(`/api/admin/users/${userId}/points`, { method: 'POST', body: JSON.stringify({ delta }) });
  const d = await r.json();
  toast(r.ok ? d.message : d.error || 'Failed', r.ok ? 'success' : 'error');
}

async function renderAdminBans(body) {
  const r = await api('/api/admin/bans');
  const bans = await r.json();
  if (!bans.length) { body.innerHTML = '<div style="padding:16px;color:#96989d">No active bans</div>'; return; }
  body.innerHTML = `<div style="overflow-x:auto"><table class="admin-table">
    <thead><tr><th>Username</th><th>Email</th><th>Reason</th><th>Banned By</th><th>Date</th><th>Action</th></tr></thead>
    <tbody>${bans.map(b => `<tr>
      <td><strong>${esc(b.username)}</strong></td>
      <td style="color:#96989d;font-size:12px">${esc(b.email)}</td>
      <td>${esc(b.reason)}</td>
      <td>${esc(b.banned_by_username||'System')}</td>
      <td style="font-size:12px;color:#96989d">${new Date(b.created_at).toLocaleDateString()}</td>
      <td><button onclick="adminUnban(${b.user_id})" style="font-size:12px;padding:3px 8px;border-radius:4px;background:#57f287;color:#000;border:none;cursor:pointer;font-weight:600">Unban</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

async function renderAdminModlogs(body) {
  const r = await api('/api/admin/modlogs');
  const { logs } = await r.json();
  if (!logs.length) { body.innerHTML = '<div style="padding:16px;color:#96989d">No moderation logs</div>'; return; }
  body.innerHTML = `<div style="overflow-x:auto"><table class="admin-table">
    <thead><tr><th>Admin</th><th>Action</th><th>Target</th><th>Reason</th><th>Date</th></tr></thead>
    <tbody>${logs.map(l => `<tr>
      <td><strong>${esc(l.admin_username||'System')}</strong></td>
      <td><span class="tag" style="background:#2b2d31;color:#dcddde">${esc(l.action)}</span></td>
      <td>${esc(l.target_username||'-')}</td>
      <td style="color:#96989d;font-size:12px">${esc(l.reason||'-')}</td>
      <td style="font-size:12px;color:#96989d">${new Date(l.created_at).toLocaleString()}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

async function renderAdminServers(body) {
  const r = await api('/api/admin/servers');
  const servers = await r.json();
  body.innerHTML = `<div style="overflow-x:auto"><table class="admin-table">
    <thead><tr><th>Server</th><th>Owner</th><th>Members</th><th>Channels</th><th>Action</th></tr></thead>
    <tbody>${servers.map(s => `<tr>
      <td><strong>${esc(s.name)}</strong> <span style="color:#96989d;font-size:12px">${esc(s.invite_code)}</span></td>
      <td>${esc(s.owner_username||'Unknown')}</td>
      <td>${s.member_count}</td>
      <td>${s.channel_count}</td>
      <td><button onclick="adminDeleteServer(${s.id},'${esc(s.name)}')" style="font-size:12px;padding:3px 8px;border-radius:4px;background:#ed4245;color:#fff;border:none;cursor:pointer;font-weight:600">Delete</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

async function adminDeleteServer(id, name) {
  if (!confirm(`Delete server "${name}"? This is PERMANENT.`)) return;
  const r = await api(`/api/admin/servers/${id}`, { method: 'DELETE' });
  const d = await r.json();
  toast(r.ok ? 'Server deleted' : d.error || 'Failed', r.ok ? 'success' : 'error');
  if (r.ok) renderAdminServers(document.getElementById('adminBody'));
}

// ── Modal helpers ──────────────────────────────────────────────────────────────
function showModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

// ── Auth ───────────────────────────────────────────────────────────────────────
async function logout() {
  await api('/auth/logout', { method: 'POST' });
  location.href = '/login.html';
}
async function logoutAll() {
  await api('/auth/logout-all', { method: 'POST' });
  location.href = '/login.html';
}

// ── Keyboard shortcuts ─────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const modals = ['adminModal','storeModal','settingsModal','profileModal','addFriendModal','createServerModal','joinServerModal'];
    for (const id of modals) {
      const el = document.getElementById(id);
      if (el && el.style.display !== 'none') { closeModal(id); return; }
    }
  }
});

// ── Boot ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
