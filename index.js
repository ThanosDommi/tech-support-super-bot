const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Post to Slack
async function replyToSlack(channel, message) {
  await axios.post('https://slack.com/api/chat.postMessage', {
    channel,
    text: message,
  }, {
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
}

// Emoji rotation
const emojiThemes = [
  { chat: '🌼', ticket: '📩' },
  { chat: '🔮', ticket: '🧾' },
  { chat: '🍭', ticket: '📪' },
  { chat: '🍀', ticket: '📬' }
];

// Break logic
const activeBreaks = {};
const breakHistory = {};
const breakQueue = [];

function getNovaDay() {
  const now = new Date();
  const israel = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  if (israel.getHours() < 2) israel.setDate(israel.getDate() - 1);
  return israel.toISOString().split('T')[0];
}

async function handleBreak(userId, userName, channel) {
  const today = getNovaDay();
  if (breakHistory[userId] === today) {
    return replyToSlack(channel, `❌ ${userName}, you've already had a break today.`);
  }
  if (activeBreaks[userId]) {
    const min = Math.ceil((activeBreaks[userId] - Date.now()) / 60000);
    return replyToSlack(channel, `⏳ ${userName}, you're already on break! ${min} min left.`);
  }
  if (Object.keys(activeBreaks).length > 0) {
    breakQueue.push({ userId, userName, channel });
    const [curr] = Object.keys(activeBreaks);
    const min = Math.ceil((activeBreaks[curr] - Date.now()) / 60000);
    return replyToSlack(channel, `⏳ ${userName}, queued. ${min} min left before your turn.`);
  }
  const end = Date.now() + 30 * 60000;
  activeBreaks[userId] = end;
  breakHistory[userId] = today;
  replyToSlack(channel, `✅ Break granted to ${userName}! 30 min!`);
  setTimeout(() => {
    delete activeBreaks[userId];
    replyToSlack(channel, `🕒 ${userName}, break over!`);
    if (breakQueue.length) {
      const next = breakQueue.shift();
      handleBreak(next.userId, next.userName, next.channel);
    }
  }, 30 * 60000);
}

// Rotation logic
function getWeekNumber() {
  const now = new Date();
  const janFirst = new Date(now.getFullYear(), 0, 1);
  return Math.ceil((((now - janFirst) / 86400000) + 1) / 7);
}

function determineRole(shiftTime, week) {
  const defaultRole = shiftTime === '18:00-02:00' ? 'TICKET' : 'CHAT';
  if (week % 2 === 0) return defaultRole;
  return defaultRole === 'TICKET' ? 'CHAT' : 'TICKET';
}

// Slack commands
app.post('/slack/commands', async (req, res) => {
  const { command, channel_id } = req.body;
  if (command === '/nova_schedule_today') {
    const today = new Date().toISOString().split('T')[0];
    const week = getWeekNumber();
    const emoji = emojiThemes[Math.floor(Math.random() * emojiThemes.length)];
    const agents = await pool.query('SELECT * FROM agent_shifts ORDER BY shift_time, name');
    let msg = `:calendar_spiral: *Today’s Schedule (${today})*\n`;
    agents.rows.forEach(r => {
      const role = determineRole(r.shift_time, week);
      const icon = role === 'CHAT' ? emoji.chat : emoji.ticket;
      msg += `${icon} ${role} | ${r.name} | ${r.shift_time}\n`;
    });
    await replyToSlack(channel_id, msg);
    return res.send();
  }
  if (command === '/nova_help') {
    await replyToSlack(channel_id, `📝 Nova Help:\n/nova_schedule_today - Show today’s schedule with rotation`);
    return res.send();
  }
  res.send('Unknown command');
});

// Slack events (break)
app.post('/slack/events', async (req, res) => {
  const { type, event } = req.body;
  if (type === 'url_verification') return res.send({ challenge: req.body.challenge });
  if (event && event.type === 'app_mention' && /break/i.test(event.text)) {
    await handleBreak(event.user, `<@${event.user}>`, event.channel);
  }
  res.sendStatus(200);
});

// Health
app.get('/', (req, res) => res.send('Nova is live with rotation + breaks + emojis!'));

app.listen(PORT, () => console.log(`✅ Nova live on ${PORT}`));
