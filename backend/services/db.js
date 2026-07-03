const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

let supabase = null;

function getClient() {
  if (!supabase) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return null; // fall back to file-based or in-memory
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

/**
 * Persist a room object to Supabase.
 * Uses upsert so create and update are the same call.
 * Silently falls back to in-memory if Supabase is not configured.
 */
async function saveRoom(roomData) {
  const client = getClient();
  if (!client) return; // no Supabase — caller keeps it in-memory

  const { error } = await client
    .from('rooms')
    .upsert(
      { id: roomData.id, data: roomData, updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    );

  if (error) {
    console.error('[DB] Failed to save room:', roomData.id, error.message);
  }
}

/**
 * Load all rooms from Supabase into the in-memory store on startup.
 * Returns a map of { roomId -> roomObject }.
 */
async function loadAllRooms() {
  const client = getClient();
  if (!client) {
    console.warn('[DB] Supabase not configured — rooms will not persist across restarts.');
    return {};
  }

  const { data, error } = await client
    .from('rooms')
    .select('id, data')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[DB] Failed to load rooms on startup:', error.message);
    return {};
  }

  const roomMap = {};
  for (const row of data) {
    if (row.data && row.data.id) {
      roomMap[row.data.id] = row.data;
      console.log(`[DB] Loaded room: ${row.data.id} (${row.data.topic})`);
    }
  }
  console.log(`[DB] Loaded ${Object.keys(roomMap).length} room(s) from Supabase.`);
  return roomMap;
}

module.exports = { saveRoom, loadAllRooms };
