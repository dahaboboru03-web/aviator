const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const paymentsConfig = require('./payments/config');
const daraja = require('./payments/daraja');
const payStore = require('./payments/store');
const payDb = require('./payments/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '84798479';
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const CONFIG = {
  bettingMs: 5000,
  crashedMs: 3000,
  growthRate: 0.06,
  startBalance: 200,
  vipWindowMs: 10 * 60 * 1000,
  vipThreshold: 5
};

const AVATARS = ['😀','😃','😄','😁','😆','😊','🙂','😉','😎','🤠','🥳','🤩','😇','😏','😋','😜','🤓','🧐','🥸','😺','😸','😼','🙃','😌'];

const NAMES = [
  'Nelson','Elosy','Brian','Kevin','Sharon','Faith','Mercy','Daniel','Victor','James',
  'Esther','Lilian','Hannah','Ruth','Joy','Peter','Michael','Grace','Allan','Tina',
  'Mary','Samuel','Caroline','Dennis','Ann','Beatrice','David','Eunice','Joseph','Lucy',
  'Alex','Alice','Andrew','Angela','Anthony','Ashley','Barbara','Ben','Betty','Brenda',
  'Caleb','Catherine','Charles','Chris','Cynthia','Diana','Donald','Donna','Dorothy','Dylan',
  'Edward','Elizabeth','Emily','Eric','Eva','Felix','Fiona','Frank','George','Gloria',
  'Helen','Henry','Ian','Irene','Isaac','Ivy','Jack','Jacob','Jane','Janet',
  'Jason','Jennifer','Jerry','Jessica','Joan','John','Jonathan','Jordan','Judith','Judy',
  'Julia','Justin','Karen','Kenneth','Kimberly','Larry','Laura','Leo','Linda','Lisa',
  'Mark','Margaret','Martin','Megan','Michelle','Moses','Nancy','Naomi','Nathan','Nicole',
  'Noah','Oliver','Olivia','Oscar','Pamela','Patrick','Paul','Philip','Rachel','Rebecca',
  'Richard','Robert','Rose','Ryan','Sandra','Sarah','Scott','Simon','Sophia','Stephen',
  'Susan','Teresa','Thomas','Timothy','Tracy','Vincent','Walter','Wendy','William','Zoe'
];

function now() { return Date.now(); }
function round2(n) { return Math.floor(n * 100) / 100; }
function clampMoney(n) { return Math.round(n * 100) / 100; }
function uid(prefix='id') { return prefix + '_' + Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

function multiplierAt(elapsedMs) {
  const t = Math.max(0, elapsedMs) / 1000;
  return round2(Math.exp(CONFIG.growthRate * t));
}

function generateCrashPoint() {
  const r = Math.random();
  let crash;
  if (r < 0.55) crash = 1.1 + Math.random() * 1.2;
  else if (r < 0.8) crash = 2.3 + Math.random() * 2.7;
  else if (r < 0.95) crash = 5 + Math.random() * 7;
  else crash = 12 + Math.random() * 38;
  return round2(crash);
}

function betAmountSample() {
  const pool = [50,50,100,100,100,200,200,300,500,500,1000,2000];
  return pool[Math.floor(Math.random() * pool.length)];
}

function targetCashout(crashPoint) {
  const r = Math.random();
  let target;
  if (r < 0.45) target = 1.15 + Math.random() * 0.85;
  else if (r < 0.75) target = 2.0 + Math.random() * 2.0;
  else target = 4.0 + Math.random() * 10.0;
  if (target > crashPoint - 0.02) return null;
  return Math.max(1.01, round2(target));
}

function ensureDataDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }

function loadState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}

let persistTimer = null;
function persist(immediate=false) {
  const write = () => {
    persistTimer = null;
    ensureDataDir();
    const data = {
      version: 1,
      savedAt: now(),
      roundSeq: game.roundSeq,
      round: game.round,
      recent: game.recent,
      completedRounds: game.completedRounds.slice(-50),
      players: game.players,
      transactions: game.transactions.slice(-500),
      queuedBets: game.queuedBets,
      deposits: (game.deposits || []).slice(-2000),
      withdrawals: (game.withdrawals || []).slice(-2000),
      walletLedger: (game.walletLedger || []).slice(-3000),
      adminActions: (game.adminActions || []).slice(-1000),
      paymentSettings: game.paymentSettings || null,
      upcomingCrashes: (game.upcomingCrashes || []).slice(0, 10)
    };
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(data)); } catch (e) { console.error('persist failed', e.message); }
    try { payDb.syncAll(game); } catch (e) { console.error('db sync failed', e.message); }
  };
  if (immediate) { if (persistTimer) clearTimeout(persistTimer); write(); }
  else if (!persistTimer) { persistTimer = setTimeout(write, 250); }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createSimBets(roundId, crashPoint) {
  const pool = shuffle(NAMES);
  const count = Math.min(pool.length, 18 + Math.floor(Math.random() * 23)); // 18-40 players per round
  const bets = [];
  const t = now();
  for (let i = 0; i < count; i++) {
    const name = pool[i];
    const sp = getSimPlayer(name);
    recordActivity(sp, t, false);
    bets.push({
      id: `${roundId}-s-${i}`,
      roundId,
      owner: null,
      panel: null,
      name,
      simulated: true,
      amount: betAmountSample(),
      status: 'BET_PLACED',
      cashoutAt: null,
      win: null,
      auto: targetCashout(crashPoint),
      payoutDone: false
    });
  }
  return bets;
}

function formatRoundId(seq) { return 'R' + String(seq).padStart(8, '0'); }
function nextRoundId() { return formatRoundId(game.roundSeq + 1); }

function ensureUpcomingCrashes(n = 4) {
  if (!Array.isArray(game.upcomingCrashes)) game.upcomingCrashes = [];
  while (game.upcomingCrashes.length < n) game.upcomingCrashes.push(generateCrashPoint());
  if (game.upcomingCrashes.length > n) game.upcomingCrashes = game.upcomingCrashes.slice(0, n);
}

function newRound(roundSeq) {
  const roundId = formatRoundId(roundSeq);
  ensureUpcomingCrashes(4);
  const crashPoint = game.upcomingCrashes.length ? round2(game.upcomingCrashes.shift()) : generateCrashPoint();
  ensureUpcomingCrashes(4);
  const bettingEndsAt = now() + CONFIG.bettingMs;
  return {
    roundId,
    state: 'BETTING',
    crashPoint,
    bettingEndsAt,
    startedAt: 0,
    crashedAt: 0,
    nextAt: 0,
    completed: false,
    bets: createSimBets(roundId, crashPoint)
  };
}

const persisted = loadState();
const game = {
  roundSeq: (persisted && persisted.roundSeq) || 0,
  round: null,
  recent: (persisted && persisted.recent) || [1.34,2.10,1.08,5.62,12.30,1.75,3.41,1.19,8.04,2.66],
  completedRounds: (persisted && persisted.completedRounds) || [],
  players: (persisted && persisted.players) || {},
  transactions: (persisted && persisted.transactions) || [],
  queuedBets: Array.isArray(persisted && persisted.queuedBets) ? persisted.queuedBets : [],
  simPlayers: {},
  timer: null,
  deposits: Array.isArray(persisted && persisted.deposits) ? persisted.deposits : [],
  withdrawals: Array.isArray(persisted && persisted.withdrawals) ? persisted.withdrawals : [],
  walletLedger: Array.isArray(persisted && persisted.walletLedger) ? persisted.walletLedger : [],
  adminActions: Array.isArray(persisted && persisted.adminActions) ? persisted.adminActions : [],
  paymentSettings: (persisted && persisted.paymentSettings) || null,
  upcomingCrashes: Array.isArray(persisted && persisted.upcomingCrashes) ? persisted.upcomingCrashes.map(x => round2(Number(x))).filter(x => isFinite(x) && x >= 1.01).slice(0, 10) : []
};
if (persisted && persisted.round) game.round = persisted.round;
ensureUpcomingCrashes(4);
payStore.ensurePaymentState(game);

function sanitizeUsername(name) {
  if (typeof name !== 'string') return null;
  const cleaned = name.replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!cleaned) return null;
  return cleaned;
}

function sanitizeAvatar(av) {
  if (typeof av !== 'string') return null;
  const a = av.trim();
  if (!AVATARS.includes(a)) return null;
  return a;
}

function defaultAutoPanel() {
  return {
    running: false,
    amount: 100,
    roundsTotal: 0,
    roundsRemaining: 0,
    autoCashout: null,
    lastPlacedRoundId: null,
    lastQueuedRoundId: null,
    stopRequested: false,
    status: 'AUTO STOPPED',
    lastError: null
  };
}

function normalizeAutoPanel(a) {
  const d = defaultAutoPanel();
  const x = a && typeof a === 'object' ? a : {};
  const p = {
    running: !!x.running,
    amount: Math.max(10, Math.min(10000, Math.floor(Number(x.amount) || d.amount))),
    roundsTotal: Math.max(0, Math.floor(Number(x.roundsTotal) || 0)),
    roundsRemaining: Math.max(0, Math.floor(Number(x.roundsRemaining) || 0)),
    autoCashout: (isFinite(Number(x.autoCashout)) && Number(x.autoCashout) >= 1.01) ? round2(Number(x.autoCashout)) : null,
    lastPlacedRoundId: typeof x.lastPlacedRoundId === 'string' ? x.lastPlacedRoundId : null,
    lastQueuedRoundId: typeof x.lastQueuedRoundId === 'string' ? x.lastQueuedRoundId : null,
    stopRequested: !!x.stopRequested,
    status: typeof x.status === 'string' && x.status ? x.status : d.status,
    lastError: x.lastError || null
  };
  if (!p.running && p.roundsRemaining <= 0 && p.status !== 'INSUFFICIENT BALANCE') p.status = 'AUTO STOPPED';
  if (p.running && p.roundsRemaining <= 0) { p.running = false; p.status = 'AUTO STOPPED'; }
  return p;
}

