const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const schedule = require('node-schedule');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

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
  })
  .then(res => {
    console.log('📤 Slack API response:', res.data);
  })
  .catch(err => {
    console.error('❌ Slack API error:', err.response?.data || err.message);
  });
}

function postShiftMessage(slot) {
  const agents = fixedShifts[slot];
  if (!agents) return;
  const message = formatShiftMessage(slot, agents.chat, agents.ticket);
  replyToSlack(process.env.SLACK_CHANNEL_ID, message).catch(console.error);
}

function postTeamLeaderMessage(slot) {
  const message = formatTeamLeaderMessage(slot);
  if (message) {
    replyToSlack(process.env.SLACK_CHANNEL_ID, message).catch(console.error);
  }
}

// 🔔 Slack Event Handler
app.post('/slack/events', async (req, res) => {
  console.log('🔔 Incoming Slack event:', req.body);

  const { type, challenge, event } = req.body;

  if (type === 'url_verification') {
    return res.status(200).send(challenge);
  }

  if (type === 'event_callback' && event && event.type === 'app_mention') {
    const userId = event.user;
    const rawText = event.text;
    const text = rawText
      .replace(/<@[^>]+>/g, '')
      .trim()
      .toLowerCase();

    const now = Date.now();

    console.log(`🔵 Mentioned by user: ${userId}`);
    console.log(`📝 Text parsed: ${text}`);

    if (text.includes('break')) {
      if (!breaks[userId]) breaks[userId] = { start: 0 };
      const lastBreak = breaks[userId].start;
      const timeSince = now - lastBreak;
      const someoneElse = Object.entries(breaks).some(([uid, b]) => uid !== userId && now - b.start < 30 * 60 * 1000);

      if (timeSince < 30 * 60 * 1000) {
        await replyToSlack(event.channel, `🕒 You're already on break <@${userId}>! Come back in ${Math.ceil((30 * 60 * 1000 - timeSince) / 60000)} minutes.`);
        return res.status(200).end();
      }

      if (someoneElse) {
        await replyToSlack(event.channel, '❌ Someone else is on break. Please try again later.');
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

// Health check
app.get('/', (req, res) => {
  res.send('🟢 Tech Support Super Bot is active!');
});

// ⏰ Schedule shift messages
['02:00', '06:00', '10:00', '14:00', '18:00', '22:00'].forEach(t => {
  const [h, m] = t.split(':').map(Number);
  schedule.scheduleJob({ hour: h, minute: m, tz: 'Asia/Jerusalem' }, () => postShiftMessage(t));
});

// ⏰ Schedule team leader announcements
['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'].forEach(t => {
  const [h, m] = t.split(':').map(Number);
  schedule.scheduleJob({ hour: h, minute: m, tz: 'Asia/Jerusalem' }, () => postTeamLeaderMessage(t));
});

app.listen(port, () => {
  console.log(`✅ Bot live on port ${port}`);
});
