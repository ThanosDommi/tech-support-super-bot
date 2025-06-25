const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// === Config ===
const SLACK_CHANNEL_SUPPORT = 'C0929GPUAAZ';   // On-duty announcements
const SLACK_CHANNEL_COVERAGE = 'C092HG70ZPY';  // Coverage gaps
const BREAK_DURATION = 30 * 60 * 1000; // 30 minutes

// === Memory Stores ===
const currentBreaks = {}; // { userId: endTimestamp }
const breakQueue = [];    // [{ userId, channel }]

// === Utility: Post to a Slack channel ===
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
    console.error('Error sending message to Slack:', error.response?.data || error.message);
  }
}

// === Greeting by Time ===
function getGreeting(hour) {
  if (hour < 12) return '🌅 Good morning Tech Agents!';
  if (hour < 18) return '🌞 Good afternoon Tech Agents!';
  return '🌙 Good evening Tech Agents!';
}

// === Rotating Emojis ===
const emojiThemes = [
  { chat: '🌼', ticket: '📩' },
  { chat: '🔮', ticket: '🧾' },
  { chat: '🍭', ticket: '📪' },
  { chat: '🍀', ticket: '📬' },
];

// === Fixed Team Leaders ===
const teamLeaders = {
  '02:00': { backend: 'Carmela', frontend: 'Krissy' },
  '04:00': { backend: 'Krissy', frontend: 'Carmela' },
  '08:00': { backend: 'George', frontend: 'Giannis' },
  '12:00': { backend: 'Giannis', frontend: 'George' },
  '16:00': { backend: 'Barbara', frontend: 'Marcio' },
  '20:00': { backend: 'Marcio', frontend: 'Barbara' },
  '00:00': { backend: 'Carmela', frontend: 'Krissy' },
};

// === Agent Shift Assignments ===
const agentShifts = {
  '02:00': {
    chat: ['Zoe', 'Jean'],
    ticket: ['Mae Jean', 'Ella']
  },
  '06:00': {
    chat: ['Krizza', 'Lorain'],
    ticket: ['Michael', 'Dimitris']
  },
  '10:00': {
    chat: ['Angelica', 'Stelios', 'Thanos'],
    ticket: ['Christina Z.', 'Aggelos', 'Thanos']
  },
  '14:00': {
    chat: ['Cezamarie', 'Jean', 'Thanos'],
    ticket: ['Lorain', 'Ella', 'Thanos']
  },
  '18:00': {
    chat: ['Krizza', 'Zoe', 'Thanos'],
    ticket: ['Michael', 'Jean', 'Thanos']
  },
  '22:00': {
    chat: ['Angelica', 'Jean', 'Thanos'],
    ticket: ['Christina Z.', 'Ella', 'Thanos']
  }
};

// === Shift Announcement Logic ===
async function postShiftMessage(time) {
  const { chat, ticket } = agentShifts[time] || {};
  const tl = teamLeaders[time] || {};
  const emoji = emojiThemes[Math.floor(Math.random() * emojiThemes.length)];
  const greeting = getGreeting(parseInt(time));

  let message = `🧠 *Team Leader Assignment*\n🧠 Backend TL: ${tl.backend || 'TBD'}\n💬 Frontend TL: ${tl.frontend || 'TBD'}\n\n`;
  message += `🕒 ${greeting}\n\n`;
  if (chat && ticket) {
    message += `${emoji.chat} *Chat Agents:* ${chat.join(', ')}\n`;
    message += `${emoji.ticket} *Ticket Agents:* ${ticket.join(', ')}`;
  } else {
    message += '⚠️ No agent data found for this shift.';
  }

  await replyToSlack(SLACK_CHANNEL_SUPPORT, message);
}

// === Auto Shift Scheduler (every minute) ===
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

// === Slack Events: Break Handling via @Nova Mentions ===
app.post('/slack/events', async (req, res) => {
  const event = req.body.event;
  res.sendStatus(200);
  if (!event || event.type !== 'app_mention') return;

  const userId = event.user;
  const channel = event.channel;
  const now = new Date();

  // Already on break?
  if (currentBreaks[userId]) {
    const remaining = Math.ceil((currentBreaks[userId] - now) / 60000);
    await replyToSlack(channel, `🕒 <@${userId}>, you're already on break! ${remaining} minutes left.`);
    return;
  }

  // Someone else is on break?
  const otherId = Object.keys(currentBreaks)[0];
  if (otherId) {
    const remaining = Math.ceil((currentBreaks[otherId] - now) / 60000);
    breakQueue.push({ userId, channel });
    await replyToSlack(channel, `⏳ <@${userId}> you're queued for a break. ${remaining} minutes left before it's your turn.`);
    return;
  }

  // Grant break
  currentBreaks[userId] = new Date(now.getTime() + BREAK_DURATION);
  await replyToSlack(channel, `✅ <@${userId}> you're on a 30-minute break now. Enjoy!`);

  setTimeout(async () => {
    delete currentBreaks[userId];
    await replyToSlack(channel, `⏰ <@${userId}>, your break is over!`);

    // Grant next in queue
    if (breakQueue.length > 0) {
      const next = breakQueue.shift();
      currentBreaks[next.userId] = new Date(Date.now() + BREAK_DURATION);
      await replyToSlack(next.channel, `🔁 <@${next.userId}> it's your turn! Enjoy your 30-minute break.`);

      setTimeout(async () => {
        delete currentBreaks[next.userId];
        await replyToSlack(next.channel, `⏰ <@${next.userId}> your break is over!`);
      }, BREAK_DURATION);
    }
  }, BREAK_DURATION);
});

// === Health Check ===
app.get('/', (req, res) => {
  res.send('Nova is up and running!');
});

// === Start App ===
app.listen(PORT, () => {
  console.log(`✅ Nova is live on port ${PORT}`);
});

