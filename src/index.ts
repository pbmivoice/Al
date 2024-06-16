import * as dotenv from 'dotenv';
import assert from 'assert';
import { ChatGPTAPI } from 'chatgpt';
dotenv.config();
const { DISCORD_TOKEN, OPENAI_API_KEY, GUILD_ID } = process.env;
assert(DISCORD_TOKEN, 'DISCORD_TOKEN is not defined');
assert(OPENAI_API_KEY, 'OPENAI_API_KEY is not defined');
assert(GUILD_ID, 'GUILD_ID is not defined');

import {
  Client,
  CommandInteraction,
  GatewayIntentBits,
  IntentsBitField,
  Message,
  PartialMessage,
  TextBasedChannel,
} from 'discord.js';
export {};

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  closeTimeout: 6_000,
});
const chatGpt = new ChatGPTAPI({
  apiKey: OPENAI_API_KEY,
  completionParams: {
    temperature: 1,
    max_tokens: 128,
    model: 'gpt-4o',
    user: 'Al',
  },
});

const timeToLive = 64;
const timeoutMs = 12_000;
const messageLimit = 16;
const impatienceLimit = messageLimit / 2;
type MessageDetails = {
  id: string;
  at: Date;
  tag: string;
  content: string;
  reply?: string;
};
type ChannelCtx = {
  at: Date;
  timer?: NodeJS.Timeout | number;
  channel: TextBasedChannel;
  impatience: number;
  timeToLive: number;
  profiles: Map<string, string>;
};
const channels: ChannelCtx[] = [];
const shortIds = new Map<string, string>();

const messageDetails = (message: Message | PartialMessage): MessageDetails => {
  const shortId = message.id.slice(-5);
  shortIds.set(shortId, message.id);
  const reply = message.reference?.messageId
    ? shortIds.get(message.reference.messageId)
    : undefined;
  return {
    id: shortId,
    at: message.createdAt,
    tag: message.author?.tag ?? 'Unknown',
    content: message.content ?? '[no content]',
    reply,
  };
};

const handleAlive = async (interaction: CommandInteraction) => {
  const { channel } = interaction;
  if (!channel) return;
  if (channels.some(y => y.channel.id === interaction.channelId)) {
    await interaction.reply('I am already alive in this channel.');
    return;
  }
  const ctx: ChannelCtx = {
    at: new Date(),
    channel,
    impatience: 0,
    profiles: new Map(),
    timeToLive,
  };
  channels.push(ctx);
  await interaction.reply(
    `I am alive. I will respond ${timeToLive} times before dying.`,
  );
};

const handleBrain = async (interaction: CommandInteraction) => {
  const { channel } = interaction;
  if (!channel) return;
  const ctx = channels.find(x => x.channel.id === channel.id);
  if (!ctx) {
    await interaction.reply('I am not alive in this channel.');
    return;
  }
  await interaction.reply(
    ctx.profiles.size
      ? [...ctx.profiles.entries()].map(x => `${x[0]}: ${x[1]}`).join('\n')
      : 'No profiles yet.',
  );
};

client.once('ready', async () => {
  client.on('messageCreate', handleMessage).on('interactionCreate', async x => {
    if (!x.isCommand()) return;
    if (x.commandName === 'alive') return await handleAlive(x);
    if (x.commandName === 'brain') return await handleBrain(x);
  });

  await client.application?.commands.create({
    name: 'alive',
    description: 'Make the bot come alive in the channel',
  });
  await client.application?.commands.create({
    name: 'brain',
    description: "List the profiles in the bot's memory",
  });

  console.log('Ready.');
});

(async () => {
  await client.login(DISCORD_TOKEN);
})();

const handleMessage = async (message: Message | PartialMessage) => {
  if (message.guildId !== GUILD_ID) {
    await message.guild?.leave();
    return;
  }
  if (!message.author) return;
  const ctx = channels.find(x => x.channel.id === message.channelId);
  if (!ctx) return;

  if (message.author.id === client.user?.id) return;

  if (ctx.impatience++ >= impatienceLimit) {
    await reply(ctx)();
  } else {
    ctx.timer && clearTimeout(ctx.timer);
    ctx.timer = setTimeout(reply(ctx), timeoutMs);
  }
};

const reply = (ctx: ChannelCtx) => async () => {
  await ctx.channel.sendTyping();
  clearTimeout(ctx.timer);
  ctx.impatience = 0;
  --ctx.timeToLive;
  if (!ctx.timeToLive) {
    channels.splice(channels.indexOf(ctx), 1);
    await ctx.channel.send('I died. Use `/alive` to bring me back to life.');
    return;
  }
  const tag = client.user!.tag;

  const messages = (
    await ctx.channel.messages.fetch({ limit: messageLimit })
  ).map(messageDetails);
  messages.sort((a, b) => a.at.getTime() - b.at.getTime());

  const tags = new Set(messages.map(x => x.tag));
  tags.delete(tag);
  tags.delete('auekha');
  const includedProfiles = new Map<string, string>([['auekha', 'my creator']]);
  for (const message of messages) {
    const profile = ctx.profiles.get(message.tag);
    profile && includedProfiles.set(message.tag, profile);
  }

  const message = `
What you remember of everybody so far:
${[...includedProfiles.entries()].map(x => `${x[0]}: ${x[1]}`).join('\n')}
-----
Latest messages in the channel:
${messages
  .map(x => {
    const ago = Math.floor((Date.now() - x.at.getTime()) / 1_000);
    return (
      `(ID ${x.id}) ${x.tag} ${ago} seconds ago: ${x.content}` +
      (x.reply ? ` (replying to ${x.reply})` : '')
    );
  })
  .join('\n')}`;

  const systemMessage = `You're a Discord user called Al (${tag}).
You're just an average person, blending in with other Discord users.
Don't repeat yourself or others, and don't respond with long messages, and don't respond to yourself.
Respond exactly as so:

what you'd like to say
-----
null or the message ID you'd like to reply to
-----
${[...tags].map(x => `${x}: [what you think of them]`).join('\n')}`;

  console.log({ message, systemMessage });

  const response = await chatGpt.sendMessage(message, { systemMessage });
  const [content, id, memory] = response.text
    .split(/-{4,5}/g)
    .map(x => x.trim());

  console.log(response.text);

  const msgRef = id && id !== 'null' && new RegExp(/\d+/).exec(id)?.[0];
  const messageReference = msgRef && shortIds.get(msgRef);
  await ctx.channel.send({
    content,
    reply: messageReference
      ? { messageReference, failIfNotExists: false }
      : undefined,
  });

  if (!memory) return;
  const newProfiles = memory
    .split('\n')
    .map(x => x.trim())
    .filter(x => x)
    .map(x => x.split(':') as [string, string]);
  for (const [tag, profile] of newProfiles) {
    ctx.profiles.set(tag, profile);
  }
};
