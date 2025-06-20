// Load environment variables
require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    Events
} = require('discord.js');
const fs = require('fs');
const http = require('http');

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId || !guildId) {
    console.error('❌ Missing environment variables: TOKEN, CLIENT_ID, or GUILD_ID');
    process.exit(1);
}

let client;
try {
    client = new Client({ intents: [GatewayIntentBits.Guilds] });
    console.log('✅ Discord client initialized.');
} catch (error) {
    console.error('❌ Failed to initialize Discord client:', error);
    process.exit(1);
}

let stats = {};
const statsFile = './stats.json';

try {
    if (fs.existsSync(statsFile)) {
        stats = JSON.parse(fs.readFileSync(statsFile));
        console.log('✅ Stats loaded from file.');
    }
} catch (err) {
    console.error('❌ Failed to read stats file:', err);
}

function saveStats() {
    try {
        fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
        console.log('✅ Stats saved.');
    } catch (err) {
        console.error('❌ Failed to save stats:', err);
    }
}

const commands = [
    new SlashCommandBuilder()
        .setName('дуель')
        .setDescription('Кинути виклик гравцю або будь-кому')
        .addUserOption(option =>
            option.setName('гравець').setDescription('Кого викликаєш').setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName('статистика')
        .setDescription('Переглянути свою статистику')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        console.log('📡 Registering slash commands...');
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
            body: commands
        });
        console.log('✅ Slash commands registered.');
    } catch (error) {
        console.error('❌ Error registering slash commands:', error);
    }
})();

client.once('ready', () => {
    console.log(`✅ Бот увімкнено як ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            console.log(`📥 Slash command received: ${interaction.commandName}`);
            if (interaction.commandName === 'дуель') {
                const challenger = interaction.user;
                const opponent = interaction.options.getUser('гравець');

                const acceptRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('accept').setLabel('✅ Прийняти').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('decline').setLabel('❌ Відхилити').setStyle(ButtonStyle.Danger)
                );

                if (opponent) {
                    await interaction.reply({
                        content: `🛡️ ${opponent}, тебе викликає на дуель ${challenger}!`,
                        components: [acceptRow]
                    });

                    const filter = i => ['accept', 'decline'].includes(i.customId) && i.user.id === opponent.id;
                    const collector = interaction.channel.createMessageComponentCollector({ filter, time: 15000 });

                    collector.on('collect', async i => {
                        await handleDuelResponse(i, challenger, opponent);
                    });

                } else {
                    await interaction.reply({
                        content: `⚔️ ${challenger} викликає на дуель будь-кого! Хто приймає виклик?`,
                        components: [acceptRow]
                    });

                    const filter = i => ['accept', 'decline'].includes(i.customId) && i.user.id !== challenger.id;
                    const collector = interaction.channel.createMessageComponentCollector({ filter, max: 1, time: 15000 });

                    collector.on('collect', async i => {
                        if (i.customId === 'accept') {
                            await handleDuelResponse(i, challenger, i.user);
                        } else {
                            await i.update({
                                content: `❌ Відкритий виклик було відхилено.`,
                                components: []
                            });
                        }
                    });
                }
            }

            if (interaction.commandName === 'статистика') {
                const user = interaction.user;
                const userStats = stats[user.id];

                if (!userStats) {
                    await interaction.reply({ content: 'У тебе ще немає дуелей.', ephemeral: true });
                } else {
                    const victories = Object.entries(userStats.victoriesOver || {})
                        .map(([id, count]) => `<@${id}> — ${count} раз(и)`)
                        .join('\n') || 'Нікого не переміг';

                    await interaction.reply({
                        content: `📊 Статистика для ${user.username}:\n✅ Перемог: ${userStats.wins}\n❌ Поразок: ${userStats.losses}\n\n👑 Перемоги над:\n${victories}`,
                        ephemeral: true
                    });
                }
            }
        }

        if (interaction.isButton()) {
            console.log(`🔘 Button clicked: ${interaction.customId}`);
            await handleResultButton(interaction);
        }
    } catch (err) {
        console.error('❌ Interaction error:', err);
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: '🚨 Сталася помилка під час обробки запиту.', ephemeral: true });
            } else {
                await interaction.reply({ content: '🚨 Сталася помилка під час обробки запиту.', ephemeral: true });
            }
        } catch (err2) {
            console.error('❌ Failed to reply with error message:', err2);
        }
    }
});

const resolvedDuels = new Set();

async function handleDuelResponse(interaction, challenger, opponent) {
    console.log(`⚔️ Дуель між ${challenger.username} і ${opponent.username}`);

    const resultRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`win_${challenger.id}_${opponent.id}`).setLabel('🥇 Я переміг').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`lose_${challenger.id}_${opponent.id}`).setLabel('🥈 Я програв').setStyle(ButtonStyle.Secondary)
    );

    let message;
    try {
        message = await interaction.update({
            content: `⚔️ Дуель між ${challenger} і ${opponent} почалась! Хто переміг?`,
            components: [resultRow],
            fetchReply: true
        });
    } catch (error) {
        console.error('❌ Failed to send duel message:', error);
        return;
    }

    const filter = i => {
        const [result, chId, opId] = i.customId.split('_');
        const isDuelButton = ['win', 'lose'].includes(result);
        const isParticipant = [challenger.id, opponent.id].includes(i.user.id);
        return isDuelButton && isParticipant;
    };

    const startCollector = () => {
        const collector = message.createMessageComponentCollector({ filter, max: 1, time: 60000 });

        collector.on('collect', async i => {
            console.log(`🎯 Button pressed by ${i.user.username}: ${i.customId}`);
            await handleResultButton(i);
        });

        collector.on('end', (collected, reason) => {
            if (collected.size === 0 && reason === 'time') {
                console.log(`⏳ Ніхто не натиснув кнопку. Продовжуємо чекати...`);
                startCollector();
            }
        });
    };

    startCollector();
}

async function handleResultButton(interaction) {
    const [result, challengerId, opponentId] = interaction.customId.split('_');
    const duelId = `${challengerId}_${opponentId}`;

    if (resolvedDuels.has(duelId)) return;

    if (!['win', 'lose'].includes(result)) return;

    if (![challengerId, opponentId].includes(interaction.user.id)) {
        return interaction.reply({
            content: 'Ти не учасник цієї дуелі!',
            ephemeral: true
        });
    }

    resolvedDuels.add(duelId);

    let winner, loser;

    if (result === 'win') {
        winner = interaction.user.id;
        loser = winner === challengerId ? opponentId : challengerId;
    } else {
        loser = interaction.user.id;
        winner = loser === challengerId ? opponentId : challengerId;
    }

    if (!stats[winner]) stats[winner] = { wins: 0, losses: 0, victoriesOver: {} };
    if (!stats[loser]) stats[loser] = { wins: 0, losses: 0, victoriesOver: {} };

    stats[winner].wins++;
    stats[winner].victoriesOver[loser] = (stats[winner].victoriesOver[loser] || 0) + 1;
    stats[loser].losses++;

    saveStats();

    try {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.update({
                content: `🏁 Переможець: <@${winner}>! Поразка: <@${loser}>.`,
                components: []
            });
        }
    } catch (err) {
        console.error('❌ Failed to update interaction (maybe it expired):', err);
    }
}

client.login(token).catch(err => {
    console.error('❌ Failed to login to Discord:', err);
});

const port = process.env.PORT || 3000;
try {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Discord Bot is running!');
    });

    server.listen(port, () => {
        console.log(`🌐 HTTP server listening on port ${port}`);
    });
} catch (err) {
    console.error('❌ Failed to start HTTP server:', err);
}
