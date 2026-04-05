require('dotenv').config();
const WebSocket = require('ws');
const http      = require('http');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

const WS_URL      = 'wss://free.blr2.piesocket.com/v3/1?api_key=q55tCAaMdppkFY39hA2h2ebJHAQiv3a4C5824jcy&notify_self=1';
const LOG_CHANNEL = process.env.LOG_CHANNEL;
const TOKEN       = process.env.TOKEN;
const MIN_GEN     = 1000000;
const RARE_RARITIES = ['divino', 'galaxy', 'lava', 'rainbow', 'radioactive', 'glitch', 'bloodmoon'];

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

let logChannel     = null;
let wsConn         = null;
let reconnectTimer = null;
let totalLogs      = 0;
let totalRare      = 0;

// ── HTTP server para Render (necesita puerto) ─────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('H7K WS Bridge ✅\nLogs: ' + totalLogs + ' | Raros: ' + totalRare);
}).listen(PORT, () => console.log('🌐 HTTP corriendo en puerto ' + PORT));

// ── COLORES Y EMOJIS ──────────────────────────────────────
const RARITY_COLORS = {
    divino:0xFFD700, galaxy:0x6432FF, lava:0xFF5000, rainbow:0xFF64C8,
    radioactive:0x50DC32, diamond:0x96DCFF, gold:0xFFC800,
    glitch:0xC832FF, bloodmoon:0xB40000, normal:0x888888,
};
const RARITY_EMOJIS = {
    divino:'✨', galaxy:'🌌', lava:'🔥', rainbow:'🌈',
    radioactive:'☢️', diamond:'💎', gold:'⭐', glitch:'👾', bloodmoon:'🔴',
};

function getRarityColor(r) {
    const k = (r||'').toLowerCase();
    for (const [n,c] of Object.entries(RARITY_COLORS)) if (k.includes(n)) return c;
    return 0x5865F2;
}
function getRarityEmoji(r) {
    const k = (r||'').toLowerCase();
    for (const [n,e] of Object.entries(RARITY_EMOJIS)) if (k.includes(n)) return e;
    return '❓';
}
function isRare(r) {
    const k = (r||'').toLowerCase();
    return RARE_RARITIES.some(x => k.includes(x));
}
function parseGen(text) {
    if (!text) return 0;
    const clean = text.replace(/[^0-9.KMBT]/g,'');
    const n = parseFloat(clean.match(/^[\d.]+/)?.[0]||'0');
    const s = clean.match(/[KMBT]$/)?.[0]||'';
    return n * ({K:1e3,M:1e6,B:1e9,T:1e12}[s]||1);
}

// ── SEND LOG TO DISCORD ───────────────────────────────────
async function sendLog(data) {
    if (!logChannel) return;
    totalLogs++;
    const genVal = parseGen(data.genText || data.gen || '0');
    if (genVal < MIN_GEN) return;
    const rare = isRare(data.rarity||'');
    if (rare) totalRare++;

    const emoji = getRarityEmoji(data.rarity||'');
    const embed = new EmbedBuilder()
        .setTitle(emoji + ' ' + (data.name||'Brainrot') + ' encontrado!')
        .setColor(getRarityColor(data.rarity||''))
        .addFields(
            { name:'🧬 Nombre',  value:data.name||'?',                inline:true  },
            { name:'💫 Rareza',  value:data.rarity||'?',              inline:true  },
            { name:'📈 Gen',     value:data.genText||data.gen||'?',   inline:true  },
            { name:'🗺️ Plot',   value:data.plot||'?',                 inline:true  },
            { name:'🌐 Job ID',  value:'`'+(data.jobId||'?')+'`',     inline:false },
            { name:'🔗 Unirse',  value:data.joinLink
                ? '[Click aquí]('+data.joinLink+')'
                : 'roblox://experiences/start?placeId='+data.placeId+'&gameInstanceId='+data.jobId,
              inline:false },
        )
        .setFooter({ text:'H7K Finder • Logs: '+totalLogs+' | Raros: '+totalRare })
        .setTimestamp();

    const content = rare ? '@here 🚨 **'+data.rarity?.toUpperCase()+'** encontrado!' : null;
    await logChannel.send({ content, embeds:[embed] }).catch(e => console.error('Discord error:', e.message));
    console.log('[LOG] ' + emoji + ' ' + data.name + ' | ' + data.rarity + ' | ' + (data.genText||data.gen));
}

