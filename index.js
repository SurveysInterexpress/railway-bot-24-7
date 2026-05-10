const mineflayer = require('mineflayer');
const antiAfk = require('mineflayer-anti-afk');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// ============================================
// CONFIGURATION FROM ENVIRONMENT VARIABLES
// ============================================
const config = {
  // Server connection
  host:           process.env.MC_HOST           || 'localhost',
  port:           parseInt(process.env.MC_PORT)  || 25565,
  version:        process.env.MC_VERSION         || '1.20.4',

  // Bot credentials
  username:       process.env.MC_USERNAME        || 'AFK_Bot',
  password:       process.env.MC_PASSWORD        || '',       // Leave empty for cracked/offline
  auth:           process.env.MC_AUTH            || 'offline', // 'microsoft', 'mojang', 'offline'

  // Anti-AFK settings
  antiAfkEnabled: process.env.ANTI_AFK_ENABLED !== 'false',   // default true
  actions:        process.env.AFK_ACTIONS        || 'rotate,walk', // comma-separated

  // Respawn on death
  autoRespawn:    process.env.AUTO_RESPAWN       !== 'false',   // default true

  // Reconnect settings
  reconnect:      process.env.RECONNECT_ENABLED  !== 'false',   // default true
  reconnectDelay: parseInt(process.env.RECONNECT_DELAY) || 10000, // 10 seconds

  // Walk interval (seconds between random walks)
  walkInterval:   parseInt(process.env.WALK_INTERVAL) || 30,

  // Chat logging
  logChat:        process.env.LOG_CHAT           !== 'false',   // default true
};

// ============================================
// BOT CREATION
// ============================================
let bot = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 50;

function createBot() {
  console.log(`[INFO] Creating bot...`);
  console.log(`[INFO] Connecting to ${config.host}:${config.port} (version ${config.version})`);
  console.log(`[INFO] Username: ${config.username} | Auth: ${config.auth}`);

  const botOptions = {
    host:     config.host,
    port:     config.port,
    version:  config.version,
    username: config.username,
    auth:     config.auth,
    hideErrors: false,
  };

  // Only add password if provided (for premium accounts)
  if (config.password && config.password.length > 0) {
    botOptions.password = config.password;
  }

  bot = mineflayer.createBot(botOptions);

  // Load anti-afk plugin
  if (config.antiAfkEnabled) {
    bot.loadPlugin(antiAfk);
  }

  // ============================================
  // EVENT HANDLERS
  // ============================================

  bot.once('spawn', () => {
    reconnectAttempts = 0;
    console.log('[SUCCESS] Bot has spawned and is now AFK!');
    console.log(`[INFO] Anti-AFK: ${config.antiAfkEnabled ? 'ENABLED' : 'DISABLED'}`);
    console.log(`[INFO] Actions: ${config.actions}`);

    // Start anti-afk plugin if loaded
    if (config.antiAfkEnabled && bot.afk) {
      bot.afk.start();
      console.log('[INFO] Anti-AFK plugin started');
    }

    // Custom walk scheduler for extra anti-AFK protection
    startWalkScheduler();
  });

  bot.on('chat', (username, message) => {
    if (config.logChat && username !== config.username) {
      console.log(`[CHAT] <${username}> ${message}`);
    }

    // Respond to !ping command
    if (message === '!ping') {
      bot.chat('Pong! AFK Bot is active 🟢');
    }

    // Respond to !status command
    if (message === '!status') {
      const health = bot.health ? bot.health.toFixed(1) : 'N/A';
      const food = bot.food ? bot.food.toFixed(1) : 'N/A';
      const pos = bot.entity ? `${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.z)}` : 'N/A';
      bot.chat(`Health: ${health} | Food: ${food} | Pos: ${pos}`);
    }
  });

  bot.on('kicked', (reason, loggedIn) => {
    console.log(`[WARN] Bot was kicked! Reason: ${reason}`);
    console.log(`[WARN] Was logged in: ${loggedIn}`);
    scheduleReconnect();
  });

  bot.on('error', (err) => {
    console.log(`[ERROR] Bot error: ${err.message}`);
  });

  bot.on('end', (reason) => {
    console.log(`[WARN] Bot disconnected. Reason: ${reason}`);
    scheduleReconnect();
  });

  bot.on('death', () => {
    console.log('[WARN] Bot died!');
    if (config.autoRespawn) {
      setTimeout(() => {
        if (bot && bot.entity) {
          bot.chat('/kill'); // sometimes needed
        }
      }, 1000);
    }
  });

  bot.on('respawn', () => {
    console.log('[INFO] Bot respawned');
  });

  bot.on('health', () => {
    // Log only if health drops significantly
    if (bot.health < 10) {
      console.log(`[WARN] Low health: ${bot.health.toFixed(1)}`);
    }
  });

  bot.on('message', (jsonMsg) => {
    const msg = jsonMsg.toString();
    // Detect anti-bot / login messages
    if (msg.includes('register') || msg.includes('login') || msg.includes('/register') || msg.includes('/login')) {
      console.log(`[SERVER-MESSAGE] ${msg}`);
    }
  });
}