function ensureAuto(p) {
  if (!p) return;
  if (!Array.isArray(p.auto)) p.auto = [defaultAutoPanel(), defaultAutoPanel()];
  p.auto = [normalizeAutoPanel(p.auto[0]), normalizeAutoPanel(p.auto[1])];
}

function getPlayer(token) {
  if (!token || typeof token !== 'string') return null;
  const t = token.slice(0, 80);
  if (!game.players[t]) {
    game.players[t] = {
      token: t, balance: CONFIG.startBalance, reservedBalance: 0, phoneNumber: null, createdAt: now(), lastNotice: null,
      username: 'Player', avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)], activity: [], isVip: false, vipNotified: false,
      auto: [defaultAutoPanel(), defaultAutoPanel()]
    };
    persist();
  }
  const p = game.players[t];
  if (p.lastNotice === undefined) p.lastNotice = null;
  if (!p.username) p.username = 'Player';
  if (!p.avatar || !AVATARS.includes(p.avatar)) p.avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
  if (!Array.isArray(p.activity)) p.activity = [];
  if (typeof p.isVip !== 'boolean') p.isVip = false;
  if (typeof p.vipNotified !== 'boolean') p.vipNotified = false;
  delete p.vipWindowStart;
  delete p.vipNotifiedWindow;
  if (!isFinite(Number(p.reservedBalance))) p.reservedBalance = 0;
  p.reservedBalance = clampMoney(Math.max(0, p.reservedBalance));
  if (!isFinite(Number(p.balance))) p.balance = 0;
  p.balance = clampMoney(Math.max(0, p.balance));
  if (p.phoneNumber === undefined) p.phoneNumber = null;
  ensureAuto(p);
  return p;
}

function getSimPlayer(name) {
  if (!name || typeof name !== 'string') return null;
  if (!game.simPlayers) game.simPlayers = {};
  if (!game.simPlayers[name]) {
    game.simPlayers[name] = {
      name,
      avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
      activity: [],
      isVip: false
    };
  }
  const sp = game.simPlayers[name];
  if (!sp.avatar || !AVATARS.includes(sp.avatar)) sp.avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
  if (!Array.isArray(sp.activity)) sp.activity = [];
  if (typeof sp.isVip !== 'boolean') sp.isVip = false;
  return sp;
}

function updateVipStatus(p, t = now(), notify = true) {
  if (!p) return;
  if (!Array.isArray(p.activity)) p.activity = [];
  const cutoff = t - CONFIG.vipWindowMs;
  p.activity = p.activity.filter(ts => ts > cutoff);
  const wasVip = !!p.isVip;
  p.isVip = p.activity.length >= CONFIG.vipThreshold;
  if (!p.isVip) {
    if ('vipNotified' in p) p.vipNotified = false;
  } else if (!wasVip && notify) {
    if ('vipNotified' in p && !p.vipNotified) {
      p.vipNotified = true;
      p.lastNotice = { type: 'vip', msg: 'You are now a VIP! Stay active to keep your VIP status.', at: t };
    }
  }
}

function recordActivity(p, t = now(), notify = true) {
  if (!p) return;
  updateVipStatus(p, t, notify);
  p.activity.push(t);
  updateVipStatus(p, t, notify);
}

function addTransaction(tx) {
  game.transactions.push(Object.assign({ id: uid('tx'), at: now() }, tx));
  if (game.transactions.length > 1000) game.transactions = game.transactions.slice(-500);
}

function clearTimer() { if (game.timer) { clearTimeout(game.timer); game.timer = null; } }

function displayBetName(bet) {
  if (bet && bet.owner && !bet.simulated) {
    const p = game.players[bet.owner];
    return (p && p.username) ? p.username : 'Player';
  }
  return bet ? bet.name : 'Player';
}

function visibleBetsFor(token) {
  const r = game.round;
  const bets = r.bets.map(b => {
    const owner = b.owner && !b.simulated ? game.players[b.owner] : null;
    const sim = b.simulated ? getSimPlayer(b.name) : null;
    const profile = owner || sim;
    return {
      id: b.id,
      roundId: b.roundId,
      name: displayBetName(b),
      simulated: !!b.simulated,
      isMine: !!(token && b.owner === token),
      panel: b.panel ?? null,
      amount: b.amount,
      status: b.status,
      cashoutAt: b.cashoutAt,
      win: b.win,
      avatar: profile ? (profile.avatar || (profile.username ? profile.username.charAt(0).toUpperCase() : '?')) : null,
      isVip: profile ? !!profile.isVip : false
    };
  });
  const nextId = nextRoundId();
  game.queuedBets.forEach(q => {
    if (q.targetRoundId !== nextId) return;
    const isMine = !!(token && q.owner === token);
    const p = game.players[q.owner];
    const uname = (p && p.username) ? p.username : 'Player';
    bets.unshift({
      id: q.id,
      roundId: q.targetRoundId,
      name: uname,
      simulated: false,
      isMine,
      panel: q.panel,
      amount: q.amount,
      status: 'QUEUED',
      cashoutAt: null,
      win: null,
      avatar: p ? (p.avatar || uname.charAt(0).toUpperCase()) : null,
      isVip: p ? !!p.isVip : false
    });
  });
  return bets;
}

function myBetHistory(token) {
  if (!token) return [];
  const out = [];
  for (let i = game.completedRounds.length - 1; i >= 0 && out.length < 50; i--) {
    const r = game.completedRounds[i];
    for (const b of (r.bets || [])) {
      if (b.owner === token && !b.simulated) {
        out.push({
          id: b.id,
          roundId: r.roundId,
          crashPoint: r.crashPoint,
          at: r.crashedAt,
          amount: b.amount,
          status: b.status,
          cashoutAt: b.cashoutAt,
          win: b.win
        });
        if (out.length >= 50) break;
      }
    }
  }
  return out;
}

function snapshotFor(token) {
  const t = now();
  const r = game.round;
  let multiplier = 1;
  let remainingMs = 0;
  if (r.state === 'BETTING') {
    multiplier = 1;
    remainingMs = Math.max(0, r.bettingEndsAt - t);
  } else if (r.state === 'RUNNING') {
    multiplier = Math.min(r.crashPoint, Math.max(1, multiplierAt(t - r.startedAt)));
  } else if (r.state === 'CRASHED') {
    multiplier = r.crashPoint;
    remainingMs = Math.max(0, r.nextAt - t);
  }
  const p = token && game.players[token] ? game.players[token] : null;
  if (p) updateVipStatus(p, t);
  const paySettings = payStore.getPaymentSettings(game);
  const lastCompleted = (game.completedRounds || []).length ? game.completedRounds[game.completedRounds.length - 1] : null;
  return {
    type: 'state',
    serverTime: t,
    config: { bettingMs: CONFIG.bettingMs, crashedMs: CONFIG.crashedMs, growthRate: CONFIG.growthRate, vipWindowMs: CONFIG.vipWindowMs, vipThreshold: CONFIG.vipThreshold, avatars: AVATARS },
    payments: paySettings,
    round: {
      roundId: r.roundId,
      state: r.state,
      multiplier,
      crashPoint: r.crashPoint,
      bettingEndsAt: r.bettingEndsAt,
      startedAt: r.startedAt,
      crashedAt: r.crashedAt,
      nextAt: r.nextAt,
      remainingMs,
      nextRoundId: nextRoundId()
    },
    recent: game.recent,
    bets: visibleBetsFor(token),
    myBets: myBetHistory(token),
    previousRound: lastCompleted ? {
      roundId: lastCompleted.roundId,
      crashPoint: lastCompleted.crashPoint,
      crashedAt: lastCompleted.crashedAt,
      bets: (lastCompleted.bets || []).map(b => {
        const owner = b.owner && !b.simulated ? game.players[b.owner] : null;
        const sim = b.simulated ? getSimPlayer(b.name) : null;
        const profile = owner || sim;
        return {
          id: b.id,
          roundId: b.roundId,
          name: (owner && owner.username) ? owner.username : (b.name || 'Player'),
          simulated: !!b.simulated,
          isMine: !!(token && b.owner === token),
          panel: b.panel ?? null,
          amount: b.amount,
          status: b.status,
          cashoutAt: b.cashoutAt,
          win: b.win,
          avatar: profile ? (profile.avatar || (profile.username ? profile.username.charAt(0).toUpperCase() : '?')) : null,
          isVip: profile ? !!profile.isVip : false
        };
      })
    } : null,
    player: p ? {
      token: p.token, balance: p.balance, reservedBalance: p.reservedBalance || 0, notice: p.lastNotice || null,
      username: p.username || 'Player', avatar: AVATARS.includes(p.avatar) ? p.avatar : AVATARS[0], isVip: !!p.isVip,
      activityCount: Array.isArray(p.activity) ? p.activity.length : 0,
      phoneNumber: p.phoneNumber || null,
      auto: (ensureAuto(p), p.auto)
    } : null
  };
}