async function sendStatus(title, desc, color) {
    if (!logChannel) return;
    await logChannel.send({ embeds:[new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color||0x5865F2).setTimestamp()] }).catch(()=>{});
}

// ── WEBSOCKET ─────────────────────────────────────────────
function connectWS() {
    if (wsConn) { try { wsConn.close(); } catch(e){} wsConn=null; }
    console.log('🔗 Conectando WebSocket...');
    try { wsConn = new WebSocket(WS_URL); } catch(e) { console.error('WS error:', e.message); scheduleReconnect(); return; }

    wsConn.on('open', () => {
        console.log('✅ WebSocket conectado!');
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer=null; }
        sendStatus('🟢 H7K Finder Conectado', 'WebSocket conectado. Los logs apareceran aqui.', 0x57F287);
    });
    wsConn.on('message', (raw) => {
        try {
            const data = JSON.parse(raw.toString());
            if (data && (data.name || data.genText || data.gen)) sendLog(data);
        } catch(e) {}
    });
    wsConn.on('close', (code) => {
        console.log('⚠️ WS cerrado ('+code+'). Reconectando en 5s...');
        sendStatus('🔴 Desconectado', 'Reconectando en 5 segundos...', 0xED4245);
        scheduleReconnect();
    });
    wsConn.on('error', (err) => { console.error('WS error:', err.message); scheduleReconnect(); });

    setInterval(() => {
        if (wsConn && wsConn.readyState === WebSocket.OPEN) wsConn.ping();
    }, 30000);
}
function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => { reconnectTimer=null; connectWS(); }, 5000);
}

// ── DISCORD READY ─────────────────────────────────────────
client.once('ready', async () => {
    console.log('✅ Bot: ' + client.user.tag);
    logChannel = client.channels.cache.get(LOG_CHANNEL);
    if (!logChannel) {
        try { logChannel = await client.channels.fetch(LOG_CHANNEL); } catch(e) { console.error('❌ Canal no encontrado:', LOG_CHANNEL); }
    }
    if (logChannel) { console.log('✅ Canal: #' + logChannel.name); connectWS(); }
    else console.error('❌ Verifica LOG_CHANNEL en las variables de entorno');

    // Slash commands
    const { REST, Routes, SlashCommandBuilder } = require('discord.js');
    const rest = new REST({version:'10'}).setToken(TOKEN);
    const cmds = [
        new SlashCommandBuilder().setName('ws-status').setDescription('📡 Estado del WebSocket'),
        new SlashCommandBuilder().setName('ws-reconectar').setDescription('🔄 Reconectar WebSocket'),
        new SlashCommandBuilder().setName('ws-setcanal').setDescription('📌 Cambiar canal de logs')
            .addChannelOption(o=>o.setName('canal').setDescription('Canal').setRequired(true)),
    ].map(c=>c.toJSON());
    await rest.put(Routes.applicationCommands(client.user.id), {body:cmds}).catch(()=>{});
});

// ── SLASH COMMANDS ────────────────────────────────────────
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const cmd = interaction.commandName;

    if (cmd==='ws-status') {
        const on = wsConn && wsConn.readyState === WebSocket.OPEN;
        await interaction.reply({ embeds:[new EmbedBuilder().setTitle('📡 Estado WS')
            .addFields({name:'Estado',value:on?'🟢 Conectado':'🔴 Desconectado',inline:true},{name:'Logs',value:''+totalLogs,inline:true},{name:'Raros',value:''+totalRare,inline:true})
            .setColor(on?0x57F287:0xED4245).setTimestamp()], ephemeral:true });
    }
    if (cmd==='ws-reconectar') {
        if (!interaction.member.permissions.has('Administrator')) return interaction.reply({content:'❌ Solo admins',ephemeral:true});
        await interaction.reply({content:'🔄 Reconectando...',ephemeral:true});
        connectWS();
    }
    if (cmd==='ws-setcanal') {
        if (!interaction.member.permissions.has('Administrator')) return interaction.reply({content:'❌ Solo admins',ephemeral:true});
        logChannel = interaction.options.getChannel('canal');
        await interaction.reply({embeds:[new EmbedBuilder().setDescription('✅ Canal → '+logChannel).setColor(0x57F287)]});
    }
});

process.on('uncaughtException', err => console.error('Error:', err.message));
process.on('unhandledRejection', err => console.error('Rejection:', err?.message));

client.login(TOKEN);
