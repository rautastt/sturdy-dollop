const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');

// ─── Store catalogue (each id is unique) ──────────────────────────────────────
const STORE_ITEMS = [
  {
    id: 'rail',
    name: 'Rail Subscription',
    cost: 1000,
    type: 'subscription',
    icon: '🚆',
    description: 'Get the Rail badge and exclusive member perks',
  },
  {
    id: 'namecolor_gold',
    name: 'Gold Name',
    cost: 150,
    type: 'namecolor',
    icon: '🌟',
    description: 'Display your name in gold',
    value: '#FFD700',
  },
  {
    id: 'namecolor_cyan',
    name: 'Cyan Name',
    cost: 150,
    type: 'namecolor',
    icon: '💎',
    description: 'Display your name in cyan',
    value: '#00CED1',
  },
  {
    id: 'namecolor_pink',
    name: 'Pink Name',
    cost: 150,
    type: 'namecolor',
    icon: '🌸',
    description: 'Display your name in pink',
    value: '#FF69B4',
  },
  {
    id: 'namecolor_green',
    name: 'Green Name',
    cost: 150,
    type: 'namecolor',
    icon: '🍀',
    description: 'Display your name in green',
    value: '#57f287',
  },
  {
    id: 'namecolor_red',
    name: 'Red Name',
    cost: 150,
    type: 'namecolor',
    icon: '🔴',
    description: 'Display your name in red',
    value: '#ed4245',
  },
  {
    id: 'theme_midnight',
    name: 'Midnight Theme',
    cost: 200,
    type: 'theme',
    icon: '🌙',
    description: 'A deep midnight blue theme',
    value: 'midnight',
  },
  {
    id: 'theme_sunset',
    name: 'Sunset Theme',
    cost: 200,
    type: 'theme',
    icon: '🌅',
    description: 'Warm sunset gradient theme',
    value: 'sunset',
  },
  {
    id: 'effect_sparkle',
    name: 'Sparkle Effect',
    cost: 500,
    type: 'chateffect',
    icon: '✨',
    description: 'Your messages sparkle and shimmer',
    value: 'sparkle',
  },
  {
    id: 'effect_confetti',
    name: 'Confetti Effect',
    cost: 500,
    type: 'chateffect',
    icon: '🎊',
    description: 'Send confetti bursting with every message',
    value: 'confetti',
  },
];

// GET /api/store
router.get('/', requireAuth, async (req, res) => {
  try {
    const purchased = await db.query(
      `SELECT item FROM store_purchases WHERE user_id = $1`, [req.session.userId]
    );
    const ownedIds = new Set(purchased.rows.map(r => r.item));
    const user = await db.query(`SELECT points FROM users WHERE id = $1`, [req.session.userId]);

    res.json({
      points: user.rows[0]?.points ?? 0,
      // Never send duplicate items — STORE_ITEMS already has unique ids
      items: STORE_ITEMS.map(item => ({ ...item, owned: ownedIds.has(item.id) })),
    });
  } catch (err) {
    console.error('Store fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch store' });
  }
});

// POST /api/store/buy
router.post('/buy', requireAuth, async (req, res) => {
  const { itemId } = req.body;
  if (!itemId) return res.status(400).json({ error: 'No item specified' });

  const item = STORE_ITEMS.find(i => i.id === itemId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Lock user row to prevent race conditions
    const userRow = await client.query(
      `SELECT points FROM users WHERE id = $1 FOR UPDATE`, [req.session.userId]
    );
    if (!userRow.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }

    const points = userRow.rows[0].points;
    if (points < item.cost) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Not enough points — need ${item.cost}, you have ${points}` });
    }

    // Check not already owned
    const owns = await client.query(
      `SELECT id FROM store_purchases WHERE user_id = $1 AND item = $2`, [req.session.userId, item.id]
    );
    if (owns.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'You already own this item' });
    }

    // Deduct points & record purchase
    await client.query(`UPDATE users SET points = points - $1 WHERE id = $2`, [item.cost, req.session.userId]);
    await client.query(
      `INSERT INTO store_purchases (user_id, item, cost) VALUES ($1, $2, $3)`,
      [req.session.userId, item.id, item.cost]
    );

    // Apply item effect immediately
    if (item.type === 'subscription' && item.id === 'rail') {
      await client.query(`UPDATE users SET badge_rail = TRUE WHERE id = $1`, [req.session.userId]);
    } else if (item.type === 'namecolor') {
      await client.query(`UPDATE users SET name_color = $1 WHERE id = $2`, [item.value, req.session.userId]);
    } else if (item.type === 'theme') {
      await client.query(`UPDATE users SET theme = $1 WHERE id = $2`, [item.value, req.session.userId]);
    } else if (item.type === 'chateffect') {
      await client.query(`UPDATE users SET chat_effect = $1 WHERE id = $2`, [item.value, req.session.userId]);
    }

    await client.query('COMMIT');

    const updated = await db.query(`SELECT points FROM users WHERE id = $1`, [req.session.userId]);
    res.json({
      message: `Purchased ${item.name}!`,
      points: updated.rows[0].points,
      applied: item.type,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Purchase error:', err);
    res.status(500).json({ error: 'Purchase failed' });
  } finally {
    client.release();
  }
});

module.exports = router;
