const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Slack Channel IDs
const ON_DUTY_CHANNEL = 'C0929GPUAAZ'; // #on_duty_tech_support
const ABSENCES_CHANNEL = 'C092H86AJ2J'; // #absences
const COVERAGE_CHANNEL = 'C092HG70ZPY'; // #coverage

// Approved Team Leader IDs
const TEAM_LEADERS = ['U092ABHUREW', 'U092XEY44AZ'];

// Utility: Post to Slack
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
    console.error('Slack post error:', error);
  }
}

// Greeting logic
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

const teamLeaders = {
  '02:00': { backend: 'Carmela', frontend: 'Krissy' },
  '04:00': { backend: 'Krissy', frontend: 'Carmela' },
  '08:00': { backend: 'George', frontend: 'Giannis' },
  '12:00': { backend: 'Giannis', frontend: 'George' },
  '16:00': { backend: 'Barbara', frontend: 'Marcio' },
  '20:00': { backend: 'Marcio', frontend: 'Barbara' },
  '00:00': { backend: 'Carmela', frontend: 'Krissy' },
};

const agentShifts = {
  '02:00': { chat: ['Zoe', 'Jean', 'Thanos'], ticket: ['Mae Jean', 'Ella', 'Thanos'] },
  '06:00': { chat: ['Krizza', 'Lorain', 'Thanos'], ticket: ['Michael', 'Dimitris', 'Thanos'] },
  '10:00': { chat: ['Angelica', 'Stelios', 'Thanos'], ticket: ['Christina Z.', 'Aggelos', 'Thanos'] },
  '14:00': { chat: ['Cezamarie', 'Jean', 'Thanos'], ticket: ['Lorain', 'Ella', 'Thanos'] },
  '18:00': { chat: ['Krizza', 'Zoe', 'Thanos'], ticket: ['Michael', 'Jean', 'Thanos'] },
  '22:00': { chat: ['Angelica', 'Jean', 'Thanos'], ticket: ['Christina Z.', 'Ella', 'Thanos'] },
};

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

  await replyToSlack(ON_DUTY_CHANNEL, message);
}

const shiftTimes = ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];
setInterval(async () => {
  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 5);
  if (shiftTimes.includes(currentTime)) {
    console.log(`⏰ Posting shift message for ${currentTime}`);
    await postShiftMessage(currentTime);
  }
}, 60000);

// Slash commands
app.post('/slack/commands', async (req, res) => {
  const { command, user_id } = req.body;

  if (command === '/sick') {
    const message = `🥺 <@${user_id}> reported sick.\nTLs, please confirm by reacting with ✅ to mark the shift as available.`;
    await replyToSlack(ABSENCES_CHANNEL, message);
    return res.json({
      response_type: 'ephemeral',
      text: '✅ Your sick report has been received. Get well soon!'
    });
  }

  return res.status(200).send('⚙️ Command received. Processing...');
});

// Reaction event logic
app.post('/slack/events', async (req, res) => {
  const { type, event } = req.body;
  if (type === 'url_verification') return res.send(req.body.challenge);

  if (event && event.type === 'reaction_added') {
    const { reaction, item_user, item, user } = event;

    if (reaction === 'white_check_mark' && TEAM_LEADERS.includes(user)) {
      try {
        const messageResp = await axios.post('https://slack.com/api/conversations.history', {
          channel: item.channel,
          latest: item.ts,
          inclusive: true,
          limit: 1
        }, {
          headers: {
            Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
            'Content-Type': 'application/json',
          }
        });

        const sickMsg = messageResp.data.messages[0];
        const match = sickMsg.text.match(/<@(.*?)>/);
        if (!match) return res.status(200).end();
        const sickUserId = match[1];

        const coverageMsg = `📢 <@${sickUserId}>'s shift is now open due to reported sick leave.\nAvailable to claim via \`/claim_shift\`.`;
        await replyToSlack(COVERAGE_CHANNEL, coverageMsg);
      } catch (err) {
        console.error('Failed to post sick coverage message:', err);
      }
    }
  }

  res.status(200).end();
});

app.get('/', (req, res) => {
  res.send('Nova is up and running!');
});

app.listen(PORT, () => {
  console.log(`✅ Nova is live on port ${PORT}`);
});
