# Larry The Lobster - Discord Voice Bot 🦞

A Discord voice bot that uses ElevenLabs Conversational AI to have real-time voice conversations.

## Features

- Joins Discord voice channels on command
- Listens to users speaking and transcribes via ElevenLabs
- Responds with AI-generated voice using your custom ElevenLabs agent
- Real-time conversation with interruption support

## Setup

### 1. Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to Bot tab and create a bot
4. Enable these Privileged Gateway Intents:
   - MESSAGE CONTENT INTENT
   - SERVER MEMBERS INTENT (optional)
5. Copy the bot token
6. Use OAuth2 URL Generator to invite bot with permissions:
   - Connect
   - Speak
   - View Channels
   - Send Messages

### 2. ElevenLabs Setup

1. Go to [ElevenLabs](https://elevenlabs.io)
2. Get your API key from Profile Settings
3. Create a Conversational AI agent
4. Copy the Agent ID

### 3. Environment Variables

```env
DISCORD_TOKEN=your_discord_bot_token
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_AGENT_ID=your_agent_id
```

### 4. Run with Docker

```bash
docker build -t larry-voice-bot .
docker run --network=host -e DISCORD_TOKEN=xxx -e ELEVENLABS_API_KEY=xxx -e ELEVENLABS_AGENT_ID=xxx larry-voice-bot
```

**Important:** Use `--network=host` for voice to work properly!

### 5. Run with Coolify

1. Connect this repo to Coolify
2. Set environment variables in Coolify dashboard
3. **Set network mode to "host"** in Docker settings
4. Deploy!

## Commands

- `larry join` - Join your voice channel
- `larry leave` - Leave voice channel
- `larry status` - Check bot status

## Requirements

- Node.js 18+
- FFmpeg
- Network access for UDP (Discord voice uses UDP)

## Troubleshooting

**Bot joins but doesn't talk?**
- Make sure you're using `--network=host` in Docker
- Check that UDP traffic is allowed on your server

**Can't hear the bot?**
- Make sure your ElevenLabs agent is configured correctly
- Check the bot's audio permissions in Discord

## License

MIT
