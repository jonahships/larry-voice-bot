/**
 * Larry The Lobster - Discord Voice Bot 🦞
 * 
 * Joins Discord voice channels and speaks using ElevenLabs Conversational AI
 */

require('dotenv').config();

const { Client, GatewayIntentBits, Events } = require('discord.js');
const { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  EndBehaviorType,
  getVoiceConnection,
  entersState
} = require('@discordjs/voice');
const WebSocket = require('ws');
const { Transform, PassThrough } = require('stream');
const prism = require('prism-media');

// Config from environment
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

if (!DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN not set');
  process.exit(1);
}

if (!ELEVENLABS_API_KEY) {
  console.error('❌ ELEVENLABS_API_KEY not set');
  process.exit(1);
}

if (!AGENT_ID) {
  console.error('❌ ELEVENLABS_AGENT_ID not set');
  process.exit(1);
}

console.log('🦞 Larry The Lobster Voice Bot starting...');

// Discord client with voice intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Track active voice sessions
const activeSessions = new Map();

/**
 * ElevenLabs Conversational AI Session
 */
class ElevenLabsSession {
  constructor(connection, guildId, channelId) {
    this.connection = connection;
    this.guildId = guildId;
    this.channelId = channelId;
    this.ws = null;
    this.isConnected = false;
    this.player = createAudioPlayer();
    this.audioQueue = [];
    this.isPlaying = false;
    this.conversationId = null;
    
    connection.subscribe(this.player);
    
    this.player.on(AudioPlayerStatus.Idle, () => {
      this.isPlaying = false;
      this.playNextInQueue();
    });
    
    this.player.on('error', (err) => {
      console.error('🦞 Audio player error:', err.message);
      this.isPlaying = false;
    });
  }

  async connect() {
    try {
      const signedUrl = await this.getSignedUrl();
      console.log('🦞 Connecting to ElevenLabs...');
      
      return new Promise((resolve, reject) => {
        this.ws = new WebSocket(signedUrl);
        
        this.ws.on('open', () => {
          console.log('🦞 Connected to ElevenLabs Conversational AI!');
          this.isConnected = true;
          resolve();
        });
        
        this.ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleMessage(message);
          } catch (err) {
            console.error('Failed to parse message:', err);
          }
        });
        
        this.ws.on('error', (err) => {
          console.error('🦞 WebSocket error:', err.message);
          this.isConnected = false;
          reject(err);
        });
        
        this.ws.on('close', () => {
          console.log('🦞 ElevenLabs connection closed');
          this.isConnected = false;
        });
      });
    } catch (err) {
      console.error('Failed to connect to ElevenLabs:', err);
      throw err;
    }
  }

  async getSignedUrl() {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${AGENT_ID}`,
      {
        headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to get signed URL: ${response.status}`);
    }
    
    const data = await response.json();
    return data.signed_url;
  }

  handleMessage(message) {
    switch (message.type) {
      case 'conversation_initiation_metadata':
        this.conversationId = message.conversation_initiation_metadata_event?.conversation_id;
        console.log(`🦞 Conversation started: ${this.conversationId}`);
        break;
        
      case 'audio':
        if (message.audio?.chunk) {
          this.queueAudio(message.audio.chunk);
        }
        break;
      
      case 'agent_response':
        const text = message.agent_response_event?.agent_response;
        if (text) console.log(`🦞 Larry: ${text}`);
        break;
      
      case 'user_transcript':
        const userText = message.user_transcription_event?.user_transcript;
        if (userText) console.log(`👤 User: ${userText}`);
        break;
      
      case 'interruption':
        console.log('⚡ Interrupted!');
        this.player.stop();
        this.audioQueue = [];
        break;

      case 'ping':
        if (message.ping_event?.event_id) {
          this.send({ type: 'pong', event_id: message.ping_event.event_id });
        }
        break;
    }
  }

  queueAudio(base64Chunk) {
    const pcmBuffer = Buffer.from(base64Chunk, 'base64');
    this.audioQueue.push(pcmBuffer);
    if (!this.isPlaying) this.playNextInQueue();
  }

  playNextInQueue() {
    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      return;
    }
    
    this.isPlaying = true;
    const combinedBuffer = Buffer.concat(this.audioQueue);
    this.audioQueue = [];
    
    const inputStream = new PassThrough();
    inputStream.end(combinedBuffer);
    
    // Convert 16kHz mono to 48kHz stereo for Discord
    const ffmpeg = new prism.FFmpeg({
      args: [
        '-f', 's16le', '-ar', '16000', '-ac', '1', '-i', 'pipe:0',
        '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'
      ]
    });
    
    const resource = createAudioResource(inputStream.pipe(ffmpeg), {
      inputType: StreamType.Raw,
    });
    
    this.player.play(resource);
  }

  sendAudio(pcmBuffer) {
    if (!this.ws || !this.isConnected) return;
    this.send({ user_audio_chunk: pcmBuffer.toString('base64') });
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.player.stop();
  }
}

