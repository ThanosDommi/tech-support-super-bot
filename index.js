const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const schedule = require('node-schedule');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());

const breaks = {};
const absences = {};
const claims = {};
const claimedCounts = {};
const pendingClaims = {};
const incentivePoints = {};
const agentHours = {};

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

function replyToSlack(channel, text) {
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

function postShiftMessage(slot) {
  const agents = fixedShifts[slot];
  if (!agents) return;
  const message = formatShiftMessage(slot, agents.chat, agents.ticket);
  replyToSlack(process.env.SLACK_CHANNEL_ID, message).catch(console.error);
}

// Shift scheduler
['02:00', '06:00', '10:00', '14:00', '18:00', '22:00'].forEach(t => {
  const [h, m] = t.split(':').map(Number);
  schedule.scheduleJob({ hour: h, minute: m, tz: 'Asia/Jerusalem' }, () => postShiftMessage(t));
});

// Express Event Listener
app.post('/slack/events', async (req, res) => {
  const { type, challenge, event } = req.body;
  if (type === 'url_verification') return res.status(200).send(challenge);

  if (type === 'event_callback' && event && event.type === 'app_mention') {
    const userId = event.user;
    const text = event.text.toLowerCase();
    const channel = event.channel;
    const now = Date.now();

    // ✅ Break logic
    if (text.includes('break')) {
      if (!breaks[userId]) breaks[userId] = { start: 0 };
      const lastBreak = breaks[userId].start;
      const timeSince = now - lastBreak;
      const someoneElse = Object.entries(breaks).some(([uid, b]) => uid !== userId && now - b.start < 30 * 60 * 1000);

      const inFinalHour = false; // Replace with actual shift logic
      if (inFinalHour) {
        await replyToSlack(channel, `⏳ You cannot request a break during the final hour of your shift <@${userId}>.`);
        return res.status(200).end();
      }

      if (timeSince < 30 * 60 * 1000) {
        await replyToSlack(channel, `🕒 You're already on break <@${userId}>! Come back in ${Math.ceil((30 * 60 * 1000 - timeSince) / 60000)} minutes.`);
        return res.status(200).end();
      }

      if (someoneElse) {
        const current = Object.entries(breaks).find(([uid, b]) => uid !== userId && now - b.start < 30 * 60 * 1000);
        const [onBreakId, data] = current;
        const remaining = 30 * 60 * 1000 - (now - data.start);
        await replyToSlack(channel, `❌ <@${onBreakId}> is currently on break. You will be granted a break in ${Math.ceil(remaining / 60000)} minutes.`);
        return res.status(200).end();
      }

      breaks[userId].start = now;
      await replyToSlack(channel, `✅ Break granted to <@${userId}>! Enjoy 30 minutes!`);
      return res.status(200).end();
    }

    // Placeholder for other commands
    if (text.includes('sick') || text.includes('claim') || text.includes('mark_absent') || text.includes('check_shift')) {
      await replyToSlack(channel, `📌 Feature under construction, stay tuned <@${userId}>!`);
      return res.status(200).end();
    }

    await replyToSlack(channel, `👋 Hello <@${userId}>! Need a break? Just mention me with the word "break".`);
    return res.status(200).end();
  }

  res.status(200).end();
});

app.get('/', (req, res) => {
  res.send('🟢 Tech Support Super Bot is active!');
});

app.listen(port, () => {
  console.log(`✅ Bot live on port ${port}`);
});
