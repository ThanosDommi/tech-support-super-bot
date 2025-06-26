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

// Time-based greetings
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

// Team Leaders fixed structure
const teamLeaders = {
  '02:00': { backend: 'Carmela', frontend: 'Krissy' },
  '04:00': { backend: 'Krissy', frontend: 'Carmela' },
  '08:00': { backend: 'George', frontend: 'Giannis' },
  '12:00': { backend: 'Giannis', frontend: 'George' },
  '16:00': { backend: 'Barbara', frontend: 'Marcio' },
  '20:00': { backend: 'Marcio', frontend: 'Barbara' },
  '00:00': { backend: 'Carmela', frontend: 'Krissy' },
};

// Agent shift structure
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

// Post shift message
async function postShiftMessage(time) {
  const { chat, ticket } = agentShifts[time] || {};
  const tl = teamLeaders[time] || {};
  const emoji = emojiThemes[Math.floor(Math.random() * emojiThemes.length)];
  const greeting = getGreeting(parseInt(time));

  if (tl.backend || tl.frontend) {
    let message = `${greeting}\n\n`;
    message += `🧠 *Team Leader Assignment*\n🧠 Backend TL: ${tl.backend || 'TBD'}\n💬 Frontend TL: ${tl.frontend || 'TBD'}`;
    await replyToSlack('C0929GPUAAZ', message);
    return;
  }

  if (chat && ticket) {
    let message = `${greeting}\n\n`;
    message += `${emoji.chat} *Chat Agents:* ${chat.join(', ')}\n`;
    message += `${emoji.ticket} *Ticket Agents:* ${ticket.join(', ')}`;
    await replyToSlack('C0929GPUAAZ', message);
    return;
  }

  let message = `${greeting}\n\n⚠️ No scheduled agents for this shift.`;
  await replyToSlack('C0929GPUAAZ', message);
}

// Shift scheduler (24/7)
const shiftTimes = ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];
setInterval(async () => {
  const now = new Date();
  const israelTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const currentTime = israelTime.toTimeString().slice(0, 5);
  if (shiftTimes.includes(currentTime)) {
    console.log(`⏰ Posting shift message for ${currentTime}`);
    await postShiftMessage(currentTime);
  }
}, 60000); // every minute check

// Health check
app.get('/', (req, res) => {
  res.send('Nova is up and running!');
});

app.listen(PORT, () => {
  console.log(`✅ Nova is live on port ${PORT}`);
});
