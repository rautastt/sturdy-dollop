// ─── Sigma Chat Client ────────────────────────────────────────────────────────

let me = null;
let socket = null;
let currentServerId = null;
let currentChannelId = null;
let currentDmId = null;
let currentGroupId = null;
let servers = [];
let typingUsers = {};
let typingTimer = null;
let isTyping = false;
let replyToId = null;
let replyToName = null;
let memberListVisible = true;

const EMOJIS = ['😀','😂','🥰','😎','🤔','🤯','🔥','❤️','👍','👎','🎉','✨','💯','⚡','🌟',
  '💀','🤣','😭','🙏','👀','💬','🎮','🚀','🌈','💎','🦄','🍕','☕','💻','🎵'];

// ─── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch('/auth/me', { credentials: 'include' });
    if (!res.ok) { location.href = '/login.html'; return; }
    me = await res.json();
    if (me.is_banned) { location.href = '/login.html?error=banned'; return; }
    setupSocket();
    renderProfileBar();
    await loadServers();
    showHome();
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('app-layout').style.display = 'flex';
    if (!me.email_verified) document.getElementById('unverified-banner').style.display = 'flex';
  } catch (err) {
    console.error('Init error:', err);
    location.href = '/login.html';
  }
}

// ─── Socket ────────────────────────────────────────────────────────────────────
function setupSocket() {
  socket = io({ withCredentials: true });

  socket.on('connect', () => console.log('Socket connected'));
  socket.on('disconnect', () => console.log('Socket disconnected'));

  socket.on('message:new', (msg) => {
    if (msg.channel_id === currentChannelId) appendMessage(msg);
  });

  socket.on('message:delete', ({ id, channelId }) => {
    if (channelId === currentChannelId) {
      const el = document.getElementById(`msg-${id}`);
      if (el) {
        el.querySelector('.message-content').textContent = 'This message was deleted.';
        el.querySelector('.message-content').classList.add('deleted');
        const actions = el.querySelector('.message-actions');
        if (actions) actions.remove();
      }
    }
  });

  socket.on('message:edit', (msg) => {
    const el = document.getElementById(`msg-${msg.id}`);
    if (el) {
      el.querySelector('.message-content').textContent = msg.content;
      const editedEl = el.querySelector('.message-edited');
      if (editedEl) editedEl.textContent = '(edited)';
      else el.querySelector('.message-content').insertAdjacentHTML('afterend', '<span class="message-edited">(edited)</span>');
    }
  });

  socket.on('message:pinned', ({ messageId }) => toast('Message pinned 📌'));
  socket.on('message:unpinned', () => toast('Message unpinned'));

  socket.on('message:react', ({ messageId, userId, emoji }) => updateReaction(messageId, userId, emoji, true));
  socket.on('message:unreact', ({ messageId, userId, emoji }) => updateReaction(messageId, userId, emoji, false));

  socket.on('dm:message', (msg) => {
    if (msg.dm_channel_id === currentDmId) appendDmMessage(msg);
  });

  socket.on('group:message', (msg) => {
    if (msg.group_id === currentGroupId) appendDmMessage(msg);
  });

  socket.on('typing:start', ({ userId, username, channelId }) => {
    if (channelId !== currentChannelId) return;
    typingUsers[userId] = username;
    renderTyping();
  });

  socket.on('typing:stop', ({ userId, channelId }) => {
    if (channelId !== currentChannelId) return;
    delete typingUsers[userId];
    renderTyping();
  });

  socket.on('presence:update', ({ userId, status }) => {
    const dots = document.querySelectorAll(`[data-user-id="${userId}"] .status-dot`);
    dots.forEach(d => { d.className = `status-dot status-${status}`; });
  });

  socket.on('friend:request', ({ fromUsername }) => {
    toast(`Friend request from ${fromUsername}!`, 'info');
  });

  socket.on('friend:accepted', ({ byUsername }) => {
    toast(`${byUsername} accepted your friend request!`, 'success');
  });
}

// ─── Servers ───────────────────────────────────────────────────────────────────
async function loadServers() {
  const res = await fetch('/api/servers', { credentials: 'include' });
  servers = await res.json();
  renderServerDock();
}

function renderServerDock() {
  const icons = document.getElementById('server-icons');
  icons.innerHTML = '';
  for (const s of servers) {
    const item = document.createElement('div');
    item.className = 'dock-item';
    item.id = `dock-server-${s.id}`;
    item.setAttribute('data-server-id', s.id);
    item.title = s.name;
    if (s.icon) {
      item.innerHTML = `<img src="${s.icon}" alt="${s.name}"><div class="dock-tooltip">${escHtml(s.name)}</div>`;
    } else {
      item.innerHTML = `<span>${escHtml(s.name).charAt(0)}</span><div class="dock-tooltip">${escHtml(s.name)}</div>`;
    }
    item.onclick = () => selectServer(s.id);
    icons.appendChild(item);
  }
}

async function selectServer(id) {
  document.querySelectorAll('.dock-item').forEach(d => d.classList.remove('active'));
  document.getElementById(`dock-server-${id}`)?.classList.add('active');
  currentServerId = id;
  currentChannelId = null;
  currentDmId = null;
  const res = await fetch(`/api/servers/${id}`, { credentials: 'include' });
  if (!res.ok) { toast('Failed to load server', 'error'); return; }
  const server = await res.json();
  renderServerSidebar(server);
  renderMemberList(server.members);
  showChatArea();
  document.getElementById('member-list').style.display = memberListVisible ? 'block' : 'none';
  // Auto-select first text channel
  const firstChannel = server.channels.find(c => c.type === 'text');
  if (firstChannel) selectChannel(firstChannel.id, firstChannel.name, firstChannel.topic);
}

