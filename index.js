const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const AGENTS = [
  "Aggelos Postantsidis", "Angelica Corpuz", "Christina Zelelidou", "Dimitris Michoudis",
  "Ella Pineda", "Hannah Mae Nojor", "Jay Curativo", "Jean Zamora", "Joyce Kate Dalangin",
  "Krizza Mabale", "Lorain Kate P. Dadacay", "Ma. Yvonne Lareta", "Mae Jean Unda",
  "Merbena Omega", "Michael Andrew Pailande", "Rhaven Regalario Barcelon",
  "Stelios Georgiou", "Veronica Rose Bulos", "Zoe Lefa"
];

const TEAM_LEADERS = [
  "Barbara de Melo Lima", "Carmela Sedanto", "George Marios Alexakis",
  "Giannis Kiriakou", "Krissy Matias", "Márcio Rodrigues"
];

const MANAGER_IDS = ["U092ABHUREW"]; // Add manager/team leader Slack IDs here if needed

// Utility: post to Slack
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

// Break logic with queue
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
    if (breakQueue.length > 0) {
      const next = breakQueue.shift();
      handleBreak(next.userId, next.userName, next.channel);
    }
  }, 30 * 60000);
}

// Slack commands
app.post("/slack/commands", async (req, res) => {
  const { command, channel_id, user_id } = req.body;

  if (command === "/nova_help") {
    await replyToSlack(channel_id, `📝 Nova Help:
• /nova_schedule_today — show today’s schedule
• /nova_schedule_week — show this week’s schedule
• /nova_update_shift — update shift dynamically`);
    return res.send();
  }

  if (command === "/nova_update_shift") {
    await axios.post("https://slack.com/api/views.open", {
      trigger_id: req.body.trigger_id,
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

// Build update modal
function buildUpdateModal(userId) {
  const isManager = MANAGER_IDS.includes(userId);

  return {
    type: "modal",
    callback_id: "update_shift_modal",
    title: { type: "plain_text", text: "Update shift" },
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
          options: [
            { text: { type: "plain_text", text: "Agent" }, value: "agent" },
            { text: { type: "plain_text", text: "Team leader" }, value: "team_leader" }
          ]
        }
      }] : []),
      {
        type: "input",
        block_id: "name_block",
        label: { type: "plain_text", text: "Select name" },
        element: {
          type: "static_select",
          action_id: "name_select",
          options: (isManager ? AGENTS.concat(TEAM_LEADERS) : AGENTS).map(name => ({
            text: { type: "plain_text", text: name },
            value: name
          }))
        }
      },
      {
        type: "input",
        block_id: "date_block",
        label: { type: "plain_text", text: "Select date" },
        element: {
          type: "datepicker",
          action_id: "date_select"
        }
      },
      {
        type: "input",
        block_id: "time_block",
        label: { type: "plain_text", text: "Select time frame" },
        element: {
          type: "static_select",
          action_id: "time_select",
          options: (isManager ? [
            { text: { type: "plain_text", text: "00:00-04:00" }, value: "00:00-04:00" },
            { text: { type: "plain_text", text: "04:00-08:00" }, value: "04:00-08:00" },
            { text: { type: "plain_text", text: "08:00-12:00" }, value: "08:00-12:00" },
            { text: { type: "plain_text", text: "12:00-16:00" }, value: "12:00-16:00" },
            { text: { type: "plain_text", text: "16:00-20:00" }, value: "16:00-20:00" },
            { text: { type: "plain_text", text: "20:00-00:00" }, value: "20:00-00:00" }
          ] : [
            { text: { type: "plain_text", text: "10:00-14:00" }, value: "10:00-14:00" },
            { text: { type: "plain_text", text: "14:00-18:00" }, value: "14:00-18:00" },
            { text: { type: "plain_text", text: "18:00-22:00" }, value: "18:00-22:00" },
            { text: { type: "plain_text", text: "22:00-02:00" }, value: "22:00-02:00" },
            { text: { type: "plain_text", text: "02:00-06:00" }, value: "02:00-06:00" },
            { text: { type: "plain_text", text: "06:00-10:00" }, value: "06:00-10:00" }
          ])
        }
      },
      {
        type: "input",
        block_id: "role_block",
        label: { type: "plain_text", text: "Select role" },
        element: {
          type: "static_select",
          action_id: "role_select",
          options: (isManager ? [
            { text: { type: "plain_text", text: "Backend" }, value: "backend" },
            { text: { type: "plain_text", text: "Frontend" }, value: "frontend" }
          ] : [
            { text: { type: "plain_text", text: "Chat" }, value: "chat" },
            { text: { type: "plain_text", text: "Ticket" }, value: "ticket" }
          ])
        }
      }
    ]
  };
}

app.listen(PORT, () => console.log(`✅ Nova listening on ${PORT}`));
