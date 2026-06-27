const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const STORE_ITEMS = [
  { id: 'rail', name: 'Rail Subscription', cost: 1000, type: 'subscription', description: 'Unlock Rail badge and exclusive features' },
  { id: 'theme_midnight', name: 'Midnight Theme', cost: 200, type: 'theme', description: 'A deep midnight blue theme' },
  { id: 'theme_sunset', name: 'Sunset Theme', cost: 200, type: 'theme', description: 'Warm sunset gradient theme' },
  { id: 'namecolor_gold', name: 'Gold Name Color', cost: 150, type: 'namecolor', description: 'Display your name in gold', metadata: { color: '#FFD700' } },
  { id: 'namecolor_cyan', name: 'Cyan Name Color', cost: 150, type: 'namecolor', description: 'Display your name in cyan', metadata: { color: '#00CED1' } },
  { id: 'namecolor_pink', name: 'Pink Name Color', cost: 150, type: 'namecolor', description: 'Display your name in pink', metadata: { color: '#FF69B4' } },
  { id: 'banner_galaxy', name: 'Galaxy Banner', cost: 300, type: 'banner', description: 'A stunning galaxy profile banner' },
  { id: 'banner_neon', name: 'Neon Banner', cost: 300, type: 'banner', description: 'Neon lights profile banner' },
  { id: 'effect_sparkle', name: 'Sparkle Chat Effect', cost: 250, type: 'chateffect', description: 'Your messages sparkle when sent' },
  { id: 'effect_fire', name: 'Fire Chat Effect', cost: 250, type: 'chateffect', description: 'Your messages burst with flames' },
];

// GET /api/store
router.get('/', requireAuth, async (req, res) => {
  try {
    const purchased = await db.query(`SELECT item FROM store_purchases WHERE user_id = $1`, [req.session.userId]);
    const purchasedIds = new Set(purchased.rows.map(r => r.item));
    const user = await db.query(`SELECT points FROM users WHERE id = $1`, [req.session.userId]);
    res.json({
      points: user.rows[0].points,
      items: STORE_ITEMS.map(i => ({ ...i, owned: purchasedIds.has(i.id) })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch store' });
  }
});

// POST /api/store/buy
router.post('/buy', requireAuth, async (req, res) => {
  const { itemId } = req.body;
  const item = STORE_ITEMS.find(i => i.id === itemId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const user = await client.query(`SELECT points FROM users WHERE id = $1 FOR UPDATE`, [req.session.userId]);
    if (user.rows[0].points < item.cost) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Not enough points. Need ${item.cost}, you have ${user.rows[0].points}` });
    }
    const alreadyOwned = await client.query(`SELECT id FROM store_purchases WHERE user_id = $1 AND item = $2`, [req.session.userId, itemId]);
    if (alreadyOwned.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'You already own this item' });
    }

    await client.query(`UPDATE users SET points = points - $1 WHERE id = $2`, [item.cost, req.session.userId]);
    await client.query(`INSERT INTO store_purchases (user_id, item, cost, metadata) VALUES ($1, $2, $3, $4)`,
      [req.session.userId, item.id, item.cost, JSON.stringify(item.metadata || {})]);

    // Apply item effects
    if (item.type === 'subscription' && item.id === 'rail') {
      await client.query(`UPDATE users SET badge_rail = TRUE WHERE id = $1`, [req.session.userId]);
    } else if (item.type === 'namecolor') {
      await client.query(`UPDATE users SET name_color = $1 WHERE id = $2`, [item.metadata.color, req.session.userId]);
    } else if (item.type === 'theme') {
      await client.query(`UPDATE users SET theme = $1 WHERE id = $2`, [item.id, req.session.userId]);
    } else if (item.type === 'chateffect') {
      await client.query(`UPDATE users SET chat_effect = $1 WHERE id = $2`, [item.id, req.session.userId]);
    }

    await client.query('COMMIT');
    const updated = await db.query(`SELECT points FROM users WHERE id = $1`, [req.session.userId]);
    res.json({ message: `Purchased ${item.name}!`, points: updated.rows[0].points });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Purchase error:', err);
    res.status(500).json({ error: 'Purchase failed' });
  } finally {
    client.release();
  }
});

module.exports = router;