function renderServerSidebar(server) {
  const title = document.getElementById('sidebar-title');
  title.textContent = server.name;
  title.onclick = () => showServerSettings(server);
  const list = document.getElementById('channel-list');
  list.innerHTML = '';
  const isAdmin = server.myRole === 'owner' || server.myRole === 'admin';
  const catHeader = document.createElement('div');
  catHeader.className = 'channel-category';
  catHeader.innerHTML = `
    <span>Channels</span>
    ${isAdmin ? `<span class="channel-category-add" title="Add channel" onclick="openModal('modal-create-channel')">+</span>` : ''}`;
  list.appendChild(catHeader);
  for (const ch of server.channels) {
    const item = document.createElement('div');
    item.className = 'channel-item';
    item.id = `channel-item-${ch.id}`;
    item.innerHTML = `<span class="channel-icon">${ch.type === 'announcement' ? '📢' : '#'}</span><span>${escHtml(ch.name)}</span>`;
    item.onclick = () => selectChannel(ch.id, ch.name, ch.topic);
    list.appendChild(item);
  }
}

async function selectChannel(id, name, topic) {
  document.querySelectorAll('.channel-item').forEach(i => i.classList.remove('active'));
  document.getElementById(`channel-item-${id}`)?.classList.add('active');
  currentChannelId = id;
  currentDmId = null;
  document.getElementById('ch-name').textContent = name;
  document.getElementById('ch-icon').textContent = '#';
  const topicEl = document.getElementById('ch-topic');
  if (topic) { topicEl.textContent = topic; topicEl.style.display = ''; }
  else topicEl.style.display = 'none';
  document.getElementById('message-input').placeholder = `Message #${name}`;
  document.getElementById('channel-start-name').textContent = `# ${name}`;
  document.getElementById('channel-start-desc').textContent = `This is the beginning of #${name}`;
  document.getElementById('btn-pinned').style.display = '';
  document.getElementById('btn-members').style.display = '';
  socket.emit('channel:join', id);
  typingUsers = {};
  renderTyping();
  await loadMessages(id);
}

async function loadMessages(channelId) {
  const container = document.getElementById('messages-container');
  const welcome = container.querySelector('.messages-start');
  while (container.lastChild !== welcome) container.removeChild(container.lastChild);
  const res = await fetch(`/api/channels/${channelId}/messages`, { credentials: 'include' });
  if (!res.ok) { toast('Failed to load messages', 'error'); return; }
  const msgs = await res.json();
  for (const msg of msgs) appendMessage(msg, false);
  container.scrollTop = container.scrollHeight;
}

function appendMessage(msg, scroll = true) {
  const container = document.getElementById('messages-container');
  const id = `msg-${msg.id}`;
  if (document.getElementById(id)) return;

  const isMe = msg.user_id === me.id;
  const timeStr = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const nameColor = msg.name_color || '#dcddde';
  const avatarHtml = msg.avatar
    ? `<img src="${msg.avatar}" class="avatar" width="40" height="40" title="${escHtml(msg.username)}">`
    : `<div class="avatar-placeholder" style="width:40px;height:40px;font-size:16px;background:${strToColor(msg.username)}">${(msg.username || '?').charAt(0).toUpperCase()}</div>`;

  const badges = [
    msg.badge_admin ? '<span class="badge badge-admin">ADMIN</span>' : '',
    msg.badge_gold ? '<span class="badge badge-gold">GOLD</span>' : '',
    msg.badge_rail ? '<span class="badge badge-rail">RAIL</span>' : '',
    msg.badge_blue ? '<span class="badge badge-blue">✓</span>' : '',
  ].join('');

  const replyHtml = msg.reply_message
    ? `<div class="reply-preview" onclick="scrollToMsg(${msg.reply_to_id})">
        <span class="reply-author">@${escHtml(msg.reply_message.author)}</span>
        <span>${escHtml(msg.reply_message.content?.substring(0, 80) || '')}</span>
       </div>` : '';

  const actionsHtml = `
    <div class="message-actions">
      <div class="msg-action-btn" title="React" onclick="showEmojiForMsg(${msg.id}, event)">😊</div>
      <div class="msg-action-btn" title="Reply" onclick="setReply(${msg.id},'${escHtml(msg.username)}')">↩</div>
      ${isMe ? `<div class="msg-action-btn" title="Edit" onclick="editMsg(${msg.id})">✏</div>` : ''}
      ${(isMe || me.is_admin) ? `<div class="msg-action-btn" title="Delete" onclick="deleteMsg(${msg.id})" style="color:var(--danger)">🗑</div>` : ''}
      ${me.is_admin ? `<div class="msg-action-btn" title="Pin/unpin" onclick="togglePin(${msg.id},${msg.is_pinned})">📌</div>` : ''}
    </div>`;

  const div = document.createElement('div');
  div.className = 'message-group';
  div.id = id;
  div.setAttribute('data-user-id', msg.user_id);
  div.innerHTML = `
    ${actionsHtml}
    <div class="message-avatar" onclick="showProfile(${msg.user_id}, event)" style="cursor:pointer">${avatarHtml}</div>
    ${replyHtml}
    <div class="message-header">
      <span class="message-author" style="color:${nameColor}" onclick="showProfile(${msg.user_id}, event)">${escHtml(msg.display_name || msg.username)}${badges}</span>
      <span class="message-timestamp">${timeStr}</span>
      ${msg.is_pinned ? '<span title="Pinned" style="font-size:12px">📌</span>' : ''}
    </div>
    <div class="message-content">${msg.is_deleted ? '<em style="color:var(--text-muted)">Message deleted</em>' : escHtml(msg.content)}</div>
    ${msg.edited_at ? '<span class="message-edited">(edited)</span>' : ''}
    <div class="message-reactions" id="reactions-${msg.id}"></div>`;

  container.appendChild(div);
  if (msg.reactions) renderReactions(msg.id, msg.reactions);
  if (scroll) { container.scrollTop = container.scrollHeight; }
}

// ─── DMs ───────────────────────────────────────────────────────────────────────
function showHome() {
  document.querySelectorAll('.dock-item').forEach(d => d.classList.remove('active'));
  document.getElementById('dock-home').classList.add('active');
  currentServerId = null;
  currentChannelId = null;
  document.getElementById('sidebar-title').textContent = 'Direct Messages';
  loadDmList();
  hideChatArea();
}