function adminSnapshot() {
  const t = now();
  const r = game.round;
  ensureUpcomingCrashes(4);
  let multiplier = 1;
  let remainingMs = 0;
  if (r.state === 'BETTING') {
    multiplier = 1;
    remainingMs = Math.max(0, r.bettingEndsAt - t);
  } else if (r.state === 'RUNNING') {
    multiplier = Math.min(r.crashPoint, Math.max(1, multiplierAt(t - r.startedAt)));
  } else if (r.state === 'CRASHED') {
    multiplier = r.crashPoint;
    remainingMs = Math.max(0, r.nextAt - t);
  }
  const baseSeq = game.roundSeq;
  const upcoming = [r.crashPoint].concat((game.upcomingCrashes || []).slice(0, 3)).slice(0, 4).map((cp, i) => ({
    label: i === 0 ? 'This round' : `Next +${i}`,
    roundId: formatRoundId(baseSeq + i),
    crashPoint: round2(cp)
  }));
  return {
    type: 'admin_state',
    serverTime: t,
    round: {
      roundId: r.roundId,
      state: r.state,
      multiplier,
      crashPoint: r.crashPoint,
      bettingEndsAt: r.bettingEndsAt,
      startedAt: r.startedAt,
      crashedAt: r.crashedAt,
      nextAt: r.nextAt,
      remainingMs,
      nextRoundId: nextRoundId()
    },
    upcoming,
    recent: game.recent,
    completedRounds: game.completedRounds.slice(-10).map(x => ({ roundId: x.roundId, crashPoint: x.crashPoint, crashedAt: x.crashedAt }))
  };
}

// ---------------- Payments (Daraja-ready) ----------------

function paymentClientSnapshot(token) {
  const p = token ? game.players[token] : null;
  const settings = payStore.getPaymentSettings(game);
  const myDeposits = (game.deposits || []).filter(d => d.user_id === token).slice(-50).reverse();
  const myWithdrawals = (game.withdrawals || []).filter(w => w.user_id === token).slice(-50).reverse();
  const myLedger = (game.walletLedger || []).filter(e => e.user_id === token).slice(-80).reverse();
  return {
    type: 'payments_state',
    serverTime: now(),
    settings,
    player: p ? {
      token: p.token,
      username: p.username || 'Player',
      phone_number: p.phoneNumber || null,
      available_balance: p.balance || 0,
      reserved_balance: p.reservedBalance || 0
    } : null,
    deposits: myDeposits,
    withdrawals: myWithdrawals,
    ledger: myLedger
  };
}

function sendPaymentsState(socket) {
  if (!socket || !socket.data || socket.data.isAdmin) return;
  socket.emit('payments_state', paymentClientSnapshot(socket.data.token));
}

function adminPaymentsSnapshot() {
  payStore.ensurePaymentState(game);
  const settings = payStore.getPaymentSettings(game);
  const totals = payStore.totals(game);
  const players = {};
  Object.values(game.players || {}).forEach(p => {
    players[p.token] = { token: p.token, username: p.username || 'Player', phone_number: p.phoneNumber || null, available_balance: p.balance || 0, reserved_balance: p.reservedBalance || 0 };
  });
  return {
    type: 'admin_payments_state',
    serverTime: now(),
    settings,
    totals,
    deposits: (game.deposits || []).slice(-200).reverse(),
    withdrawals: (game.withdrawals || []).slice(-200).reverse(),
    adminActions: (game.adminActions || []).slice(-100).reverse(),
    players
  };
}

function sendAdminPayments(socket) {
  if (!socket || !socket.data || !socket.data.isAdmin) return;
  socket.emit('admin_payments_state', adminPaymentsSnapshot());
}
function broadcastAdminPayments() {
  for (const [, socket] of io.sockets.sockets) {
    if (socket.data.isAdmin) sendAdminPayments(socket);
  }
}
function broadcastPaymentsFor(token) {
  for (const [, socket] of io.sockets.sockets) {
    if (!socket.data.isAdmin && socket.data.token === token) sendPaymentsState(socket);
  }
}

function requirePlayerToken(req, res) {
  const token = (req.headers['x-player-token'] || req.query.token || (req.body && req.body.token) || '').toString().slice(0, 80);
  const p = getPlayer(token);
  if (!p) { res.status(401).json({ ok: false, msg: 'No active session' }); return null; }
  return { token, p };
}

function requireAdmin(req, res) {
  const key = (req.headers['x-admin-key'] || req.query.key || (req.body && req.body.key) || '').toString();
  if (key !== ADMIN_KEY) { res.status(401).json({ ok: false, msg: 'Unauthorized' }); return false; }
  return true;
}

function paymentError(res, msg, code=400) { return res.status(code).json({ ok: false, msg }); }

function sendState(socket) { socket.emit('state', snapshotFor(socket.data.token)); }
function broadcastState() {
  for (const [, socket] of io.sockets.sockets) {
    sendState(socket);
  }
}
function sendAdmin(socket) { socket.emit('admin_state', adminSnapshot()); }
function broadcastAdmin() {
  for (const [, socket] of io.sockets.sockets) {
    if (socket.data.isAdmin) sendAdmin(socket);
  }
}

function schedule(ms, fn) {
  clearTimer();
  game.timer = setTimeout(fn, Math.max(0, ms));
}

function finalizeRound() {
  const r = game.round;
  if (r.completed) return;
  r.completed = true;
  r.bets.forEach(b => { if (b.roundId === r.roundId && b.status === 'FLYING') b.status = 'LOST'; });
  // update auto panel statuses from outcomes
  r.bets.forEach(b => {
    if (!b.autoBet || !b.owner) return;
    const p = game.players[b.owner];
    if (!p) return; ensureAuto(p);
    const a = p.auto[b.panel];
    if (!a) return;
    if (b.status === 'CASHED_OUT') a.status = 'CASHED OUT';
    else if (b.status === 'LOST') a.status = 'ROUND LOST';
    if (!a.running && a.roundsRemaining <= 0 && a.status !== 'INSUFFICIENT BALANCE') {
      // keep outcome status visible; next start/idle will show stopped in UI context
    }
  });
    // auto panels with no bet this round but still running can continue; clear running when exhausted
    for (const token of Object.keys(game.players)) {
      const p = game.players[token]; ensureAuto(p);
      for (let panel = 0; panel < 2; panel++) {
        const a = p.auto[panel];
        if (a.running && a.roundsRemaining <= 0) {
          a.running = false;
          if (!['CASHED OUT','ROUND LOST','INSUFFICIENT BALANCE'].includes(a.status)) a.status = 'AUTO STOPPED';
        } else if (!a.running && a.roundsRemaining <= 0 && !['CASHED OUT','ROUND LOST','INSUFFICIENT BALANCE'].includes(a.status)) {
          a.status = 'AUTO STOPPED';
        }
      }
    }
  game.recent.unshift(r.crashPoint);
  if (game.recent.length > 30) game.recent.pop();
  const summary = {
    roundId: r.roundId,
    crashPoint: r.crashPoint,
    startedAt: r.startedAt,
    crashedAt: r.crashedAt,
    bets: r.bets.map(b => ({ id:b.id, roundId:b.roundId, owner:b.owner, name:b.name, simulated:b.simulated, amount:b.amount, status:b.status, cashoutAt:b.cashoutAt, win:b.win, autoBet: !!b.autoBet}))
  };
  game.completedRounds.push(summary);
  if (game.completedRounds.length > 100) game.completedRounds = game.completedRounds.slice(-50);
  addTransaction({ type: 'round_complete', roundId: r.roundId, crashPoint: r.crashPoint });
  persist(true);
}

function activateQueuedBetsForRound(roundId) {
  const r = game.round;
  if (!r || r.roundId !== roundId || r.state !== 'BETTING') return;
  const remaining = [];
  for (const q of game.queuedBets) {
    if (q.targetRoundId !== roundId) { remaining.push(q); continue; }
    const p = getPlayer(q.owner);
    if (!p) continue;
    if (p.balance < q.amount) {
      p.lastNotice = { type: 'error', msg: `Queued bet for panel ${q.panel + 1} (KSh ${q.amount}) rejected: insufficient balance`, at: now() };
      addTransaction({ type: 'queue_rejected', roundId, owner: q.owner, panel: q.panel, amount: q.amount, reason: 'insufficient_balance' });
      if (q.auto) {
        const a = p.auto && p.auto[q.panel];
        if (a) { a.running = false; a.roundsRemaining = 0; a.status = 'INSUFFICIENT BALANCE'; a.lastError = 'Insufficient balance'; a.stopRequested = false; }
      }
      continue;
    }
    p.balance = clampMoney(p.balance - q.amount);
    recordActivity(p);
    const bet = {
      id: uid('b'), roundId: roundId, owner: q.owner, panel: q.panel,
      name: 'Player', simulated: false, amount: q.amount, status: 'BET_PLACED',
      cashoutAt: null, win: null, auto: (q.autoCashout != null ? q.autoCashout : (q.auto || null)), payoutDone: false, placedAt: now(), activatedFromQueue: true, autoBet: !!q.autoBet || !!q.autoMode || !!q.auto
    };
    r.bets.unshift(bet);
    if (bet.autoBet) {
      const a = p.auto && p.auto[q.panel];
      if (a) { a.lastPlacedRoundId = roundId; a.status = 'BET ACTIVE'; a.lastError = null; }
    }
    addTransaction({ type: 'bet', roundId, betId: bet.id, owner: q.owner, amount: q.amount, auto: q.autoCashout || null, simulated: false, queued: true });
    // award check for queued real-money bet activation (idempotent by bet id)
  }
  game.queuedBets = remaining;
}

