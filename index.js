const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const schedule = require('node-schedule');
const { WebClient } = require('@slack/web-api');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;
const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const breaks = {}; // { userId: { start: timestamp } }
const breakQueue = [];
const shiftCheckins = {}; // { timestamp: { userId: 'pending' | 'checked_in' | 'absent' } }
const absences = {}; // { userId: [date strings] }

const allowedUsers = [
  'U092ABHUREW' // Thanos
];

const fixedShifts = {
  '02:00': { chat: ['Zoe', 'Jean', 'Thanos'], ticket: ['Mae Jean', 'Ella', 'Thanos'] },
  '06:00': { chat: ['Krizza', 'Lorain', 'Thanos'], ticket: ['Michael', 'Dimitris', 'Thanos'] },
  '10:00': { chat: ['Angelica', 'Stelios', 'Thanos'], ticket: ['Christina Z.', 'Aggelos', 'Thanos'] },
  '14:00': { chat: ['Zoe', 'Jean', 'Thanos'], ticket: ['Mae Jean', 'Ella', 'Thanos'] },
  '18:00': { chat: ['Krizza', 'Lorain', 'Thanos'], ticket: ['Michael', 'Dimitris', 'Thanos'] },
  '22:00': { chat: ['Angelica', 'Stelios', 'Thanos'], ticket: ['Christina Z.', 'Aggelos', 'Thanos'] }
};

const dailyThemes = {
  Sunday: { chat: '🌙', ticket: '💤' },
  Monday: { chat: '🌞', ticket: '📩' },
  Tuesday: { chat: '🪓', ticket: '🛡️' },
  Wednesday: { chat: '🧬', ticket: '🔬' },
  Thursday: { chat: '🍃', ticket: '🌻' },
  Friday: { chat: '🔥', ticket: '💼' },
  Saturday: { chat: '❄️', ticket: '🧊' }
};

function getTodayTheme() {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'Asia/Jerusalem'
  });
  return dailyThemes[today];
}

function getGreeting(hour) {
  if (hour < 12) return 'Good morning Tech Agents!';
  if (hour < 18) return 'Good afternoon Tech Agents!';
  return 'Good evening Tech Agents!';
}

function formatShiftMessage(slot, chatAgents, ticketAgents) {
  const theme = getTodayTheme();
  const nowIL = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' });
  const hour = new Date(nowIL).getHours();
  const greeting = getGreeting(hour);
  return `🕒 ${greeting}\n\n${theme.chat} Chat Agents: ${chatAgents.join(', ')}\n${theme.ticket} Ticket Agents: ${ticketAgents.join(', ')}\n`;
}

async function replyToSlack(channel, text) {
  return axios.post('https://slack.com/api/chat.postMessage', {
    channel,
    text
  }, {
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
}

async function postShiftMessage(slot) {
  const agents = fixedShifts[slot];
  if (!agents) return;
  const message = formatShiftMessage(slot, agents.chat, agents.ticket);
  const response = await slack.chat.postMessage({
    channel: process.env.SLACK_CHANNEL_ID,
    text: message
  });
  const ts = response.ts;
  const allAgents = [...agents.chat, ...agents.ticket];
  shiftCheckins[ts] = {};
  allAgents.forEach(agent => {
    shiftCheckins[ts][agent.toLowerCase()] = 'pending';
  });
  setTimeout(() => checkShiftCheckins(ts, allAgents), 4 * 60 * 1000);
}

async function checkShiftCheckins(ts, agents) {
  const pending = Object.entries(shiftCheckins[ts] || {}).filter(([_, status]) => status === 'pending');
  for (const [name] of pending) {
    const user = await findUserIdByName(name);
    if (user) {
      await replyToSlack('C092H86AJ2J', `❌ <@${user}> has not checked in for the shift. Please confirm presence ASAP.`);
      setTimeout(() => finalizeAbsence(ts, user, name), 2 * 60 * 1000);
    }
  }
}

function finalizeAbsence(ts, userId, name) {
  if (shiftCheckins[ts] && shiftCheckins[ts][name] === 'pending') {
    shiftCheckins[ts][name] = 'absent';
    const today = new Date().toISOString().split('T')[0];
    if (!absences[userId]) absences[userId] = [];
    absences[userId].push(today);
    replyToSlack('C092H86AJ2J', `📌 <@${userId}> marked as absent for today.`);
  }
}

async function findUserIdByName(name) {
  try {
    const users = await slack.users.list();
    const match = users.members.find(u => u.name.toLowerCase().includes(name.toLowerCase()) || u.real_name.toLowerCase().includes(name.toLowerCase()));
    return match?.id;
  } catch {
    return null;
  }
}

function getCurrentILHour() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).getHours();
}

