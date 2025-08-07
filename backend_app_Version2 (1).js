const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

const WEATHER_API_KEY = process.env.WEATHER_API_KEY; // e.g., OpenWeatherMap API key

app.get('/weather', async (req, res) => {
  const city = req.query.city;
  if (!city) return res.status(400).json({ error: 'City is required' });

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${WEATHER_API_KEY}&units=metric`;
    const response = await axios.get(url);
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch weather', details: err.message });
  }
});

app.get('/', (req, res) => res.send('Weather API backend running'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend listening on port ${PORT}`));