function hasBetForRoundPanel(owner, panel, roundId) {
  const r = game.round;
  if (!r) return false;
  return r.bets.some(b => b.owner === owner && b.panel === panel && b.roundId === roundId && (b.status === 'BET_PLACED' || b.status === 'FLYING' || b.status === 'CASHED_OUT' || b.status === 'LOST'));
}
function hasQueuedFor(owner, panel, targetRoundId) {
  return game.queuedBets.some(q => q.owner === owner && q.panel === panel && q.targetRoundId === targetRoundId);
}

function tryAutoPlaceCurrent(p, token, panel, roundId) {
  const a = p.auto[panel];
  if (!a || !a.running || a.roundsRemaining <= 0) return false;
  if (a.lastPlacedRoundId === roundId || a.lastQueuedRoundId === roundId) return false;
  if (hasBetForRoundPanel(token, panel, roundId) || hasQueuedFor(token, panel, roundId)) { a.lastPlacedRoundId = roundId; return false; }
  if (p.balance < a.amount) {
    a.running = false; a.roundsRemaining = 0; a.status = 'INSUFFICIENT BALANCE'; a.lastError = 'Insufficient balance'; a.stopRequested = false;
    p.lastNotice = { type: 'error', msg: `Auto bet (panel ${panel + 1}) stopped: insufficient balance`, at: now() };
    return false;
  }
  p.balance = clampMoney(p.balance - a.amount);
  recordActivity(p);
  const bet = { id: uid('b'), roundId, owner: token, panel, name: 'Player', simulated: false, amount: a.amount, status: 'BET_PLACED', cashoutAt: null, win: null, auto: a.autoCashout, payoutDone: false, placedAt: now(), autoBet: true };
  game.round.bets.unshift(bet);
  a.lastPlacedRoundId = roundId;
  a.roundsRemaining = Math.max(0, a.roundsRemaining - 1);
  a.status = 'BET ACTIVE';
  a.lastError = null;
  addTransaction({ type: 'bet', roundId, betId: bet.id, owner: token, amount: a.amount, auto: a.autoCashout, simulated: false, autoMode: true });
  return true;
}

function tryAutoQueueNext(p, token, panel, targetRoundId) {
  const a = p.auto[panel];
  if (!a || !a.running || a.roundsRemaining <= 0) return false;
  if (a.lastQueuedRoundId === targetRoundId || a.lastPlacedRoundId === targetRoundId) return false;
  if (hasQueuedFor(token, panel, targetRoundId) || hasBetForRoundPanel(token, panel, targetRoundId)) { a.lastQueuedRoundId = targetRoundId; return false; }
  game.queuedBets.push({ id: uid('q'), owner: token, panel, amount: a.amount, autoCashout: a.autoCashout, targetRoundId, createdAt: now(), autoBet: true });
  a.lastQueuedRoundId = targetRoundId;
  a.roundsRemaining = Math.max(0, a.roundsRemaining - 1);
  a.status = 'BET QUEUED';
  a.lastError = null;
  addTransaction({ type: 'queue', targetRoundId, owner: token, panel, amount: a.amount, auto: a.autoCashout, autoMode: true });
  return true;
}

function processAutoSchedulingForRound(roundId) {
  const r = game.round;
  if (!r || r.roundId !== roundId || r.state !== 'BETTING') return;
  for (const token of Object.keys(game.players)) {
    const p = game.players[token];
    ensureAuto(p);
    for (let panel = 0; panel < 2; panel++) {
      const a = p.auto[panel];
      if (!a) continue;
      if (a.running && a.roundsRemaining <= 0) {
        // all scheduled rounds placed/queued; stop further scheduling
        a.running = false;
        if (!['CASHED OUT','ROUND LOST','INSUFFICIENT BALANCE'].includes(a.status)) a.status = 'AUTO STOPPED';
        continue;
      }
      if (!a.running || a.roundsRemaining <= 0) continue;
      tryAutoPlaceCurrent(p, token, panel, roundId);
    }
  }
}

function startBetting() {
  clearTimer();
  game.roundSeq += 1;
  game.round = newRound(game.roundSeq);
  processAutoSchedulingForRound(game.round.roundId);
  activateQueuedBetsForRound(game.round.roundId);
  addTransaction({ type: 'round_created', roundId: game.round.roundId, crashPoint: game.round.crashPoint, bettingEndsAt: game.round.bettingEndsAt });
  persist(true);
  schedule(game.round.bettingEndsAt - now(), startRunning);
  broadcastState(); broadcastAdmin();
}

function startRunning() {
  const r = game.round;
  if (!r || r.state !== 'BETTING') return;
  clearTimer();
  r.state = 'RUNNING';
  r.startedAt = now();
  r.bets.forEach(b => { if (b.roundId === r.roundId && b.status === 'BET_PLACED') b.status = 'FLYING'; });
  addTransaction({ type: 'round_running', roundId: r.roundId, startedAt: r.startedAt });
  persist();
  broadcastState(); broadcastAdmin();
}

function crashRound(triggerTime) {
  const r = game.round;
  if (!r || r.state !== 'RUNNING') return;
  clearTimer();
  r.state = 'CRASHED';
  r.crashedAt = triggerTime || now();
  r.nextAt = r.crashedAt + CONFIG.crashedMs;
  finalizeRound();
  schedule(r.nextAt - now(), startBetting);
  broadcastState(); broadcastAdmin();
}

function processCashouts() {
  const r = game.round;
  if (!r || r.state !== 'RUNNING') return false;
  const t = now();
  const m = Math.min(r.crashPoint, Math.max(1, multiplierAt(t - r.startedAt)));
  let changed = false;
  r.bets.forEach(b => {
    if (b.roundId !== r.roundId || b.status !== 'FLYING' || b.cashoutAt != null || !b.auto) return;
    if (m >= b.auto && b.auto <= r.crashPoint && b.auto <= m) {
      b.status = 'CASHED_OUT';
      b.cashoutAt = b.auto;
      b.win = clampMoney(b.amount * b.auto);
      if (b.simulated) {
        const sp = getSimPlayer(b.name);
        if (sp) recordActivity(sp, t, false);
      }
      if (b.owner && !b.payoutDone) {
        const p = getPlayer(b.owner);
        if (p) { p.balance = clampMoney(p.balance + b.win); recordActivity(p, t); }
        b.payoutDone = true;
        addTransaction({ type: 'cashout', roundId: r.roundId, betId: b.id, owner: b.owner, amount: b.amount, multiplier: b.auto, win: b.win, simulated: !!b.simulated});
      }
      if (b.autoBet && b.owner) {
        const p = game.players[b.owner];
        if (p && p.auto && p.auto[b.panel]) {
          const a = p.auto[b.panel];
          if (a.running || a.roundsRemaining > 0) a.status = 'AUTO RUNNING';
          else { a.running = false; a.status = 'CASHED OUT'; }
        }
      }
      changed = true;
    }
  });
  if (changed) { persist(); broadcastState(); }
  if (m >= r.crashPoint) { crashRound(t); return true; }
  return false;
}

function vipSweep() {
  const t = now();
  let changed = false;
  for (const token of Object.keys(game.players)) {
    const p = game.players[token];
    const beforeVip = !!p.isVip;
    const beforeNotice = p.lastNotice;
    updateVipStatus(p, t);
    if (beforeVip !== !!p.isVip || beforeNotice !== p.lastNotice) changed = true;
  }
  if (game.simPlayers) {
    for (const name of Object.keys(game.simPlayers)) {
      const sp = game.simPlayers[name];
      const before = !!sp.isVip;
      updateVipStatus(sp, t, false);
      if (before !== !!sp.isVip) changed = true;
    }
  }
  if (changed) persist();
  return changed;
}

function engineTick() {
  const r = game.round;
  if (!r) return;
  const t = now();
  if (r.state === 'BETTING') {
    if (t >= r.bettingEndsAt) startRunning();
  } else if (r.state === 'RUNNING') {
    if (!processCashouts()) {
      for (const [, socket] of io.sockets.sockets) {
        if (socket.data.isAdmin) socket.emit('admin_state', adminSnapshot());
        else socket.emit('tick', snapshotFor(socket.data.token));
      }
    }
  } else if (r.state === 'CRASHED') {
    if (t >= r.nextAt) startBetting();
  }
}

function recover() {
  const t = now();
  if (!Array.isArray(game.queuedBets)) game.queuedBets = [];
  if (!game.simPlayers) game.simPlayers = {};
  if (!game.round || !game.round.roundId) { startBetting(); return; }
  const r = game.round;
  if (!Array.isArray(r.bets)) r.bets = [];
  const expectedNext = nextRoundId();
  game.queuedBets = game.queuedBets.filter(q => q && q.targetRoundId === expectedNext && (q.panel === 0 || q.panel === 1));
  Object.values(game.players).forEach(p => { getPlayer(p.token); ensureAuto(p); updateVipStatus(p, t); });
  if (r.state === 'RUNNING') {
    const m = Math.min(r.crashPoint, Math.max(1, multiplierAt(t - r.startedAt)));
    if (m >= r.crashPoint) crashRound(r.startedAt + Math.ceil(Math.log(r.crashPoint) / CONFIG.growthRate * 1000));
    else { broadcastState(); broadcastAdmin(); }
  } else if (r.state === 'BETTING') {
    if (t >= r.bettingEndsAt) startRunning(); else { schedule(r.bettingEndsAt - t, startRunning); broadcastState(); broadcastAdmin(); }
  } else if (r.state === 'CRASHED') {
    if (!r.completed) finalizeRound();
    if (t >= r.nextAt) startBetting(); else { schedule(r.nextAt - t, startBetting); broadcastState(); broadcastAdmin(); }
  } else {
    startBetting();
  }
}

