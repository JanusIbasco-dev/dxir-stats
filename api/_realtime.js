const Pusher = require('pusher');

let client = null;

function getRealtimeConfig() {
  const appId = String(process.env.PUSHER_APP_ID || '').trim();
  const key = String(process.env.PUSHER_KEY || '').trim();
  const secret = String(process.env.PUSHER_SECRET || '').trim();
  const cluster = String(process.env.PUSHER_CLUSTER || '').trim();
  const channel = String(process.env.PUSHER_CHANNEL || 'dxir-stats').trim();

  const enabled = Boolean(appId && key && secret && cluster);

  return {
    enabled,
    appId,
    key,
    secret,
    cluster,
    channel,
  };
}

function getClient() {
  const config = getRealtimeConfig();
  if (!config.enabled) {
    return null;
  }

  if (client) {
    return client;
  }

  client = new Pusher({
    appId: config.appId,
    key: config.key,
    secret: config.secret,
    cluster: config.cluster,
    useTLS: true,
  });

  return client;
}

async function publishRealtimeEvent(eventName, payload) {
  const config = getRealtimeConfig();
  if (!config.enabled) {
    return false;
  }

  const pusher = getClient();
  if (!pusher) {
    return false;
  }

  try {
    await pusher.trigger(config.channel, eventName, payload || {});
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  getRealtimeConfig,
  publishRealtimeEvent,
};

