const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// --- Utility to post to Slack ---
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
  } catch (err) {
    console.error('Slack error:', err);
  }
}

// --- Scheduler ---
const shiftTimes = ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];

async function postShiftMessage(time) {
  const agentRes = await pool.query('SELECT * FROM agent_shifts WHERE shift_time = $1 AND shift_date = CURRENT_DATE', [time]);
  const tlRes = await pool.query('SELECT * FROM tl_shifts WHERE shift_time = $1 AND shift_date = CURRENT_DATE', [time]);
  const agents = agentRes.rows;
  const tls = tlRes.rows;

  let msg = `⏰ Shift Update for ${time} (Asia/Jerusalem)\n`;

  if (agents.length) {
    const chat = agents.filter(a => a.role === 'chat').map(a => a.name).join(', ') || 'None';
    const ticket = agents.filter(a => a.role === 'ticket').map(a => a.name).join(', ') || 'None';
    msg += `🌼 *Chat Agents:* ${chat}\n📩 *Ticket Agents:* ${ticket}\n`;
  }

  if (tls.length) {
    const backend = tls.find(t => t.role === 'backend')?.name || 'TBD';
    const frontend = tls.find(t => t.role === 'frontend')?.name || 'TBD';
    msg += `🧠 *Backend TL:* ${backend}\n💬 *Frontend TL:* ${frontend}`;
  }

  await replyToSlack(process.env.SLACK_CHANNEL_ID, msg);
}

setInterval(async () => {
  const now = new Date();
  const time = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).toTimeString().slice(0,5);
  if (shiftTimes.includes(time)) {
    await postShiftMessage(time);
  }
}, 60000);

// --- Break Logic ---
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

// --- Slack endpoint ---
app.post('/slack/events', async (req, res) => {
  const { type, event } = req.body;

  if (type === 'url_verification') {
    return res.send({ challenge: req.body.challenge });
  }

  if (event && event.type === 'app_mention' && /break/i.test(event.text)) {
    await handleBreak(event.user, `<@${event.user}>`, event.channel);
  }

  res.sendStatus(200);
});

// Health check
app.get('/', (req, res) => res.send('Nova is live!'));

app.listen(PORT, () => console.log(`✅ Nova listening on port ${PORT}`));
