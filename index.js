const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Post to Slack
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

// Break logic (keep existing)
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
    if (breakQueue.length) {
      const next = breakQueue.shift();
      handleBreak(next.userId, next.userName, next.channel);
    }
  }, 30 * 60000);
}

// Slack commands
app.post("/slack/commands", async (req, res) => {
  const { command, channel_id, user_id } = req.body;

  if (command === "/nova_help") {
    await replyToSlack(channel_id, `📝 Nova Help:\n/nova_schedule_today - Show today’s schedule\n/nova_schedule_week - Show this week’s schedule\n/nova_update_shift - Update shift dynamically`);
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

// Modal builder
function buildUpdateModal(userId) {
  const isManager = [/* list of manager Slack IDs */].includes(userId);

  return {
    type: "modal",
    callback_id: "update_shift_modal",
    title: { type: "plain_text", text: "Update Shift" },
    submit: { type: "plain_text", text: "Submit" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      ...(isManager ? [
        {
          type: "input",
          block_id: "type_block",
          label: { type: "plain_text", text: "Select type" },
          element: {
            type: "static_select",
            action_id: "type_select",
            options: [
              { text: { type: "plain_text", text: "Agent" }, value: "agent" },
              { text: { type: "plain_text", text: "Team leader" }, value: "team_leader" },
            ]
          }
        }
      ] : []),
      {
        type: "input",
        block_id: "name_block",
        label: { type: "plain_text", text: "Select name" },
        element: {
          type: "static_select",
          action_id: "name_select",
          options: [
            // Dynamically fill with agent or TL names as per type
          ]
        }
      },
      {
        type: "input",
        block_id: "time_block",
        label: { type: "plain_text", text: "Select time frame" },
        element: {
          type: "static_select",
          action_id: "time_select",
          options: [
            // Dynamically fill timeframes as per type
          ]
        }
      },
      {
        type: "input",
        block_id: "role_block",
        label: { type: "plain_text", text: "Select role" },
        element: {
          type: "static_select",
          action_id: "role_select",
          options: [
            // Dynamically fill roles as per type
          ]
        }
      }
    ]
  };
}

// TODO: Add interaction handler and DB insert logic here

app.listen(PORT, () => console.log(`✅ Nova listening on ${PORT}`));