async function loadDmList() {
  const res = await fetch('/api/dms', { credentials: 'include' });
  const dms = await res.json();
  const list = document.getElementById('channel-list');
  list.innerHTML = `<div class="dm-section-header">Direct Messages</div>`;
  for (const dm of dms) {
    const item = document.createElement('div');
    item.className = 'dm-item';
    item.id = `dm-item-${dm.dm_channel_id}`;
    const avatarHtml = dm.avatar
      ? `<img src="${dm.avatar}" class="avatar" width="32" height="32">`
      : `<div class="avatar-placeholder" style="width:32px;height:32px;font-size:14px;background:${strToColor(dm.username)}">${(dm.username||'?').charAt(0).toUpperCase()}</div>`;
    item.innerHTML = `${avatarHtml}<div><div class="dm-name">${escHtml(dm.display_name || dm.username)}</div><div class="dm-preview">${escHtml(dm.last_message || 'No messages yet')}</div></div>`;
    item.onclick = () => openDm(dm.dm_channel_id, dm);
    list.appendChild(item);
  }
  // Add friends section
  list.insertAdjacentHTML('beforeend', `
    <div class="dm-section-header" style="margin-top:8px;display:flex;justify-content:space-between;align-items:center">
      Friends <span style="cursor:pointer;font-size:18px;color:var(--success)" onclick="loadFriendsList()" title="Refresh">↻</span>
    </div>
    <div id="friends-list"></div>
    <div style="padding:8px 16px">
      <button class="btn-ghost btn-full" onclick="openModal('modal-search')" style="font-size:13px">Find Users</button>
    </div>
  `);
  loadFriendsList();
}

async function loadFriendsList() {
  const res = await fetch('/api/friends', { credentials: 'include' });
  const friends = await res.json();
  const el = document.getElementById('friends-list');
  if (!el) return;
  el.innerHTML = '';
  for (const f of friends) {
    const item = document.createElement('div');
    item.className = 'dm-item';
    const avatarHtml = f.avatar
      ? `<img src="${f.avatar}" class="avatar" width="32" height="32">`
      : `<div class="avatar-placeholder" style="width:32px;height:32px;font-size:14px;background:${strToColor(f.username)}">${(f.username||'?').charAt(0).toUpperCase()}</div>`;
    item.innerHTML = `${avatarHtml}<div><div class="dm-name">${escHtml(f.display_name || f.username)}</div><div class="dm-preview status-${f.status}">${f.status}</div></div>`;
    item.onclick = async () => {
      const r = await fetch('/api/dms/open', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({userId:f.id}), credentials:'include' });
      const d = await r.json();
      openDm(d.dmChannelId, { ...f, dm_channel_id: d.dmChannelId });
    };
    el.appendChild(item);
  }
  if (!friends.length) {
    el.innerHTML = '<div style="padding:8px 16px;font-size:13px;color:var(--text-muted)">No friends yet. Search for users to add!</div>';
  }
}

async function openDm(dmChannelId, user) {
  currentDmId = dmChannelId;
  currentChannelId = null;
  currentGroupId = null;
  showChatArea();
  document.getElementById('ch-icon').textContent = '@';
  document.getElementById('ch-name').textContent = user.display_name || user.username;
  document.getElementById('ch-topic').style.display = 'none';
  document.getElementById('message-input').placeholder = `Message ${user.username}`;
  document.getElementById('channel-start-name').textContent = `@ ${user.display_name || user.username}`;
  document.getElementById('channel-start-desc').textContent = 'Beginning of your DM conversation.';
  document.getElementById('btn-pinned').style.display = 'none';
  document.getElementById('btn-members').style.display = 'none';
  document.getElementById('member-list').style.display = 'none';
  socket.emit('dm:join', dmChannelId);
  const container = document.getElementById('messages-container');
  const welcome = container.querySelector('.messages-start');
  while (container.lastChild !== welcome) container.removeChild(container.lastChild);
  const res = await fetch(`/api/dms/${dmChannelId}/messages`, { credentials: 'include' });
  const msgs = await res.json();
  for (const msg of msgs) appendDmMessage(msg, false);
  container.scrollTop = container.scrollHeight;
}

function appendDmMessage(msg, scroll = true) {
  const container = document.getElementById('messages-container');
  const id = `msg-${msg.id}`;
  if (document.getElementById(id)) return;
  const timeStr = new Date(msg.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  const avatarHtml = msg.avatar
    ? `<img src="${msg.avatar}" class="avatar" width="40" height="40">`
    : `<div class="avatar-placeholder" style="width:40px;height:40px;font-size:16px;background:${strToColor(msg.username)}">${(msg.username||'?').charAt(0).toUpperCase()}</div>`;
  const div = document.createElement('div');
  div.className = 'message-group';
  div.id = id;
  div.setAttribute('data-user-id', msg.user_id);
  div.innerHTML = `
    <div class="message-avatar">${avatarHtml}</div>
    <div class="message-header">
      <span class="message-author">${escHtml(msg.display_name || msg.username)}</span>
      <span class="message-timestamp">${timeStr}</span>
    </div>
    <div class="message-content">${escHtml(msg.content)}</div>
    ${msg.edited_at ? '<span class="message-edited">(edited)</span>' : ''}`;
  container.appendChild(div);
  if (scroll) container.scrollTop = container.scrollHeight;
}

// ─── Sending messages ──────────────────────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('message-input');
  const content = input.value.trim();
  if (!content) return;
  input.value = '';
  autoResizeTextarea(input);
  stopTyping();

  let url, body;
  if (currentChannelId) {
    url = `/api/channels/${currentChannelId}/messages`;
    body = { content, replyToId };
  } else if (currentDmId) {
    url = `/api/dms/${currentDmId}/messages`;
    body = { content };
  } else if (currentGroupId) {
    url = `/api/dms/groups/${currentGroupId}/messages`;
    body = { content };
  } else return;

  cancelReply();
  const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), credentials:'include' });
  if (!res.ok) {
    const d = await res.json();
    toast(d.error || 'Failed to send message', 'error');
  }
}

function handleInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
  autoResizeTextarea(e.target);
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

let typingTimeout;
function handleTyping() {
  if (!socket || !currentChannelId) return;
  if (!isTyping) {
    isTyping = true;
    socket.emit('typing:start', { channelId: currentChannelId });
  }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(stopTyping, 3000);
}

