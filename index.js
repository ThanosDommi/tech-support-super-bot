const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const schedule = require('node-schedule');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const breaks = {};
const absenceReports = [];

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
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

function postShiftMessage(slot) {
  const agents = fixedShifts[slot];
  if (!agents) return;
  const message = formatShiftMessage(slot, agents.chat, agents.ticket);
  replyToSlack(process.env.SLACK_CHANNEL_ID, message).catch(console.error);
}

// 🔔 Event Handler
app.post('/slack/events', async (req, res) => {
  console.log('🔔 Incoming Slack event:', req.body);

  const { type, challenge, event } = req.body;

  if (type === 'url_verification') {
    return res.status(200).send(challenge);
  }

  if (type === 'event_callback' && event && event.type === 'app_mention') {
    const userId = event.user;
    const text = event.text.toLowerCase();
    const now = Date.now();

    console.log(`🔵 Mentioned by user: ${userId}`);
    console.log(`📝 Text parsed: ${text}`);

    if (text.includes('break')) {
      if (!breaks[userId]) breaks[userId] = { start: 0 };
      const lastBreak = breaks[userId].start;
      const timeSince = now - lastBreak;
      const someoneElse = Object.entries(breaks).some(([uid, b]) => uid !== userId && now - b.start < 30 * 60 * 1000);

      if (timeSince < 30 * 60 * 1000) {
        await replyToSlack(event.channel, `🕒 You're already on break <@${userId}>! Come back soon.`);
        return res.status(200).end();
      }

      if (someoneElse) {
        const otherBreak = Object.entries(breaks).find(([uid, b]) => uid !== userId && now - b.start < 30 * 60 * 1000);
        const remaining = 30 - Math.floor((now - otherBreak[1].start) / 60000);
        await replyToSlack(event.channel, `⌛ Someone else is on break. Please try again in ${remaining} minutes.`);
        return res.status(200).end();
      }

      breaks[userId].start = now;
      await replyToSlack(event.channel, `✅ Break granted to <@${userId}>! Enjoy 30 minutes!`);
      return res.status(200).end();
    }

    if (text.includes('sick')) {
      await replyToSlack(event.channel, `📌 Feature under construction, stay tuned <@${userId}>!`);
      return res.status(200).end();
    }

    await replyToSlack(event.channel, `👋 Hello <@${userId}>! If you want to request a break, just say "break".`);
    return res.status(200).end();
  }

  res.status(200).end();
});

// Slash Commands Endpoint
app.post('/slack/commands', async (req, res) => {
  const { command, user_id, text, response_url } = req.body;
  console.log(`📟 Slash command received: ${command} from ${user_id}`);

  if (command === '/sick') {
    const message = `🤒 <@${user_id}> reported sick. TLs, please confirm and mark the shift as absent.`;
    await replyToSlack(process.env.SLACK_CHANNEL_ID, message);
    return res.status(200).send(`✅ Your sick report has been received. Get well soon!`);
  }

  res.status(200).send('⚙️ Command received. Processing...');
});

// Health check
app.get('/', (req, res) => {
  res.send('🟢 Tech Support Super Bot is active!');
});

// Scheduler
['02:00', '06:00', '10:00', '14:00', '18:00', '22:00'].forEach(t => {
  const [h, m] = t.split(':').map(Number);
  schedule.scheduleJob({ hour: h, minute: m, tz: 'Asia/Jerusalem' }, () => postShiftMessage(t));
});

app.listen(port, () => {
  console.log(`✅ Bot live on port ${port}`);
});
