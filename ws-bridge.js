require('dotenv').config();
const WebSocket = require('ws');
const { Client, GatewayIntentBits, EmbedBuilder, WebhookClient } = require('discord.js');

// ============================================================
// CONFIG — cambia estos valores
// ============================================================
const WS_URL      = 'wss://free.blr2.piesocket.com/v3/1?api_key=q55tCAaMdppkFY39hA2h2ebJHAQiv3a4C5824jcy&notify_self=1';
const LOG_CHANNEL = process.env.LOG_CHANNEL; // ID del canal de Discord
const TOKEN       = process.env.TOKEN;        // Token del bot
const MIN_GEN     = 1000000;                  // Gen mínima para notificar (1M)

// Rarezas que notifican con ping
const RARE_RARITIES = ['divino', 'galaxy', 'lava', 'rainbow', 'radioactive', 'glitch', 'bloodmoon'];

// ============================================================
// DISCORD CLIENT
// ============================================================
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

let logChannel = null;
let wsConn     = null;
let reconnectTimer = null;
let totalLogs  = 0;
let totalRare  = 0;

// ============================================================
// COLORS POR RAREZA
// ============================================================
const RARITY_COLORS = {
    divino:      0xFFD700,
    galaxy:      0x6432FF,
    lava:        0xFF5000,
    rainbow:     0xFF64C8,
    radioactive: 0x50DC32,
    diamond:     0x96DCFF,
    gold:        0xFFC800,
    glitch:      0xC832FF,
    bloodmoon:   0xB40000,
    normal:      0x888888,
};

const RARITY_EMOJIS = {
    divino:      '✨',
    galaxy:      '🌌',
    lava:        '🔥',
    rainbow:     '🌈',
    radioactive: '☢️',
    diamond:     '💎',
    gold:        '⭐',
    glitch:      '👾',
    bloodmoon:   '🔴',
    normal:      '⚪',
};

function getRarityColor(rarity) {
    const key = (rarity || '').toLowerCase();
    for (const [name, color] of Object.entries(RARITY_COLORS)) {
        if (key.includes(name)) return color;
    }
    return 0x5865F2;
}

function getRarityEmoji(rarity) {
    const key = (rarity || '').toLowerCase();
    for (const [name, emoji] of Object.entries(RARITY_EMOJIS)) {
        if (key.includes(name)) return emoji;
    }
    return '❓';
}

function isRare(rarity) {
    const key = (rarity || '').toLowerCase();
    return RARE_RARITIES.some(r => key.includes(r));
}

function parseGen(text) {
    if (!text) return 0;
    const clean = text.replace(/[^0-9.KMBT]/g, '');
    const n = parseFloat(clean.match(/^[\d.]+/)?.[0] || '0');
    const suffix = clean.match(/[KMBT]$/)?.[0] || '';
    const mult = {K:1e3, M:1e6, B:1e9, T:1e12};
    return n * (mult[suffix] || 1);
}

// ============================================================
// SEND TO DISCORD
// ============================================================
async function sendLog(data) {
    if (!logChannel) return;

    totalLogs++;
    const genVal = parseGen(data.genText || data.gen || '0');
    if (genVal < MIN_GEN) return; // Filtrar por gen mínima

    const rare = isRare(data.rarity || '');
    if (rare) totalRare++;

    const emoji = getRarityEmoji(data.rarity || '');
    const color = getRarityColor(data.rarity || '');

    const embed = new EmbedBuilder()
        .setTitle(`${emoji} ${data.name || 'Brainrot'} encontrado!`)
        .setColor(color)
        .addFields(
            { name: '🧬 Nombre',    value: data.name    || '?', inline: true  },
            { name: '💫 Rareza',    value: data.rarity  || '?', inline: true  },
            { name: '📈 Gen',       value: data.genText || data.gen || '?', inline: true  },
            { name: '🗺️ Plot',     value: data.plot    || '?', inline: true  },
            { name: '🌐 Job ID',    value: `\`${data.jobId || '?'}\``, inline: false },
            { name: '🔗 Unirse',    value: data.joinLink
                ? `[Click aquí](${data.joinLink})`
                : `roblox://experiences/start?placeId=${data.placeId}&gameInstanceId=${data.jobId}`,
              inline: false },
        )
        .setFooter({ text: `H7K Finder • Total logs: ${totalLogs} | Raros: ${totalRare}` })
        .setTimestamp();

    // Ping si es raro
    const content = rare ? `@here 🚨 **${data.rarity?.toUpperCase()}** encontrado!` : null;

    await logChannel.send({ content, embeds: [embed] }).catch(e => {
        console.error('❌ Error enviando a Discord:', e.message);
    });

    console.log(`[LOG] ${emoji} ${data.name} | ${data.rarity} | ${data.genText || data.gen}`);
}