function stopTyping() {
  if (isTyping && socket && currentChannelId) {
    isTyping = false;
    socket.emit('typing:stop', { channelId: currentChannelId });
  }
  clearTimeout(typingTimeout);
}

function renderTyping() {
  const el = document.getElementById('typing-indicator');
  const names = Object.values(typingUsers).filter(n => n !== me.username);
  if (!names.length) { el.innerHTML = ''; return; }
  const dotsHtml = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  if (names.length === 1) el.innerHTML = `${dotsHtml} <strong>${escHtml(names[0])}</strong> is typing...`;
  else if (names.length === 2) el.innerHTML = `${dotsHtml} <strong>${escHtml(names[0])}</strong> and <strong>${escHtml(names[1])}</strong> are typing...`;
  else el.innerHTML = `${dotsHtml} Several people are typing...`;
}

// ─── Message actions ───────────────────────────────────────────────────────────
function setReply(msgId, username) {
  replyToId = msgId;
  replyToName = username;
  document.getElementById('reply-to-name').textContent = username;
  document.getElementById('reply-bar').style.display = 'flex';
  document.getElementById('message-input').focus();
}
function cancelReply() {
  replyToId = null; replyToName = null;
  document.getElementById('reply-bar').style.display = 'none';
}

async function deleteMsg(msgId) {
  if (!confirm('Delete this message?')) return;
  const res = await fetch(`/api/channels/${currentChannelId}/messages/${msgId}`, { method:'DELETE', credentials:'include' });
  if (!res.ok) toast('Failed to delete message', 'error');
}

async function editMsg(msgId) {
  const el = document.getElementById(`msg-${msgId}`).querySelector('.message-content');
  const current = el.textContent;
  const newContent = prompt('Edit message:', current);
  if (!newContent || newContent === current) return;
  const res = await fetch(`/api/channels/${currentChannelId}/messages/${msgId}`, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ content: newContent }), credentials:'include',
  });
  if (!res.ok) toast('Failed to edit message', 'error');
}

async function togglePin(msgId, isPinned) {
  const url = `/api/channels/${currentChannelId}/messages/${msgId}/pin`;
  await fetch(url, { method: isPinned ? 'DELETE' : 'POST', credentials:'include' });
}

async function showPinned() {
  const res = await fetch(`/api/channels/${currentChannelId}/pinned`, { credentials:'include' });
  const msgs = await res.json();
  if (!msgs.length) { toast('No pinned messages in this channel'); return; }
  const html = msgs.map(m => `<div style="padding:8px;border-bottom:1px solid var(--border)"><strong>${escHtml(m.username)}</strong>: ${escHtml(m.content)}</div>`).join('');
  showSimpleModal('Pinned Messages', html);
}

function scrollToMsg(id) {
  const el = document.getElementById(`msg-${id}`);
  if (el) { el.scrollIntoView({ behavior:'smooth', block:'center' }); el.style.background='rgba(88,101,242,0.2)'; setTimeout(()=>el.style.background='',1500); }
}

// ─── Reactions ─────────────────────────────────────────────────────────────────
let emojiTargetMsgId = null;

function showEmojiForMsg(msgId, e) {
  e.stopPropagation();
  emojiTargetMsgId = msgId;
  const picker = document.getElementById('emoji-picker');
  if (picker.innerHTML === '') {
    picker.innerHTML = EMOJIS.map(emoji =>
      `<span style="cursor:pointer;padding:4px;border-radius:4px;text-align:center" onmouseenter="this.style.background='var(--bg-surface)'" onmouseleave="this.style.background=''" onclick="reactToMsg('${emoji}')">${emoji}</span>`
    ).join('');
  }
  picker.classList.remove('hidden');
  const rect = e.target.getBoundingClientRect();
  picker.style.left = Math.min(rect.left, window.innerWidth - 260) + 'px';
  picker.style.top = (rect.top - picker.offsetHeight - 8) + 'px';
}

function toggleEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  emojiTargetMsgId = null;
  if (picker.innerHTML === '') {
    picker.innerHTML = EMOJIS.map(emoji =>
      `<span style="cursor:pointer;padding:4px;border-radius:4px;text-align:center" onclick="insertEmoji('${emoji}')">${emoji}</span>`
    ).join('');
  }
  picker.classList.toggle('hidden');
  const btn = document.querySelector('.input-emoji-btn');
  const rect = btn.getBoundingClientRect();
  picker.style.left = rect.left + 'px';
  picker.style.top = (rect.top - 200) + 'px';
}

function insertEmoji(emoji) {
  const input = document.getElementById('message-input');
  input.value += emoji;
  input.focus();
  document.getElementById('emoji-picker').classList.add('hidden');
}

async function reactToMsg(emoji) {
  document.getElementById('emoji-picker').classList.add('hidden');
  if (!emojiTargetMsgId) return;
  await fetch(`/api/channels/${currentChannelId}/messages/${emojiTargetMsgId}/react`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ emoji }), credentials:'include',
  });
}

function updateReaction(messageId, userId, emoji, add) {
  const container = document.getElementById(`reactions-${messageId}`);
  if (!container) return;
  let badge = container.querySelector(`[data-emoji="${emoji}"]`);
  if (add) {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'reaction-badge';
      badge.setAttribute('data-emoji', emoji);
      badge.setAttribute('data-count', '0');
      badge.onclick = () => reactToMsg(emoji);
      container.appendChild(badge);
    }
    const count = parseInt(badge.getAttribute('data-count') || '0') + 1;
    badge.setAttribute('data-count', count);
    badge.innerHTML = `${emoji} ${count}`;
    if (userId === me.id) badge.classList.add('mine');
  } else if (badge) {
    const count = parseInt(badge.getAttribute('data-count') || '1') - 1;
    if (count <= 0) badge.remove();
    else { badge.setAttribute('data-count', count); badge.innerHTML = `${emoji} ${count}`; }
    if (userId === me.id) badge.classList.remove('mine');
  }
}

