const express = require('express');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const winston = require('winston');
const axios = require('axios');
const session = require('express-session');

const app = express();
const port = 3000;

// Логирование
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level}: ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs.log' })
  ]
});

// Настройка сессий
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// Настройка Steam OpenID
passport.use(new SteamStrategy({
  returnURL: 'http://localhost:3000/auth/steam/return',
  realm: 'http://localhost:3000/',
  apiKey: 'YOUR_STEAM_API_KEY' // Замените на ваш Steam API ключ
}, (identifier, profile, done) => {
  logger.info(`Authenticated user with SteamID: ${profile.id}`);
  return done(null, { steamId: profile.id });
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Роуты для аутентификации
app.get('/auth/steam', passport.authenticate('steam'));
app.get('/auth/steam/return', passport.authenticate('steam', { failureRedirect: '/' }), (req, res) => {
  res.redirect('/');
});

app.get('/auth/steam/user', (req, res) => {
  res.json(req.user || {});
});

// API для добавления бесплатных игр
app.post('/api/free-games', async (req, res) => {
  const { steamId, apiKey } = req.body;
  if (!steamId || !apiKey) {
    logger.error('Missing SteamID or API key');
    return res.status(400).json({ error: 'Missing SteamID or API key' });
  }

  try {
    // Получение списка приложений
    const appList = await axios.get('https://api.steampowered.com/ISteamApps/GetAppList/v2/')
      .then(res => res.data.applist.apps
        .filter(app => app.name.toLowerCase().includes('free') || app.name.toLowerCase().includes('demo'))
        .slice(0, 5)); // Ограничение для теста

    const results = [];
    for (const game of appList) {
      try {
        const response = await axios.post(
          `https://api.steampowered.com/IStoreService/AddFreeLicense/v1/?key=${apiKey}&appid=${game.appid}&steamid=${steamId}`
        );
        logger.info(`Added game ${game.appid} to account ${steamId}`);
        results.push({ id: game.appid, packageId: game.appid, status: 'OK' });
        await new Promise(resolve => setTimeout(resolve, 1000)); // Задержка
      } catch (err) {
        if (err.response && err.response.status === 429) {
          logger.warn('Rate limit exceeded');
          return res.status(429).json({ error: 'Rate limit exceeded' });
        }
        logger.error(`Failed to add game ${game.appid}: ${err.message}`);
        results.push({ id: game.appid, packageId: game.appid, status: 'Error', error: err.message });
      }
    }
    res.json({ games: results });
  } catch (err) {
    logger.error(`Error fetching app list: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  logger.info(`Server running at http://localhost:${port}`);
});