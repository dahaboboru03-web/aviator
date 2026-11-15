(() => {
  const ui = {
    canvas: document.getElementById('gameCanvas'),
    multiplier: document.getElementById('multiplier'),
    crashLabel: document.getElementById('crashLabel'),
    countdown: document.getElementById('countdown'),
    roundStatus: document.getElementById('roundStatus'),
    resultsStrip: document.getElementById('resultsStrip'),
    historyBody: document.getElementById('historyBody'),
    historyMeta: document.getElementById('historyMeta'),
    htabs: Array.from(document.querySelectorAll('.htab')),
    balance: document.getElementById('balance'),
    toast: document.getElementById('toast'),
    profileBtn: document.getElementById('profileBtn'),
    profileName: document.getElementById('profileName'),
    avatar: document.getElementById('avatar'),
    panels: [document.querySelector('.bet-panel[data-panel="0"]'), document.querySelector('.bet-panel[data-panel="1"]')],
    amount: [document.getElementById('amount-0'), document.getElementById('amount-1')],
    auto: [document.getElementById('auto-0'), document.getElementById('auto-1')],
    action: [document.getElementById('action-0'), document.getElementById('action-1')],
    status: [document.getElementById('status-0'), document.getElementById('status-1')],
    manualCtrl: [document.getElementById('manual-0'), document.getElementById('manual-1')],
    autoCtrl: [document.getElementById('autoctrl-0'), document.getElementById('autoctrl-1')],
    autoAmount: [document.getElementById('auto-amount-0'), document.getElementById('auto-amount-1')],
    autoRounds: [document.getElementById('auto-rounds-0'), document.getElementById('auto-rounds-1')],
    autoTarget: [document.getElementById('auto-target-0'), document.getElementById('auto-target-1')],
    autoMeta: [document.getElementById('auto-meta-0'), document.getElementById('auto-meta-1')],
    autoAction: [document.getElementById('auto-action-0'), document.getElementById('auto-action-1')],
    autoSub: [document.getElementById('auto-sub-0'), document.getElementById('auto-sub-1')],
    autoCashout: [document.getElementById('auto-cashout-0'), document.getElementById('auto-cashout-1')],
    autoCashoutSub: [document.getElementById('auto-cashout-sub-0'), document.getElementById('auto-cashout-sub-1')],
    tabs: [Array.from(document.querySelectorAll('.tab[data-panel="0"]')), Array.from(document.querySelectorAll('.tab[data-panel="1"]'))],
    modal: document.getElementById('profileModal'),
    modalClose: document.getElementById('profileClose'),
    modalCancel: document.getElementById('profileCancel'),
    modalSave: document.getElementById('profileSave'),
    usernameInput: document.getElementById('usernameInput'),
    avatarGrid: document.getElementById('avatarGrid'),
    profileAvatarPreview: document.getElementById('profileAvatarPreview'),
    profileNamePreview: document.getElementById('profileNamePreview'),
    profileVipBadge: document.getElementById('profileVipBadge'),
    profileVipStatus: document.getElementById('profileVipStatus'),
    vipHint: document.getElementById('vipHint'),
    depositModal: document.getElementById('depositModal'),
    depositClose: document.getElementById('depositClose'),
    depositCancel: document.getElementById('depositCancel'),
    depositConfirm: document.getElementById('depositConfirm'),
    depositPhone: document.getElementById('depositPhone'),
    depositAmount: document.getElementById('depositAmount'),
    depositQuick: document.getElementById('depositQuick'),
    depositStatusMsg: document.getElementById('depositStatusMsg'),
    withdrawModal: document.getElementById('withdrawModal'),
    withdrawClose: document.getElementById('withdrawClose'),
    withdrawCancel: document.getElementById('withdrawCancel'),
    withdrawConfirm: document.getElementById('withdrawConfirm'),
    withdrawPhone: document.getElementById('withdrawPhone'),
    withdrawAmount: document.getElementById('withdrawAmount'),
    withdrawInfo: document.getElementById('withdrawInfo'),
    withdrawLimits: document.getElementById('withdrawLimits'),
    withdrawStatusMsg: document.getElementById('withdrawStatusMsg'),
    txModal: document.getElementById('txModal'),
    txClose: document.getElementById('txClose'),
    txBody: document.getElementById('txBody'),
    txHistoryBtn: document.getElementById('txHistoryBtn')
  };
  const ctx = ui.canvas.getContext('2d');

  const TOKEN_KEY = 'aviator_player_token';
  const client = {
    token: localStorage.getItem(TOKEN_KEY) || null,
    connected: false,
    serverOffset: 0,
    config: { growthRate: 0.06, bettingMs: 5000, crashedMs: 3000, avatars: [] },
    state: null,
    selectedAvatar: 'P',
    panelMode: ['manual', 'manual'],
    liveBetsTab: 'all',
    payments: null,
    paymentsSettings: { minWithdrawal: 50, maxWithdrawal: 70000 },
  };

  function fmtMoney(n) {
    return 'KSh ' + Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtTime(ms){ if(!ms) return '—'; const d=new Date(ms); return d.toLocaleString(); }
  function round2(n) { return Math.floor(n * 100) / 100; }
  function serverNow() { return Date.now() + client.serverOffset; }

  function showToast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => ui.toast.classList.remove('show'), 2600);
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json', 'x-player-token': client.token || '' }, opts.headers || {});
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const err = new Error((data && data.msg) || ('Request failed (' + res.status + ')'));
      err.data = data; err.status = res.status; throw err;
    }
    return data || {};
  }

  function normalizePhoneInput(v) {
    if (v == null) return null;
    let s = String(v).trim().replace(/[\s\-()]/g, '');
    if (/^\+254\d{9}$/.test(s)) s = s.slice(1);
    if (/^254\d{9}$/.test(s)) return s;
    if (/^0\d{9}$/.test(s)) return '254' + s.slice(1);
    if (/^[17]\d{8}$/.test(s)) return '254' + s;
    return null;
  }

  function openModal(el){ if(!el) return; el.classList.add('show'); el.setAttribute('aria-hidden','false'); }
  function closeModal(el){ if(!el) return; el.classList.remove('show'); el.setAttribute('aria-hidden','true'); }

  function resize() {
    const rect = ui.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    ui.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    ui.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function resultClass(mult) {
    if (mult >= 10) return 'top';
    if (mult >= 5) return 'high';
    if (mult >= 2) return 'mid';
    return 'low';
  }

  function renderRecent(recent) {
    ui.resultsStrip.innerHTML = (recent || []).map(m => `<span class="result-chip ${resultClass(m)}">${Number(m).toFixed(2)}x</span>`).join('');
  }

  function computeDisplayRound(round) {
    if (!round) return null;
    const t = serverNow();
    let multiplier = 1;
    let remainingMs = 0;
    if (round.state === 'BETTING') {
      multiplier = 1;
      remainingMs = Math.max(0, (round.bettingEndsAt || 0) - t);
    } else if (round.state === 'RUNNING') {
      const elapsed = Math.max(0, t - (round.startedAt || t));
      multiplier = Math.min(round.crashPoint, Math.max(1, round2(Math.exp(client.config.growthRate * (elapsed / 1000)))));
    } else if (round.state === 'CRASHED') {
      multiplier = round.crashPoint;
      remainingMs = Math.max(0, (round.nextAt || 0) - t);
    }
    return Object.assign({}, round, { multiplier, remainingMs, displayTime: t });
  }

  function getPanelAmount(i) {
    const v = parseFloat(ui.amount[i].value);
    return isFinite(v) ? Math.max(10, Math.floor(v)) : 100;
  }

  function myBetForPanel(state, panel) {
    const current = state.round && state.round.roundId;
    const nextId = state.round && state.round.nextRoundId;
    const mine = (state.bets || []).filter(x => x.isMine && x.panel === panel);
    let b = mine.find(x => x.status === 'QUEUED' && x.roundId === nextId);
    if (b) return b;
    b = mine.find(x => x.roundId === current && (x.status === 'FLYING' || x.status === 'BET_PLACED' || x.status === 'CASHED_OUT' || x.status === 'LOST'));
    if (b) return b;
    b = mine.find(x => x.roundId === current);
    if (b) return b;
    return mine[0] || null;
  }

  function setPanelMode(panel, mode) {
    client.panelMode[panel] = mode;
    ui.manualCtrl[panel].classList.toggle('hidden', mode !== 'manual');
    ui.autoCtrl[panel].classList.toggle('hidden', mode !== 'auto');
    ui.tabs[panel].forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  }

  function getAutoState(panel) {
    const p = client.state && client.state.player;
    const a = p && p.auto && p.auto[panel];
    return a || { running: false, amount: 100, roundsTotal: 0, roundsRemaining: 0, autoCashout: null, status: 'AUTO STOPPED', lastError: null };
  }

  function panelBetStatus(state, panel) {
    const round = state.round;
    const current = round && round.roundId;
    const nextId = round && round.nextRoundId;
    const auto = getAutoState(panel);
    const b = myBetForPanel(state, panel);
    // priority by active/queued bet state for this round context
    if (b && b.status === 'QUEUED') return { text: 'BET QUEUED', cls: 'queued' };
    if (b && b.status === 'FLYING' && b.roundId === current) return { text: 'BET ACTIVE', cls: 'active' };
    if (b && b.status === 'BET_PLACED' && b.roundId === current) return { text: auto.running || auto.roundsRemaining > 0 ? 'BET ACTIVE' : 'BET PLACED', cls: 'active' };
    if (b && b.status === 'CASHED_OUT' && b.roundId === current) return { text: 'CASHED OUT', cls: 'won' };
    if (b && b.status === 'LOST' && b.roundId === current) return { text: 'ROUND LOST', cls: 'lost' };
    if (auto.status === 'INSUFFICIENT BALANCE') return { text: 'INSUFFICIENT BALANCE', cls: 'lost' };
    if (auto.running) return { text: auto.status || 'AUTO RUNNING', cls: 'active' };
    if (auto.status && auto.status !== 'AUTO STOPPED') return { text: auto.status, cls: auto.status === 'CASHED OUT' ? 'won' : (auto.status === 'ROUND LOST' ? 'lost' : '') };
    return { text: 'Ready', cls: '' };
  }

  function setMyStatusFromState(state) {
    [0,1].forEach(panel => {
      const s = panelBetStatus(state, panel);
      const auto = getAutoState(panel);
      let text = s.text;
      if (auto.running || auto.roundsRemaining > 0 || auto.status !== 'AUTO STOPPED') {
        text = `${text} · Remaining: ${auto.roundsRemaining || 0}`;
      }
      ui.status[panel].textContent = text;
      ui.status[panel].className = 'bet-status' + (s.cls ? ' ' + s.cls : '');
      const b = myBetForPanel(state, panel);
      ui.panels[panel].classList.toggle('has-queued', !!(b && b.status === 'QUEUED'));

      ui.autoMeta[panel].textContent = `${auto.status || 'AUTO STOPPED'} · Remaining: ${auto.roundsRemaining || 0}`;
      ui.autoMeta[panel].className = 'auto-meta ' + (auto.status === 'INSUFFICIENT BALANCE' ? 'error' : ((auto.running || auto.roundsRemaining > 0) ? 'running' : 'stopped'));
      if (document.activeElement !== ui.autoAmount[panel]) ui.autoAmount[panel].value = auto.amount || 100;
      if (document.activeElement !== ui.autoRounds[panel] && !auto.running) ui.autoRounds[panel].value = Math.max(auto.roundsTotal || 10, 1);
      if (document.activeElement !== ui.autoTarget[panel]) ui.autoTarget[panel].value = (auto.autoCashout != null ? auto.autoCashout : '');
      ui.autoSub[panel].textContent = fmtMoney(Math.max(10, Math.floor(parseInt(ui.autoAmount[panel].value || '100', 10) || 100)));
      if (auto.running) {
        ui.autoAction[panel].className = 'action-btn stop-auto';
        ui.autoAction[panel].innerHTML = `STOP AUTO <span class="action-sub">Remaining: ${auto.roundsRemaining || 0}</span>`;
        ui.autoAction[panel].disabled = !client.connected;
      } else {
        const amt = Math.max(10, Math.floor(parseInt(ui.autoAmount[panel].value || '100', 10) || 100));
        ui.autoAction[panel].className = 'action-btn bet';
        ui.autoAction[panel].innerHTML = `START AUTO <span class="action-sub">${fmtMoney(amt)}</span>`;
        ui.autoAction[panel].disabled = !client.connected;
      }
    });
  }
  function renderLiveBets(state) {
    if (client.liveBetsTab === 'previous') {
      const prev = state && state.previousRound ? state.previousRound : null;
      const bets = prev ? (prev.bets || []).slice() : [];
      const order = { CASHED_OUT: 0, FLYING: 1, BET_PLACED: 2, LOST: 3 };
      bets.sort((a, b) => {
        if ((order[a.status] ?? 9) !== (order[b.status] ?? 9)) return (order[a.status] ?? 9) - (order[b.status] ?? 9);
        return (b.amount || 0) - (a.amount || 0);
      });
      let total = 0, won = 0;
      ui.historyBody.innerHTML = bets.map(h => {
        total += h.amount || 0;
        if (h.status === 'CASHED_OUT') won += Number(h.win || 0);
        const cashTxt = h.status === 'CASHED_OUT' && h.cashoutAt ? `${Number(h.cashoutAt).toFixed(2)}x` : '—';
        const winTxt = h.status === 'CASHED_OUT' && h.win != null ? fmtMoney(h.win) : '—';
        let badge = '';
        if (h.status === 'BET_PLACED') badge = '<span class="status-badge placed">BET PLACED</span>';
        else if (h.status === 'FLYING') badge = '<span class="status-badge flying">FLYING</span>';
        else if (h.status === 'CASHED_OUT') badge = '<span class="status-badge cashed">CASHED OUT</span>';
        else badge = '<span class="status-badge lost">LOST</span>';
        let pillClass = 'loss';
        if (h.status === 'CASHED_OUT') pillClass = 'win';
        else if (h.status === 'FLYING') pillClass = 'flying';
        const cashCell = h.status === 'CASHED_OUT' ? `<span class="pill win">${cashTxt}</span>` : `<span class="pill ${pillClass}">—</span>`;
        const winClass = h.status === 'CASHED_OUT' ? 'win' : 'loss';
        const av = h.avatar ? `<span class="mini-av ${h.isVip ? 'vip' : ''}">${h.avatar}</span>` : '';
        const vip = h.isVip ? '<span class="vip-tag">VIP</span>' : '';
        const name = `<span class="player-cell">${av}<span>${h.name}${vip}</span></span>`;
        return `<tr>
          <td class="player">${name}</td>
          <td>${fmtMoney(h.amount)}</td>
          <td>${cashCell}</td>
          <td class="${winClass}">${winTxt}</td>
          <td>${badge}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="5" class="muted">No previous round yet</td></tr>';
      if (prev) ui.historyMeta.textContent = `Previous ${prev.roundId || ''} · Crash ${Number(prev.crashPoint || 0).toFixed(2)}x · Players: ${bets.length} · Total: ${fmtMoney(total)} · Won: ${fmtMoney(won)}`;
      else ui.historyMeta.textContent = 'No previous round yet';
      return;
    }
    if (client.liveBetsTab === 'mine') {
      const bets = ((state && state.myBets) || []).slice();
      let total = 0;
      ui.historyBody.innerHTML = bets.map(h => {
        total += h.amount || 0;
        const cashTxt = h.status === 'CASHED_OUT' && h.cashoutAt ? `${Number(h.cashoutAt).toFixed(2)}x` : '—';
        const winTxt = h.status === 'CASHED_OUT' && h.win != null ? fmtMoney(h.win) : '—';
        let badge = '';
        if (h.status === 'CASHED_OUT') badge = '<span class="status-badge cashed">CASHED OUT</span>';
        else badge = '<span class="status-badge lost">LOST</span>';
        const cashCell = h.status === 'CASHED_OUT' ? `<span class="pill win">${cashTxt}</span>` : '<span class="pill loss">-</span>';
        const winClass = h.status === 'CASHED_OUT' ? 'win' : 'loss';
        const name = `<span class="player-cell"><span>${h.roundId || '—'} <span class="tag-sim">crash ${Number(h.crashPoint||0).toFixed(2)}x</span></span></span>`;
        return `<tr>
          <td class="player">${name}</td>
          <td>${fmtMoney(h.amount)}</td>
          <td>${cashCell}</td>
          <td class="${winClass}">${winTxt}</td>
          <td>${badge}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="5" class="muted">No bet history yet</td></tr>';
      ui.historyMeta.textContent = `My bet history: ${bets.length} · Total: ${fmtMoney(total)}`;
      return;
    }
    const bets = (state.bets || []).filter(h => h.status !== 'QUEUED').slice();
    const order = { CASHED_OUT: 0, FLYING: 1, BET_PLACED: 2, LOST: 3 };
    bets.sort((a, b) => {
      if ((order[a.status] ?? 9) !== (order[b.status] ?? 9)) return (order[a.status] ?? 9) - (order[b.status] ?? 9);
      return (b.amount || 0) - (a.amount || 0);
    });
    let total = 0, won = 0, active = 0;
    ui.historyBody.innerHTML = bets.map(h => {
      total += h.amount || 0;
      if (h.status === 'CASHED_OUT') won += Number(h.win || 0);
      else if (h.status !== 'LOST') active++;
      const cashTxt = h.status === 'CASHED_OUT' && h.cashoutAt ? `${Number(h.cashoutAt).toFixed(2)}x` : '—';
      const winTxt = h.status === 'CASHED_OUT' && h.win != null ? fmtMoney(h.win) : '—';
      let badge = '';
      if (h.status === 'BET_PLACED') badge = '<span class="status-badge placed">BET PLACED</span>';
      else if (h.status === 'FLYING') badge = '<span class="status-badge flying">FLYING</span>';
      else if (h.status === 'CASHED_OUT') badge = '<span class="status-badge cashed">CASHED OUT</span>';
      else badge = '<span class="status-badge lost">LOST</span>';
      let pillClass = 'loss';
      if (h.status === 'CASHED_OUT') pillClass = 'win';
      else if (h.status === 'FLYING') pillClass = 'flying';
      const cashCell = h.status === 'CASHED_OUT' ? `<span class="pill win">${cashTxt}</span>` : `<span class="pill ${pillClass}">—</span>`;
      const winClass = h.status === 'CASHED_OUT' ? 'win' : 'loss';
      const av = h.avatar ? `<span class="mini-av ${h.isVip ? 'vip' : ''}">${h.avatar}</span>` : '';
      const vip = h.isVip ? '<span class="vip-tag">VIP</span>' : '';
      const name = `<span class="player-cell">${av}<span>${h.name}${vip}</span></span>`;
      return `<tr>
        <td class="player">${name}</td>
        <td>${fmtMoney(h.amount)}</td>
        <td>${cashCell}</td>
        <td class="${winClass}">${winTxt}</td>
        <td>${badge}</td>
      </tr>`;
    }).join('');
    ui.historyMeta.textContent = `Players: ${active} · Total: ${fmtMoney(total)} · Won: ${fmtMoney(won)}`;
  }

  function flyingBetForPanel(state, panel) {
    if (!state || !state.round) return null;
    const rid = state.round.roundId;
    return (state.bets || []).find(x => x.isMine && x.panel === panel && x.roundId === rid && x.status === 'FLYING') || null;
  }

  function updatePanels(displayRound) {
    const state = client.state;
    if (!displayRound || !state) return;
    for (let i = 0; i < 2; i++) {
      const b = myBetForPanel(state, i);
      const btn = ui.action[i];
      const amount = getPanelAmount(i);
      const amtInput = ui.amount[i];
      const autoInput = ui.auto[i];
      const auto = getAutoState(i);
      const autoActive = !!(auto.running || (auto.roundsRemaining > 0));
      const flying = flyingBetForPanel(state, i);

      // Auto tab: allow manual cash-out of active flying bet while in Auto mode
      if (ui.autoCashout && ui.autoCashout[i]) {
        if (flying) {
          const win = (flying.amount || 0) * (displayRound.multiplier || 1);
          ui.autoCashout[i].classList.remove('hidden');
          ui.autoCashout[i].disabled = !client.connected;
          if (ui.autoCashoutSub && ui.autoCashoutSub[i]) ui.autoCashoutSub[i].textContent = fmtMoney(win);
        } else {
          ui.autoCashout[i].classList.add('hidden');
          ui.autoCashout[i].disabled = true;
        }
      }

      // manual action button: allow manual cashout of any active flying bet even if auto placed it
      if (flying) {
        btn.className = 'action-btn cashout';
        const win = (flying.amount || 0) * (displayRound.multiplier || 1);
        btn.innerHTML = `CASH OUT <span class="action-sub">${fmtMoney(win)}</span>`;
        btn.disabled = false;
        amtInput.disabled = true; autoInput.disabled = true;
      } else if (b && b.status === 'QUEUED') {
        btn.className = 'action-btn queued';
        btn.innerHTML = `BET QUEUED <span class="action-sub">${fmtMoney(b.amount)}</span>`;
        btn.disabled = !!autoActive;
        amtInput.disabled = true; autoInput.disabled = true;
      } else if (displayRound.state === 'BETTING' && b && b.status === 'BET_PLACED' && b.roundId === displayRound.roundId) {
        btn.className = 'action-btn bet';
        btn.innerHTML = `CANCEL <span class="action-sub">${fmtMoney(b.amount)}</span>`;
        btn.disabled = !client.connected || autoActive;
        amtInput.disabled = true; autoInput.disabled = true;
      } else if (b && b.status === 'CASHED_OUT' && b.roundId === displayRound.roundId) {
        if (displayRound.state === 'RUNNING' || displayRound.state === 'CRASHED') {
          if (autoActive) {
            btn.className = 'action-btn bet';
            btn.innerHTML = `AUTO <span class="action-sub">Waiting for next round</span>`;
            btn.disabled = true;
          } else {
            btn.className = 'action-btn bet';
            btn.innerHTML = `BET <span class="action-sub">${fmtMoney(amount)}</span>`;
            btn.disabled = !client.connected;
          }
          amtInput.disabled = autoActive; autoInput.disabled = autoActive;
        } else {
          btn.className = 'action-btn bet';
          btn.innerHTML = `CASHED OUT <span class="action-sub">${Number(b.cashoutAt || 0).toFixed(2)}x</span>`;
          btn.disabled = true;
          amtInput.disabled = true; autoInput.disabled = true;
        }
      } else if (b && b.status === 'LOST' && b.roundId === displayRound.roundId) {
        if (autoActive) {
          btn.className = 'action-btn bet';
          btn.innerHTML = `AUTO <span class="action-sub">Waiting for next round</span>`;
          btn.disabled = true;
          amtInput.disabled = true; autoInput.disabled = true;
        } else {
          btn.className = 'action-btn bet';
          btn.innerHTML = `BET <span class="action-sub">${fmtMoney(amount)}</span>`;
          btn.disabled = !client.connected;
          amtInput.disabled = false; autoInput.disabled = false;
        }
      } else {
        const useAmt = amount;
        btn.className = 'action-btn bet';
        btn.innerHTML = `BET <span class="action-sub">${fmtMoney(amount)}</span>`;
        const hasCurrent = b && b.roundId === displayRound.roundId && (b.status === 'BET_PLACED' || b.status === 'FLYING' || b.status === 'CASHED_OUT');
        const hasQueued = b && b.status === 'QUEUED';
        btn.disabled = !client.connected || hasCurrent || hasQueued || autoActive;
        amtInput.disabled = !!hasQueued || autoActive;
        autoInput.disabled = !!hasQueued || autoActive;
      }
    }
  }

  function renderAvatarGrid() {
    const avatars = client.config.avatars || ['ðŸ˜€'];
    ui.avatarGrid.innerHTML = avatars.map(a => {
      const selected = a === client.selectedAvatar ? ' selected' : '';
      return `<button type="button" class="avatar-opt${selected}" data-av="${a}">${a}</button>`;
    }).join('');
    ui.avatarGrid.querySelectorAll('.avatar-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        client.selectedAvatar = btn.dataset.av;
        renderAvatarGrid();
        updateProfilePreview();
      });
    });
  }

  function updateProfilePreview() {
    const uname = (ui.usernameInput.value || '').trim() || (client.state && client.state.player && client.state.player.username) || 'Player';
    const av = client.selectedAvatar || (client.config.avatars && client.config.avatars[0]) || 'ðŸ˜€';
    const isVip = !!(client.state && client.state.player && client.state.player.isVip);
    ui.profileAvatarPreview.textContent = av;
    ui.profileAvatarPreview.className = 'avatar' + (isVip ? ' vip' : '');
    ui.profileNamePreview.textContent = uname;
    ui.profileVipBadge.innerHTML = isVip ? '<span class="vip-badge">VIP</span>' : '';
  }

  function openProfileModal() {
    if (!client.state || !client.state.player) return;
    const p = client.state.player;
    ui.usernameInput.value = p.username || 'Player';
    client.selectedAvatar = p.avatar || (client.config.avatars && client.config.avatars[0]) || 'ðŸ˜€';
    renderAvatarGrid();
    const isVip = !!p.isVip;
    ui.profileVipStatus.textContent = isVip ? `Status: VIP (${p.activityCount || 0} active actions in last 10 min)` : `Status: Regular player (${p.activityCount || 0} active actions in last 10 min)`;
    ui.profileVipBadge.innerHTML = isVip ? '<span class="vip-badge">VIP</span>' : '';
    ui.profileAvatarPreview.className = 'avatar' + (isVip ? ' vip' : '');
    ui.vipHint.textContent = 'VIP is based on your own last 10 minutes of activity (bets/cash-outs). Stay active to keep it; more than 10 minutes inactive removes it.';
    updateProfilePreview();
    ui.modal.classList.add('show');
    ui.modal.setAttribute('aria-hidden', 'false');
  }
  function closeProfileModal() {
    ui.modal.classList.remove('show');
    ui.modal.setAttribute('aria-hidden', 'true');
  }

  function applyPaymentsState(pstate) {
    if (!pstate) return;
    client.payments = pstate;
    if (pstate.settings) client.paymentsSettings = pstate.settings;
    if (pstate.player) {
      if (ui.withdrawInfo) ui.withdrawInfo.textContent = `Available: ${fmtMoney(pstate.player.available_balance)} · Reserved: ${fmtMoney(pstate.player.reserved_balance || 0)}`;
      if (pstate.player.phone_number && ui.depositPhone && !ui.depositPhone.value) ui.depositPhone.value = pstate.player.phone_number;
      if (pstate.player.phone_number && ui.withdrawPhone && !ui.withdrawPhone.value) ui.withdrawPhone.value = pstate.player.phone_number;
    }
    if (ui.withdrawLimits) {
      const s = client.paymentsSettings || {};
      ui.withdrawLimits.textContent = `Limits: ${fmtMoney(s.minWithdrawal || 220)} – ${fmtMoney(s.maxWithdrawal || 70000)} (available balance only; reserved funds cannot be withdrawn).`;
    }
    renderTxHistory(pstate);
  }

  function fmtTime(ms){
    if(!ms) return '—';
    const d=new Date(ms);
    return d.toLocaleDateString('en-KE',{day:'2-digit',month:'2-digit'}) + ' ' + d.toLocaleTimeString('en-KE',{hour:'2-digit',minute:'2-digit'});
  }
  function statusClass(s){ return ['COMPLETED','PENDING','PROCESSING','FAILED','CANCELLED','REJECTED','APPROVED','AWAITING_PAYMENT','AWAITING_APPROVAL','MARKED_PAID'].includes(s) ? s : 'PENDING'; }

  let txShowAll = false;
  function renderTxHistory(pstate) {
    if (!ui.txBody) return;
    const deps = (pstate && pstate.deposits || []).map(d => ({
      id: d.id, type: 'Deposit', amount: d.amount, phone: d.phone_number, ref: d.mpesa_receipt_number || d.checkout_request_id || d.id, at: d.completed_at || d.created_at, status: d.status, desc: d.description, raw: d
    }));
    const wds = (pstate && pstate.withdrawals || []).map(w => ({
      id: w.id, type: 'Withdrawal', amount: w.amount, phone: w.phone_number, ref: w.transaction_reference || w.conversation_id || w.id, at: w.completed_at || w.created_at, status: w.status, desc: w.description || w.failure_reason, raw: w
    }));
    const rowsAll = deps.concat(wds).sort((a,b) => (b.at||0)-(a.at||0));
    if (!rowsAll.length) { ui.txBody.innerHTML = '<tr><td colspan="7" class="muted">No transactions yet</td></tr>'; const t=document.getElementById('txToggleWrap'); if(t) t.innerHTML=''; return; }
    const rows = txShowAll ? rowsAll : rowsAll.slice(0, 5);
    ui.txBody.innerHTML = rows.map(r => {
      const st = statusClass(r.status);
      const canEditDep = r.type === 'Deposit' && ['AWAITING_PAYMENT','AWAITING_APPROVAL','MARKED_PAID'].includes(r.status);
      const canEditWd = r.type === 'Withdrawal' && ['AWAITING_PAYMENT','AWAITING_APPROVAL','MARKED_PAID'].includes(r.status);
      let act = '—';
      if (canEditDep) act = `<button class="btn btn-secondary dep-edit" data-id="${r.id}" style="padding:3px 6px;font-size:10px">${r.status==='AWAITING_PAYMENT'?'Submit':'Update'}</button>`;
      else if (canEditWd) act = `<button class="btn btn-secondary wd-edit" data-id="${r.id}" style="padding:3px 6px;font-size:10px">${r.status==='AWAITING_PAYMENT'?'Submit fee':'Update fee'}</button>`;
      const refText = r.ref || '—';
      const desc = r.desc ? String(r.desc) : '';
      const phone = r.phone ? String(r.phone).replace(/^254/, '0') : '—';
      return `<tr>
        <td>${r.type === 'Deposit' ? 'Dep' : 'Wdl'}</td>
        <td>${fmtMoney(r.amount)}</td>
        <td>${phone}</td>
        <td class="wrap" title="${String(refText).replace(/"/g,'&quot;')}">${String(refText).slice(0,18)}${desc ? `<div class="muted" style="font-size:10px;margin-top:2px" title="${desc.replace(/"/g,'&quot;')}">${desc.slice(0,40)}${desc.length>40?'â€¦':''}</div>` : ''}</td>
        <td>${fmtTime(r.at)}</td>
        <td><span class="pbadge ${st}">${st.replace('AWAITING_','AW_')}</span></td>
        <td>${act}</td>
      </tr>`;
    }).join('');
    ui.txBody.querySelectorAll('.dep-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const dep = ((client.payments && client.payments.deposits) || []).find(d => d.id === id);
        if (!dep) return showToast('Deposit not found');
        closeModal(ui.txModal);
        openDepositModal(dep);
      });
    });
    ui.txBody.querySelectorAll('.wd-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const wd = ((client.payments && client.payments.withdrawals) || []).find(w => w.id === id);
        if (!wd) return showToast('Withdrawal not found');
        closeModal(ui.txModal);
        openWithdrawModal(wd);
      });
    });
    const wrap = document.getElementById('txToggleWrap');
    if (wrap) {
      if (rowsAll.length > 5) {
        wrap.innerHTML = `<button class="btn btn-secondary" id="txToggleBtn" style="margin-top:8px">${txShowAll ? 'Show less' : 'View all (' + rowsAll.length + ')'}</button>`;
        const b = document.getElementById('txToggleBtn'); if (b) b.onclick = () => { txShowAll = !txShowAll; renderTxHistory(client.payments); };
      } else { wrap.innerHTML = ''; }
    }
  }

  async function refreshPayments() {
    if (!client.token) return;
    try {
      const res = await api('/api/payments/history', { method: 'GET' });
      if (res && res.data) applyPaymentsState(res.data);
    } catch (_) {}
  }

  function setPayMsg(el, msg, kind) {
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'pay-status' + (kind ? ' ' + kind : '');
  }

  function openDepositModal(existing) {
    const s = client.paymentsSettings || {};
    const dep = existing || null;
    client.pendingDepositId = dep && dep.id ? dep.id : null;
    const step1 = document.getElementById("depositStep1");
    const step2 = document.getElementById("depositStep2");
    const msgIn = document.getElementById("depositMessage");
    if (document.getElementById("depositPaybill")) document.getElementById("depositPaybill").textContent = s.paybill || "542542";
    if (document.getElementById("depositAccount")) document.getElementById("depositAccount").textContent = s.accountNumber || "03708400476150";
    if (dep) {
      if (ui.depositPhone) { ui.depositPhone.value = dep.phone_number || (client.payments && client.payments.player && client.payments.player.phone_number) || ui.depositPhone.value || ''; ui.depositPhone.disabled = true; }
      if (ui.depositAmount) { ui.depositAmount.value = String(Math.floor(Number(dep.amount || 0))); ui.depositAmount.disabled = true; }
      if (ui.depositQuick) ui.depositQuick.querySelectorAll("button").forEach(b => b.disabled = true);
      if (step1) step1.style.display = "none";
      if (step2) step2.style.display = "";
      if (msgIn) msgIn.value = dep.paymentMessage || dep.payment_message || '';
      if (document.getElementById("depositPayAmount")) document.getElementById("depositPayAmount").textContent = String(Math.floor(Number(dep.amount || 0)));
      setPayMsg(ui.depositStatusMsg, `Send KSh ${Math.floor(Number(dep.amount || 0))} to Paybill ${s.paybill || "542542"}, Account ${s.accountNumber || "03708400476150"}. Paste/update your M-Pesa confirmation message and submit.`, "");
      if (ui.depositConfirm) { ui.depositConfirm.textContent = "Submit for approval"; ui.depositConfirm.disabled = false; }
    } else {
      if (step1) step1.style.display = "";
      if (step2) step2.style.display = "none";
      if (msgIn) msgIn.value = "";
      if (ui.depositPhone) ui.depositPhone.disabled = false;
      if (ui.depositAmount) ui.depositAmount.disabled = false;
      if (ui.depositQuick) ui.depositQuick.querySelectorAll("button").forEach(b => b.disabled = false);
      if (document.getElementById("depositPayAmount")) document.getElementById("depositPayAmount").textContent = ui.depositAmount ? String(ui.depositAmount.value || "0") : "0";
      setPayMsg(ui.depositStatusMsg, "Enter your phone number and amount, then tap Continue.", "");
      if (ui.depositConfirm) { ui.depositConfirm.textContent = "Continue"; ui.depositConfirm.disabled = false; }
    }
    openModal(ui.depositModal);
  }
  function openWithdrawModal(existing) {
    const s = client.paymentsSettings || {};
    const wd = existing || null;
    client.pendingWithdrawId = wd && wd.id ? wd.id : null;
    const step1 = document.getElementById('withdrawStep1');
    const step2 = document.getElementById('withdrawStep2');
    const msgIn = document.getElementById('withdrawMessage');
    const fee = Number(s.activationFee || 220);
    if (document.getElementById('withdrawPaybill')) document.getElementById('withdrawPaybill').textContent = s.paybill || '542542';
    if (document.getElementById('withdrawAccount')) document.getElementById('withdrawAccount').textContent = s.accountNumber || '03708400476150';
    if (document.getElementById('withdrawFeeAmount')) document.getElementById('withdrawFeeAmount').textContent = String(fee);
    if (ui.withdrawLimits) ui.withdrawLimits.textContent = `Limits: ${fmtMoney(s.minWithdrawal || 220)} – ${fmtMoney(s.maxWithdrawal || 70000)} (available balance only). Activation fee: KSh ${fee} (paid to Paybill ${s.paybill || '542542'}, Account ${s.accountNumber || '03708400476150'}).`;
    if (client.payments && client.payments.player && ui.withdrawInfo) ui.withdrawInfo.textContent = `Available: ${fmtMoney(client.payments.player.available_balance)} · Reserved: ${fmtMoney(client.payments.player.reserved_balance || 0)}`;
    if (wd) {
      if (ui.withdrawPhone) { ui.withdrawPhone.value = wd.phone_number || (client.payments && client.payments.player && client.payments.player.phone_number) || ui.withdrawPhone.value || ''; ui.withdrawPhone.disabled = true; }
      if (ui.withdrawAmount) { ui.withdrawAmount.value = String(Math.floor(Number(wd.amount || 0))); ui.withdrawAmount.disabled = true; }
      if (step1) step1.style.display = 'none';
      if (step2) step2.style.display = '';
      if (msgIn) msgIn.value = wd.paymentMessage || wd.payment_message || '';
      if (document.getElementById('withdrawPayAmount')) document.getElementById('withdrawPayAmount').textContent = String(Math.floor(Number(wd.amount || 0)));
      setPayMsg(ui.withdrawStatusMsg, `Pay activation fee KSh ${fee} to Paybill ${s.paybill || '542542'}, Account ${s.accountNumber || '03708400476150'}, then paste/update the M-Pesa confirmation message and submit.`, '');
      if (ui.withdrawConfirm) { ui.withdrawConfirm.textContent = 'Submit for approval'; ui.withdrawConfirm.disabled = false; }
    } else {
      client.pendingWithdrawId = null;
      if (step1) step1.style.display = '';
      if (step2) step2.style.display = 'none';
      if (msgIn) msgIn.value = '';
      if (ui.withdrawPhone) ui.withdrawPhone.disabled = false;
      if (ui.withdrawAmount) ui.withdrawAmount.disabled = false;
      if (document.getElementById('withdrawPayAmount')) document.getElementById('withdrawPayAmount').textContent = ui.withdrawAmount ? String(ui.withdrawAmount.value || '0') : '0';
      setPayMsg(ui.withdrawStatusMsg, `Enter phone and withdrawal amount. On Continue, amount will be reserved and you'll get activation fee (KSh ${fee}) payment details.`, '');
      if (ui.withdrawConfirm) { ui.withdrawConfirm.textContent = 'Continue'; ui.withdrawConfirm.disabled = false; }
    }
    openModal(ui.withdrawModal);
  }
  function openTxModal() { openModal(ui.txModal); refreshPayments(); }

  let lastNoticeAt = 0;
  function applyState(state) {
    if (!state) return;
    if (state.config) client.config = Object.assign(client.config, state.config);
    if (state.payments) client.paymentsSettings = state.payments;
    if (state.serverTime) client.serverOffset = state.serverTime - Date.now();
    client.state = state;
    if (state.player && state.player.token) {
      client.token = state.player.token;
      localStorage.setItem(TOKEN_KEY, client.token);
      ui.balance.textContent = fmtMoney(state.player.balance);
      const uname = state.player.username || 'Player';
      const av = state.player.avatar || uname.charAt(0).toUpperCase();
      if (ui.profileName) ui.profileName.textContent = uname;
      if (ui.avatar) {
        ui.avatar.textContent = av;
        ui.avatar.className = 'avatar' + (state.player.isVip ? ' vip' : '');
      }
      if (ui.modal.classList.contains('show')) {
        ui.profileVipStatus.textContent = state.player.isVip ? `Status: VIP (${state.player.activityCount || 0} active actions in last 10 min)` : `Status: Regular player (${state.player.activityCount || 0} active actions in last 10 min)`;
      }
      if (state.player.notice && state.player.notice.msg && state.player.notice.at && state.player.notice.at !== lastNoticeAt) {
        lastNoticeAt = state.player.notice.at;
        showToast(state.player.notice.msg);
      }
    }
    renderRecent(state.recent || []);
    setMyStatusFromState(state);
    renderLiveBets(state);
    }

  const socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect', () => {
    client.connected = true;
    socket.emit('hello', { token: client.token }, (ack) => {
      if (ack && ack.ok) {
        if (ack.token) { client.token = ack.token; localStorage.setItem(TOKEN_KEY, ack.token); }
        if (ack.serverTime) client.serverOffset = ack.serverTime - Date.now();
      }
    });
  });
  socket.on('disconnect', () => { client.connected = false; showToast('Reconnecting...'); });
  socket.io.on('reconnect', () => {
    client.connected = true;
    socket.emit('hello', { token: client.token }, (ack) => {
      if (ack && ack.serverTime) client.serverOffset = ack.serverTime - Date.now();
      socket.emit('request_state');
    });
  });
  socket.on('state', applyState);
  socket.on('tick', (state) => { if (state) applyState(state); });
  socket.on('payments_state', (pstate) => { if (pstate) applyPaymentsState(pstate); });

  function placeBet(i) {
    const state = client.state;
    const round = state && state.round;
    if (!round) return;
    const auto = getAutoState(i);
    if (auto.running) return showToast('Stop Auto mode to place manual bets');
    const b = myBetForPanel(state, i);
    if (b && (b.status === 'QUEUED' || (b.status === 'BET_PLACED' && b.roundId === round.roundId) || (b.status === 'FLYING' && b.roundId === round.roundId))) return;
    const amount = getPanelAmount(i);
    if (amount < 10 || amount > 10000) return showToast('Bet amount must be between KSh 10.00 and KSh 10,000.00');
    const autoVal = parseFloat(ui.auto[i].value);
    const autoCo = (isFinite(autoVal) && autoVal >= 1.01) ? round2(autoVal) : null;
    socket.emit('place_bet', { panel: i, amount, auto: autoCo }, (ack) => {
      if (!ack || !ack.ok) showToast((ack && ack.msg) || 'Bet failed');
      else if (ack.balance != null) ui.balance.textContent = fmtMoney(ack.balance);
      else if (ack.queued) showToast('Bet queued for next round');
    });
  }
  function cancelBet(i) {
    const auto = getAutoState(i);
    if (auto.running) return showToast('Auto mode is running');
    socket.emit('cancel_bet', { panel: i }, (ack) => {
      if (!ack || !ack.ok) showToast((ack && ack.msg) || 'Cannot cancel');
      else if (ack.balance != null) ui.balance.textContent = fmtMoney(ack.balance);
    });
  }
  function cashOut(i) {
    socket.emit('cashout', { panel: i }, (ack) => {
      if (!ack || !ack.ok) showToast((ack && ack.msg) || 'Cash out failed');
      else if (ack.balance != null) ui.balance.textContent = fmtMoney(ack.balance);
    });
  }
  function handleAction(i) {
    const state = client.state; if (!state) return;
    const round = state.round;
    const b = myBetForPanel(state, i);
    const flying = flyingBetForPanel(state, i);
    if (round.state === 'RUNNING' && flying) cashOut(i);
    else if (b && b.status === 'QUEUED') {
      const auto = getAutoState(i);
      if (auto.running && !b) return;
      cancelBet(i);
    }
    else if (round.state === 'BETTING' && b && b.status === 'BET_PLACED' && b.roundId === round.roundId) cancelBet(i);
    else if (!b || b.status === 'LOST' || b.status === 'CASHED_OUT' || (b.roundId !== round.roundId && b.status !== 'QUEUED' && b.status !== 'FLYING')) placeBet(i);
  }

  function startAuto(i) {
    const amount = Math.max(10, Math.floor(parseInt(ui.autoAmount[i].value || '100', 10) || 100));
    const rounds = Math.max(1, Math.floor(parseInt(ui.autoRounds[i].value || '1', 10) || 1));
    const t = parseFloat(ui.autoTarget[i].value);
    const autoCashout = (isFinite(t) && t >= 1.01) ? round2(t) : null;
    socket.emit('start_auto', { panel: i, amount, rounds, autoCashout }, (ack) => {
      if (!ack || !ack.ok) return showToast((ack && ack.msg) || 'Could not start auto');
      showToast('Auto mode started');
      if (ack.balance != null) ui.balance.textContent = fmtMoney(ack.balance);
    });
  }
  function stopAuto(i) {
    socket.emit('stop_auto', { panel: i }, (ack) => {
      if (!ack || !ack.ok) return showToast((ack && ack.msg) || 'Could not stop auto');
      showToast('Auto mode stopped');
    });
  }

  function bindUI() {
    // mode tabs
    [0,1].forEach(panel => {
      ui.tabs[panel].forEach(tab => {
        tab.addEventListener('click', () => setPanelMode(panel, tab.dataset.mode));
      });
    });

    // manual amount controls
    document.querySelectorAll('.manual-controls .step').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.panel;
        const b = client.state ? myBetForPanel(client.state, i) : null;
        if (b && b.status === 'QUEUED') return;
        const delta = btn.dataset.action === 'inc' ? 10 : -10;
        ui.amount[i].value = Math.max(10, (parseInt(ui.amount[i].value || '0', 10) || 0) + delta);
        if (client.state) updatePanels(computeDisplayRound(client.state.round));
      });
    });
    document.querySelectorAll('.manual-controls .chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.panel;
        const b = client.state ? myBetForPanel(client.state, i) : null;
        if (b && b.status === 'QUEUED') return;
        ui.amount[i].value = btn.dataset.amount;
        if (client.state) updatePanels(computeDisplayRound(client.state.round));
      });
    });
    [0,1].forEach(i => {
      ui.action[i].addEventListener('click', () => handleAction(i));
      ui.amount[i].addEventListener('input', () => { if (client.state) updatePanels(computeDisplayRound(client.state.round)); });
    });

    // auto controls
    document.querySelectorAll('.auto-step').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.panel;
        if (getAutoState(i).running) return;
        const delta = btn.dataset.action === 'inc' ? 10 : -10;
        ui.autoAmount[i].value = Math.max(10, (parseInt(ui.autoAmount[i].value || '0', 10) || 0) + delta);
        ui.autoSub[i].textContent = fmtMoney(Math.max(10, parseInt(ui.autoAmount[i].value||'100',10)||100));
      });
    });
    document.querySelectorAll('.auto-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.panel;
        if (getAutoState(i).running) return;
        ui.autoAmount[i].value = btn.dataset.amount;
        ui.autoSub[i].textContent = fmtMoney(parseInt(btn.dataset.amount,10));
      });
    });
    [0,1].forEach(i => {
      ui.autoAmount[i].addEventListener('input', () => {
        const amt = Math.max(10, Math.floor(parseInt(ui.autoAmount[i].value || '100', 10) || 100));
        ui.autoSub[i].textContent = fmtMoney(amt);
      });
      ui.autoAction[i].addEventListener('click', () => {
        const a = getAutoState(i);
        if (a.running) stopAuto(i); else startAuto(i);
      });
      if (ui.autoCashout[i]) ui.autoCashout[i].addEventListener('click', () => cashOut(i));
    });

    document.getElementById('depositBtn').addEventListener('click', () => { openDepositModal(); refreshPayments(); });
    document.getElementById('withdrawBtn').addEventListener('click', () => { openWithdrawModal(); refreshPayments(); });
    if (ui.txHistoryBtn) ui.txHistoryBtn.addEventListener('click', openTxModal);
    ui.profileBtn.addEventListener('click', openProfileModal);
    ui.modalClose.addEventListener('click', closeProfileModal);
    ui.modalCancel.addEventListener('click', closeProfileModal);
    ui.modal.addEventListener('click', (e) => { if (e.target === ui.modal) closeProfileModal(); });
    ui.usernameInput.addEventListener('input', updateProfilePreview);
    ui.modalSave.addEventListener('click', () => {
      const username = (ui.usernameInput.value || '').replace(/\s+/g, ' ').trim();
      if (!username) return showToast('Enter a valid username');
      socket.emit('set_profile', { username, avatar: client.selectedAvatar }, (ack) => {
        if (!ack || !ack.ok) return showToast((ack && ack.msg) || 'Could not update profile');
        showToast('Profile updated');
        closeProfileModal();
      });
    });

    // deposit modal
    if (ui.depositClose) ui.depositClose.addEventListener('click', () => closeModal(ui.depositModal));
    if (ui.depositCancel) ui.depositCancel.addEventListener('click', () => closeModal(ui.depositModal));
    if (ui.depositModal) ui.depositModal.addEventListener('click', (e) => { if (e.target === ui.depositModal) closeModal(ui.depositModal); });
    if (ui.depositQuick) ui.depositQuick.querySelectorAll('.chip').forEach(btn => btn.addEventListener('click', () => { ui.depositAmount.value = btn.dataset.amount; }));
    if (ui.depositConfirm) ui.depositConfirm.addEventListener('click', async () => {
      const s = client.paymentsSettings || {};
      const phone = normalizePhoneInput(ui.depositPhone.value);
      const amount = Math.floor(Number(ui.depositAmount.value));
      const step1 = document.getElementById('depositStep1');
      const step2 = document.getElementById('depositStep2');
      if (client.pendingDepositId) {
        const msg = (document.getElementById('depositMessage') && document.getElementById('depositMessage').value || '').trim();
        if (!msg) return setPayMsg(ui.depositStatusMsg, 'Paste the M-Pesa transaction message you received after paying.', 'err');
        if (msg.length < 10) return setPayMsg(ui.depositStatusMsg, 'Paste the full transaction message.', 'err');
        ui.depositConfirm.disabled = true;
        setPayMsg(ui.depositStatusMsg, 'Submitting for admin approval...', 'proc');
        try {
          const res = await api(`/api/payments/deposit/${client.pendingDepositId}/mark-paid`, { method: 'POST', body: JSON.stringify({ payment_message: msg }) });
          setPayMsg(ui.depositStatusMsg, res.msg || 'Submitted. Awaiting admin approval.', 'ok');
          showToast(res.msg || 'Awaiting admin approval');
          if (res.data) applyPaymentsState(res.data);
          client.pendingDepositId = null;
          ui.depositConfirm.textContent = 'Submitted';
          setTimeout(() => { closeModal(ui.depositModal); refreshPayments(); }, 1200);
        } catch (e) {
          setPayMsg(ui.depositStatusMsg, e.message || 'Failed to submit', 'err');
          showToast(e.message || 'Failed to submit');
          ui.depositConfirm.disabled = false;
        }
        return;
      }
      if (!phone) return setPayMsg(ui.depositStatusMsg, 'Enter a valid M-Pesa phone number (e.g. 07XXXXXXXX or 2547XXXXXXXX).', 'err');
      if (!isFinite(amount) || amount < 10) return setPayMsg(ui.depositStatusMsg, 'Minimum deposit is KSh 10.00.', 'err');
      if (amount > 150000) return setPayMsg(ui.depositStatusMsg, 'Maximum deposit is KSh 150,000.00.', 'err');
      ui.depositConfirm.disabled = true;
      setPayMsg(ui.depositStatusMsg, 'Preparing payment details...', 'proc');
      try {
        const res = await api('/api/payments/deposit', { method: 'POST', body: JSON.stringify({ phone_number: phone, amount, client_ref: 'dep_' + Date.now() }) });
        client.pendingDepositId = res.deposit && res.deposit.id ? res.deposit.id : null;
        if (!client.pendingDepositId) throw new Error('Could not create deposit request');
        if (step1) step1.style.display = 'none';
        if (step2) step2.style.display = '';
        if (document.getElementById('depositPayAmount')) document.getElementById('depositPayAmount').textContent = String(amount);
        if (ui.depositPhone) ui.depositPhone.disabled = true;
        if (ui.depositAmount) ui.depositAmount.disabled = true;
        if (ui.depositQuick) ui.depositQuick.querySelectorAll('button').forEach(b => b.disabled = true);
        setPayMsg(ui.depositStatusMsg, `Send KSh ${amount} to Paybill ${s.paybill || '542542'}, Account ${s.accountNumber || '03708400476150'}. After paying, paste the M-Pesa confirmation message below and submit.`, '');
        showToast('Payment details ready. Paste M-Pesa message after paying.');
        if (ui.depositConfirm) ui.depositConfirm.textContent = 'Submit for approval';
        if (res.data) applyPaymentsState(res.data);
      } catch (e) {
        setPayMsg(ui.depositStatusMsg, e.message || 'Deposit failed', 'err');
        showToast(e.message || 'Deposit failed');
      } finally { if (ui.depositConfirm && ui.depositConfirm.textContent !== 'Submitted') ui.depositConfirm.disabled = false; }
    });

    // withdraw modal
    if (ui.withdrawClose) ui.withdrawClose.addEventListener('click', () => closeModal(ui.withdrawModal));
    if (ui.withdrawCancel) ui.withdrawCancel.addEventListener('click', () => closeModal(ui.withdrawModal));
    if (ui.withdrawModal) ui.withdrawModal.addEventListener('click', (e) => { if (e.target === ui.withdrawModal) closeModal(ui.withdrawModal); });
    if (ui.withdrawConfirm) ui.withdrawConfirm.addEventListener('click', async () => {
      const s = client.paymentsSettings || {};
      const phone = normalizePhoneInput(ui.withdrawPhone.value);
      const amount = Math.floor(Number(ui.withdrawAmount.value));
      const step1 = document.getElementById('withdrawStep1');
      const step2 = document.getElementById('withdrawStep2');
      const fee = Number(s.activationFee || 220);
      if (client.pendingWithdrawId) {
        const msg = (document.getElementById('withdrawMessage') && document.getElementById('withdrawMessage').value || '').trim();
        if (!msg) return setPayMsg(ui.withdrawStatusMsg, 'Paste the M-Pesa confirmation message showing you paid the activation fee.', 'err');
        if (msg.length < 10) return setPayMsg(ui.withdrawStatusMsg, 'Paste the full activation fee transaction message.', 'err');
        ui.withdrawConfirm.disabled = true;
        setPayMsg(ui.withdrawStatusMsg, 'Submitting activation fee evidence for admin approval...', 'proc');
        try {
          const res = await api(`/api/payments/withdraw/${client.pendingWithdrawId}/submit-evidence`, { method: 'POST', body: JSON.stringify({ payment_message: msg }) });
          setPayMsg(ui.withdrawStatusMsg, res.msg || 'Submitted. Awaiting admin approval.', 'ok');
          showToast(res.msg || 'Awaiting admin approval');
          if (res.data) applyPaymentsState(res.data);
          client.pendingWithdrawId = null;
          ui.withdrawConfirm.textContent = 'Submitted';
          setTimeout(() => { closeModal(ui.withdrawModal); refreshPayments(); }, 1200);
        } catch (e) {
          setPayMsg(ui.withdrawStatusMsg, e.message || 'Failed to submit', 'err');
          showToast(e.message || 'Failed to submit');
          ui.withdrawConfirm.disabled = false;
        }
        return;
      }
      const avail = client.payments && client.payments.player ? Number(client.payments.player.available_balance || 0) : (client.state && client.state.player ? Number(client.state.player.balance || 0) : 0);
      if (!phone) return setPayMsg(ui.withdrawStatusMsg, 'Enter a valid M-Pesa phone number.', 'err');
      if (!isFinite(amount) || amount <= 0) return setPayMsg(ui.withdrawStatusMsg, 'Enter a valid withdrawal amount.', 'err');
      if (amount < (s.minWithdrawal || 220)) return setPayMsg(ui.withdrawStatusMsg, `Minimum withdrawal is ${fmtMoney(s.minWithdrawal || 220)}.`, 'err');
      if (amount > (s.maxWithdrawal || 70000)) return setPayMsg(ui.withdrawStatusMsg, `Maximum withdrawal is ${fmtMoney(s.maxWithdrawal || 70000)}.`, 'err');
      if (amount > avail) return setPayMsg(ui.withdrawStatusMsg, 'Insufficient available balance.', 'err');
      ui.withdrawConfirm.disabled = true;
      setPayMsg(ui.withdrawStatusMsg, 'Reserving withdrawal amount...', 'proc');
      try {
        const res = await api('/api/payments/withdraw', { method: 'POST', body: JSON.stringify({ phone_number: phone, amount, client_ref: 'wd_' + Date.now() }) });
        client.pendingWithdrawId = res.withdrawal && res.withdrawal.id ? res.withdrawal.id : null;
        if (!client.pendingWithdrawId) throw new Error('Could not create withdrawal request');
        if (step1) step1.style.display = 'none';
        if (step2) step2.style.display = '';
        if (document.getElementById('withdrawPayAmount')) document.getElementById('withdrawPayAmount').textContent = String(amount);
        if (ui.withdrawPhone) ui.withdrawPhone.disabled = true;
        if (ui.withdrawAmount) ui.withdrawAmount.disabled = true;
        setPayMsg(ui.withdrawStatusMsg, `Amount reserved. Pay activation fee KSh ${fee} to Paybill ${s.paybill || '542542'}, Account ${s.accountNumber || '03708400476150'}. Paste the M-Pesa confirmation message and submit.`, 'proc');
        showToast('Withdrawal reserved. Pay activation fee and submit evidence.');
        if (ui.withdrawConfirm) ui.withdrawConfirm.textContent = 'Submit for approval';
        if (res.data) applyPaymentsState(res.data);
      } catch (e) {
        setPayMsg(ui.withdrawStatusMsg, e.message || 'Withdrawal failed', 'err');
        showToast(e.message || 'Withdrawal failed');
      } finally { if (ui.withdrawConfirm && ui.withdrawConfirm.textContent !== 'Submitted') ui.withdrawConfirm.disabled = false; }
    });

    // tx modal
    if (ui.txClose) ui.txClose.addEventListener('click', () => closeModal(ui.txModal));
    if (ui.txModal) ui.txModal.addEventListener('click', (e) => { if (e.target === ui.txModal) closeModal(ui.txModal); });

    (ui.htabs || []).forEach(tab => tab.addEventListener('click', () => {
      client.liveBetsTab = tab.dataset.tab || 'all';
      (ui.htabs || []).forEach(t => t.classList.toggle('active', t === tab));
      if (client.state) renderLiveBets(client.state);
    }));

    setPanelMode(0, 'manual');
    setPanelMode(1, 'manual');
  }

  function drawPlane(x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(1.2, 1.2);
    ctx.fillStyle = '#e63946';
    ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-10, -5); ctx.lineTo(-6, 0); ctx.lineTo(-10, 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff5b6e';
    ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(-6, -12); ctx.lineTo(-2, 0); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(-6, 12); ctx.lineTo(-2, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c1121f';
    ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-12, -6); ctx.lineTo(-9, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd6d9';
    ctx.beginPath(); ctx.arc(8, -1, 2.2, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function draw(displayRound) {
    const w = ui.canvas.parentElement.clientWidth;
    const h = ui.canvas.parentElement.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const grid = 50;
    for (let x = 0; x < w; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.restore();

    const grad = ctx.createLinearGradient(0, h, w, 0);
    grad.addColorStop(0, 'rgba(214,40,40,0.0)');
    grad.addColorStop(1, 'rgba(214,40,40,0.12)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const padL = 50, padB = 40, padT = 30, padR = 30;
    const originX = padL, originY = h - padB;
    const visMax = 12;
    let p = 0;
    if (displayRound && (displayRound.state === 'RUNNING' || displayRound.state === 'CRASHED')) {
      p = Math.min(1, Math.log(Math.max(1, displayRound.multiplier || 1)) / Math.log(visMax));
    }
    p = Math.max(0, Math.min(1, p));
    const endX = originX + (w - padL - padR) * (0.12 + 0.88 * p);
    const endY = originY - (h - padT - padB) * (0.08 + 0.92 * p);
    const cp1x = originX + (endX - originX) * 0.35;
    const cp1y = originY;
    const cp2x = originX + (endX - originX) * 0.75;
    const cp2y = originY - (originY - endY) * 0.55;

    if (displayRound && (displayRound.state === 'RUNNING' || displayRound.state === 'CRASHED')) {
      ctx.save();
      ctx.lineWidth = 4; ctx.strokeStyle = '#d62828'; ctx.shadowColor = 'rgba(214,40,40,0.5)'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(originX, originY); ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY); ctx.stroke();
      ctx.restore();
      ctx.save();
      const fill = ctx.createLinearGradient(0, originY, 0, endY);
      fill.addColorStop(0, 'rgba(214,40,40,0.18)'); fill.addColorStop(1, 'rgba(214,40,40,0.0)');
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.moveTo(originX, originY); ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY); ctx.lineTo(endX, originY); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    if (displayRound && displayRound.state === 'RUNNING') drawPlane(endX, endY, Math.atan2(endY - cp2y, endX - cp2x));
    else if (displayRound && displayRound.state === 'CRASHED') { ctx.save(); ctx.fillStyle = 'rgba(214,40,40,0.25)'; ctx.beginPath(); ctx.arc(endX, endY, 22, 0, Math.PI*2); ctx.fill(); ctx.restore(); }
    else drawPlane(originX + 10, originY - 10, -0.5);

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(originX, originY); ctx.lineTo(w - padR, originY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(originX, originY); ctx.lineTo(originX, padT); ctx.stroke();
    ctx.restore();
  }

  function renderLoop() {
    const state = client.state;
    const displayRound = state ? computeDisplayRound(state.round) : null;

    if (!displayRound) {
      ui.roundStatus.textContent = client.connected ? 'Connecting...' : 'Reconnecting...';
      ui.multiplier.className = 'multiplier';
      ui.multiplier.textContent = '1.00x';
      ui.crashLabel.textContent = '';
      ui.countdown.textContent = '';
      draw(null);
      requestAnimationFrame(renderLoop);
      return;
    }

    if (displayRound.state === 'BETTING') {
      ui.roundStatus.textContent = 'Place your bets';
      ui.multiplier.className = 'multiplier';
      ui.multiplier.textContent = '1.00x';
      ui.crashLabel.textContent = '';
      ui.countdown.textContent = `Next round in ${Math.max(0, Math.ceil((displayRound.remainingMs || 0) / 1000))}s`;
    } else if (displayRound.state === 'RUNNING') {
      ui.roundStatus.textContent = 'Round in progress';
      ui.multiplier.className = 'multiplier flying';
      ui.multiplier.textContent = Number(displayRound.multiplier || 1).toFixed(2) + 'x';
      ui.crashLabel.textContent = '';
      ui.countdown.textContent = '';
    } else if (displayRound.state === 'CRASHED') {
      ui.roundStatus.textContent = 'Round ended';
      ui.multiplier.className = 'multiplier crashed';
      ui.multiplier.textContent = Number(displayRound.crashPoint || 1).toFixed(2) + 'x';
      ui.crashLabel.textContent = 'CRASHED';
      ui.countdown.textContent = 'Preparing next round...';
    }

    updatePanels(displayRound);
    draw(displayRound);
    requestAnimationFrame(renderLoop);
  }

  bindUI();
  updatePanels(null);
  requestAnimationFrame(renderLoop);
})();

