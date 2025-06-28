const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Utility: Post to Slack
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

// Break logic
const activeBreaks = {};
const breakHistory = {};
const breakQueue = [];

function getNovaDay() {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  if (local.getHours() < 2) local.setDate(local.getDate() - 1);
  return local.toISOString().split('T')[0];
}

async function handleBreak(userId, userName, channel) {
  const today = getNovaDay();

  if (breakHistory[userId] === today) {
    return replyToSlack(channel, `❌ <@${userId}>, you've already had a break today.`);
  }

  if (activeBreaks[userId]) {
    const min = Math.ceil((activeBreaks[userId] - Date.now()) / 60000);
    return replyToSlack(channel, `⏳ <@${userId}>, you're already on break! ${min} min left.`);
  }

  if (Object.keys(activeBreaks).length > 0) {
    breakQueue.push({ userId, userName, channel });
    const [curr] = Object.keys(activeBreaks);
    const min = Math.ceil((activeBreaks[curr] - Date.now()) / 60000);
    return replyToSlack(channel, `⏳ <@${userId}>, you're queued. ${min} min left before your turn.`);
  }

  const end = Date.now() + 30 * 60000;
  activeBreaks[userId] = end;
  breakHistory[userId] = today;
  replyToSlack(channel, `✅ Break granted to <@${userId}>! Enjoy 30 min!`);

  setTimeout(() => {
    delete activeBreaks[userId];
    replyToSlack(channel, `🕒 <@${userId}>, your break is over!`);
    if (breakQueue.length) {
      const next = breakQueue.shift();
      handleBreak(next.userId, next.userName, next.channel);
    }
  }, 30 * 60000);
}

// Slack commands
app.post('/slack/commands', async (req, res) => {
  const { command, channel_id } = req.body;

  if (command === '/nova_schedule_today') {
    await postShiftMessageToday(channel_id);
    return res.send();
  }

  if (command === '/nova_schedule_week') {
    await postShiftMessageWeek(channel_id);
    return res.send();
  }

  if (command === '/nova_help') {
    await replyToSlack(channel_id, `📝 Nova Help:\n/nova_schedule_today - Show today’s schedule\n/nova_schedule_week - Show this week’s schedule\n/nova_update_shift - Update shift dynamically`);
    return res.send();
  }

  if (command === '/nova_update_shift') {
    await replyToSlack(channel_id, `⚡ Shift update functionality coming soon!`);
    return res.send();
  }

  res.send('Unknown command');
});

async function postShiftMessageToday(channel) {
  const today = getNovaDay();
  const agents = await pool.query('SELECT * FROM agent_shifts WHERE shift_date=$1 ORDER BY shift_time', [today]);
  if (agents.rows.length === 0) {
    return replyToSlack(channel, `:calendar_spiral: *Today’s Schedule (${today})*\n_No shifts scheduled for today._`);
  }
  let msg = `:calendar_spiral: *Today’s Schedule (${today})*\n`;
  agents.rows.forEach(r => {
    const roleIcon = ':bust_in_silhouette:';
    msg += `${roleIcon} ${r.role.toUpperCase()} | ${r.name} | ${r.shift_time} - ${r.shift_end_time}\n`;
  });
  await replyToSlack(channel, msg);
}

async function postShiftMessageWeek(channel) {
  const agents = await pool.query('SELECT * FROM agent_shifts ORDER BY shift_date, shift_time');
  if (agents.rows.length === 0) {
    return replyToSlack(channel, `:calendar_spiral: *Weekly Schedule*\n_No shifts scheduled._`);
  }
  let msg = `:calendar_spiral: *Weekly Schedule*\n`;
  agents.rows.forEach(r => {
    const roleIcon = ':bust_in_silhouette:';
    msg += `${r.shift_date} | ${roleIcon} ${r.role.toUpperCase()} | ${r.name} | ${r.shift_time} - ${r.shift_end_time}\n`;
  });
  await replyToSlack(channel, msg);
}

app.get('/', (req, res) => res.send('Nova is live!'));

app.listen(PORT, () => console.log(`✅ Nova listening on ${PORT}`));
