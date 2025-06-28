const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const shifts = [
  // Permanent agent schedule — no weekly data change needed
  { shift_date: '2025-06-28', shift_time: '02:00-04:00', role: 'ticket', name: 'Zoe' },
  { shift_date: '2025-06-28', shift_time: '02:00-04:00', role: 'chat', name: 'Jean' },
  { shift_date: '2025-06-28', shift_time: '06:00-08:00', role: 'ticket', name: 'Cezamarie' },
  { shift_date: '2025-06-28', shift_time: '06:00-08:00', role: 'chat', name: 'Krizza' },
  { shift_date: '2025-06-28', shift_time: '10:00-12:00', role: 'ticket', name: 'Thanos' },
  { shift_date: '2025-06-28', shift_time: '10:00-12:00', role: 'chat', name: 'Stelios' },
  { shift_date: '2025-06-28', shift_time: '14:00-16:00', role: 'ticket', name: 'Ella' },
  { shift_date: '2025-06-28', shift_time: '14:00-16:00', role: 'chat', name: 'Jean' },
  { shift_date: '2025-06-28', shift_time: '18:00-22:00', role: 'ticket', name: 'Michael' },
  { shift_date: '2025-06-28', shift_time: '18:00-22:00', role: 'chat', name: 'Zoe' },
  { shift_date: '2025-06-28', shift_time: '22:00-02:00', role: 'ticket', name: 'Christina Z.' },
  { shift_date: '2025-06-28', shift_time: '22:00-02:00', role: 'chat', name: 'Angelica' },
];

async function insertShifts() {
  for (const shift of shifts) {
    await pool.query(
      `INSERT INTO agent_shifts (shift_date, shift_time, role, name, created_at) VALUES ($1, $2, $3, $4, NOW())`,
      [shift.shift_date, shift.shift_time, shift.role, shift.name]
    );
    console.log(`✅ Inserted: ${shift.name} | ${shift.role} | ${shift.shift_date} ${shift.shift_time}`);
  }
  await pool.end();
}

insertShifts().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