function renderReactions(msgId, reactions) {
  if (!reactions) return;
  const container = document.getElementById(`reactions-${msgId}`);
  if (!container) return;
  for (const r of reactions) {
    const badge = document.createElement('div');
    badge.className = 'reaction-badge' + (r.me ? ' mine' : '');
    badge.setAttribute('data-emoji', r.emoji);
    badge.setAttribute('data-count', r.count);
    badge.innerHTML = `${r.emoji} ${r.count}`;
    badge.onclick = () => reactToMsg(r.emoji);
    container.appendChild(badge);
  }
}

// ─── Profile Panel ─────────────────────────────────────────────────────────────
async function showProfile(userId, e) {
  e?.stopPropagation();
  const panel = document.getElementById('profile-panel');
  const res = await fetch(`/api/users/${userId}`, { credentials:'include' });
  if (!res.ok) return;
  const user = await res.json();
  const isMe = user.id === me.id;
  const isFriend = !isMe;
  const bannerStyle = user.banner ? `background-image:url(${user.banner});background-size:cover;background-position:center` : `background:linear-gradient(135deg,${strToColor(user.username)},${strToColor(user.username+'2')})`;
  const avatarHtml = user.avatar
    ? `<img src="${user.avatar}" class="avatar" width="72" height="72" style="border:4px solid var(--bg-primary)">`
    : `<div class="avatar-placeholder" style="width:72px;height:72px;font-size:28px;border:4px solid var(--bg-primary);background:${strToColor(user.username)}">${user.username.charAt(0).toUpperCase()}</div>`;
  const badges = [
    user.badge_admin ? '<span class="badge badge-admin">ADMIN</span>' : '',
    user.badge_gold ? '<span class="badge badge-gold">GOLD</span>' : '',
    user.badge_rail ? '<span class="badge badge-rail">RAIL</span>' : '',
    user.badge_blue ? '<span class="badge badge-blue">✓</span>' : '',
  ].join('');
  const level = Math.floor(user.xp / 100) + 1;
  const xpProgress = user.xp % 100;

  panel.innerHTML = `
    <div class="profile-banner" style="${bannerStyle}"></div>
    <div class="profile-avatar-wrap">${avatarHtml}</div>
    <div class="profile-body">
      <div class="profile-name" style="color:${user.name_color || '#dcddde'}">${escHtml(user.display_name || user.username)}</div>
      <div class="profile-username">@${escHtml(user.username)}${badges}</div>
      ${user.bio ? `<div class="profile-bio">${escHtml(user.bio)}</div>` : ''}
      <div class="profile-stats">
        <div class="profile-stat"><div class="profile-stat-value">${user.points || 0}</div><div class="profile-stat-label">Points</div></div>
        <div class="profile-stat"><div class="profile-stat-value">${level}</div><div class="profile-stat-label">Level</div></div>
        <div class="profile-stat"><div class="profile-stat-value">${user.friend_count || 0}</div><div class="profile-stat-label">Friends</div></div>
      </div>
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:4px"><span>XP: ${user.xp % 100}/100</span><span>Lv ${level}</span></div>
        <div style="height:6px;background:var(--bg-surface);border-radius:3px"><div style="height:100%;width:${xpProgress}%;background:var(--accent);border-radius:3px;transition:width 0.3s"></div></div>
      </div>
      <div class="profile-actions">
        ${isMe ? `<button class="btn-primary" onclick="openSettings()">Edit Profile</button>` : `
          <button class="btn-primary" onclick="startDmWithUser(${user.id});closeProfilePanel()">Message</button>
          <button class="btn-ghost" onclick="sendFriendRequest(${user.id})">Add Friend</button>
          ${me.is_admin ? `<button class="btn-danger" onclick="showAdminActions(${user.id},'${escHtml(user.username)}')">Admin</button>` : ''}
        `}
      </div>
    </div>`;

  panel.classList.remove('hidden');
  // Position near click
  const x = e?.clientX || window.innerWidth / 2;
  const y = e?.clientY || window.innerHeight / 2;
  panel.style.left = Math.min(x + 10, window.innerWidth - 340) + 'px';
  panel.style.top = Math.min(y - 20, window.innerHeight - 500) + 'px';
  setTimeout(() => document.addEventListener('click', closeProfilePanel, { once: true }), 100);
}

function closeProfilePanel() {
  document.getElementById('profile-panel').classList.add('hidden');
}

async function startDmWithUser(userId) {
  const res = await fetch('/api/dms/open', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({userId}), credentials:'include' });
  const d = await res.json();
  showHome();
  setTimeout(() => openDm(d.dmChannelId, d.user), 300);
}

async function sendFriendRequest(userId) {
  const res = await fetch('/api/friends/request', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({userId}), credentials:'include' });
  const d = await res.json();
  toast(d.message || d.error || 'Done', res.ok ? 'success' : 'error');
}

// ─── User search ───────────────────────────────────────────────────────────────
let searchTimeout;
async function searchUsers() {
  const q = document.getElementById('search-input').value;
  clearTimeout(searchTimeout);
  if (q.length < 2) { document.getElementById('search-results').innerHTML = ''; return; }
  searchTimeout = setTimeout(async () => {
    const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, { credentials:'include' });
    const users = await res.json();
    const results = document.getElementById('search-results');
    if (!users.length) { results.innerHTML = '<div style="padding:16px;color:var(--text-muted);text-align:center">No users found</div>'; return; }
    results.innerHTML = users.map(u => `
      <div class="member-item" style="padding:10px 8px;cursor:pointer" onclick="showProfile(${u.id});closeModal('modal-search')">
        ${u.avatar ? `<img src="${u.avatar}" class="avatar" width="36" height="36">` : `<div class="avatar-placeholder" style="width:36px;height:36px;font-size:14px;background:${strToColor(u.username)}">${u.username.charAt(0).toUpperCase()}</div>`}
        <div>
          <div style="font-weight:600">${escHtml(u.display_name || u.username)}</div>
          <div style="font-size:12px;color:var(--text-muted)">@${escHtml(u.username)}</div>
        </div>
      </div>
    `).join('');
  }, 300);
}