async function sendStatus(title, description, color) {
    if (!logChannel) return;
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color || 0x5865F2)
        .setTimestamp();
    await logChannel.send({ embeds: [embed] }).catch(() => {});
}

// ============================================================
// WEBSOCKET
// ============================================================
function connectWS() {
    if (wsConn) {
        try { wsConn.close(); } catch(e) {}
        wsConn = null;
    }

    console.log('🔗 Conectando al WebSocket...');

    try {
        wsConn = new WebSocket(WS_URL);
    } catch(e) {
        console.error('❌ Error creando WebSocket:', e.message);
        scheduleReconnect();
        return;
    }

    wsConn.on('open', () => {
        console.log('✅ WebSocket conectado!');
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        sendStatus('🟢 H7K Finder Conectado', 'El WebSocket se conectó. Los logs aparecerán aquí.', 0x57F287);
    });

    wsConn.on('message', (raw) => {
        try {
            const data = JSON.parse(raw.toString());
            if (data && (data.name || data.genText || data.gen)) {
                sendLog(data);
            }
        } catch(e) {
            // mensaje no JSON, ignorar
        }
    });

    wsConn.on('close', (code, reason) => {
        console.log(`⚠️ WebSocket cerrado (${code}). Reconectando en 5s...`);
        sendStatus('🔴 WebSocket Desconectado', `Código: ${code}. Reconectando en 5 segundos...`, 0xED4245);
        scheduleReconnect();
    });

    wsConn.on('error', (err) => {
        console.error('❌ WebSocket error:', err.message);
        scheduleReconnect();
    });

    // Keep alive ping cada 30s
    const pingInterval = setInterval(() => {
        if (wsConn && wsConn.readyState === WebSocket.OPEN) {
            wsConn.ping();
        } else {
            clearInterval(pingInterval);
        }
    }, 30000);
}

function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWS();
    }, 5000);
}

// ============================================================
// DISCORD READY
// ============================================================
client.once('ready', async () => {
    console.log(`✅ Bot listo: ${client.user.tag}`);

    // Buscar el canal de logs
    logChannel = client.channels.cache.get(LOG_CHANNEL);
    if (!logChannel) {
        try {
            logChannel = await client.channels.fetch(LOG_CHANNEL);
        } catch(e) {
            console.error('❌ No se pudo encontrar el canal LOG_CHANNEL:', LOG_CHANNEL);
        }
    }

    if (logChannel) {
        console.log(`✅ Canal de logs: #${logChannel.name}`);
        connectWS();
    } else {
        console.error('❌ Canal no encontrado. Verifica LOG_CHANNEL en .env');
    }
});

// ============================================================
// DISCORD COMMANDS (slash básicos)
// ============================================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ws-status') {
        const connected = wsConn && wsConn.readyState === WebSocket.OPEN;
        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle('📡 Estado del WebSocket')
                .addFields(
                    { name: '🔗 Estado',     value: connected ? '🟢 Conectado' : '🔴 Desconectado', inline: true },
                    { name: '📊 Total logs', value: `${totalLogs}`, inline: true },
                    { name: '⭐ Raros',      value: `${totalRare}`, inline: true },
                    { name: '📡 URL',        value: `\`${WS_URL.slice(0, 50)}...\``, inline: false },
                )
                .setColor(connected ? 0x57F287 : 0xED4245)
                .setTimestamp()],
            ephemeral: true
        });
    }

    if (interaction.commandName === 'ws-reconectar') {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: '❌ Solo administradores', ephemeral: true });
        }
        await interaction.reply({ content: '🔄 Reconectando WebSocket...', ephemeral: true });
        connectWS();
    }

    if (interaction.commandName === 'ws-setcanal') {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: '❌ Solo administradores', ephemeral: true });
        }
        const canal = interaction.options.getChannel('canal');
        logChannel = canal;
        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setDescription(`✅ Canal de logs cambiado a ${canal}`)
                .setColor(0x57F287)]
        });
    }
});

// Register commands on startup
client.once('ready', async () => {
    const { REST, Routes, SlashCommandBuilder } = require('discord.js');
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    const cmds = [
        new SlashCommandBuilder().setName('ws-status').setDescription('📡 Ver estado del WebSocket'),
        new SlashCommandBuilder().setName('ws-reconectar').setDescription('🔄 Reconectar WebSocket'),
        new SlashCommandBuilder()
            .setName('ws-setcanal')
            .setDescription('📌 Cambiar canal de logs')
            .addChannelOption(o => o.setName('canal').setDescription('Canal').setRequired(true)),
    ].map(c => c.toJSON());

    await rest.put(Routes.applicationCommands(client.user.id), { body: cmds }).catch(() => {});
});

// ============================================================
// LOGIN
// ============================================================
client.login(TOKEN);

process.on('uncaughtException', err => console.error('Error:', err.message));
process.on('unhandledRejection', err => console.error('Rejection:', err?.message));