io.on('connection', (socket) => {
  socket.data.token = null;
  socket.data.isAdmin = false;

  socket.on('hello', (payload = {}, ack) => {
    const token = (payload && typeof payload.token === 'string' && payload.token) ? payload.token.slice(0,80) : uid('p');
    socket.data.token = token;
    const player = getPlayer(token);
    updateVipStatus(player);
    const notice = player.lastNotice;
    player.lastNotice = null;
    const snap = snapshotFor(token);
    if (notice) snap.player.notice = notice;
    socket.emit('state', snap);
    sendPaymentsState(socket);
    if (typeof ack === 'function') ack({ ok: true, token, balance: player.balance, serverTime: now() });
    if (notice) persist();
  });

  socket.on('admin_login', (payload = {}, ack) => {
    const key = payload && payload.key;
    if (key === ADMIN_KEY) {
      socket.data.isAdmin = true;
      socket.emit('admin_state', adminSnapshot());
      sendAdminPayments(socket);
      if (typeof ack === 'function') ack({ ok: true });
    } else {
      if (typeof ack === 'function') ack({ ok: false, msg: 'Invalid admin key' });
    }
  });

  socket.on('place_bet', (payload = {}, ack) => {
    if (socket.data.isAdmin) { if (typeof ack === 'function') ack({ ok: false, msg: 'Admin view' }); return; }
    const token = socket.data.token;
    const p = getPlayer(token);
    const r = game.round;
    const res = (ok, msg, extra={}) => { if (typeof ack === 'function') ack(Object.assign({ ok, msg }, extra)); };
    if (!p || !r) return res(false, 'No active session');
    const panel = Number(payload.panel);
    if (!(panel === 0 || panel === 1)) return res(false, 'Invalid panel');
    if (p.auto && p.auto[panel] && (p.auto[panel].running || p.auto[panel].roundsRemaining > 0)) return res(false, 'Stop Auto mode to place manual bets');
    const amount = Math.floor(Number(payload.amount) || 0);
    if (amount < 10 || amount > 10000) return res(false, 'Bet amount must be between KSh 10.00 and KSh 10,000.00');
    const autoVal = Number(payload.auto);
    const auto = (isFinite(autoVal) && autoVal >= 1.01) ? round2(autoVal) : null;

    if (r.state === 'BETTING') {
      const existing = r.bets.find(b => b.owner === token && b.panel === panel && b.roundId === r.roundId && (b.status === 'BET_PLACED' || b.status === 'FLYING'));
      if (existing) return res(false, 'Bet already placed');
      const qIdx = game.queuedBets.findIndex(q => q.owner === token && q.panel === panel && q.targetRoundId === r.roundId);
      if (qIdx !== -1) return res(false, 'Bet already placed');
      if (p.balance < amount) return res(false, 'Insufficient balance');
      p.balance = clampMoney(p.balance - amount);
      recordActivity(p);
      const bet = { id: uid('b'), roundId: r.roundId, owner: token, panel, name: 'Player', simulated: false, amount, status: 'BET_PLACED', cashoutAt: null, win: null, auto, payoutDone: false, placedAt: now() };
      r.bets.unshift(bet);
      addTransaction({ type: 'bet', roundId: r.roundId, betId: bet.id, owner: token, amount, auto, simulated: false });
      persist(); broadcastState(); broadcastAdmin(); sendState(socket);
      return res(true, 'Bet placed', { balance: p.balance });
    }

    if (r.state === 'RUNNING' || r.state === 'CRASHED') {
      const target = nextRoundId();
      const dup = game.queuedBets.find(q => q.owner === token && q.panel === panel && q.targetRoundId === target);
      if (dup) return res(false, 'Bet already queued for next round');
      game.queuedBets.push({ id: uid('q'), owner: token, panel, amount, auto, targetRoundId: target, createdAt: now() });
      addTransaction({ type: 'queue', targetRoundId: target, owner: token, panel, amount, auto });
      persist(); broadcastState(); broadcastAdmin(); sendState(socket);
      return res(true, 'Bet queued for next round', { balance: p.balance, queued: true, targetRoundId: target });
    }
    return res(false, 'Betting unavailable');
  });

  socket.on('cancel_bet', (payload = {}, ack) => {
    if (socket.data.isAdmin) { if (typeof ack === 'function') ack({ ok: false, msg: 'Admin view' }); return; }
    const token = socket.data.token;
    const p = getPlayer(token);
    const r = game.round;
    const res = (ok, msg, extra={}) => { if (typeof ack === 'function') ack(Object.assign({ ok, msg }, extra)); };
    if (!p || !r) return res(false, 'No active session');
    const panel = Number(payload.panel);
    if (!(panel === 0 || panel === 1)) return res(false, 'Invalid panel');
    if (p.auto && p.auto[panel] && (p.auto[panel].running || p.auto[panel].roundsRemaining > 0)) return res(false, 'Auto mode is running');
    const target = nextRoundId();
    const qIdx = game.queuedBets.findIndex(q => q.owner === token && q.panel === panel && q.targetRoundId === target);
    if (qIdx !== -1) {
      const q = game.queuedBets[qIdx];
      if (q.autoBet || q.autoMode || (p.auto && p.auto[panel] && (p.auto[panel].running || p.auto[panel].roundsRemaining > 0))) return res(false, 'Auto queued bet cannot be cancelled manually');
      game.queuedBets.splice(qIdx, 1);
      addTransaction({ type: 'queue_cancel', targetRoundId: q.targetRoundId, owner: token, panel, amount: q.amount });
      persist(); broadcastState(); broadcastAdmin(); sendState(socket);
      return res(true, 'Queued bet cancelled', { balance: p.balance });
    }
    if (r.state !== 'BETTING') return res(false, 'Cannot cancel');
    const idx = r.bets.findIndex(b => b.owner === token && b.panel === panel && b.roundId === r.roundId && b.status === 'BET_PLACED');
    if (idx === -1) return res(false, 'No bet to cancel');
    const bet = r.bets[idx];
    if (bet.autoBet) return res(false, 'Auto bet cannot be cancelled manually');
    r.bets.splice(idx, 1);
    p.balance = clampMoney(p.balance + bet.amount);
    addTransaction({ type: 'cancel', roundId: r.roundId, betId: bet.id, owner: token, amount: bet.amount });
    persist(); broadcastState(); broadcastAdmin(); sendState(socket);
    res(true, 'Bet cancelled', { balance: p.balance });
  });

  socket.on('cashout', (payload = {}, ack) => {
    if (socket.data.isAdmin) { if (typeof ack === 'function') ack({ ok: false, msg: 'Admin view' }); return; }
    const token = socket.data.token;
    const p = getPlayer(token);
    const r = game.round;
    const res = (ok, msg, extra={}) => { if (typeof ack === 'function') ack(Object.assign({ ok, msg }, extra)); };
    if (!p || !r) return res(false, 'No active session');
    if (r.state !== 'RUNNING') return res(false, 'Not running');
    const panel = Number(payload.panel);
    const bet = r.bets.find(b => b.owner === token && b.panel === panel && b.roundId === r.roundId);
    if (!bet) return res(false, 'No active bet');
    if (bet.status !== 'FLYING' || bet.cashoutAt != null) return res(false, 'Already settled');
    const t = now();
    const m = Math.min(r.crashPoint, Math.max(1, multiplierAt(t - r.startedAt)));
    if (m > r.crashPoint) return res(false, 'Round crashed');
    bet.status = 'CASHED_OUT';
    bet.cashoutAt = m;
    bet.win = clampMoney(bet.amount * m);
    if (!bet.payoutDone) {
      p.balance = clampMoney(p.balance + bet.win);
      bet.payoutDone = true;
      recordActivity(p, t);
      addTransaction({ type: 'cashout', roundId: r.roundId, betId: bet.id, owner: token, amount: bet.amount, multiplier: m, win: bet.win, simulated: false });
    }
    if (bet.autoBet && p.auto && p.auto[panel]) {
      const a = p.auto[panel];
      if (a.running || a.roundsRemaining > 0) a.status = 'AUTO RUNNING';
      else { a.running = false; a.status = 'CASHED OUT'; }
    }
    persist(); broadcastState(); broadcastAdmin(); sendState(socket);
    res(true, 'Cashed out', { balance: p.balance, multiplier: m, win: bet.win });
  });

  socket.on('start_auto', (payload = {}, ack) => {
    if (socket.data.isAdmin) { if (typeof ack === 'function') ack({ ok: false, msg: 'Admin view' }); return; }
    const token = socket.data.token;
    const p = getPlayer(token);
    const r = game.round;
    const res = (ok, msg, extra={}) => { if (typeof ack === 'function') ack(Object.assign({ ok, msg }, extra)); };
    if (!p || !r) return res(false, 'No active session');
    const panel = Number(payload.panel);
    if (!(panel === 0 || panel === 1)) return res(false, 'Invalid panel');
    const amount = Math.floor(Number(payload.amount) || 0);
    const rounds = Math.max(1, Math.min(1000, Math.floor(Number(payload.rounds) || 0)));
    if (amount < 10 || amount > 10000) return res(false, 'Bet amount must be between KSh 10.00 and KSh 10,000.00');
    if (rounds < 1) return res(false, 'Select number of rounds');
    const autoVal = Number(payload.autoCashout);
    const autoCashout = (isFinite(autoVal) && autoVal >= 1.01) ? round2(autoVal) : null;
    ensureAuto(p);
    const a = p.auto[panel];
    a.amount = amount; a.roundsTotal = rounds; a.roundsRemaining = rounds; a.autoCashout = autoCashout;
    a.running = true; a.stopRequested = false; a.lastError = null; a.status = 'AUTO RUNNING';
    // schedule first bet
    if (r.state === 'BETTING') {
      tryAutoPlaceCurrent(p, token, panel, r.roundId);
      if (a.running && a.roundsRemaining > 0 && !hasBetForRoundPanel(token, panel, r.roundId) && !hasQueuedFor(token, panel, r.roundId)) {
        // could not place now (e.g. dup) - keep running for future
      }
    } else {
      tryAutoQueueNext(p, token, panel, nextRoundId());
      if (!a.running && a.status !== 'INSUFFICIENT BALANCE') a.status = 'BET QUEUED';
    }
    if (a.running && a.status === 'AUTO RUNNING') a.status = (r.state === 'BETTING' && hasBetForRoundPanel(token, panel, r.roundId)) ? 'BET ACTIVE' : (hasQueuedFor(token, panel, nextRoundId()) ? 'BET QUEUED' : 'AUTO RUNNING');
    persist(); broadcastState(); broadcastAdmin(); sendState(socket);
    res(true, 'Auto mode started', { auto: p.auto[panel], balance: p.balance });
  });

  socket.on('stop_auto', (payload = {}, ack) => {
    if (socket.data.isAdmin) { if (typeof ack === 'function') ack({ ok: false, msg: 'Admin view' }); return; }
    const token = socket.data.token;
    const p = getPlayer(token);
    const r = game.round;
    const res = (ok, msg, extra={}) => { if (typeof ack === 'function') ack(Object.assign({ ok, msg }, extra)); };
    if (!p) return res(false, 'No active session');
    const panel = Number(payload.panel);
    if (!(panel === 0 || panel === 1)) return res(false, 'Invalid panel');
    ensureAuto(p);
    const a = p.auto[panel];
    a.running = false; a.roundsRemaining = 0; a.stopRequested = true; a.status = 'AUTO STOPPED'; a.lastError = null;
    // stop scheduling future automatic bets: remove pending auto-queued entries for this panel
    const target = nextRoundId();
    game.queuedBets = game.queuedBets.filter(q => !(q.owner === token && q.panel === panel && (q.autoBet || q.autoMode) && (q.targetRoundId === target)));
    persist(); broadcastState(); broadcastAdmin(); sendState(socket);
    res(true, 'Auto mode stopped', { auto: a });
  });


  socket.on('set_profile', (payload = {}, ack) => {
    const token = socket.data.token;
    const p = getPlayer(token);
    const res = (ok, msg, extra={}) => { if (typeof ack === 'function') ack(Object.assign({ ok, msg }, extra)); };
    if (!p) return res(false, 'No active session');
    let changed = false;
    if (payload.username !== undefined) {
      const name = sanitizeUsername(payload.username);
      if (!name) return res(false, 'Enter a valid username');
      p.username = name; changed = true;
    }
    if (payload.avatar !== undefined) {
      const av = sanitizeAvatar(payload.avatar);
      if (!av) return res(false, 'Invalid avatar');
      p.avatar = av; changed = true;
    }
    if (!changed) return res(false, 'Nothing to update');
    persist(); broadcastState(); broadcastAdmin(); sendState(socket);
    res(true, 'Profile updated', { username: p.username, avatar: p.avatar, isVip: p.isVip });
  });socket.on('set_username', (payload = {}, ack) => {
    const token = socket.data.token;
    const p = getPlayer(token);
    const res = (ok, msg, extra={}) => { if (typeof ack === 'function') ack(Object.assign({ ok, msg }, extra)); };
    if (!p) return res(false, 'No active session');
    const name = sanitizeUsername(payload.username);
    if (!name) return res(false, 'Enter a valid username');
    p.username = name;
    persist(); broadcastState(); broadcastAdmin(); sendState(socket);
    res(true, 'Username updated', { username: name });
  });

  socket.on('request_state', () => { if (socket.data.isAdmin) { sendAdmin(socket); sendAdminPayments(socket); } else { sendState(socket); sendPaymentsState(socket); } });
  socket.on('payments_request', () => { if (socket.data.isAdmin) sendAdminPayments(socket); else sendPaymentsState(socket); });
});