function isInLastHour() {
  const hour = getCurrentILHour();
  return (hour === 9 || hour === 17 || hour === 1);
}

function resetBreaksDaily() {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    Object.keys(breaks).forEach(user => delete breaks[user]);
  }
}

function startBreakTimer(userId, channel) {
  breaks[userId] = { start: Date.now() };
  setTimeout(() => {
    delete breaks[userId];
    if (breakQueue.length > 0) {
      const next = breakQueue.shift();
      startBreakTimer(next.userId, next.channel);
      replyToSlack(next.channel, `✅ Break now granted to <@${next.userId}>! Enjoy your 30 minutes!`);
    }
  }, 30 * 60 * 1000);
}

function getRemainingTime(startTime) {
  const now = Date.now();
  const remainingMs = 30 * 60 * 1000 - (now - startTime);
  const mins = Math.ceil(remainingMs / 60000);
  return mins > 0 ? mins : 0;
}

// Weekly absence report every Sunday 10:00 IL
schedule.scheduleJob({ hour: 10, minute: 0, dayOfWeek: 0, tz: 'Asia/Jerusalem' }, async () => {
  if (Object.keys(absences).length === 0) return;
  let report = `📊 *Weekly Absence Report*\n\n`;
  for (const [userId, days] of Object.entries(absences)) {
    report += `<@${userId}> – ${days.length} missed shift(s)\n`;
  }
  await slack.chat.postMessage({
    channel: 'U092ABHUREW',
    text: report
  });
  for (const key in absences) delete absences[key];
});

app.post('/slack/events', async (req, res) => {
  const { type, challenge, event } = req.body;
  if (type === 'url_verification') return res.status(200).send(challenge);

  if (type === 'event_callback' && event.type === 'app_mention') {
    const userId = event.user;
    const rawText = event.text;
    const channel = event.channel;
    const text = rawText.replace(/<@[^>]+>/g, '').trim().toLowerCase();

    resetBreaksDaily();

    if (text.includes('break')) {
      if (breaks[userId]) {
        await replyToSlack(channel, `🕒 You're already on break <@${userId}>! Come back soon.`);
        return res.status(200).end();
      }
      if (isInLastHour()) {
        await replyToSlack(channel, `⛔ Sorry <@${userId}>, no breaks allowed during the last hour of your shift.`);
        return res.status(200).end();
      }
      const activeBreak = Object.entries(breaks).find(([uid, b]) => Date.now() - b.start < 30 * 60 * 1000);
      if (activeBreak) {
        const [onBreakUserId, breakInfo] = activeBreak;
        const minsLeft = getRemainingTime(breakInfo.start);
        breakQueue.push({ userId, channel });
        await replyToSlack(channel, `❌ Someone else is on break!\n⏳ <@${onBreakUserId}> has **${minsLeft} minutes** left. You’ll be next!`);
        return res.status(200).end();
      }
      startBreakTimer(userId, channel);
      await replyToSlack(channel, `✅ Break granted to <@${userId}>! Enjoy 30 minutes!`);
      return res.status(200).end();
    }
    await replyToSlack(channel, `👋 Hello <@${userId}>! Just say \"break\" to request one.`);
    return res.status(200).end();
  }
  res.status(200).end();
});

app.post('/slack/commands', async (req, res) => {
  const { user_id, command, channel_id } = req.body;
  if (command === '/breaks') {
    if (!allowedUsers.includes(user_id)) return res.send(`❌ You are not allowed to use this command.`);
    const current = Object.entries(breaks).map(([uid, info]) => {
      const mins = Math.ceil((30 * 60 * 1000 - (Date.now() - info.start)) / 60000);
      return `<@${uid}> (${mins} min left)`;
    });
    const queued = breakQueue.map(b => `<@${b.userId}>`);
    let msg = '🧘 *Break Dashboard*\n';
    msg += `\n*Currently on break:*\n${current.length ? current.join('\n') : 'Nobody'}\n`;
    msg += `\n*In queue:*\n${queued.length ? queued.join('\n') : 'Nobody waiting'}`;
    return res.send(msg);
  }
  res.send('Unknown command.');
});

// Scheduler
['02:00', '06:00', '10:00', '14:00', '18:00', '22:00'].forEach(t => {
  const [h, m] = t.split(':').map(Number);
  schedule.scheduleJob({ hour: h, minute: m, tz: 'Asia/Jerusalem' }, () => postShiftMessage(t));
});

app.get('/', (req, res) => {
  res.send('🟢 Tech Support Super Bot is active!');
});

app.listen(port, () => {
  console.log(`✅ Bot live on port ${port}`);
});
