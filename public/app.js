(() => {
  'use strict';

  const STORAGE_KEY = 'chat.conversation';

  const thread = document.getElementById('thread');
  const empty = document.getElementById('empty');
  const form = document.getElementById('composer');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const newChatBtn = document.getElementById('new-chat');

  /** @type {{role: 'user' | 'reply', text: string}[]} */
  let messages = load();
  let controller = null;

  // ---------- persistence ----------
  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // storage unavailable — conversation just won't persist
    }
  }

  // ---------- lightweight, safe markdown ----------
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function inline(s) {
    return escapeHtml(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function renderMarkdown(src) {
    const out = [];
    const lines = src.replace(/\r\n/g, '\n').split('\n');
    let i = 0;
    let para = [];
    const flushPara = () => {
      if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    };

    while (i < lines.length) {
      const line = lines[i];

      const fence = line.match(/^```\s*([\w+-]*)/);
      if (fence) {
        flushPara();
        const code = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
        i++; // skip closing fence (or end of input while streaming)
        out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.*)/);
      if (heading) {
        flushPara();
        out.push(`<h4>${inline(heading[2])}</h4>`);
        i++;
        continue;
      }

      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        flushPara();
        const ordered = /^\s*\d+[.)]\s+/.test(line);
        const items = [];
        while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
          items.push(`<li>${inline(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''))}</li>`);
          i++;
        }
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>${items.join('')}</${tag}>`);
        continue;
      }

      if (line.trim() === '') flushPara();
      else para.push(line);
      i++;
    }
    flushPara();
    return out.join('');
  }

  function addCopyButtons(el) {
    el.querySelectorAll('pre').forEach((pre) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(pre.querySelector('code').textContent);
          btn.textContent = 'Copied';
          setTimeout(() => (btn.textContent = 'Copy'), 1500);
        } catch {
          btn.textContent = 'Failed';
        }
      });
      pre.appendChild(btn);
    });
  }

  // ---------- rendering ----------
  function createBubble(role) {
    const row = document.createElement('div');
    row.className = `msg ${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    row.appendChild(bubble);
    thread.appendChild(row);
    empty.hidden = true;
    return bubble;
  }

  function fillBubble(bubble, role, text) {
    if (role === 'user') {
      bubble.textContent = text;
    } else {
      bubble.innerHTML = renderMarkdown(text);
      addCopyButtons(bubble);
    }
  }

  function scrollToBottom() {
    thread.scrollTop = thread.scrollHeight;
  }

  function renderAll() {
    thread.querySelectorAll('.msg').forEach((n) => n.remove());
    empty.hidden = messages.length > 0;
    for (const m of messages) fillBubble(createBubble(m.role), m.role, m.text);
    scrollToBottom();
  }

  function setBusy(busy) {
    form.classList.toggle('busy', busy);
    sendBtn.title = busy ? 'Stop' : 'Send';
    sendBtn.setAttribute('aria-label', sendBtn.title);
    updateSendState();
  }

  function updateSendState() {
    sendBtn.disabled = !controller && input.value.trim() === '';
  }

  function autoResize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  }

  // ---------- sending ----------
  async function send(text) {
    const convo = messages;
    convo.push({ role: 'user', text });
    save();
    const userBubble = createBubble('user');
    fillBubble(userBubble, 'user', text);

    const bubble = createBubble('reply');
    bubble.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
    scrollToBottom();

    controller = new AbortController();
    setBusy(true);
    let reply = '';

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: convo }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Something went wrong. Please try again.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        reply += decoder.decode(value, { stream: true });
        const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
        fillBubble(bubble, 'reply', reply);
        if (nearBottom) scrollToBottom();
      }
      reply += decoder.decode();

      if (!reply.trim()) throw new Error('No response received. Please try again.');
    } catch (err) {
      if (err.name !== 'AbortError' && !reply) {
        bubble.parentElement.classList.add('error');
        bubble.textContent =
          err instanceof TypeError
            ? 'Could not reach the server. Please try again.'
            : err.message || 'Something went wrong. Please try again.';
      }
    } finally {
      if (reply) {
        convo.push({ role: 'reply', text: reply });
        fillBubble(bubble, 'reply', reply);
      } else {
        // drop the unanswered message and put it back in the box so it can be retried
        if (!bubble.parentElement.classList.contains('error')) {
          bubble.parentElement.remove();
          userBubble.parentElement.remove();
        }
        convo.pop();
        if (convo === messages && !input.value) {
          input.value = text;
          autoResize();
        }
      }
      if (convo === messages) save();
      controller = null;
      setBusy(false);
      input.focus();
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (controller) {
      controller.abort();
      return;
    }
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    autoResize();
    send(text);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  input.addEventListener('input', () => {
    autoResize();
    updateSendState();
  });

  newChatBtn.addEventListener('click', () => {
    if (controller) controller.abort();
    messages = [];
    save();
    renderAll();
    input.focus();
  });

  renderAll();
  updateSendState();
  input.focus();
})();
