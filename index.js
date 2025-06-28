const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Utility: Post message to Slack
async function replyToSlack(channel, text) {
  await axios.post('https://slack.com/api/chat.postMessage', {
    channel,
    text,
  }, {
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
}

// Utility: Open modal
async function openModal(trigger_id) {
  await axios.post('https://slack.com/api/views.open', {
    trigger_id,
    view: {
      type: 'modal',
      title: { type: 'plain_text', text: 'Update Shift' },
      callback_id: 'update_shift_modal',
      submit: { type: 'plain_text', text: 'Submit' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'name_block',
          label: { type: 'plain_text', text: 'Select Name' },
          element: {
            type: 'static_select',
            action_id: 'name_action',
            options: [
              { text: { type: 'plain_text', text: 'Stelios Georgiou' }, value: 'Stelios Georgiou' },
              { text: { type: 'plain_text', text: 'Dimitris Michoudis' }, value: 'Dimitris Michoudis' },
              { text: { type: 'plain_text', text: 'Aggelos Diogenis P.' }, value: 'Aggelos Diogenis P.' },
              { text: { type: 'plain_text', text: 'Christina Z.' }, value: 'Christina Z.' },
              { text: { type: 'plain_text', text: 'Ella Pineda' }, value: 'Ella Pineda' },
              { text: { type: 'plain_text', text: 'Jean Zamora' }, value: 'Jean Zamora' },
              { text: { type: 'plain_text', text: 'Zoe Lefa' }, value: 'Zoe Lefa' },
              // Add TLs too as needed
            ],
          },
        },
        {
          type: 'input',
          block_id: 'action_block',
          label: { type: 'plain_text', text: 'Select Action' },
          element: {
            type: 'static_select',
            action_id: 'action_action',
            options: [
              { text: { type: 'plain_text', text: 'Add Shift' }, value: 'add' },
              { text: { type: 'plain_text', text: 'Remove Shift' }, value: 'remove' },
              { text: { type: 'plain_text', text: 'Swap Shift' }, value: 'swap' },
            ],
          },
        },
        {
          type: 'input',
          block_id: 'date_block',
          label: { type: 'plain_text', text: 'Shift Date' },
          element: { type: 'datepicker', action_id: 'date_action' },
        },
        {
          type: 'input',
          block_id: 'time_block',
          label: { type: 'plain_text', text: 'Shift Time (e.g. 10:00-14:00)' },
          element: { type: 'plain_text_input', action_id: 'time_action' },
        },
        {
          type: 'input',
          block_id: 'role_block',
          label: { type: 'plain_text', text: 'Role' },
          element: {
            type: 'static_select',
            action_id: 'role_action',
            options: [
              { text: { type: 'plain_text', text: 'CHAT' }, value: 'chat' },
              { text: { type: 'plain_text', text: 'TICKET' }, value: 'ticket' },
              { text: { type: 'plain_text', text: 'BACKEND' }, value: 'backend' },
              { text: { type: 'plain_text', text: 'FRONTEND' }, value: 'frontend' },
            ],
          },
        },
      ],
    },
  }, {
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
}

// Slack command for update shift
app.post('/slack/commands', async (req, res) => {
  const { command, trigger_id } = req.body;
  if (command === '/nova_update_shift') {
    await openModal(trigger_id);
    return res.send();
  }
  res.send('Unknown command');
});

// Slack interactivity endpoint
app.post('/slack/interactivity', async (req, res) => {
  const payload = JSON.parse(req.body.payload);
  if (payload.type === 'view_submission' && payload.view.callback_id === 'update_shift_modal') {
    const vals = payload.view.state.values;
    const name = vals.name_block.name_action.selected_option.value;
    const action = vals.action_block.action_action.selected_option.value;
    const date = vals.date_block.date_action.selected_date;
    const time = vals.time_block.time_action.value;
    const role = vals.role_block.role_action.selected_option.value;

    try {
      if (action === 'add') {
        await pool.query(
          `INSERT INTO agent_shifts (shift_date, shift_time, role, name, updated_by, reason, created_at)
           VALUES ($1, $2, $3, $4, 'slack', 'manual update', NOW())`,
          [date, time, role, name]
        );
      } else if (action === 'remove') {
        await pool.query(
          `DELETE FROM agent_shifts WHERE shift_date = $1 AND shift_time = $2 AND role = $3 AND name = $4`,
          [date, time, role, name]
        );
      }
      // Swap logic can be added similarly
      await replyToSlack(payload.user.id, `✅ Shift ${action}ed: ${name} | ${role.toUpperCase()} | ${date} | ${time}`);
    } catch (err) {
      console.error(err);
      await replyToSlack(payload.user.id, `❌ Failed to ${action} shift.`);
    }

    return res.send({ response_action: 'clear' });
  }
  res.send();
});

// Health check
app.get('/', (req, res) => res.send('Nova is live with modals!'));

app.listen(PORT, () => console.log(`✅ Nova listening on ${PORT}`));