// ─── Member list ───────────────────────────────────────────────────────────────
function renderMemberList(members) {
  const list = document.getElementById('member-list');
  const online = members.filter(m => m.status !== 'invisible' && m.status !== 'offline');
  const offline = members.filter(m => m.status === 'invisible' || m.status === 'offline');
  list.innerHTML = `
    <div class="member-group-header">Online — ${online.length}</div>
    ${online.map(m => memberItemHtml(m)).join('')}
    ${offline.length ? `<div class="member-group-header" style="margin-top:16px">Offline — ${offline.length}</div>${offline.map(m => memberItemHtml(m)).join('')}` : ''}
  `;
}

function memberItemHtml(m) {
  const avatarHtml = m.avatar
    ? `<img src="${m.avatar}" class="avatar" width="32" height="32">`
    : `<div class="avatar-placeholder" style="width:32px;height:32px;font-size:13px;background:${strToColor(m.username)}">${m.username.charAt(0).toUpperCase()}</div>`;
  const crown = m.role === 'owner' ? '<span class="member-role-crown">👑</span>' : m.role === 'admin' ? '<span class="member-role-crown" style="color:var(--danger)">🛡</span>' : '';
  return `<div class="member-item" data-user-id="${m.id}" onclick="showProfile(${m.id}, event)">
    <div style="position:relative">${avatarHtml}<div class="status-dot status-${m.status}" style="position:absolute;bottom:-1px;right:-1px"></div></div>
    <div><div class="member-name">${escHtml(m.display_name || m.nickname || m.username)}${crown}</div></div>
  </div>`;
}

function toggleMemberList() {
  const list = document.getElementById('member-list');
  memberListVisible = !memberListVisible;
  list.style.display = memberListVisible ? 'block' : 'none';
}

// ─── Create / Join server ──────────────────────────────────────────────────────
async function createServer() {
  const name = document.getElementById('new-server-name').value.trim();
  const desc = document.getElementById('new-server-desc').value.trim();
  if (!name) { toast('Server name required', 'error'); return; }
  const res = await fetch('/api/servers', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name,description:desc}), credentials:'include' });
  const s = await res.json();
  if (!res.ok) { toast(s.error || 'Failed to create server', 'error'); return; }
  closeModal('modal-create-server');
  document.getElementById('new-server-name').value = '';
  document.getElementById('new-server-desc').value = '';
  servers.push(s);
  renderServerDock();
  selectServer(s.id);
  toast(`Server "${s.name}" created!`, 'success');
}

async function joinServer() {
  const code = document.getElementById('join-invite-code').value.trim();
  if (!code) { toast('Invite code required', 'error'); return; }
  const res = await fetch('/api/servers/join', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({inviteCode:code}), credentials:'include' });
  const s = await res.json();
  if (!res.ok) { toast(s.error || 'Failed to join server', 'error'); return; }
  closeModal('modal-join-server');
  servers.push(s);
  renderServerDock();
  selectServer(s.id);
  toast(`Joined "${s.name}"!`, 'success');
}

async function createChannel() {
  const name = document.getElementById('new-channel-name').value.trim();
  const type = document.getElementById('new-channel-type').value;
  if (!name || !currentServerId) return;
  const res = await fetch(`/api/servers/${currentServerId}/channels`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name,type}), credentials:'include',
  });
  const ch = await res.json();
  if (!res.ok) { toast(ch.error || 'Failed to create channel', 'error'); return; }
  closeModal('modal-create-channel');
  await selectServer(currentServerId);
  toast(`Channel #${ch.name} created!`, 'success');
}

// ─── Settings ──────────────────────────────────────────────────────────────────
function openSettings() {
  document.getElementById('settings-overlay').classList.remove('hidden');
  showSettingsPage('profile');
}
function closeSettings() {
  document.getElementById('settings-overlay').classList.add('hidden');
}

