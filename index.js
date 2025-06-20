const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const schedule = require('node-schedule');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
app.use(bodyParser.json());

const breaks = {};
const fixedShifts = {
  '02:00': { chat: ['Zoe', 'Jean'], ticket: ['Mae Jean', 'Ella'] },
  '06:00': { chat: ['Krizza', 'Lorain'], ticket: ['Michael', 'Dimitris'] },
  '10:00': { chat: ['Angelica', 'Stelios'], ticket: ['Christina Z.', 'Aggelos'] },
  '14:00': { chat: ['Zoe', 'Jean'], ticket: ['Mae Jean', 'Ella'] },
  '18:00': { chat: ['Krizza', 'Lorain'], ticket: ['Michael', 'Dimitris'] },
  '22:00': { chat: ['Angelica', 'Stelios'], ticket: ['Christina Z.', 'Aggelos'] }
};

const dailyThemes = {
  Sunday:    { chat: '🌙', ticket: '💤' },
  Monday:    { chat: '🌞', ticket: '📩' },
  Tuesday:   { chat: '🪓', ticket: '🛡️' },
  Wednesday: { chat: '🧬', ticket: '🔬' },
  Thursday:  { chat: '🍃', ticket: '🌻' },
  Friday:    { chat: '🔥', ticket: '💼' },
  Saturday:  { chat: '❄️', ticket: '🧊' }
};

function getTodayTheme() {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Jerusalem' });
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
  axios.post('https://slack.com/api/chat.postMessage', {
    channel,
    text
  }, {
    headers: {
      'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    }
  }).catch(console.error);
}

function postShiftMessage(slot) {
  const agents = fixedShifts[slot];
  if (!agents) return;

  const message = formatShiftMessage(slot, agents.chat, agents.ticket);
  replyToSlack(process.env.SLACK_CHANNEL_ID, message);
}

// --- Break Handler ---
app.post('/slack/events', (req, res) => {
  const body = req.body;

  if (body.type === 'url_verification') {
    return res.status(200).json({ challenge: body.challenge });
  }

  if (body.event && body.event.type === 'app_mention') {
    const userId = body.event.user;
    const text = body.event.text.toLowerCase();

    if (text.includes('break')) {
      const now = Date.now();
      const userBreak = breaks[userId];

      if (userBreak && now - userBreak.start < 30 * 60 * 1000) {
        replyToSlack(body.event.channel, `🕒 You're already on break <@${userId}>! Come back in ${Math.ceil((30 * 60 * 1000 - (now - userBreak.start)) / 60000)} minutes.`);
        return res.status(200).send();
      }

      const someoneElseOnBreak = Object.entries(breaks).some(([uid, b]) =>
        uid !== userId && now - b.start < 30 * 60 * 1000
      );

      if (someoneElseOnBreak) {
        replyToSlack(body.event.channel, '❌ Someone else is on break. Please try again later.');
        return res.status(200).send();
      }

      breaks[userId] = { start: now };
      replyToSlack(body.event.channel, `✅ Break granted to <@${userId}>! Enjoy 30 minutes!`);
      return res.status(200).send();
    }
  }

  res.status(200).send();
});

// --- Schedule shift messages every 4 hours ---
['02:00', '06:00', '10:00', '14:00', '18:00', '22:00'].forEach(t => {
  const [h, m] = t.split(':').map(Number);
  schedule.scheduleJob({ hour: h, minute: m, tz: 'Asia/Jerusalem' }, () => postShiftMessage(t));
});

// --- Default Route ---
app.get('/', (req, res) => {
  res.send('🟢 Tech Support Super Bot is active!');
});

app.listen(port, () => {
  console.log(`✅ Bot live on port ${port}`);
});

