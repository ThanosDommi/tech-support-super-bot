const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const schedule = require('node-schedule');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());

const breaks = {}; // { userId: { start: timestamp } }
const breakQueue = []; // [{ userId, channel }]

const fixedShifts = {
  '02:00': { chat: ['Zoe', 'Jean', 'Thanos'], ticket: ['Mae Jean', 'Ella', 'Thanos'] },
  '06:00': { chat: ['Krizza', 'Lorain', 'Thanos'], ticket: ['Michael', 'Dimitris', 'Thanos'] },
  '10:00': { chat: ['Angelica', 'Stelios', 'Thanos'], ticket: ['Christina Z.', 'Aggelos', 'Thanos'] },
  '14:00': { chat: ['Zoe', 'Jean', 'Thanos'], ticket: ['Mae Jean', 'Ella', 'Thanos'] },
  '18:00': { chat: ['Krizza', 'Lorain', 'Thanos'], ticket: ['Michael', 'Dimitris', 'Thanos'] },
  '22:00': { chat: ['Angelica', 'Stelios', 'Thanos'], ticket: ['Christina Z.', 'Aggelos', 'Thanos'] }
};

const teamLeaderAssignments = {
  '08:00': { backend: 'George', frontend: 'Giannis' },
  '12:00': { backend: 'Giannis', frontend: 'George' },
  '16:00': { backend: 'Barbara', frontend: 'Marcio' },
  '20:00': { backend: 'Marcio', frontend: 'Barbara' },
  '00:00': { backend: 'Carmela', frontend: 'Krissy' },
  '04:00': { backend: 'Krissy', frontend: 'Carmela' }
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
    timeZone: 'Asia/Jerusalem',
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

function formatTeamLeaderMessage(slot) {
  const leaders = teamLeaderAssignments[slot];
  if (!leaders) return '';
  return `🎯 *Team Leader Assignment*\n🧠 Backend TL: ${leaders.backend}\n💬 Frontend TL: ${leaders.frontend}`;
}

function replyToSlack(channel, text) {
  return axios.post('https://slack.com/api/chat.postMessage', {
    channel,
    text
  }, {
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    }
  }).then(res => {
    console.log('📤 Slack API response:', res.data);
  }).catch(err => {
    console.error('❌ Slack API error:', err.response?.data || err.message);
  });
}

function postShiftMessage(slot) {
  const agents = fixedShifts[slot];
  if (!agents) return;
  const message = formatShiftMessage(slot, agents.chat, agents.ticket);
  replyToSlack(process.env.SLACK_CHANNEL_ID, message);
}

function postTeamLeaderMessage(slot) {
  const message = formatTeamLeaderMessage(slot);
  if (message) replyToSlack(process.env.SLACK_CHANNEL_ID, message);
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

app.post('/slack/events', async (req, res) => {
  const { type, challenge, event } = req.body;
  if (type === 'url_verification') return res.status(200).send(challenge);

  if (type === 'event_callback' && event.type === 'app_mention') {
    const userId = event.user;
    const rawText = event.text;
    const channel = event.channel;
    const text = rawText.replace(/<@[^>]+>/g, '').trim().toLowerCase();

    console.log(`🔵 Mentioned by ${userId}:`, text);

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
        breakQueue.push({ userId, channel });
        await replyToSlack(channel, `🕓 Break queue activated <@${userId}>. You’ll be next!`);
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

// Health check
app.get('/', (req, res) => {
  res.send('🟢 Tech Support Super Bot is active!');
});

// Schedulers
['02:00', '06:00', '10:00', '14:00', '18:00', '22:00'].forEach(t => {
  const [h, m] = t.split(':').map(Number);
  schedule.scheduleJob({ hour: h, minute: m, tz: 'Asia/Jerusalem' }, () => postShiftMessage(t));
});

['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'].forEach(tl => {
  const [h, m] = tl.split(':').map(Number);
  schedule.scheduleJob({ hour: h, minute: m, tz: 'Asia/Jerusalem' }, () => postTeamLeaderMessage(tl));
});

app.listen(port, () => {
  console.log(`✅ Bot live on port ${port}`);
});
