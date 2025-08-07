/*
frontend/App.js
Single-file React Native (Expo) demo app that connects to the backend.
Replace BACKEND_URL below with your deployed backend URL or set as env var.
*/

import React, { useState, useEffect, useRef } from 'react';
import { SafeAreaView, View, Text, TextInput, Button, FlatList, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import io from 'socket.io-client';

const BACKEND_URL = (typeof process !== 'undefined' && process.env && process.env.BACKEND_URL) ? process.env.BACKEND_URL : 'http://YOUR_BACKEND_URL:5000';

export default function App() {
  const [screen, setScreen] = useState('auth'); // auth | feed | chat
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);

  const [posts, setPosts] = useState([]);
  const [newPostText, setNewPostText] = useState('');

  const [chatWith, setChatWith] = useState('');
  const [messages, setMessages] = useState([]);
  const socketRef = useRef(null);

  useEffect(() => {
    if (token && screen === 'feed') {
      fetchPosts();
      socketRef.current = io(BACKEND_URL, { auth: { token } });
      socketRef.current.on('connect', () => console.log('socket connected'));
      socketRef.current.on('message', (m) => {
        setMessages(prev => [...prev, m]);
      });
      return () => socketRef.current.disconnect();
    }
  }, [token, screen]);

  async function signup() {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'User', email, password })
      });
      const data = await res.json();
      if (data.token) {
        setToken(data.token); setUser(data.user); setScreen('feed');
      } else alert(JSON.stringify(data));
    } catch (err) { alert(err.message); }
  }

  async function login() {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (data.token) { setToken(data.token); setUser(data.user); setScreen('feed'); }
      else alert(JSON.stringify(data));
    } catch (err) { alert(err.message); }
  }

  async function fetchPosts() {
    try {
      const res = await fetch(`${BACKEND_URL}/posts`, { headers: { Authorization: `Bearer ${token}` }});
      const data = await res.json();
      setPosts(data);
    } catch (err) { console.log(err); }
  }

  async function createPost() {
    try {
      const res = await fetch(`${BACKEND_URL}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: newPostText })
      });
      const data = await res.json();
      setPosts([data, ...posts]);
      setNewPostText('');
    } catch (err) { console.log(err); }
  }

  async function openChat(otherUserId) {
    setChatWith(otherUserId);
    setScreen('chat');
    const res = await fetch(`${BACKEND_URL}/messages/${otherUserId}`, { headers: { Authorization: `Bearer ${token}` }});
    const data = await res.json();
    setMessages(data);
  }

  function sendMessage(text) {
    if (!socketRef.current) return;
    const payload = { to: chatWith, text };
    socketRef.current.emit('sendMessage', payload);
    setMessages(prev => [...prev, { sender: user.id, receiver: chatWith, text, createdAt: new Date() }]);
  }

  if (screen === 'auth') {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.h1}>Login / Signup</Text>
        <TextInput placeholder="email" value={email} onChangeText={setEmail} style={styles.input} autoCapitalize="none" />
        <TextInput placeholder="password" value={password} onChangeText={setPassword} style={styles.input} secureTextEntry />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Button title="Sign Up" onPress={signup} />
          <Button title="Login" onPress={login} />
        </View>
      </SafeAreaView>
    );
  }

  if (screen === 'feed') {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.h1}>Feed</Text>
        <View style={{ marginBottom: 12 }}>
          <TextInput placeholder="Write a post..." value={newPostText} onChangeText={setNewPostText} style={styles.input} />
          <Button title="Post" onPress={createPost} />
        </View>

        <FlatList
          data={posts}
          keyExtractor={(item) => item._id || item.id}
          renderItem={({ item }) => (
            <View style={styles.post}>
              <Text style={{ fontWeight: 'bold' }}>{item.user?.name || 'User'}</Text>
              <Text>{item.text}</Text>
              <View style={{ flexDirection: 'row', marginTop: 6 }}>
                <TouchableOpacity onPress={() => openChat(item.user?._id || item.user?.id)}>
                  <Text style={styles.link}>Message</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
        <Button title="Open Chat (manual)" onPress={() => setScreen('chat')} />
      </SafeAreaView>
    );
  }

  if (screen === 'chat') {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.h1}>Chat {chatWith ? `(with ${chatWith})` : ''}</Text>
        <ScrollView style={{ flex: 1 }}>
          {messages.map((m, i) => (
            <View key={i} style={[styles.msg, m.sender === user.id ? styles.msgSent : styles.msgRecv]}>
              <Text>{m.text}</Text>
              <Text style={styles.msgTime}>{new Date(m.createdAt).toLocaleString()}</Text>
            </View>
          ))}
        </ScrollView>
        <MessageBox onSend={sendMessage} />
        <Button title="Back to Feed" onPress={() => setScreen('feed')} />
      </SafeAreaView>
    );
  }

  return null;
}

function MessageBox({ onSend }) {
  const [text, setText] = useState('');
  return (
    <View style={styles.messageBox}>
      <TextInput value={text} onChangeText={setText} style={styles.input} placeholder="Type message..." />
      <Button title="Send" onPress={() => { if (text.trim()) { onSend(text.trim()); setText(''); } }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  h1: { fontSize: 22, marginBottom: 10 },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 8, marginBottom: 8, borderRadius: 6 },
  post: { padding: 12, borderBottomWidth: 1, borderColor: '#eee' },
  link: { color: 'blue', marginRight: 10 },
  messageBox: { flexDirection: 'row', alignItems: 'center' },
  msg: { padding: 8, margin: 6, borderRadius: 8, maxWidth: '80%' },
  msgSent: { backgroundColor: '#dcf8c6', alignSelf: 'flex-end' },
  msgRecv: { backgroundColor: '#fff', alignSelf: 'flex-start' },
  msgTime: { fontSize: 10, color: '#666', marginTop: 4 }
});