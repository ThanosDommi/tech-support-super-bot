const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const activeBreaks = {};
const breakHistory = {};
const breakQueue = [];

function getNovaDay() {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  if (local.getHours() < 2) local.setDate(local.getDate() - 1);
  return local.toISOString().split("T")[0];
}

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

app.post("/slack/events", async (req, res) => {
  const { type, event } = req.body;
  if (type === "url_verification") return res.send({ challenge: req.body.challenge });
  if (event && event.type === "app_mention" && /break/i.test(event.text)) {
    await handleBreak(event.user, `<@${event.user}>`, event.channel);
  }
  res.sendStatus(200);
});

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
  const managers = ["U092ABHUREW"];
  const isManager = managers.includes(userId);

  const agentTimeframes = [
    "10:00-14:00", "14:00-18:00", "18:00-22:00",
    "22:00-2:00", "2:00-6:00", "6:00-10:00"
  ];
  const tlTimeframes = [
    "00:00-4:00", "4:00-8:00", "8:00-12:00",
    "12:00-16:00", "16:00-20:00", "20:00-00:00"
  ];

  const agentNames = ["Stelios Georgiou", "Dimitris Michoudis", "Aggelos Diogenis P.", "Christina Z.", "Ella Pineda", "Jay Curativo", "Maria Yvonne Lareta", "Mae Jean Unda", "Jean Zamora", "Zoe Lefa", "Hannah Mae Nojor", "Merbena Omega", "Angelica", "Krizza Mabale", "Lorain Kate", "Veronica Rose Bulos", "Rhaven Barcelon"];
  const tlNames = ["George", "Giannis", "Carmela", "Krissy", "Barbara", "Marcio"];

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
          options: (isManager ? agentNames.concat(tlNames) : agentNames).map(name => ({
            text: { type: "plain_text", text: name },
            value: name
          }))
        }
      },
      {
        type: "input",
        block_id: "time_block",
        label: { type: "plain_text", text: "Select time frame" },
        element: {
          type: "static_select",
          action_id: "time_select",
          options: (isManager ? agentTimeframes.concat(tlTimeframes) : agentTimeframes).map(tf => ({
            text: { type: "plain_text", text: tf },
            value: tf
          }))
        }
      },
      {
        type: "input",
        block_id: "role_block",
        label: { type: "plain_text", text: "Select role" },
        element: {
          type: "static_select",
          action_id: "role_select",
          options: (isManager ? ["chat", "ticket", "backend", "frontend"] : ["chat", "ticket"]).map(r => ({
            text: { type: "plain_text", text: r.charAt(0).toUpperCase() + r.slice(1) },
            value: r
          }))
        }
      }
    ]
  };
}

app.listen(PORT, () => console.log(`✅ Nova listening on ${PORT}`));