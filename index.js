const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const schedule = require('node-schedule');
const qs = require('qs'); // required for slash command parsing
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.urlencoded({ extended: true })); // for slash commands
app.use(bodyParser.json()); // for event handling

// 👥 In-memory storage
const breaks = {};
const sickRequests = [];

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

// 🆕 Slash command: /sick
app.post('/slack/commands', async (req, res) => {
  const { command, user_id, user_name, text } = req.body;

  if (command === '/sick') {
    sickRequests.push({ user_id, user_name, reason: text, time: new Date() });

    // You can also DM TLs here or store more data
    await replyToSlack(process.env.SLACK_CHANNEL_ID, `🤒 <@${user_id}> reported sick: "${text || 'No reason provided'}". TLs please confirm.`);

    res.status(200).send(`✅ Got it <@${user_id}>! A TL will confirm the absence soon.`);
  } else {
    res.status(200).send('Unknown command.');
  }
});

// 🟣 Slack Events API (mentions + break logic)
app.post('/slack/events', async (req, res) => {
  const { type, challenge, event } = req.body;

  if (type === 'url_verification') return res.status(200).send(challenge);

  if (type === 'event_callback' && event.type === 'app_mention') {
    const userId = event.user;
    const text = event.text.toLowerCase();
    const now = Date.now();

    if (text.includes('break')) {
      if (!breaks[userId]) breaks[userId] = { start: 0 };
      const lastBreak = breaks[userId].start;
      const timeSince = now - lastBreak;
      const someoneElse = Object.entries(breaks).some(([uid, b]) => uid !== userId && now - b.start < 30 * 60 * 1000);
      const israelTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' });
      const hour = new Date(israelTime).getHours();

      // Block if last hour
      const currentShift = Object.entries(fixedShifts).find(([slot]) => {
        const [h] = slot.split(':').map(Number);
        return Math.abs(h - hour) <= 2;
      });

      if (currentShift) {
        const [shiftHour] = currentShift[0].split(':').map(Number);
        if ((hour === (shiftHour + 7) % 24)) {
          await replyToSlack(event.channel, `❌ You can't take a break during the last hour of your shift <@${userId}>!`);
          return res.status(200).end();
        }
      }

      if (timeSince < 30 * 60 * 1000) {
        await replyToSlack(event.channel, `🕒 You're already on break <@${userId}>! Come back in ${Math.ceil((30 * 60 * 1000 - timeSince) / 60000)} minutes.`);
        return res.status(200).end();
      }

      if (someoneElse) {
        const other = Object.entries(breaks).find(([uid, b]) => uid !== userId && now - b.start < 30 * 60 * 1000);
        const minsLeft = 30 - Math.floor((now - other[1].start) / 60000);
        await replyToSlack(event.channel, `⏳ Another agent is on break. You can go in ${minsLeft} minutes <@${userId}>.`);
        return res.status(200).end();
      }

      breaks[userId].start = now;
      await replyToSlack(event.channel, `✅ Break granted to <@${userId}>! Enjoy 30 minutes!`);
      return res.status(200).end();
    }

    await replyToSlack(event.channel, `👋 Hello <@${userId}>! If you want to request a break, just say "break".`);
    return res.status(200).end();
  }

  res.status(200).end();
});

// 🩺 Health check
app.get('/', (req, res) => {
  res.send('🟢 Tech Support Super Bot is active!');
});

// ⏱ Scheduler for shifts
['02:00', '06:00', '10:00', '14:00', '18:00', '22:00'].forEach(t => {
  const [h, m] = t.split(':').map(Number);
  schedule.scheduleJob({ hour: h, minute: m, tz: 'Asia/Jerusalem' }, () => postShiftMessage(t));
});

app.listen(port, () => {
  console.log(`✅ Bot live on port ${port}`);
});
