(() => {
  if (window.__trustlockMessageGuard) return;

  const host = location.hostname;
  const app = host === 'mail.google.com'
    ? 'gmail'
    : host === 'web.telegram.org'
    ? 'telegram'
    : host === 'web.whatsapp.com'
    ? 'whatsapp'
    : (host === 'discord.com' || host === 'ptb.discord.com' || host === 'canary.discord.com')
    ? 'discord'
    : null;
  if (!app) return;

  const state = { seen: new Set(), active: true, conversation: '', latestTelegramId: 0 };
  window.__trustlockMessageGuard = state;

  const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const stableText = (element) => clean(element?.innerText || element?.textContent || '');

  function gmailMessages() {
    const bodies = [...document.querySelectorAll('.a3s.aiL, .ii.gt')];
    const threadMessages = bodies.map((body, index) => {
      const row = body.closest('[data-message-id], .adn, .gE') || body.parentElement;
      const senderNode = row?.querySelector('[email], .gD[email]');
      const senderEmail = senderNode?.getAttribute('email')?.toLowerCase();
      const senderName = clean(senderNode?.getAttribute('name') || senderNode?.getAttribute('email') || senderNode?.innerText);
      const text = stableText(body);
      if (!text || text.length < 2) return null;
      const messageId = row?.getAttribute('data-message-id') || row?.getAttribute('data-legacy-message-id');
      const timestamp = row?.querySelector('time[datetime]')?.getAttribute('datetime') || '';
      const thread = location.hash.match(/#(?:[^/]+\/)?([^/?]+)/)?.[1] || 'open-thread';
      const identity = senderEmail || senderName;
      if (!identity) return null;
      return {
        app,
        conversation: `gmail:${thread}`,
        sender: identity,
        senderLabel: senderName || senderEmail,
        id: messageId || `${thread}:${senderEmail || senderName}:${timestamp || text.slice(0, 100)}`,
        text,
        outgoing: [senderNode?.innerText, senderNode?.getAttribute('name')].some((value) => /^me(?:\s|$)/i.test(clean(value))),
        isLatest: index === bodies.length - 1,
      };
    }).filter(Boolean);
    if (threadMessages.length) return threadMessages;

    // In inbox views, monitor newly inserted rows using sender + subject/snippet only.
    const rows = [...document.querySelectorAll('tr.zA, [role="main"] tr[role="main"]')];
    return rows.map((row, index) => {
      const senderNode = row.querySelector('[email], .yW span, .yW');
      const senderEmail = senderNode?.getAttribute('email')?.toLowerCase();
      const senderName = clean(senderNode?.getAttribute('name') || senderNode?.getAttribute('email') || senderNode?.getAttribute('title') || senderNode?.innerText);
      const subject = clean(row.querySelector('.bog, [data-thread-id]')?.innerText);
      const snippet = clean(row.querySelector('.y2')?.innerText);
      const text = clean(`${subject} ${snippet}`);
      const sender = senderEmail || senderName;
      if (!sender || !text) return null;
      const link = row.querySelector('a[href*="#"]')?.getAttribute('href') || '';
      const id = row.getAttribute('data-legacy-thread-id') || row.getAttribute('data-thread-id') || link || `${sender}:${subject}:${snippet}:${index}`;
      return {
        app,
        conversation: `gmail:${location.hash || 'inbox'}`,
        sender,
        senderLabel: senderName || senderEmail,
        id,
        text,
        outgoing: false,
        previewOnly: true,
        isLatest: index === 0,
      };
    }).filter(Boolean);
  }

  function telegramMessages() {
    const candidates = [...document.querySelectorAll('[data-mid], [data-message-id], .bubble')];
    const messages = [];
    const used = new Set();
    for (const node of candidates) {
      if (node.querySelector('[data-mid], [data-message-id], .bubble')) continue;
      const text = stableText(node);
      if (!text || text.length < 2 || text.length > 12000) continue;
      const peerNode = node.closest('[data-peer-id]');
      const peerId = peerNode?.getAttribute('data-peer-id');
      const senderNode = node.querySelector('[data-peer-id], [class*="sender"], [class*="peer-title"], [title]');
      const sender = clean(
        senderNode?.getAttribute('data-peer-id') ||
        senderNode?.getAttribute('title') ||
        senderNode?.innerText ||
        peerId
      );
      const header = document.querySelector('header [title], header h3, header h2, [class*="chat-info"] [class*="title"]');
      const chatLabel = clean(header?.getAttribute('title') || header?.innerText) || 'active-chat';
      // Private chats usually expose only the other participant in the chat header.
      const identity = sender || chatLabel;
      const id = node.getAttribute('data-mid') || node.getAttribute('data-message-id') || `${identity}:${text.slice(0, 96)}`;
      if (used.has(id)) continue;
      used.add(id);
      let directionNode = node;
      let directionClasses = '';
      for (let depth = 0; directionNode && depth < 5; depth += 1, directionNode = directionNode.parentElement) {
        if (typeof directionNode.className === 'string') directionClasses += ` ${directionNode.className.toLowerCase()}`;
      }
      const numericId = /^\d+$/.test(String(node.getAttribute('data-mid') || node.getAttribute('data-message-id') || ''))
        ? Number(node.getAttribute('data-mid') || node.getAttribute('data-message-id'))
        : null;
      messages.push({
        app,
        conversation: `telegram:${chatLabel}`,
        sender: identity.toLowerCase(),
        senderLabel: identity,
        id,
        numericId,
        text,
        outgoing: /is-out|outgoing|own-message|message-out/.test(directionClasses),
        domIndex: messages.length,
      });
    }
    messages.forEach((message, index) => { message.isLatest = index >= Math.max(0, messages.length - 4); });
    return messages;
  }

  function whatsappMessages() {
    const candidates = [...document.querySelectorAll('div[data-id], div[role="row"]')];
    const headerNode = document.querySelector('header [data-testid="conversation-info-header-chat-title"], header span[title]');
    const chatTitle = clean(headerNode?.getAttribute('title') || headerNode?.innerText) || 'whatsapp-chat';
    const messages = [];
    const used = new Set();

    for (const node of candidates) {
      const dataId = node.getAttribute('data-id') || '';
      const textNode = node.querySelector('.selectable-text, .copyable-text span, [class*="copyable-text"]');
      const text = stableText(textNode || node);
      if (!text || text.length < 2 || text.length > 15000) continue;

      const isOutgoing = node.classList.contains('message-out') || dataId.startsWith('true_');
      const prePlainText = node.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text') || '';
      const senderMatch = prePlainText.match(/]\s*([^:]+):/);
      const sender = clean(senderMatch?.[1] || (isOutgoing ? 'me' : chatTitle));
      const id = dataId || `${sender}:${text.slice(0, 96)}`;
      if (used.has(id)) continue;
      used.add(id);

      messages.push({
        app: 'whatsapp',
        conversation: `whatsapp:${chatTitle}`,
        sender: sender.toLowerCase(),
        senderLabel: sender,
        id,
        text,
        outgoing: isOutgoing,
        domIndex: messages.length,
      });
    }
    messages.forEach((message, index) => { message.isLatest = index >= Math.max(0, messages.length - 3); });
    return messages;
  }

  function discordMessages() {
    const messageRows = [...document.querySelectorAll('li[id^="chat-messages-"], [class*="messageListItem_"]')];
    const channelHeader = document.querySelector('h1[class*="title_"], header h1, [class*="channelName_"]');
    const channelName = clean(channelHeader?.innerText) || 'discord-channel';
    const messages = [];
    const used = new Set();

    for (const row of messageRows) {
      const contentNode = row.querySelector('[id^="message-content-"], [class*="messageContent_"]');
      const text = stableText(contentNode);
      if (!text || text.length < 2 || text.length > 15000) continue;

      const authorNode = row.querySelector('[class*="username_"], [id^="message-username-"]');
      const sender = clean(authorNode?.innerText) || 'unknown-user';
      const rowId = row.getAttribute('id') || contentNode?.getAttribute('id') || `${sender}:${text.slice(0, 96)}`;
      if (used.has(rowId)) continue;
      used.add(rowId);

      const isOutgoing = Boolean(row.querySelector('[class*="currentUser_"]'));

      messages.push({
        app: 'discord',
        conversation: `discord:${channelName}`,
        sender: sender.toLowerCase(),
        senderLabel: sender,
        id: rowId,
        text,
        outgoing: isOutgoing,
        domIndex: messages.length,
      });
    }
    messages.forEach((message, index) => { message.isLatest = index >= Math.max(0, messages.length - 3); });
    return messages;
  }

  function collectMessages() {
    switch (app) {
      case 'gmail': return gmailMessages();
      case 'telegram': return telegramMessages();
      case 'whatsapp': return whatsappMessages();
      case 'discord': return discordMessages();
      default: return [];
    }
  }

  function context() {
    const messages = collectMessages();
    let conversationName = 'active-chat';
    if (app === 'gmail') {
      conversationName = `gmail:${location.hash || 'inbox'}`;
    } else if (app === 'telegram') {
      conversationName = `telegram:${stableText(document.querySelector('header')) || 'active-chat'}`;
    } else if (app === 'whatsapp') {
      const headerNode = document.querySelector('header [data-testid="conversation-info-header-chat-title"], header span[title]');
      conversationName = `whatsapp:${clean(headerNode?.getAttribute('title') || headerNode?.innerText) || 'active-chat'}`;
    } else if (app === 'discord') {
      const channelHeader = document.querySelector('h1[class*="title_"], header h1');
      conversationName = `discord:${clean(channelHeader?.innerText) || 'active-channel'}`;
    }
    const historyCount = messages.filter((message) => !message.previewOnly).length;
    return { app, conversation: conversationName, count: messages.length, historyCount, senders: [...new Set(messages.map((message) => message.senderLabel))] };
  }

  function keyFor(message) {
    return `${message.conversation}|${message.sender}|${message.id}`;
  }

  function markCurrentAsSeen() {
    const messages = collectMessages();
    for (const message of messages) {
      state.seen.add(keyFor(message));
      if (message.numericId != null) state.latestTelegramId = Math.max(state.latestTelegramId, message.numericId);
    }
    state.conversation = context().conversation;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'TRUSTLOCK_CONTEXT') {
      sendResponse(context());
      return;
    }
    if (message?.type === 'TRUSTLOCK_LEARN_HISTORY') {
      const messages = collectMessages();
      sendResponse({ ...context(), messages: messages.filter((item) => !item.previewOnly) });
      return;
    }
    if (message?.type === 'TRUSTLOCK_STOP') {
      state.active = false;
      observer.disconnect();
      sendResponse({ stopped: true });
      return;
    }
    if (message?.type === 'TRUSTLOCK_START') {
      state.active = true;
      markCurrentAsSeen();
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
      sendResponse({ started: true });
    }
  });

  markCurrentAsSeen();
  chrome.runtime.sendMessage({ type: 'TRUSTLOCK_PAGE_CONTEXT', context: context() }).catch(() => {});

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued || !state.active) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      const current = context();
      if (current.conversation !== state.conversation) {
        state.latestTelegramId = 0;
        markCurrentAsSeen();
        state.conversation = current.conversation;
        chrome.runtime.sendMessage({
          type: 'TRUSTLOCK_HISTORY_MESSAGES',
          messages: collectMessages().filter((message) => !message.previewOnly),
        }).catch(() => {});
        return;
      }
      const newMessages = collectMessages().filter((message) => {
        const key = keyFor(message);
        if (state.seen.has(key)) return false;
        state.seen.add(key);
        if (message.app === 'telegram' && message.numericId != null) {
          const isNewer = message.numericId > state.latestTelegramId;
          state.latestTelegramId = Math.max(state.latestTelegramId, message.numericId);
          return isNewer;
        }
        return Boolean(message.isLatest);
      });
      if (newMessages.length) chrome.runtime.sendMessage({ type: 'TRUSTLOCK_NEW_MESSAGES', messages: newMessages }).catch(() => {});
    }, 250);
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
})();