/* ===================== PAYMENTS API ===================== */
function sendStateForToken(token){ for(const [,socket] of io.sockets.sockets){ if(!socket.data.isAdmin && socket.data.token===token) sendState(socket); } }
function updateLedgerStatus(reference,status,description){ (game.walletLedger||[]).forEach(e=>{ if(e.reference===reference && e.status==='PROCESSING'){ e.status=status; if(description) e.description=description; } }); }

function applyDepositSuccess(depId, mpesaReceipt, note){
  const d = (game.deposits||[]).find(x=>x.id===depId); if(!d) return false;
  if(d.status==='COMPLETED') return false; if(!['PROCESSING','PENDING','AWAITING_PAYMENT','AWAITING_APPROVAL','MARKED_PAID'].includes(d.status)) return false;
  const p = game.players[d.user_id]; if(!p) return false;
  if(mpesaReceipt){ const dup=(game.deposits||[]).find(x=>x!==d && x.mpesa_receipt_number===mpesaReceipt && x.status==='COMPLETED'); if(dup){ d.status='FAILED'; d.failure_reason='Duplicate M-Pesa receipt'; d.completed_at=now(); updateLedgerStatus(depId,'FAILED',d.failure_reason); persist(true); return false; } d.mpesa_receipt_number=mpesaReceipt; }
  else { if(payStore.ledgerRefExists(game,d.id,'DEPOSIT_CREDIT')) return false; }
  d.status='COMPLETED'; d.completed_at=now(); d.failure_reason=null;
  p.balance = clampMoney((p.balance||0)+Number(d.amount||0)); if(d.phone_number) p.phoneNumber=d.phone_number;
  updateLedgerStatus(depId,'COMPLETED', note||'Deposit completed');
  payStore.addLedger(game,{ user_id:d.user_id, transaction_type:'DEPOSIT_CREDIT', amount:d.amount, reference: mpesaReceipt||d.id, status:'COMPLETED', description: note||'Wallet credited (deposit)', environment:d.environment });
  persist(true); broadcastPaymentsFor(d.user_id); broadcastAdminPayments(); sendStateForToken(d.user_id); return true;
}
function applyDepositFailure(depId, reason){
  const d=(game.deposits||[]).find(x=>x.id===depId); if(!d) return false;
  if(['COMPLETED','FAILED','CANCELLED','REJECTED'].includes(d.status)) return false;
  d.status=/cancel/i.test(reason||'')?'CANCELLED':'REJECTED';
  d.failure_reason=String(reason||'Failed').slice(0,200); d.completed_at=now();
  updateLedgerStatus(depId,d.status,d.failure_reason); persist(true); broadcastPaymentsFor(d.user_id); broadcastAdminPayments(); return true;
}
function releaseWithdrawal(w, reason, by){
  const p=game.players[w.user_id]; if(!p) return false; if(['COMPLETED','FAILED','REJECTED','CANCELLED'].includes(w.status)) return false;
  const wasReserved=['PENDING','APPROVED','PROCESSING','AWAITING_PAYMENT','AWAITING_APPROVAL','MARKED_PAID'].includes(w.status);
  w.status=/reject/i.test(reason||'')?'REJECTED':(/cancel/i.test(reason||'')?'CANCELLED':'FAILED');
  w.failure_reason=String(reason||'Failed').slice(0,200); w.completed_at=now();
  if(wasReserved){ const amt=clampMoney(Number(w.amount||0)); p.reservedBalance=clampMoney(Math.max(0,(p.reservedBalance||0)-amt)); p.balance=clampMoney((p.balance||0)+amt); }
  updateLedgerStatus(w.id,w.status,w.failure_reason);
  payStore.addLedger(game,{ user_id:w.user_id, transaction_type:'WITHDRAW_RELEASE', amount:w.amount, reference:w.id, status:w.status, description:'Reserved amount released: '+w.failure_reason, environment:w.environment });
  if(by) payStore.recordAdminAction(game,{ action:'withdrawal_release', withdrawal_id:w.id, by, reason:w.failure_reason });
  persist(true); broadcastPaymentsFor(w.user_id); broadcastAdminPayments(); sendStateForToken(w.user_id); return true;
}
function applyWithdrawalSuccess(wId, txRef, note){
  const w=(game.withdrawals||[]).find(x=>x.id===wId); if(!w) return false; if(w.status==='COMPLETED') return false; if(!['APPROVED','PROCESSING'].includes(w.status)) return false;
  const p=game.players[w.user_id]; if(!p) return false;
  if(txRef){ const dup=(game.withdrawals||[]).find(x=>x!==w && x.transaction_reference===txRef && x.status==='COMPLETED'); if(dup){ releaseWithdrawal(w,'Duplicate transaction reference',null); return false; } w.transaction_reference=txRef; }
  else { if(payStore.ledgerRefExists(game,w.id,'WITHDRAW_COMPLETE')) return false; }
  const amt=clampMoney(Number(w.amount||0)); p.reservedBalance=clampMoney(Math.max(0,(p.reservedBalance||0)-amt));
  w.status='COMPLETED'; w.completed_at=now(); w.failure_reason=null; updateLedgerStatus(w.id,'COMPLETED', note||'Withdrawal completed');
  payStore.addLedger(game,{ user_id:w.user_id, transaction_type:'WITHDRAW_COMPLETE', amount:amt, reference: txRef||w.id, status:'COMPLETED', description: note||'Withdrawal sent', environment:w.environment });
  persist(true); broadcastPaymentsFor(w.user_id); broadcastAdminPayments(); sendStateForToken(w.user_id); return true;
}

