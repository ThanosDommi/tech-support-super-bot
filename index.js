const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Utility to post to Slack
async function replyToSlack(channel, message) {
  try {
    await axios.post('https://slack.com/api/chat.postMessage', {
      channel,
      text: message,
    }, {
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Error sending message to Slack:', error);
  }
}

// Rotating emojis
const emojiThemes = [
  { chat: '🌼', ticket: '📩' },
  { chat: '🔮', ticket: '🧾' },
  { chat: '🍭', ticket: '📪' },
  { chat: '🍀', ticket: '📬' },
];

function getNovaDay() {
  const now = new Date();
  const israelTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  if (israelTime.getHours() < 2) israelTime.setDate(israelTime.getDate() - 1);
  return israelTime.toISOString().split('T')[0];
}

// Break system
const breakTracker = {};
const activeBreaks = {};
const breakQueue = [];

async function handleBreakRequest(userId, userName, channel) {
  const today = getNovaDay();

  if (activeBreaks[userId]) {
    const remaining = Math.ceil((activeBreaks[userId].end - Date.now()) / 60000);
    return replyToSlack(channel, `❗ ${userName}, you're already on break! ${remaining} minutes left.`);
  }

  if (breakTracker[userId] === today) {
    return replyToSlack(channel, `❌ ${userName}, you've already had your break for today.`);
  }

  if (Object.keys(activeBreaks).length > 0) {
    const [currentId] = Object.keys(activeBreaks);
    const remaining = Math.ceil((activeBreaks[currentId].end - Date.now()) / 60000);
    breakQueue.push({ userId, userName, channel });
    return replyToSlack(channel, `⏳ ${userName}, you're queued for a break. ${remaining} minutes left before it's your turn.`);
  }

  // Check if last 30 min of shift (query DB)
  const { rows } = await pool.query(
    `SELECT * FROM agent_shifts WHERE name = $1 AND shift_date = $2 ORDER BY shift_time DESC LIMIT 1`,
    [userName.replace(/[<>@]/g, ''), today]
  );
  if (rows[0]) {
    const shiftEnd = new Date(`${today}T${rows[0].shift_time}`);
    shiftEnd.setMinutes(shiftEnd.getMinutes() + 480); // assume 8hr shift
    const now = new Date();
    if ((shiftEnd - now) / 60000 < 30) {
      return replyToSlack(channel, `🚫 ${userName}, too late for a break — shift is ending soon!`);
    }
  }

  const end = Date.now() + 30 * 60000;
  activeBreaks[userId] = { end };
  breakTracker[userId] = today;
  replyToSlack(channel, `✅ Break granted to ${userName}! Enjoy 30 minutes!`);

  setTimeout(() => {
    delete activeBreaks[userId];
    replyToSlack(channel, `🕒 ${userName}, your break is over!`);
    if (breakQueue.length > 0) {
      const next = breakQueue.shift();
      handleBreakRequest(next.userId, next.userName, next.channel);
    }
  }, 30 * 60000);
}

// Help command
async function postHelp(channel) {
  const helpText = `📝 *Nova Help*
/nova schedule_today — Post today's schedule
/nova schedule_week — Post this week's schedule
/nova update_shift — Update shift dynamically
/nova break — Request a break`;
  await replyToSlack(channel, helpText);
}

// Slack event handler
app.post('/slack/events', async (req, res) => {
  const { type, event } = req.body;

  if (type === 'url_verification') {
    return res.send({ challenge: req.body.challenge });
  }

  if (event && event.type === 'app_mention') {
    const userId = event.user;
    const userName = `<@${userId}>`;
    const channel = event.channel;

    if (event.text.includes('break')) {
      await handleBreakRequest(userId, userName, channel);
    } else if (event.text.includes('help')) {
      await postHelp(channel);
    } else {
      await replyToSlack(channel, `🤖 Sorry ${userName}, I didn’t understand. Try /nova help`);
    }
  }

  res.sendStatus(200);
});

// Health check
app.get('/', (req, res) => {
  res.send('Nova is up and running!');
});

app.listen(PORT, () => {
  console.log(`✅ Nova is live on port ${PORT}`);
});
