const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Utility: Post to a Slack channel
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

// Greeting logic
function getGreeting(hour) {
  if (hour < 12) return 'Good morning Tech Agents!';
  if (hour < 18) return 'Good afternoon Tech Agents!';
  return 'Good evening Tech Agents!';
}

// Rotating emojis
const emojiThemes = [
  { chat: '🌼', ticket: '📩' },
  { chat: '🔮', ticket: '🧾' },
  { chat: '🍭', ticket: '📪' },
  { chat: '🍀', ticket: '📬' },
];

// Team Leaders
const teamLeaders = {
  '02:00': { backend: 'Carmela', frontend: 'Krissy' },
  '04:00': { backend: 'Krissy', frontend: 'Carmela' },
  '08:00': { backend: 'George', frontend: 'Giannis' },
  '12:00': { backend: 'Giannis', frontend: 'George' },
  '16:00': { backend: 'Barbara', frontend: 'Marcio' },
  '20:00': { backend: 'Marcio', frontend: 'Barbara' },
  '00:00': { backend: 'Carmela', frontend: 'Krissy' },
};

// Agent shifts
const agentShifts = {
  '02:00': { chat: ['Zoe', 'Jean'], ticket: ['Mae Jean', 'Ella'] },
  '06:00': { chat: ['Krizza', 'Lorain'], ticket: ['Michael', 'Dimitris'] },
  '10:00': { chat: ['Angelica', 'Stelios', 'Thanos'], ticket: ['Christina Z.', 'Aggelos', 'Thanos'] },
  '14:00': { chat: ['Cezamarie', 'Jean', 'Thanos'], ticket: ['Lorain', 'Ella', 'Thanos'] },
  '18:00': { chat: ['Krizza', 'Zoe', 'Thanos'], ticket: ['Michael', 'Jean', 'Thanos'] },
  '22:00': { chat: ['Angelica', 'Jean', 'Thanos'], ticket: ['Christina Z.', 'Ella', 'Thanos'] }
};

// Shift message posting
async function postShiftMessage(time) {
  const { chat, ticket } = agentShifts[time] || {};
  const tl = teamLeaders[time] || {};
  const emoji = emojiThemes[Math.floor(Math.random() * emojiThemes.length)];
  const greeting = getGreeting(parseInt(time));

  let message = `${greeting}\n\n`;

  const isAgentShift = chat || ticket;
  const isTLShift = tl.backend || tl.frontend;

  if (isAgentShift && isTLShift) {
    message += `${emoji.chat} *Chat Agents:* ${chat?.join(', ') || 'None'}\n`;
    message += `${emoji.ticket} *Ticket Agents:* ${ticket?.join(', ') || 'None'}`;
  } else if (isAgentShift) {
    message += `${emoji.chat} *Chat Agents:* ${chat?.join(', ') || 'None'}\n`;
    message += `${emoji.ticket} *Ticket Agents:* ${ticket?.join(', ') || 'None'}`;
  } else if (isTLShift) {
    message += `🧠 *Team Leader Assignment*\n🧠 Backend TL: ${tl.backend || 'TBD'}\n💬 Frontend TL: ${tl.frontend || 'TBD'}`;
  }

  await replyToSlack('C0929GPUAAZ', message);
}

// Break Logic
const breakTracker = {}; // Tracks last break date per user
const activeBreaks = {}; // Tracks ongoing breaks
const breakQueue = []; // Tracks queued break requests

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

// Slack Event
app.post('/slack/events', async (req, res) => {
  const { type, event } = req.body;

  if (type === 'url_verification') {
    return res.send({ challenge: req.body.challenge });
  }

  if (event && event.type === 'app_mention' && event.text.includes('break')) {
    const userId = event.user;
    const userName = `<@${userId}>`;
    const channel = event.channel;

    // Only allow Thanos (you) to test for now
    if (userId === 'U092ABHUREW') {
      await handleBreakRequest(userId, userName, channel);
    } else {
      await replyToSlack(channel, `🚫 Sorry <@${userId}>, break logic is in test mode for now.`);
    }
  }

  res.sendStatus(200);
});

// Auto Scheduler (24/7)
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

// Health check
app.get('/', (req, res) => {
  res.send('Nova is up and running!');
});

app.listen(PORT, () => {
  console.log(`✅ Nova is live on port ${PORT}`);
});
