-- Nothing reorders spaces any more (PUT /api/spaces/order is gone; spaces.json sets the order
-- through miso.sync_spaces), so members change only a space's name and theme.
revoke update (position) on miso.spaces from authenticated;
