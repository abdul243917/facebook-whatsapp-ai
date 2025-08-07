/*
backend/app.js
Single-file Node backend for Facebook+WhatsApp+AI demo.
Dependencies (see package.json): express, cors, mongoose, jsonwebtoken, bcryptjs, axios, socket.io, dotenv
*/

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ---------- Mongoose models ----------
const { Schema } = mongoose;

const UserSchema = new Schema({
  name: String,
  email: { type: String, unique: true, sparse: true },
  phone: { type: String, unique: true, sparse: true },
  password: String,
  avatar_url: String,
  bio: String,
  createdAt: { type: Date, default: Date.now }
});

const PostSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User' },
  text: String,
  media_url: String,
  createdAt: { type: Date, default: Date.now },
  likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  comments: [{ user: { type: Schema.Types.ObjectId, ref: 'User' }, text: String, createdAt: Date }]
});

const MessageSchema = new Schema({
  sender: { type: Schema.Types.ObjectId, ref: 'User' },
  receiver: { type: Schema.Types.ObjectId, ref: 'User' },
  text: String,
  media_url: String,
  createdAt: { type: Date, default: Date.now }
});

const GroupSchema = new Schema({
  name: String,
  description: String,
  members: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Post = mongoose.model('Post', PostSchema);
const Message = mongoose.model('Message', MessageSchema);
const Group = mongoose.model('Group', GroupSchema);

// ---------- Database ----------
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/chatapp';
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error', err));

// ---------- JWT middleware ----------
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_SECRET';

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No auth header' });
  const token = header.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Invalid auth header' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ---------- Routes: Auth ----------
app.post('/auth/signup', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!password || (!email && !phone)) return res.status(400).json({ error: 'Missing credentials' });

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ name, email, phone, password: hashed });
    await user.save();
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ user: { id: user._id, name: user.name, email: user.email, avatar_url: user.avatar_url }, token });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Email or phone already used' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, phone, password } = req.body;
    const query = email ? { email } : { phone };
    const user = await User.findOne(query);
    if (!user) return res.status(400).json({ error: 'User not found' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: 'Invalid password' });
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ user: { id: user._id, name: user.name, email: user.email, avatar_url: user.avatar_url }, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Routes: Users ----------
app.get('/users/me', authMiddleware, async (req, res) => {
  const user = await User.findById(req.userId).select('-password');
  res.json({ user });
});

// ---------- Routes: Posts (feed) ----------
app.get('/posts', authMiddleware, async (req, res) => {
  const posts = await Post.find().populate('user', 'name avatar_url').sort({ createdAt: -1 }).limit(100);
  res.json(posts);
});

app.post('/posts', authMiddleware, async (req, res) => {
  const { text, media_url } = req.body;
  const post = new Post({ user: req.userId, text, media_url });
  await post.save();
  const populated = await Post.findById(post._id).populate('user', 'name avatar_url');
  res.json(populated);
});

app.post('/posts/:id/like', authMiddleware, async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  if (!post.likes.includes(req.userId)) post.likes.push(req.userId);
  await post.save();
  res.json({ success: true });
});

// ---------- Routes: Groups ----------
app.post('/groups', authMiddleware, async (req, res) => {
  const { name, description } = req.body;
  const group = new Group({ name, description, members: [req.userId] });
  await group.save();
  res.json(group);
});

app.get('/groups', authMiddleware, async (req, res) => {
  const groups = await Group.find().limit(100);
  res.json(groups);
});

// ---------- Routes: Messages ----------
app.post('/messages', authMiddleware, async (req, res) => {
  const { receiverId, text, media_url } = req.body;
  const msg = new Message({ sender: req.userId, receiver: receiverId, text, media_url });
  await msg.save();
  // emit via socket.io
  io.to(String(receiverId)).emit('message', { id: msg._id, sender: req.userId, receiver: receiverId, text, media_url, createdAt: msg.createdAt });
  res.json(msg);
});

app.get('/messages/:userId', authMiddleware, async (req, res) => {
  const other = req.params.userId;
  const messages = await Message.find({
    $or: [
      { sender: req.userId, receiver: other },
      { sender: other, receiver: req.userId }
    ]
  }).sort({ createdAt: 1 }).limit(1000);
  res.json(messages);
});

// ---------- AI assistant endpoint ----------
app.post('/ai', authMiddleware, async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!process.env.OPENAI_KEY) return res.status(400).json({ error: 'OpenAI key not configured' });

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400
    }, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_KEY}` }
    });

    const reply = response.data.choices?.[0]?.message?.content || '';
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Health ----------
app.get('/', (req, res) => res.send('Backend running'));

// ---------- Socket.IO ----------
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.id;
    next();
  } catch (err) {
    next();
  }
});

io.on('connection', (socket) => {
  if (socket.userId) socket.join(String(socket.userId));

  socket.on('sendMessage', async (payload) => {
    const message = new Message({ sender: socket.userId || payload.from, receiver: payload.to, text: payload.text, media_url: payload.media_url });
    await message.save();
    io.to(String(payload.to)).emit('message', message);
    io.to(String(message.sender)).emit('message', message);
  });

  socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log('Server listening on port', PORT));