app.get('/api/payments/config',(req,res)=>{ payStore.ensurePaymentState(game); res.json({ ok:true, settings: payStore.getPaymentSettings(game) }); });
app.get('/api/payments/history',(req,res)=>{ const auth=requirePlayerToken(req,res); if(!auth) return; res.json({ ok:true, data: paymentClientSnapshot(auth.token) }); });

app.post('/api/payments/deposit',(req,res)=>{
  const auth=requirePlayerToken(req,res); if(!auth) return; const {token,p}=auth;
  const phone=payStore.normalizePhone(req.body && req.body.phone_number); const amount=clampMoney(Number(req.body && req.body.amount));
  if(!phone) return paymentError(res,'Enter a valid M-Pesa phone number');
  if(!isFinite(amount)||amount<10) return paymentError(res,'Minimum deposit is KSh 10.00');
  if(amount>150000) return paymentError(res,'Maximum deposit is KSh 150,000.00');
  const clientRef=(req.body && req.body.client_ref)?String(req.body.client_ref).slice(0,64):null;
  if(clientRef){ const dup=payStore.findDepositByRef(game,{clientRef}); if(dup && dup.user_id===token) return res.json({ ok:true, deposit:dup, data: paymentClientSnapshot(token), duplicate:true }); }
  p.phoneNumber=phone;
  const dep={ id:uid('dep'), clientRef, user_id:token, amount, phone_number:phone, checkout_request_id:null, merchant_request_id:null, mpesa_receipt_number:null, status:'AWAITING_PAYMENT', environment:'manual', created_at:now(), completed_at:null, failure_reason:null, description:'Awaiting user payment to Paybill 542542, Account 03708400476150', paymentMessage:null };
  game.deposits.push(dep); payStore.addLedger(game,{ user_id:token, transaction_type:'DEPOSIT', amount, reference:dep.id, status:'PENDING', description:'Deposit requested; awaiting user payment and message', environment:dep.environment }); persist(true); broadcastPaymentsFor(token); broadcastAdminPayments(); sendStateForToken(token);
  return res.json({ ok:true, msg:'Pay to Paybill 542542, Account 03708400476150, then paste the M-Pesa confirmation message.', deposit:dep, data: paymentClientSnapshot(token) });
});

app.post('/api/payments/deposit/:id/mark-paid',(req,res)=>{
  const auth=requirePlayerToken(req,res); if(!auth) return; const {token}=auth;
  const d=(game.deposits||[]).find(x=>x.id===req.params.id && x.user_id===token); if(!d) return paymentError(res,'Deposit not found',404);
  if(d.status==='COMPLETED') return paymentError(res,'Deposit already completed');
  if(['FAILED','CANCELLED','REJECTED'].includes(d.status)) return paymentError(res,'This deposit cannot be submitted');
  if(!['AWAITING_PAYMENT','AWAITING_APPROVAL','MARKED_PAID'].includes(d.status)) return paymentError(res,'Deposit cannot be submitted in its current state');
  const msg=(req.body && (req.body.payment_message || req.body.paymentMessage || req.body.message)) ? String(req.body.payment_message || req.body.paymentMessage || req.body.message).trim().slice(0,2000) : '';
  if(!msg || msg.length < 10) return paymentError(res,'Paste the full M-Pesa confirmation message you received after paying.');
  const norm=msg.replace(/\s+/g,' ').toLowerCase();
  const dup=(game.deposits||[]).find(x=>x!==d && x.paymentMessage && String(x.paymentMessage).replace(/\s+/g,' ').toLowerCase()===norm && ['AWAITING_APPROVAL','COMPLETED','PROCESSING','PENDING','MARKED_PAID','AWAITING_PAYMENT'].includes(x.status));
  if(dup) return paymentError(res,'This transaction message has already been submitted.');
  d.paymentMessage=msg;
  d.status='AWAITING_APPROVAL'; d.description='Payment message submitted; awaiting admin approval'; d.completed_at=null; d.failure_reason=null;
  updateLedgerStatus(d.id,'PENDING','Payment message submitted; awaiting admin approval');
  persist(true); broadcastPaymentsFor(token); broadcastAdminPayments();
  return res.json({ ok:true, msg:'Submitted for admin approval. Your deposit will be credited after confirmation.', deposit:d, data: paymentClientSnapshot(token) });
});

app.post('/api/admin/deposits/:id/approve',(req,res)=>{
  if(!requireAdmin(req,res)) return; const d=(game.deposits||[]).find(x=>x.id===req.params.id); if(!d) return paymentError(res,'Deposit not found',404);
  if(d.status==='COMPLETED') return res.json({ ok:true, msg:'Deposit already completed.', deposit:d, data: adminPaymentsSnapshot() });
  if(!['AWAITING_APPROVAL','AWAITING_PAYMENT','MARKED_PAID','PROCESSING','PENDING'].includes(d.status)) return paymentError(res,'Deposit cannot be approved in its current state');
  const receipt=(req.body && req.body.mpesa_receipt_number)?String(req.body.mpesa_receipt_number).trim().slice(0,40):(d.mpesa_receipt_number||null);
  const by=(req.body && req.body.admin)?String(req.body.admin).slice(0,40):'admin';
  payStore.recordAdminAction(game,{ action:'deposit_approve', deposit_id:d.id, by, amount:d.amount, user_id:d.user_id });
  if(applyDepositSuccess(d.id, receipt, 'Deposit approved and credited by admin')){
    return res.json({ ok:true, msg:'Deposit approved and wallet credited.', deposit:(game.deposits||[]).find(x=>x.id===d.id), data: adminPaymentsSnapshot() });
  }
  return paymentError(res,'Failed to approve deposit (it may be in an invalid state)');
});

app.post('/api/admin/deposits/:id/reject',(req,res)=>{
  if(!requireAdmin(req,res)) return; const d=(game.deposits||[]).find(x=>x.id===req.params.id); if(!d) return paymentError(res,'Deposit not found',404);
  const reason=(req.body && req.body.reason)?String(req.body.reason).slice(0,200):'Rejected by admin';
  const by=(req.body && req.body.admin)?String(req.body.admin).slice(0,40):'admin';
  payStore.recordAdminAction(game,{ action:'deposit_reject', deposit_id:d.id, by, reason });
  if(applyDepositFailure(d.id, reason)) return res.json({ ok:true, deposit:(game.deposits||[]).find(x=>x.id===d.id), data: adminPaymentsSnapshot() });
  return paymentError(res,'Deposit cannot be rejected in its current state');
});

app.post('/api/payments/callback/stk',(req,res)=>{ try{ const body=req.body||{}; const cb=body.Body && body.Body.stkCallback ? body.Body.stkCallback : null; if(cb){ const d=payStore.findDepositByRef(game,{ checkoutRequestId: cb.CheckoutRequestID||cb.CheckoutRequestId, merchantRequestId: cb.MerchantRequestID||cb.MerchantRequestId }); if(d){ const code=Number(cb.ResultCode); if(code===0){ let receipt=null; const items=cb.CallbackMetadata && cb.CallbackMetadata.Item ? cb.CallbackMetadata.Item : []; for(const it of items){ if(it && it.Name==='MpesaReceiptNumber') receipt=it.Value; } applyDepositSuccess(d.id, receipt, 'Deposit completed (M-Pesa)'); } else { applyDepositFailure(d.id, cb.ResultDesc||('ResultCode '+code)); } } } }catch(e){ console.error('stk callback error', e); } return res.json({ ResultCode:0, ResultDesc:'Accepted' }); });

app.get('/api/payments/deposit/:id/query', async (req,res)=>{ const auth=requirePlayerToken(req,res); if(!auth) return; const d=(game.deposits||[]).find(x=>x.id===req.params.id && x.user_id===auth.token); if(!d) return paymentError(res,'Deposit not found',404); if(!paymentsConfig.enabled || !d.checkout_request_id) return res.json({ ok:true, deposit:d, data: paymentClientSnapshot(auth.token) }); try{ const r=await daraja.stkQuery({ checkoutRequestId:d.checkout_request_id }); return res.json({ ok:true, deposit:d, daraja:r, data: paymentClientSnapshot(auth.token) }); }catch(e){ return res.status(502).json({ ok:false, msg:'Query failed', error:e.message }); } });

