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

// Замінити на свої дані
const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

let stats = {};
const statsFile = './stats.json';

if (fs.existsSync(statsFile)) {
    stats = JSON.parse(fs.readFileSync(statsFile));
}

function saveStats() {
    fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
}

// ----------------------------
// Slash-команди
// ----------------------------
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

const rest = new REST({
    version: '10'
}).setToken(token);
rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commands
});

client.once('ready', () => {
    console.log(`✅ Бот увімкнено як ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'дуель') {
            const challenger = interaction.user;
            const opponent = interaction.options.getUser('гравець'); // Може бути null

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
                const collector = interaction.channel.createMessageComponentCollector({
                    filter,
                    time: 15000
                });

                collector.on('collect', async i => {
                    handleDuelResponse(i, challenger, opponent);
                });

            } else {
                await interaction.reply({
                    content: `⚔️ ${challenger} викликає на дуель будь-кого! Хто приймає виклик?`,
                    components: [acceptRow]
                });

                const filter = i => ['accept', 'decline'].includes(i.customId) && i.user.id !== challenger.id;
                const collector = interaction.channel.createMessageComponentCollector({
                    filter,
                    max: 1,
                    time: 15000
                });

                collector.on('collect', async i => {
                    if (i.customId === 'accept') {
                        handleDuelResponse(i, challenger, i.user);
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
                await interaction.reply({
                    content: 'У тебе ще немає дуелей.',
                    ephemeral: true
                });
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

    // Обробка кнопок результату
    if (interaction.isButton()) {
        const [result, challengerId, opponentId] = interaction.customId.split('_');

        if (!['win', 'lose'].includes(result)) return;

        // Перевіряємо, що натискає учасник дуелі
        if (![challengerId, opponentId].includes(interaction.user.id)) {
            return interaction.reply({
                content: 'Ти не учасник цієї дуелі!',
                ephemeral: true
            });
        }

        let winner, loser;

        if (result === 'win') {
            winner = interaction.user.id;
            loser = winner === challengerId ? opponentId : challengerId;
        } else { // result === 'lose'
            loser = interaction.user.id;
            winner = loser === challengerId ? opponentId : challengerId;
        }

        if (!stats[winner]) stats[winner] = {
            wins: 0,
            losses: 0,
            victoriesOver: {}
        };
        if (!stats[loser]) stats[loser] = {
            wins: 0,
            losses: 0,
            victoriesOver: {}
        };

        stats[winner].wins++;
        stats[winner].victoriesOver[loser] = (stats[winner].victoriesOver[loser] || 0) + 1;
        stats[loser].losses++;

        saveStats();

        await interaction.update({
            content: `🏁 Переможець: <@${winner}>! Поразка: <@${loser}>.`,
            components: []
        });
    }
});  // <-- Ось ця дужка закриває client.on

// 🔧 Функція запуску дуелі
async function handleDuelResponse(interaction, challenger, opponent) {
    const resultRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`win_${challenger.id}_${opponent.id}`).setLabel(`🥇 Я переміг`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`lose_${challenger.id}_${opponent.id}`).setLabel(`🥈 Я програв`).setStyle(ButtonStyle.Secondary)
    );

    await interaction.update({
        content: `⚔️ Дуель між ${challenger} і ${opponent} почалась! Хто переміг?`,
        components: [resultRow]
    });
}

client.login(token);