/**
 * Handle user speaking in voice channel
 */
function setupVoiceReceiver(connection, session) {
  const receiver = connection.receiver;
  
  receiver.speaking.on('start', (userId) => {
    if (userId === client.user.id) return;
    
    console.log(`🎤 User ${userId} speaking...`);
    
    const audioStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 500 },
    });
    
    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
    const ffmpeg = new prism.FFmpeg({
      args: [
        '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', 'pipe:0',
        '-f', 's16le', '-ar', '16000', '-ac', '1', 'pipe:1'
      ]
    });
    
    const chunks = [];
    
    audioStream.pipe(decoder).pipe(ffmpeg)
      .on('data', (chunk) => chunks.push(chunk))
      .on('end', () => {
        if (chunks.length > 0) {
          const audio = Buffer.concat(chunks);
          console.log(`🎤 Sending ${audio.length} bytes to ElevenLabs`);
          session.sendAudio(audio);
        }
      })
      .on('error', (err) => console.error('Audio error:', err));
  });
}

// Message handler
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  
  const content = message.content.toLowerCase();
  const mentioned = content.includes('larry');
  
  // Join voice
  if (mentioned && content.includes('join')) {
    const voiceChannel = message.member?.voice?.channel;
    
    if (!voiceChannel) {
      return message.reply('🦞 Join a voice channel first, moy drug!');
    }
    
    if (activeSessions.has(voiceChannel.id)) {
      return message.reply('🦞 Already in this channel, da!');
    }
    
    try {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
      });
      
      connection.on(VoiceConnectionStatus.Ready, async () => {
        console.log(`✅ Voice ready in ${voiceChannel.name}`);
        
        try {
          const session = new ElevenLabsSession(connection, voiceChannel.guild.id, voiceChannel.id);
          await session.connect();
          activeSessions.set(voiceChannel.id, session);
          setupVoiceReceiver(connection, session);
          message.channel.send('🦞 **Privet!** Larry is ready to talk! Speak and I will respond! 💪');
        } catch (err) {
          console.error('ElevenLabs error:', err);
          message.channel.send(`🦞 Voice connected but ElevenLabs failed: ${err.message}`);
        }
      });
      
      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        const session = activeSessions.get(voiceChannel.id);
        if (session) {
          session.disconnect();
          activeSessions.delete(voiceChannel.id);
        }
        connection.destroy();
      });
      
      message.reply('🦞 Joining voice... Один момент!');
      
    } catch (err) {
      console.error('Voice error:', err);
      message.reply(`🦞 Error: ${err.message}`);
    }
  }
  
  // Leave voice
  if (mentioned && (content.includes('leave') || content.includes('bye'))) {
    const conn = getVoiceConnection(message.guild.id);
    if (conn) {
      for (const [id, session] of activeSessions) {
        if (session.guildId === message.guild.id) {
          session.disconnect();
          activeSessions.delete(id);
        }
      }
      conn.destroy();
      message.reply('🦞 До свидания!');
    } else {
      message.reply('🦞 Not in a voice channel!');
    }
  }
  
  // Status
  if (mentioned && content.includes('status')) {
    const conn = getVoiceConnection(message.guild.id);
    message.reply(`🦞 **Status**\nVoice: ${conn ? '✅' : '❌'}\nSessions: ${activeSessions.size}`);
  }
});

client.once(Events.ClientReady, (c) => {
  console.log(`🦞 Larry Voice Bot ready as ${c.user.tag}`);
  console.log('   Commands: "larry join", "larry leave", "larry status"');
});

client.login(DISCORD_TOKEN);
