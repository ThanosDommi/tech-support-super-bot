const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Slack helpers
async function replyToSlack(channel, message) {
  await axios.post("https://slack.com/api/chat.postMessage", {
    channel,
    text: message,
  }, {
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
}

// Break logic
const activeBreaks = {};
const breakHistory = {};
const breakQueue = [];

function getNovaDay() {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  if (local.getHours() < 2) local.setDate(local.getDate() - 1);
  return local.toISOString().split("T")[0];
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
    return replyToSlack(channel, `⏳ ${userName}, you're queued. ${min} min left before your turn.`);
  }
  const end = Date.now() + 30 * 60000;
  activeBreaks[userId] = end;
  breakHistory[userId] = today;
  replyToSlack(channel, `✅ Break granted to ${userName}! Enjoy 30 min!`);
  setTimeout(() => {
    delete activeBreaks[userId];
    replyToSlack(channel, `🕒 ${userName}, your break is over!`);
    if (breakQueue.length) {
      const next = breakQueue.shift();
      handleBreak(next.userId, next.userName, next.channel);
    }
  }, 30 * 60000);
}

// Slack commands
app.post("/slack/commands", async (req, res) => {
  const { command, channel_id, user_id, trigger_id } = req.body;
  if (command === "/nova_help") {
    await replyToSlack(channel_id, `📝 Nova Help:\n/nova_schedule_today - Show today’s schedule\n/nova_schedule_week - Show this week’s schedule\n/nova_update_shift - Update shift dynamically`);
    return res.send();
  }
  if (command === "/nova_update_shift") {
    await axios.post("https://slack.com/api/views.open", {
      trigger_id,
      view: buildUpdateModal(user_id),
    }, {
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
    return res.send();
  }
  res.send("Unknown command");
});

function buildUpdateModal(userId) {
  const managers = ['U092ABHUREW'];
  const teamLeaders = []; // Add TL IDs as needed
  const isManager = managers.includes(userId);
  const isTeamLeader = teamLeaders.includes(userId);
  if (!isManager && !isTeamLeader) {
    return {
      type: "modal",
      title: { type: "plain_text", text: "Update Shift" },
      close: { type: "plain_text", text: "Close" },
      blocks: [
        { type: "section", text: { type: "plain_text", text: "🚫 You are not authorized to update shifts." } }
      ]
    };
  }
  const typeOptions = isManager ? [
    { text: { type: "plain_text", text: "Agent" }, value: "agent" },
    { text: { type: "plain_text", text: "Team leader" }, value: "team_leader" }
  ] : [
    { text: { type: "plain_text", text: "Agent" }, value: "agent" }
  ];
  return {
    type: "modal",
    callback_id: "update_shift_modal",
    title: { type: "plain_text", text: "Update Shift" },
    submit: { type: "plain_text", text: "Submit" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      ...(isManager ? [{
        type: "input",
        block_id: "type_block",
        label: { type: "plain_text", text: "Select type" },
        element: {
          type: "static_select",
          action_id: "type_select",
          options: typeOptions
        }
      }] : []),
      {
        type: "input",
        block_id: "name_block",
        label: { type: "plain_text", text: "Select name" },
        element: {
          type: "plain_text_input",
          action_id: "name_input"
        }
      },
      {
        type: "input",
        block_id: "time_block",
        label: { type: "plain_text", text: "Select time frame" },
        element: {
          type: "plain_text_input",
          action_id: "time_input"
        }
      },
      {
        type: "input",
        block_id: "role_block",
        label: { type: "plain_text", text: "Select role" },
        element: {
          type: "plain_text_input",
          action_id: "role_input"
        }
      }
    ]
  };
}

app.post("/slack/events", async (req, res) => {
  const { type, event } = req.body;
  if (type === 'url_verification') return res.send({ challenge: req.body.challenge });
  if (event && event.type === 'app_mention' && /break/i.test(event.text)) {
    await handleBreak(event.user, `<@${event.user}>`, event.channel);
  }
  res.sendStatus(200);
});

app.listen(PORT, () => console.log(`✅ Nova listening on ${PORT}`));