const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const schedule = require('node-schedule');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// === Config ===
const SHIFT_CHANNEL = 'C0929GPUAAZ'; // #on_duty_tech_support
const ABSENCES_CHANNEL = 'C092H86AJ2J'; // #absences
const TL_IDS = ['U092ABHUREW', 'U092XEY44AZ']; // Team Leaders

const breaks = {};
const breakQueue = [];

// === Greetings ===
function getGreeting(hour) {
  if (hour < 12) return '🌅 Good morning Tech Agents!';
  if (hour < 18) return '🌞 Good afternoon Tech Agents!';
  return '🌙 Good evening Tech Agents!';
}

const emojiThemes = [
  { chat: '🌼', ticket: '📩' },
  { chat: '🔮', ticket: '🧾' },
  { chat: '🍭', ticket: '📪' },
  { chat: '🍀', ticket: '📬' },
];

// === Fixed Shifts ===
const agentShifts = {
  '02:00': { chat: ['Zoe', 'Jean'], ticket: ['Mae Jean', 'Ella'] },
  '06:00': { chat: ['Krizza', 'Lorain'], ticket: ['Michael', 'Dimitris'] },
  '10:00': { chat: ['Angelica', 'Stelios', 'Thanos'], ticket: ['Christina Z.', 'Aggelos', 'Thanos'] },
  '14:00': { chat: ['Cezamarie', 'Jean'], ticket: ['Lorain', 'Ella'] },
  '18:00': { chat: ['Krizza', 'Zoe'], ticket: ['Michael', 'Jean'] },
  '22:00': { chat: ['Angelica', 'Jean'], ticket: ['Christina Z.', 'Ella'] }
};

const teamLeaders = {
  '08:00': { backend: 'George', frontend: 'Giannis' },
  '12:00': { backend: 'Giannis', frontend: 'George' },
  '16:00': { backend: 'Barbara', frontend: 'Marcio' },
  '20:00': { backend: 'Marcio', frontend: 'Barbara' },
  '00:00': { backend: 'Carmela', frontend: 'Krissy' },
  '04:00': { backend: 'Krissy', frontend: 'Carmela' },
};

// === Posters ===
async function replyToSlack(channel, text) {
  await axios.post('https://slack.com/api/chat.postMessage', {
    channel,
    text
  }, {
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
}

async function postAgentShift(time) {
  const shift = agentShifts[time];
  if (!shift) return;
  const greeting = getGreeting(Number(time.split(':')[0]));
  const emoji = emojiThemes[Math.floor(Math.random() * emojiThemes.length)];
  const msg = `${greeting}

${emoji.chat} *Chat Agents:* ${shift.chat.join(', ')}
${emoji.ticket} *Ticket Agents:* ${shift.ticket.join(', ')}`;
  await replyToSlack(SHIFT_CHANNEL, msg);
}

async function postTLShift(time) {
  const shift = teamLeaders[time];
  if (!shift) return;
  const msg = `🧠 *Team Leader Assignment*
🧠 Backend TL: ${shift.backend}
💬 Frontend TL: ${shift.frontend}`;
  await replyToSlack(SHIFT_CHANNEL, msg);
}

// === Scheduler ===
const agentTimes = ['02:00', '06:00', '10:00', '14:00', '18:00', '22:00'];
const tlTimes = ['08:00', '12:00', '16:00', '20:00', '00:00', '04:00'];

[...agentTimes, ...tlTimes].forEach(time => {
  const [hour, minute] = time.split(':');
  schedule.scheduleJob({ hour: +hour, minute: +minute, tz: 'Asia/Jerusalem' }, () => {
    if (agentTimes.includes(time)) postAgentShift(time);
    if (tlTimes.includes(time)) postTLShift(time);
  });
});

// === Commands ===
app.post('/slack/commands', async (req, res) => {
  const { command, user_id } = req.body;
  if (command === '/sick') {
    await replyToSlack(ABSENCES_CHANNEL, `🥺 <@${user_id}> reported sick. TLs, please confirm and mark the shift as absent.`);
    return res.json({ response_type: 'ephemeral', text: '✅ Your sick report has been received. Get well soon!' });
  }
  return res.status(200).send('⚙️ Command received.');
});

// === Event Listener ===
app.post('/slack/events', async (req, res) => {
  const { type, event } = req.body;
  if (type === 'url_verification') return res.send(req.body.challenge);
  if (type !== 'event_callback' || !event) return res.sendStatus(200);

  const { type: eventType, user, reaction, item, item_user } = event;

  // ✅ = Sick confirmation
  if (eventType === 'reaction_added' && reaction === 'white_check_mark' && TL_IDS.includes(user)) {
    const text = `📣 A gap just opened due to absence. TL <@${user}> confirmed. Please check and fill the role!`;
    await replyToSlack('C092HG70ZPY', text);
  }

  res.sendStatus(200);
});

// === Break Logic ===
app.post('/slack/events', async (req, res) => {
  const { type, event } = req.body;
  if (type === 'event_callback' && event.type === 'app_mention') {
    const now = Date.now();
    const userId = event.user;
    const text = event.text.toLowerCase();

    const userHasBreak = breaks[userId] && (now - breaks[userId].start < 30 * 60 * 1000);
    const inFinalHour = false; // TODO: future improvement by shift tracking
    const someoneElse = Object.entries(breaks).find(([uid, b]) => uid !== userId && now - b.start < 30 * 60 * 1000);

    if (text.includes('break')) {
      if (userHasBreak) {
        return replyToSlack(event.channel, `🕒 <@${userId}> you're already on break!`);
      }
      if (inFinalHour) {
        return replyToSlack(event.channel, `⛔ <@${userId}>, no breaks in the last hour of your shift.`);
      }
      if (someoneElse) {
        const [otherId, otherData] = someoneElse;
        const remaining = 30 - Math.floor((now - otherData.start) / 60000);
        breakQueue.push(userId);
        return replyToSlack(event.channel, `⌛ <@${userId}>, someone else is on break. You're in line! ${remaining} minutes left.`);
      }
      // grant break
      breaks[userId] = { start: now };
      return replyToSlack(event.channel, `✅ Break granted <@${userId}>! Enjoy 30 minutes.`);
    }

    return replyToSlack(event.channel, `👋 Hello <@${userId}>! Need a break? Just mention me with "break".`);
  }
  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('Nova is up and running!');
});

app.listen(PORT, () => {
  console.log(`✅ Nova live on port ${PORT}`);
});
