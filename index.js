const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { Pool } = require('pg');
const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

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

function getGreeting(hour, isAgentShift) {
  if (hour < 12) return isAgentShift ? 'Good morning Agents!' : 'Good morning Team Leaders!';
  if (hour < 18) return isAgentShift ? 'Good afternoon Agents!' : 'Good afternoon Team Leaders!';
  return isAgentShift ? 'Good evening Agents!' : 'Good evening Team Leaders!';
}

const emojiThemes = [
  { chat: '🌼', ticket: '📩' },
  { chat: '🔮', ticket: '🧾' },
  { chat: '🍭', ticket: '📪' },
  { chat: '🍀', ticket: '📬' },
];

async function postShiftMessage(time) {
  const today = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }).split(',')[0];
  const resAgents = await pool.query("SELECT * FROM agent_shifts WHERE shift_time = $1 AND shift_date = $2", [time, today]);
  const resTLs = await pool.query("SELECT * FROM tl_shifts WHERE shift_time = $1 AND shift_date = $2", [time, today]);

  const emoji = emojiThemes[Math.floor(Math.random() * emojiThemes.length)];
  const isAgentShift = resAgents.rowCount > 0;
  const isTLShift = resTLs.rowCount > 0;
  const hour = parseInt(time.split(':')[0]);
  const greeting = getGreeting(hour, isAgentShift);

  let message = `${greeting}\n\n`;

  if (isAgentShift) {
    const chatAgents = resAgents.rows.filter(r => r.role === 'chat').map(r => r.name).join(', ') || 'None';
    const ticketAgents = resAgents.rows.filter(r => r.role === 'ticket').map(r => r.name).join(', ') || 'None';
    message += `${emoji.chat} *Chat Agents:* ${chatAgents}\n`;
    message += `${emoji.ticket} *Ticket Agents:* ${ticketAgents}\n`;
  }
  
  if (isTLShift) {
    const backend = resTLs.rows.find(r => r.role === 'backend')?.name || 'TBD';
    const frontend = resTLs.rows.find(r => r.role === 'frontend')?.name || 'TBD';
    message += `🧠 Backend TL: ${backend}\n💬 Frontend TL: ${frontend}`;
  }

  await replyToSlack('C0929GPUAAZ', message);
}

const breakTracker = {};
const activeBreaks = {};
const breakQueue = [];

function getNovaDay() {
  const now = new Date();
  const israelTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  if (israelTime.getHours() < 2) israelTime.setDate(israelTime.getDate() - 1);
  return israelTime.toISOString().split('T')[0];
}

async function handleBreakRequest(userId, userName, channel) {
  const today = getNovaDay();

  if (activeBreaks[userId]) {
    const remaining = Math.ceil((activeBreaks[userId].end - Date.now()) / 60000);
    return replyToSlack(channel, `❗ <@${userId}>, you're already on break! ${remaining} minutes left.`);
  }

  if (breakTracker[userId] === today) {
    return replyToSlack(channel, `❌ <@${userId}>, you've already had your break for today.`);
  }

  if (Object.keys(activeBreaks).length > 0) {
    const [currentId] = Object.keys(activeBreaks);
    const remaining = Math.ceil((activeBreaks[currentId].end - Date.now()) / 60000);
    breakQueue.push({ userId, userName, channel });
    return replyToSlack(channel, `⏳ <@${userId}>, you're queued for a break. ${remaining} minutes left before it's your turn.`);
  }

  const end = Date.now() + 30 * 60000;
  activeBreaks[userId] = { end };
  breakTracker[userId] = today;
  replyToSlack(channel, `✅ Break granted to <@${userId}>! Enjoy 30 minutes!`);

  setTimeout(() => {
    delete activeBreaks[userId];
    replyToSlack(channel, `🕒 <@${userId}>, your break is over!`);
    if (breakQueue.length > 0) {
      const next = breakQueue.shift();
      handleBreakRequest(next.userId, next.userName, next.channel);
    }
  }, 30 * 60000);
}

app.post('/slack/events', async (req, res) => {
  const { type, event } = req.body;

  if (type === 'url_verification') {
    return res.send({ challenge: req.body.challenge });
  }

  if (event && event.type === 'app_mention' && event.text.includes('break')) {
    const userId = event.user;
    const userName = `<@${userId}>`;
    const channel = event.channel;

    if (userId === 'U092ABHUREW') {
      await handleBreakRequest(userId, userName, channel);
    } else {
      await replyToSlack(channel, `🚫 Sorry <@${userId}>, break logic is in test mode for now.`);
    }
  }

  res.sendStatus(200);
});

const shiftTimes = ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];
setInterval(async () => {
  const now = new Date();
  const israelTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const currentTime = israelTime.toTimeString().slice(0, 5);
  if (shiftTimes.includes(currentTime)) {
    console.log(`⏰ Posting shift message for ${currentTime}`);
    await postShiftMessage(currentTime);
  }
}, 60000);

app.get('/', (req, res) => {
  res.send('Nova is up and running!');
});

app.listen(PORT, () => {
  console.log(`✅ Nova is live on port ${PORT}`);
});