async function showSettingsPage(page) {
  document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
  const content = document.getElementById('settings-content');

  if (page === 'profile') {
    const r = await fetch('/auth/me', { credentials:'include' });
    const user = await r.json();
    content.innerHTML = `
      <h2>My Account</h2>
      <div class="settings-section">
        <div style="display:flex;gap:24px;align-items:flex-start;margin-bottom:24px">
          <div style="text-align:center">
            ${user.avatar ? `<img src="${user.avatar}" class="avatar" width="80" height="80">` : `<div class="avatar-placeholder" style="width:80px;height:80px;font-size:32px;margin:0 auto;background:${strToColor(user.username)}">${user.username.charAt(0).toUpperCase()}</div>`}
            <label class="btn-ghost" style="display:inline-block;margin-top:8px;font-size:12px;cursor:pointer">
              Change Avatar <input type="file" accept="image/*" style="display:none" onchange="uploadAvatar(this)">
            </label>
          </div>
          <div style="flex:1">
            <div class="field-group"><label>DISPLAY NAME</label><input type="text" id="s-display-name" value="${escHtml(user.display_name||'')}"></div>
            <div class="field-group"><label>USERNAME</label><input type="text" id="s-username" value="${escHtml(user.username)}"></div>
          </div>
        </div>
        <div class="field-group"><label>BIO</label><textarea id="s-bio" rows="3" style="width:100%;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text-normal);font-size:15px;resize:none;outline:none">${escHtml(user.bio||'')}</textarea></div>
        <div class="field-group"><label>STATUS</label>
          <select id="s-status" style="width:100%;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text-normal)">
            <option value="online" ${user.status==='online'?'selected':''}>Online</option>
            <option value="idle" ${user.status==='idle'?'selected':''}>Idle</option>
            <option value="dnd" ${user.status==='dnd'?'selected':''}>Do Not Disturb</option>
            <option value="invisible" ${user.status==='invisible'?'selected':''}>Invisible</option>
          </select>
        </div>
        <button class="btn-primary" onclick="saveProfile()">Save Changes</button>
      </div>
      <div class="settings-section">
        <h3>Change Password</h3>
        <div class="field-group"><label>CURRENT PASSWORD</label><input type="password" id="s-cur-pass"></div>
        <div class="field-group"><label>NEW PASSWORD</label><input type="password" id="s-new-pass"></div>
        <button class="btn-primary" onclick="changePassword()">Update Password</button>
      </div>
      <div class="settings-section">
        <h3>Email</h3>
        <p style="font-size:14px;color:var(--text-muted);margin-bottom:12px">${user.email} — ${user.email_verified ? '✅ Verified' : '⚠️ Not verified'}</p>
        ${!user.email_verified ? `<button class="btn-ghost" onclick="resendVerification()" style="margin-bottom:12px">Resend Verification Email</button>` : ''}
        <div class="field-group"><label>NEW EMAIL</label><input type="email" id="s-new-email" placeholder="New email address"></div>
        <div class="field-group"><label>CURRENT PASSWORD</label><input type="password" id="s-email-pass" placeholder="Required to change email"></div>
        <button class="btn-ghost" onclick="changeEmail()">Request Email Change</button>
      </div>
    `;
  } else if (page === 'store') {
    const r = await fetch('/api/store', { credentials:'include' });
    const { points, items } = await r.json();
    content.innerHTML = `
      <h2>Store</h2>
      <div style="margin-bottom:24px;padding:16px;background:var(--bg-secondary);border-radius:12px;display:flex;align-items:center;gap:12px">
        <span style="font-size:32px">💎</span>
        <div><div style="font-size:24px;font-weight:800">${points}</div><div style="font-size:13px;color:var(--text-muted)">Points</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px">
        ${items.map(i => `
          <div style="background:var(--bg-secondary);border-radius:12px;padding:16px;border:1px solid ${i.owned?'var(--accent)':'var(--border)'}">
            <div style="font-size:15px;font-weight:700;margin-bottom:4px">${escHtml(i.name)}</div>
            <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">${escHtml(i.description)}</div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-weight:700;color:var(--accent)">💎 ${i.cost}</span>
              ${i.owned ? '<span style="color:var(--success);font-size:13px">✓ Owned</span>' : `<button class="btn-primary" style="font-size:13px;padding:6px 14px" onclick="buyItem('${i.id}','${escHtml(i.name)}',${i.cost})">Buy</button>`}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } else if (page === 'sessions') {
    const r = await fetch('/api/users/me/sessions', { credentials:'include' });
    const sessions = await r.json();
    content.innerHTML = `
      <h2>Active Sessions</h2>
      <p style="color:var(--text-muted);margin-bottom:24px">Manage all devices where you're signed in.</p>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:24px">
        ${sessions.map(s => `
          <div style="background:var(--bg-secondary);border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border:1px solid ${s.current?'var(--accent)':'var(--border)'}">
            <div>
              <div style="font-weight:600">${s.current ? '🖥 This device' : '📱 Other device'}</div>
              <div style="font-size:12px;color:var(--text-muted)">Expires: ${new Date(s.expires).toLocaleDateString()}</div>
            </div>
            ${s.current ? '<span style="color:var(--success);font-size:13px">Current</span>' : ''}
          </div>
        `).join('')}
      </div>
      <button class="btn-danger" onclick="logoutAll()">Log Out All Devices</button>
    `;
  } else if (page === 'appearance') {
    content.innerHTML = `
      <h2>Appearance</h2>
      <div class="settings-section">
        <h3>Theme</h3>
        <p style="color:var(--text-muted);font-size:14px">Purchase themes in the Store to customize your appearance.</p>
      </div>
    `;
  }
}

async function saveProfile() {
  const body = {
    displayName: document.getElementById('s-display-name').value,
    bio: document.getElementById('s-bio').value,
    status: document.getElementById('s-status').value,
    username: document.getElementById('s-username').value,
  };
  const res = await fetch('/api/users/me', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), credentials:'include' });
  const d = await res.json();
  if (!res.ok) { toast(d.errors?.[0]?.msg || d.error || 'Failed to save', 'error'); return; }
  toast('Profile saved!', 'success');
  me = { ...me, ...d };
  renderProfileBar();
  socket.emit('status:set', body.status);
}

async function changePassword() {
  const cur = document.getElementById('s-cur-pass').value;
  const nw = document.getElementById('s-new-pass').value;
  if (!cur || !nw) { toast('Fill in both fields', 'error'); return; }
  const res = await fetch('/api/users/me/change-password', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({currentPassword:cur,newPassword:nw}), credentials:'include' });
  const d = await res.json();
  toast(res.ok ? 'Password changed!' : (d.error||'Failed'), res.ok ? 'success' : 'error');
}

async function changeEmail() {
  const newEmail = document.getElementById('s-new-email').value;
  const pass = document.getElementById('s-email-pass').value;
  const res = await fetch('/auth/change-email', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({newEmail,password:pass}), credentials:'include' });
  const d = await res.json();
  toast(res.ok ? d.message : (d.error||'Failed'), res.ok ? 'success' : 'error');
}

async function uploadAvatar(input) {
  const file = input.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('avatar', file);
  const res = await fetch('/api/users/me/avatar', { method:'POST', body:formData, credentials:'include' });
  const d = await res.json();
  if (res.ok) { me.avatar = d.avatar; renderProfileBar(); showSettingsPage('profile'); toast('Avatar updated!', 'success'); }
  else toast(d.error||'Failed to upload avatar', 'error');
}

async function buyItem(id, name, cost) {
  if (!confirm(`Buy "${name}" for ${cost} points?`)) return;
  const res = await fetch('/api/store/buy', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({itemId:id}), credentials:'include' });
  const d = await res.json();
  toast(res.ok ? d.message : (d.error||'Purchase failed'), res.ok ? 'success' : 'error');
  if (res.ok) showSettingsPage('store');
}

async function logoutAll() {
  if (!confirm('Log out of all devices?')) return;
  const res = await fetch('/auth/logout-all', { method:'POST', credentials:'include' });
  if (res.ok) location.href = '/login.html';
}