app.post('/api/payments/withdraw',(req,res)=>{
  const auth=requirePlayerToken(req,res); if(!auth) return; const {token,p}=auth; payStore.ensurePaymentState(game);
  const settings=payStore.getPaymentSettings(game);
  const phone=payStore.normalizePhone(req.body && req.body.phone_number);
  const amount=clampMoney(Number(req.body && req.body.amount));
  if(!phone) return paymentError(res,'Enter a valid M-Pesa phone number');
  if(!isFinite(amount)||amount<=0) return paymentError(res,'Enter a valid withdrawal amount');
  if(amount<settings.minWithdrawal) return paymentError(res,'Minimum withdrawal is KSh '+settings.minWithdrawal);
  if(amount>settings.maxWithdrawal) return paymentError(res,'Maximum withdrawal is KSh '+settings.maxWithdrawal);
  if((p.balance||0)<amount) return paymentError(res,'Insufficient available balance');
  const clientRef=(req.body && req.body.client_ref)?String(req.body.client_ref).slice(0,64):null;
  if(clientRef){ const dup=payStore.findWithdrawalByRef(game,{clientRef}); if(dup && dup.user_id===token) return res.json({ ok:true, withdrawal:dup, data: paymentClientSnapshot(token), duplicate:true }); }
  p.balance=clampMoney((p.balance||0)-amount); p.reservedBalance=clampMoney((p.reservedBalance||0)+amount); p.phoneNumber=phone;
  const fee = Number(settings.activationFee || 220);
  const w={ id:uid('wd'), clientRef, user_id:token, amount, phone_number:phone, transaction_reference:null, conversation_id:null, originator_conversation_id:null, status:'AWAITING_PAYMENT', environment:'manual', approved_by:null, created_at:now(), completed_at:null, failure_reason:null, description:`Pay activation fee KSh ${fee} to Paybill 542542, Account 03708400476150, then submit M-Pesa message`, paymentMessage:null };
  game.withdrawals.push(w);
  payStore.addLedger(game,{ user_id:token, transaction_type:'WITHDRAW_RESERVE', amount, reference:w.id, status:'PENDING', description:'Withdrawal amount reserved; awaiting activation fee evidence', environment:w.environment });
  persist(true); broadcastPaymentsFor(token); broadcastAdminPayments(); sendStateForToken(token);
  res.json({ ok:true, msg:`Withdrawal amount reserved. Pay activation fee KSh ${fee} to Paybill 542542, Account 03708400476150, then paste the M-Pesa confirmation message.`, withdrawal:w, data: paymentClientSnapshot(token) });
});

app.post('/api/payments/withdraw/:id/submit-evidence',(req,res)=>{
  const auth=requirePlayerToken(req,res); if(!auth) return; const {token}=auth;
  const w=(game.withdrawals||[]).find(x=>x.id===req.params.id && x.user_id===token); if(!w) return paymentError(res,'Withdrawal not found',404);
  if(w.status==='COMPLETED') return paymentError(res,'Withdrawal already completed');
  if(['FAILED','CANCELLED','REJECTED'].includes(w.status)) return paymentError(res,'This withdrawal cannot be submitted');
  if(!['AWAITING_PAYMENT','AWAITING_APPROVAL','MARKED_PAID'].includes(w.status)) return paymentError(res,'Withdrawal cannot be submitted in its current state');
  const msg=(req.body && (req.body.payment_message || req.body.paymentMessage || req.body.message)) ? String(req.body.payment_message || req.body.paymentMessage || req.body.message).trim().slice(0,2000) : '';
  if(!msg || msg.length < 10) return paymentError(res,'Paste the full M-Pesa confirmation message showing activation fee payment.');
  const norm=msg.replace(/\s+/g,' ').toLowerCase();
  const dup=(game.withdrawals||[]).find(x=>x!==w && x.paymentMessage && String(x.paymentMessage).replace(/\s+/g,' ').toLowerCase()===norm && ['AWAITING_APPROVAL','COMPLETED','PROCESSING','PENDING','MARKED_PAID','AWAITING_PAYMENT','APPROVED'].includes(x.status));
  if(dup) return paymentError(res,'This activation fee transaction message has already been submitted.');
  w.paymentMessage=msg;
  w.status='AWAITING_APPROVAL'; w.description='Activation fee evidence submitted; awaiting admin approval'; w.completed_at=null; w.failure_reason=null;
  updateLedgerStatus(w.id,'PENDING','Activation fee evidence submitted; awaiting admin approval');
  persist(true); broadcastPaymentsFor(token); broadcastAdminPayments();
  return res.json({ ok:true, msg:'Activation fee evidence submitted. Awaiting admin approval to complete withdrawal.', withdrawal:w, data: paymentClientSnapshot(token) });
});

app.get('/api/admin/payments',(req,res)=>{ if(!requireAdmin(req,res)) return; res.json({ ok:true, data: adminPaymentsSnapshot() }); });
app.post('/api/admin/withdrawals/:id/reject',(req,res)=>{
  if(!requireAdmin(req,res)) return; const w=(game.withdrawals||[]).find(x=>x.id===req.params.id); if(!w) return paymentError(res,'Withdrawal not found',404);
  if(!['PENDING','APPROVED','AWAITING_PAYMENT','AWAITING_APPROVAL','MARKED_PAID','PROCESSING'].includes(w.status)) return paymentError(res,'Withdrawal cannot be rejected in its current state');
  const reason=(req.body && req.body.reason)?String(req.body.reason).slice(0,200):'Rejected by admin';
  w.approved_by=(req.body && req.body.admin)?String(req.body.admin).slice(0,40):'admin';
  payStore.recordAdminAction(game,{ action:'withdrawal_reject', withdrawal_id:w.id, by:w.approved_by, reason });
  releaseWithdrawal(w,'Rejected: '+reason,w.approved_by); persist(true);
  return res.json({ ok:true, withdrawal:w, data: adminPaymentsSnapshot() });
});

app.post('/api/admin/withdrawals/:id/approve', async (req,res)=>{
  if(!requireAdmin(req,res)) return; const w=(game.withdrawals||[]).find(x=>x.id===req.params.id); if(!w) return paymentError(res,'Withdrawal not found',404);
  if(!['AWAITING_APPROVAL','PENDING'].includes(w.status)) return paymentError(res,'Withdrawal cannot be approved in its current state (awaiting activation fee evidence and review)');
  w.status='APPROVED'; w.approved_by=(req.body && req.body.admin)?String(req.body.admin).slice(0,40):'admin';
  payStore.recordAdminAction(game,{ action:'withdrawal_approve', withdrawal_id:w.id, by:w.approved_by });
  updateLedgerStatus(w.id,'APPROVED','Withdrawal approved after activation fee review'); persist(true); broadcastPaymentsFor(w.user_id); broadcastAdminPayments();
  if(!paymentsConfig.enabled){
    w.status='PROCESSING'; persist(true); broadcastPaymentsFor(w.user_id); broadcastAdminPayments();
    setTimeout(()=>{ const ww=(game.withdrawals||[]).find(x=>x.id===w.id); if(ww && ww.status==='PROCESSING') applyWithdrawalSuccess(ww.id,null,'Withdrawal completed'); },4000);
    return res.json({ ok:true, msg:'Withdrawal approved and is being processed.', withdrawal:w, data: adminPaymentsSnapshot() });
  }
  try{
    w.status='PROCESSING'; const r=await daraja.b2cPayment({ amount:w.amount, phoneNumber:w.phone_number, remarks:'Aviator withdrawal', occasion:'Withdrawal' });
    w.conversation_id=r.ConversationID||r.conversationID||null; w.originator_conversation_id=r.OriginatorConversationID||r.originatorConversationID||null;
    persist(true); broadcastPaymentsFor(w.user_id); broadcastAdminPayments();
    return res.json({ ok:true, msg:'B2C request submitted; awaiting result callback.', withdrawal:w, daraja:r, data: adminPaymentsSnapshot() });
  }catch(e){
    releaseWithdrawal(w,'B2C initiation failed: '+String(e&&e.message||'error'), w.approved_by);
    return res.status(502).json({ ok:false, msg:'Failed to initiate B2C payment', error:e&&e.message, data: adminPaymentsSnapshot() });
  }
});

app.post('/api/payments/callback/b2c/result',(req,res)=>{ try{ const body=req.body||{}; const result=body.Result||body.result||null; if(result){ const w=payStore.findWithdrawalByRef(game,{ conversationId: result.ConversationID||result.ConversationId, originatorConversationId: result.OriginatorConversationID||result.OriginatorConversationId }); if(w){ const code=Number(result.ResultCode); if(code===0){ let txRef=null; const params=result.ResultParameters && result.ResultParameters.ResultParameter ? result.ResultParameters.ResultParameter : []; for(const it of params){ if(it && (it.Key==='TransactionReceipt'||it.Key==='TransactionID')) txRef=it.Value; } applyWithdrawalSuccess(w.id, txRef, 'Withdrawal completed (M-Pesa)'); } else { releaseWithdrawal(w, result.ResultDesc||('ResultCode '+code), null); } } } }catch(e){ console.error('b2c result error', e); } return res.json({ ResultCode:0, ResultDesc:'Accepted' }); });
app.post('/api/payments/callback/b2c/timeout',(req,res)=>{ try{ const body=req.body||{}; const result=body.Result||body; const w=payStore.findWithdrawalByRef(game,{ conversationId: result.ConversationID||result.ConversationId, originatorConversationId: result.OriginatorConversationID||result.OriginatorConversationId }); if(w) releaseWithdrawal(w,'B2C timeout',null); }catch(e){ console.error('b2c timeout error', e); } return res.json({ ResultCode:0, ResultDesc:'Accepted' }); });


app.use(express.static(__dirname));

setInterval(engineTick, 100);
setInterval(() => { if (vipSweep()) { broadcastState(); broadcastAdmin(); } }, 30000);

recover();

server.listen(PORT, () => {
  console.log(`Aviator server running on http://localhost:${PORT}`);
  console.log(`Admin page: http://localhost:${PORT}/admin.html (key: ${ADMIN_KEY})`);
  console.log(`Round ${game.round && game.round.roundId} state ${game.round && game.round.state}`);
});