// ============================================
// WALK SCHEDULER (Extra Anti-AFK)
// ============================================
let walkIntervalId = null;

function startWalkScheduler() {
  if (walkIntervalId) clearInterval(walkIntervalId);

  walkIntervalId = setInterval(() => {
    if (!bot || !bot.entity) return;

    try {
      const actions = config.actions.split(',').map(a => a.trim());

      // Random rotation
      if (actions.includes('rotate')) {
        const yaw = Math.random() * Math.PI * 2;
        const pitch = (Math.random() - 0.5) * Math.PI;
        bot.look(yaw, pitch, false);
      }

      // Random short walk
      if (actions.includes('walk')) {
        const direction = Math.floor(Math.random() * 4); // 0-3: forward, back, left, right
        const walkDuration = 300 + Math.random() * 500; // 300-800ms

        const movements = ['forward', 'back', 'left', 'right'];
        const move = movements[direction];

        bot.setControlState(move, true);

        setTimeout(() => {
          bot.clearControlStates();
          // Walk back to roughly original position (optional)
          setTimeout(() => {
            const opposite = movements[(direction + 1) % 4];
            bot.setControlState(move, true);
            setTimeout(() => {
              bot.clearControlStates();
            }, walkDuration / 2);
          }, 200);
        }, walkDuration);
      }

      // Jump
      if (actions.includes('jump')) {
        bot.setControlState('jump', true);
        setTimeout(() => {
          bot.clearControlStates('jump');
        }, 500);
      }

      // Sneak toggle
      if (actions.includes('sneak')) {
        bot.setControlState('sneak', true);
        setTimeout(() => {
          bot.clearControlStates('sneak');
        }, 1000);
      }

      // Swing arm (attack animation)
      if (actions.includes('swing')) {
        bot.activateItem(); // right click
      }

    } catch (err) {
      // Silently catch errors from movement
    }
  }, config.walkInterval * 1000);
}

// ============================================
// RECONNECT LOGIC
// ============================================
function scheduleReconnect() {
  if (!config.reconnect) {
    console.log('[INFO] Reconnect is disabled. Exiting.');
    process.exit(0);
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log(`[ERROR] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Exiting.`);
    process.exit(1);
  }

  reconnectAttempts++;
  const delay = Math.min(config.reconnectDelay * reconnectAttempts, 120000); // Cap at 2 min

  console.log(`[INFO] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);

  setTimeout(() => {
    try {
      if (bot) {
        bot.removeAllListeners();
        bot = null;
      }
      createBot();
    } catch (err) {
      console.log(`[ERROR] Failed to create bot: ${err.message}`);
      scheduleReconnect();
    }
  }, delay);
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
function gracefulShutdown(signal) {
  console.log(`\n[INFO] Received ${signal}. Shutting down gracefully...`);

  if (walkIntervalId) clearInterval(walkIntervalId);

  if (bot) {
    try {
      if (bot.afk) bot.afk.stop();
      bot.quit('Shutting down');
    } catch (err) {
      // Ignore
    }
  }

  setTimeout(() => {
    console.log('[INFO] Bot disconnected. Goodbye!');
    process.exit(0);
  }, 2000);
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.log(`[CRITICAL] Uncaught Exception: ${err.message}`);
  scheduleReconnect();
});

process.on('unhandledRejection', (reason) => {
  console.log(`[CRITICAL] Unhandled Rejection: ${reason}`);
});

// ============================================
// START THE BOT
// ============================================
console.log('============================================');
console.log('   Minecraft AFK Bot - Railway Edition');
console.log('============================================');
createBot();