// ─── Admin actions ─────────────────────────────────────────────────────────────
function showAdminActions(userId, username) {
  const reason = prompt(`Admin action for @${username}. Enter action:\n- ban:reason\n- kick:serverId\n- timeout:serverId:minutes\n- grant_badge:blue|gold|rail|admin\n- remove_badge:blue|gold|rail|admin\n- points:+/-N\n- reset_xp`);
  if (!reason) return;
  const [action, ...args] = reason.split(':');
  const headers = { 'Content-Type': 'application/json' };
  const cred = { credentials:'include' };

  if (action === 'ban') {
    fetch(`/api/users/${userId}/ban`, { method:'POST', headers, body:JSON.stringify({reason:args.join(':')||'No reason'}), ...cred }).then(r=>r.json()).then(d=>toast(d.message||d.error));
  } else if (action === 'kick') {
    fetch(`/api/users/${userId}/kick`, { method:'POST', headers, body:JSON.stringify({serverId:parseInt(args[0]),reason:''}), ...cred }).then(r=>r.json()).then(d=>toast(d.message||d.error));
  } else if (action === 'timeout') {
    fetch(`/api/users/${userId}/timeout`, { method:'POST', headers, body:JSON.stringify({serverId:parseInt(args[0]),minutes:parseInt(args[1])||10,reason:''}), ...cred }).then(r=>r.json()).then(d=>toast(d.message||d.error));
  } else if (action === 'grant_badge') {
    fetch(`/api/users/${userId}/badge`, { method:'POST', headers, body:JSON.stringify({badge:`badge_${args[0]}`,grant:true}), ...cred }).then(r=>r.json()).then(d=>toast(d.message||d.error));
  } else if (action === 'remove_badge') {
    fetch(`/api/users/${userId}/badge`, { method:'POST', headers, body:JSON.stringify({badge:`badge_${args[0]}`,grant:false}), ...cred }).then(r=>r.json()).then(d=>toast(d.message||d.error));
  } else if (action === 'points') {
    fetch(`/api/users/${userId}/points`, { method:'POST', headers, body:JSON.stringify({delta:parseInt(args[0])}), ...cred }).then(r=>r.json()).then(d=>toast(d.message||d.error));
  } else if (action === 'reset_xp') {
    fetch(`/api/users/${userId}/reset-xp`, { method:'POST', headers, ...cred }).then(r=>r.json()).then(d=>toast(d.message||d.error));
  }
}

// ─── Server settings ───────────────────────────────────────────────────────────
function showServerSettings(server) {
  showSimpleModal(`${server.name} Settings`, `
    <div class="field-group"><label>INVITE LINK</label><input type="text" value="${location.origin}/join/${server.invite_code}" readonly onclick="this.select()" style="cursor:copy"></div>
    ${server.myRole === 'owner' ? `
      <div style="margin-top:16px">
        <button class="btn-danger" onclick="deleteServer(${server.id})">Delete Server</button>
      </div>` : ''}
    ${server.myRole !== 'owner' ? `<button class="btn-ghost" onclick="leaveServer(${server.id})">Leave Server</button>` : ''}
  `);
}

async function deleteServer(id) {
  if (!prompt('Type DELETE to confirm:') === 'DELETE') return;
  const res = await fetch(`/api/servers/${id}`, { method:'DELETE', credentials:'include' });
  if (res.ok) { toast('Server deleted'); servers = servers.filter(s => s.id !== id); renderServerDock(); showHome(); }
}

async function leaveServer(id) {
  const res = await fetch(`/api/servers/${id}/leave`, { method:'DELETE', credentials:'include' });
  const d = await res.json();
  if (res.ok) { servers = servers.filter(s => s.id !== id); renderServerDock(); showHome(); }
  else toast(d.error || 'Failed to leave', 'error');
}

// ─── Email verification ────────────────────────────────────────────────────────
async function resendVerification() {
  const res = await fetch('/auth/resend-verification', { method:'POST', credentials:'include' });
  const d = await res.json();
  toast(res.ok ? d.message : (d.error||'Failed'), res.ok ? 'success' : 'error');
}

// ─── Logout ────────────────────────────────────────────────────────────────────
async function doLogout() {
  await fetch('/auth/logout', { method:'POST', credentials:'include' });
  location.href = '/login.html';
}

// ─── Profile bar ───────────────────────────────────────────────────────────────
function renderProfileBar() {
  document.getElementById('pb-name').textContent = me.display_name || me.username;
  document.getElementById('pb-tag').textContent = `@${me.username}`;
  const canvas = document.getElementById('pb-avatar');
  const ctx = canvas.getContext('2d');
  if (me.avatar) {
    const img = new Image();
    img.onload = () => { ctx.clearRect(0,0,32,32); ctx.save(); ctx.beginPath(); ctx.arc(16,16,16,0,Math.PI*2); ctx.clip(); ctx.drawImage(img,0,0,32,32); ctx.restore(); };
    img.src = me.avatar;
  } else {
    ctx.fillStyle = strToColor(me.username);
    ctx.beginPath(); ctx.arc(16,16,16,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(me.username.charAt(0).toUpperCase(), 16, 16);
  }
  const dot = document.getElementById('pb-status-dot');
  dot.className = `status-dot status-${me.status || 'online'}`;
}

// ─── Layout helpers ────────────────────────────────────────────────────────────
function showChatArea() {
  document.getElementById('welcome-screen').style.display = 'none';
  document.getElementById('chat-area').style.display = 'flex';
}
function hideChatArea() {
  document.getElementById('chat-area').style.display = 'none';
  document.getElementById('welcome-screen').style.display = 'flex';
}

// ─── Modals ────────────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function closeModalOverlay(e, id) { if (e.target.id === id) closeModal(id); }

function showSimpleModal(title, body) {
  const existing = document.getElementById('simple-modal-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'simple-modal-overlay';
  overlay.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <h2>${escHtml(title)}</h2>
      <div>${body}</div>
      <div class="modal-footer"><button class="btn-ghost" onclick="document.getElementById('simple-modal-overlay').remove()">Close</button></div>
    </div>`;
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

// ─── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const tc = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : ''}`;
  el.textContent = msg;
  tc.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, 3500);
}

// ─── Utilities ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function strToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const h = hash % 360;
  return `hsl(${h},55%,45%)`;
}

// Close emoji picker on click outside
document.addEventListener('click', (e) => {
  const picker = document.getElementById('emoji-picker');
  if (!picker.contains(e.target) && !e.target.closest('.input-emoji-btn') && !e.target.classList.contains('msg-action-btn')) {
    picker.classList.add('hidden');
    emojiTargetMsgId = null;
  }
});

// Handle keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeSettings();
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
    document.getElementById('emoji-picker').classList.add('hidden');
    closeProfilePanel();
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────────
init();
