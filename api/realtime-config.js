const { getRealtimeConfig } = require('./_realtime');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET,OPTIONS');
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  const config = getRealtimeConfig();

  return res.status(200).json({
    success: true,
    enabled: config.enabled,
    provider: config.enabled ? 'pusher' : 'none',
    channel: config.channel,
    key: config.enabled ? config.key : '',
    cluster: config.enabled ? config.cluster : '',
  });
};

