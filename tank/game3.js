        let network = null;
        let myUsername = 'Player1';
        let fullyConnectedPeers = new Set();

        const TERR_WIDTH = 1600;
        const TERR_HEIGHT = 900;
        const TANK_W = 16,
            TANK_H = 10;
        const BULLET_SPEED = 15,
            GRAVITY = 0.5;
        const MAX_SLOPE = 1.5;

        let isHost = false;
        let newSeed = 1;
        let gameState = 'waiting'; 
        let currentTurn = 0;
        let playerTanks = new Map(); 
        let myPlayerId = null;
        let myTank = null;
        let isMyTurn = false;
        let playerUsernames = new Map(); 
        let canFire = true;
        let dragging = false,
            last = {
                x: 0,
                y: 0
            },
            scale = 1;
        let maiming = false;

PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST;
const app = new PIXI.Application({
    resizeTo: window,
    backgroundColor: PALETTE.base,
    antialias: false
});
document.body.appendChild(app.view);

const world = new PIXI.Container();
app.stage.addChild(world);

const tc = document.createElement('canvas');
tc.width = TERR_WIDTH;
tc.height = TERR_HEIGHT;
const tctx = tc.getContext('2d');
const ttex = PIXI.Texture.from(tc);
ttex.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
const tspr = new PIXI.Sprite(ttex);

const bulletTrail = new PIXI.Graphics();
const globalBulletTrail = new PIXI.Graphics();

world.addChild(bulletTrail);        
world.addChild(globalBulletTrail);  
world.addChild(tspr);               

function syncGameState(e) {
    if (isHost) {

        network.broadcastGameData({
            type: 'game-state-sync',
            gameState: gameState,
            endMessage: e
        });
    }
}

        let heights = [],
            terrain = [],
            collapseRegs = [];
        let bullets = [];
        let keys = {},
            mouse = {
                x: 0,
                y: 0
            };
        let allBulletGraphics = [];

        function initializeNetwork() {
            network = new P2PGameNetwork({
                signalingServer: 'ws://dono-01.danbot.host:9550/'
            });

network.onPeerConnected = (peerId) => {
    console.log('Peer connected:', peerId);

    // Step 1: Send my username to the new peer
    setTimeout(() => {
        network.sendGameData(peerId, {
            type: 'username',
            username: myUsername
        });
    }, 100);

    // Step 2: If I'm the host, send complete game state to new peer
    if (isHost) {
        setTimeout(() => {
            // Send all known usernames to the new peer
            for (const [knownPeerId, username] of playerUsernames) {
                network.sendGameData(peerId, {
                    type: 'username-share',
                    playerId: knownPeerId,
                    username: username
                });
            }

            // Send my own username
            network.sendGameData(peerId, {
                type: 'username-share',
                playerId: myPlayerId,
                username: myUsername
            });

            // Notify ALL existing peers about the new peer (with username)
            const newPeerUsername = 'Unknown'; // Will be updated when we receive their username
            for (const existingPeerId of network.getConnectedPeers()) {
                if (existingPeerId !== peerId) {
                    network.sendGameData(existingPeerId, {
                        type: 'new-peer-joined',
                        newPeerId: peerId,
                        username: newPeerUsername
                    });
                }
            }
        }, 200);

        // Step 3: Send game state after usernames are shared
        setTimeout(() => {
            resetTanks();
            network.sendGameData(peerId, {
                type: 'game-state',
                terrain: terrain,
                heights: heights,
                tanks: serializeTanks(),
                currentTurn: currentTurn,
                gameState: gameState,
                seed: newSeed
            });
        }, 1500);
    }

    // Step 4: Update UI
    setTimeout(() => {
        updatePlayerCount();
    }, 1000);
};


            network.onPeerDisconnected = (peerId) => {
                const username = getPlayerUsername(peerId);
                addChatMessage(`${username} disconnected`);
                removePlayer(peerId);
                playerUsernames.delete(peerId); 
                updatePlayerCount();
            };

//IF ANYTHING GOES WRONG NUKE ALL LOGIC HERE
            
network.onGameDataReceived = (peerId, data) => {
    if (peerId != myPlayerId) {
    handleNetworkMessage(peerId, data);
    }
    if (isHost) {
        for (const otherPeerId of network.getConnectedPeers()) {
            if (otherPeerId !== peerId) {
                network.sendGameData(otherPeerId, {
                    from: peerId,
                    payload: data
                });
            }
        }
    }
};


            network.onGameStateChanged = (state) => {
                updateConnectionStatus(state);
            };

            network.onError = (message, error) => {
                addChatMessage(`Error: ${message}`);
                console.error('Network error:', message, error);
            };
        }

function handleNetworkMessage(peerId, data) {
    switch (data.type) {
case 'username':
            console.log('Received username:', data.username, 'from', peerId);
            playerUsernames.set(peerId, data.username);
            addChatMessage(`${data.username} connected`);
            
            // If I'm the host, notify all other peers about this username
            if (isHost) {
                for (const otherPeerId of network.getConnectedPeers()) {
                    if (otherPeerId !== peerId) {
                        network.sendGameData(otherPeerId, {
                            type: 'username-share',
                            playerId: peerId,
                            username: data.username
                        });
                    }
                }
            }
            break;

        case 'username-share':
            console.log('Received username share:', data.username, 'for player:', data.playerId);
            if (!playerUsernames.has(data.playerId) && data.playerId !== myPlayerId) {
                playerUsernames.set(data.playerId, data.username);
                console.log('Learned about player:', data.username);
                updatePlayerCount();
                // Only show connection message if this is a new player we haven't seen
                addChatMessage(`${data.username} connected`);
            }
            break;

        case 'new-peer-joined':
            console.log('New peer joined notification:', data.newPeerId);
            // Don't show connection message here - wait for username-share
            updatePlayerCount();
            break;

        case 'peer-list-sync':
            // New message type to ensure all clients have the same peer list
            console.log('Received peer list sync:', data.peers);
            for (const [peerId, username] of Object.entries(data.peers)) {
                if (peerId !== myPlayerId && !playerUsernames.has(peerId)) {
                    playerUsernames.set(peerId, username);
                    addChatMessage(`${username} connected`);
                }
            }
            updatePlayerCount();
            break;


        case 'username-ack':
            if (!playerUsernames.has(peerId)) {
                playerUsernames.set(peerId, data.username);
                addChatMessage(`${data.username} connected`);
            }
            break;

        case 'game-state':
            console.log('Received game state from host');
            if (data.seed) {
                newSeed = data.seed;
                generate(data.seed);
                drawTerrain();
            }
            deserializeTanks(data.tanks);
            currentTurn = data.currentTurn;
            gameState = data.gameState;
            updateTurnIndicator();

            if (Object.keys(data.tanks).length > 0) {
                resetTanksFromState(data.tanks);
            }
            break;

        case 'terrain-generated':
            if (!isHost) {
                newSeed = data.seed;
                generate(data.seed);
                resetTanks();
                addChatMessage('Terrain updated.');
            }
            break;

        case 'tank-move':
            if (playerTanks.has(peerId)) {
                const tank = playerTanks.get(peerId);
                tank.x = data.x;
                tank.y = data.y;
                tank.angle = data.angle;
                tank.power = data.power;
                tank.barrelAngleDeg = data.barrelAngleDeg;
                updateTankDisplay(tank);
            }
            break;

        case 'tanks-reset':
            resetTanksFromState(data.tanks);
            if (data.playerOrder) {
                currentTurn = data.currentTurn;
                const currentPlayer = data.playerOrder[currentTurn];
                isMyTurn = currentPlayer === myPlayerId;
                updateTurnIndicator();
            }
            break;

        case 'bullet-fired':
            if (data.playerId !== myPlayerId) {
                bullets.push({
                    x: data.x,
                    y: data.y,
                    vx: data.vx,
                    vy: data.vy,
                    trail: [],
                    graphics: null,
                    shooter: playerTanks.get(data.playerId)
                });
            }
            break;

case 'direct-hit':

    const hitTank = playerTanks.get(data.tankId);
    if (hitTank && hitTank.hp > 0) {

        hitTank.hp = Math.max(0, hitTank.hp - data.damage);
        hitTank.updateHpBar();

        showExplosionEffect(data.x, data.y, 5, 0xffff00);
        showDamageText(data.x, data.y, data.damage);

        if (hitTank.hp === 0 && !hitTank.eliminated) {
            world.removeChild(hitTank);
            addChatMessage(`${getPlayerUsername(data.tankId)} is eliminated!`);
            hitTank.eliminated = true;
            updatePlayerCount();
        }
    }
    break;

case 'explosion':

    for (const [id, tank] of playerTanks) {
        const dist = Math.hypot(tank.x - data.x, tank.y - data.y);
        if (dist <= data.radius && tank.hp > 0) {
            tank.hp = Math.max(0, tank.hp - data.damage);
            tank.updateHpBar();

            showDamageText(tank.x, tank.y, data.damage);

            if (tank.hp === 0 && !tank.eliminated) {
                world.removeChild(tank);
                addChatMessage(`${getPlayerUsername(id)} is eliminated!`);
                tank.eliminated = true;
                updatePlayerCount();
            }
        }
    }
    blast(data.x, data.y, data.radius);
    showExplosionEffect(data.x, data.y, data.radius, PALETTE.peach);
    break;

        case 'turn-end':
            currentTurn = data.currentTurn;
            isMyTurn = data.nextPlayer === myPlayerId;
            updateTurnIndicator();
            break;

        case 'turn-end-request':

            if (isHost) {
                console.log('Received turn end request from:', data.playerId);
                const allPlayers = [myPlayerId, ...network.getConnectedPeers()].sort();
                const currentPlayer = allPlayers[currentTurn % allPlayers.length];

                if (data.playerId === currentPlayer) {
                    console.log('Valid turn end request, advancing turn');
                    setTimeout(() => {
                        const nextPlayer = advanceTurn();
                    }, 100);
                }
            }
            break;

case 'turn-change':
    console.log('Received turn change:', data.currentPlayer, 'Turn:', data.currentTurn);
    currentTurn = data.currentTurn;
    isMyTurn = data.currentPlayer === myPlayerId;
    canFire = isMyTurn; 
    turnEnding = false; 
    updateTurnIndicator();
    break;

        case 'chat':
            const senderUsername = getPlayerUsername(data.playerId);
            addChatMessage(`${senderUsername}: ${data.message}`);
            break;
        case 'game-state-sync':
            gameState = data.gameState
            if (data.e !== undefined) {
                    document.getElementById('turnIndicator').textContent = data.e;
    document.title = data.e;
                isMyTurn = false;
                addChatMessage(data.e);
            }
        break;
    }
}

        function getPlayerUsername(playerId) {
            if (playerId === myPlayerId) return myUsername;

            if (playerUsernames.has(playerId)) {
                return playerUsernames.get(playerId);
            }

            return playerId.slice(0, 8);
        }

        function createTank(x, color, playerId) {
            const g = new PIXI.Container();
            g.hp = 50;
            g.playerId = playerId;

            const body = new PIXI.Graphics()
                .beginFill(color)
                .drawRect(-TANK_W / 2, 0, TANK_W, TANK_H)
                .endFill();
            g.addChild(body);

            g.hpBar = new PIXI.Graphics();
            g.addChild(g.hpBar);

            g.updateHpBar = function() {
                g.hpBar.clear();
                const pct = Math.max(0, g.hp / 50);
                g.hpBar.beginFill(PALETTE.red).drawRect(-TANK_W, 25, TANK_W * 2 * pct, 3).endFill();
            };
            g.updateHpBar();

const barrel = new PIXI.Graphics()
    .beginFill(PALETTE.text)  
                .drawRect(0, -1, 16, 4)
                .endFill();
            barrel.pivot.set(0, 2);
            g.barrel = barrel;
            g.addChild(barrel);

            const nameText = new PIXI.Text(getPlayerUsername(playerId), {
                fontSize: 12,
                fill: PALETTE.text
            });
            nameText.anchor.set(0.5, 1);
            g.nameText = nameText;
            world.addChild(nameText); 

            g.angle = -Math.PI / 4;
            g.power = 30;
            g.barrelAngleDeg = -45;
            g.x = x;
            g.y = getY(x) - TANK_H;

            world.addChild(g);
            return g;
        }

function resetTanks() {

    for (const [id, tank] of playerTanks) {
        world.removeChild(tank);
        if (tank.nameText) {
            world.removeChild(tank.nameText);
        }
    }
    playerTanks.clear();

    bullets = [];
    for (const g of allBulletGraphics) {
        world.removeChild(g);
    }
    allBulletGraphics = [];
    bulletTrail.clear();
    globalBulletTrail.clear();

    const connectedPeers = network.getConnectedPeers();
    const allPlayers = [myPlayerId, ...connectedPeers].sort();

    const colors = [
        PALETTE.green,
        PALETTE.red,
        PALETTE.blue,
        PALETTE.yellow,
        PALETTE.mauve,
        PALETTE.pink,
        PALETTE.teal,
        PALETTE.peach
    ];

    const generatePositions = (numPlayers) => {
        const positions = [];
        const margin = 150; 
        const minSpacing = 200; 

        if (numPlayers <= 2) {

            positions.push(margin);
            if (numPlayers === 2) positions.push(TERR_WIDTH - margin);
        } else {

            const usableWidth = TERR_WIDTH - (2 * margin);
            const spacing = usableWidth / (numPlayers - 1);

            for (let i = 0; i < numPlayers; i++) {
                positions.push(margin + (i * spacing));
            }
        }

        return positions;
    };

    const positions = generatePositions(allPlayers.length);

    allPlayers.forEach((playerId, index) => {
        if (index < colors.length && index < positions.length) {
            const tank = createTank(positions[index], colors[index], playerId);
            playerTanks.set(playerId, tank);

            if (playerId === myPlayerId) {
                myTank = tank;
            }
        }
    });

    gameState = 'playing';

    if (isHost) {
        currentTurn = 0;
        const firstPlayer = allPlayers[0];
        isMyTurn = firstPlayer === myPlayerId;

        network.broadcastGameData({
            type: 'tanks-reset',
            tanks: serializeTanks(),
            currentTurn: currentTurn,
            currentPlayer: firstPlayer,
            playerOrder: allPlayers
        });

        updateTurnIndicator();
    }
updatePlayerCount();
}

        function serializeTanks() {
            const tanks = {};
            for (const [id, tank] of playerTanks) {
                tanks[id] = {
                    x: tank.x,
                    y: tank.y,
                    hp: tank.hp,
                    angle: tank.angle,
                    power: tank.power,
                    barrelAngleDeg: tank.barrelAngleDeg
                };
            }
            return tanks;
        }

        function deserializeTanks(tanks) {
            for (const [id, data] of Object.entries(tanks)) {
                if (playerTanks.has(id)) {
                    const tank = playerTanks.get(id);
                    tank.x = data.x;
                    tank.y = data.y;
                    tank.hp = data.hp;
                    tank.angle = data.angle;
                    tank.power = data.power;
                    tank.barrelAngleDeg = data.barrelAngleDeg;
                    tank.updateHpBar();
                    updateTankDisplay(tank);
                }
            }
        }

        function updateTankDisplay(tank) {
            tank.y = getY(Math.floor(tank.x)) - TANK_H;
            const yL = getY(Math.max(0, tank.x - 2));
            const yR = getY(Math.min(TERR_WIDTH - 1, tank.x + 2));
            const targetRotation = Math.atan2(yR - yL, 2);

            tank.rotation = targetRotation;
            tank.barrel.rotation = PIXI.DEG_TO_RAD * (tank.barrelAngleDeg - targetRotation * PIXI.RAD_TO_DEG);
            tank.hpBar.rotation = -targetRotation;

            if (tank.nameText) {
                tank.nameText.x = tank.x;
                tank.nameText.y = tank.y - 16;
                tank.nameText.scale.set(1 / scale); 
            }
        }

        function bulletHitsTank(bullet, tank) {
            const tx = tank.x - TANK_W / 2;
            const ty = tank.y;
            return (
                bullet.x >= tx &&
                bullet.x <= tx + TANK_W &&
                bullet.y >= ty &&
                bullet.y <= ty + TANK_H
            );
        }

function updateTurnIndicator() {

    const allPlayers = [myPlayerId, ...network.getConnectedPeers()].sort();
    if (allPlayers.length === 0) return;

    const currentPlayer = allPlayers[currentTurn % allPlayers.length];
    const tank = playerTanks.get(currentPlayer);

    if (tank && tank.hp > 0) {
        const playerName = getPlayerUsername(currentPlayer);
        const turnText = isMyTurn ? 'Your Turn!' : `${playerName}'s Turn`;
        document.getElementById('turnIndicator').textContent = turnText;
        document.title = turnText;
    } else {

        if (isHost) {
            const nextPlayer = advanceTurn();
            if (!nextPlayer) {
                document.getElementById('turnIndicator').textContent = 'Game Over';
                document.title = 'Game Over';
            }
        }
    }
    canFire = isMyTurn;
}

function advanceTurn() {

    const allPlayers = [myPlayerId, ...network.getConnectedPeers()].sort();
    if (allPlayers.length === 0) return null;

    let attempts = 0;
    let startingTurn = currentTurn;

    while (attempts < allPlayers.length) {
        currentTurn = (currentTurn + 1) % allPlayers.length;
        const currentPlayer = allPlayers[currentTurn];
        const tank = playerTanks.get(currentPlayer);

        if (tank && tank.hp > 0) {

            if (isHost) {
                isMyTurn = currentPlayer === myPlayerId;

                const aliveTanks = Array.from(playerTanks.values()).filter(tank => tank.hp > 0);
                if (aliveTanks.length <= 1) {
                    gameState = 'ended';

                    let endMessage = '';
                    if (aliveTanks.length === 1) {
                        const winner = Array.from(playerTanks.entries()).find(([id, tank]) => tank.hp > 0);
                        const winnerName = getPlayerUsername(winner[0]);
                        endMessage = `${winnerName} wins!`;
                    } else {
                        endMessage = 'Draw!';
                    }

                    addChatMessage(endMessage);
                    document.getElementById('turnIndicator').textContent = endMessage;
                    document.title = endMessage;
                    syncGameState(endMessage);
                } else {

                    network.broadcastGameData({
                        type: 'turn-change',
                        currentTurn: currentTurn,
                        currentPlayer: currentPlayer
                    });

                    updateTurnIndicator();
                }
            }

            return currentPlayer;
        }

        attempts++;

        if (currentTurn === startingTurn && attempts > 0) {
            break;
        }
    }

    if (isHost) {
        gameState = 'ended';
        document.getElementById('turnIndicator').textContent = 'Game Over';
        document.title = 'Game Over';
        syncGameState('Game Over');
    }
    return null;
}

        function createPRNG(seed) {
            let state = seed | 0;
            return function() {
                state ^= state << 13;
                state ^= state >>> 17;
                state ^= state << 5;
                return ((state >>> 0) / 4294967296);
            };
        }

        function generate(seed) {

            const terrainTypes = ["plain", "mountain", "single_mountain", "valley", "cliff"];
            const firstDigit = +String(seed)[0] % terrainTypes.length;
            const type = terrainTypes[firstDigit];

            const rng = createPRNG(seed);

            noise.seed(seed);

            const W = TERR_WIDTH;
            const H = TERR_HEIGHT;
            const base = H * 0.75;

            const amps = {
                plain: 0.3,
                mountain: 1.4,
                single_mountain: 0.4,
                valley: 1.2,
                cliff: 0.25
            };

            const amp = amps[type] * (0.8 + rng() * 0.4);
            const peakH = 60 + rng() * 80;
            const dipD = 60 + rng() * 80;
            const cliffO = 40 + rng() * 60;

            const octs = [{
                f: 0.002,
                a: 120
            }, {
                f: 0.007,
                a: 50
            }, {
                f: 0.03,
                a: 15
            }];

            heights = [];

            let s0 = 0.2 + rng() * 0.3;
            let w0 = 0.2 + rng() * 0.4;
            let s1 = s0 + w0;

            for (let x = 0; x <= W; x++) {
                let t = x / W;
                let e = octs.reduce((sum, o) => sum + noise.simplex2(x * o.f, 0) * o.a, 0);

                let y = base - e * amp;

                switch (type) {
                    case "single_mountain":
                        if (t > s0 && t < s1) {
                            y -= Math.sin(((t - s0) / (s1 - s0)) * Math.PI) * peakH * 1.5;
                        }
                        break;
                    case "valley":
                        if (t > 0.3 && t < 0.7) {
                            y += Math.sin(((t - 0.3) / 0.4) * Math.PI) * dipD;
                        }
                        break;
                    case "cliff":
                        if (t < 0.5) y -= cliffO;
                        y += noise.simplex2(x * octs[2].f, 0) * 6;
                        break;
                }

                y = Math.max(4, Math.min(H - 2, y));

                heights.push(y);
            }

            terrain = Array.from({
                length: H
            }, () => new Uint8Array(W));

            for (let i = 0; i < heights.length; i++) {
                const px = i;
                const hy = Math.floor(heights[i]);
                for (let yy = hy; yy < H - 1; yy++) {
                    terrain[yy][px] = 1;
                }
                terrain[H - 1][px] = 1; 
            }

            collapseRegs = [];
            drawTerrain();
        }

function drawTerrain() {
    const img = tctx.createImageData(TERR_WIDTH, TERR_HEIGHT);
    for (let y = 0; y < TERR_HEIGHT; y++) {
        for (let x = 0; x < TERR_WIDTH; x++) {
            if (terrain[y][x]) {
                const i = (y * TERR_WIDTH + x) * 4;

                const green = PALETTE.surface1;
                img.data[i] = (green >> 16) & 0xFF;     
                img.data[i + 1] = (green >> 8) & 0xFF;  
                img.data[i + 2] = green & 0xFF;         
                img.data[i + 3] = 255;                  
            }
        }
    }
    tctx.putImageData(img, 0, 0);
    ttex.update();
}

        function blast(cx, cy, r) {
            const r2 = r * r;
            for (let y = Math.max(0, cy - r); y < Math.min(TERR_HEIGHT, cy + r); y++) {
                for (let x = Math.max(0, cx - r); x < Math.min(TERR_WIDTH, cx + r); x++) {
                    if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) {
                        terrain[y][x] = 0;
                    }
                }
            }
            for (let x = 0; x < TERR_WIDTH; x++) {
                terrain[TERR_HEIGHT - 1][x] = 1;
            }
            drawTerrain();
        }

        function getY(x) {
            x = Math.max(0, Math.min(TERR_WIDTH - 1, x));
            for (let y = 0; y < TERR_HEIGHT; y++) {
                if (terrain[y][x]) return y;
            }
            return TERR_HEIGHT - 1;
        }

        function stepCollapse() {
            let changed = false;
            for (let y = TERR_HEIGHT - 2; y >= 0; y--) {
                for (let x = 0; x < TERR_WIDTH; x++) {
                    if (terrain[y][x] === 1 && terrain[y + 1][x] === 0) {
                        terrain[y + 1][x] = 1;
                        terrain[y][x] = 0;
                        changed = true;
                    }
                }
            }
            if (changed) drawTerrain();
        }

        function updateConnectionStatus(state) {
            const statusEl = document.getElementById('status');
            const capitalizedState = state.charAt(0).toUpperCase() + state.slice(1);
            statusEl.textContent = capitalizedState;
            statusEl.className = state === 'connected' ? 'status connected' : 'status';
        }

function updatePlayerCount() {
    const count = network ? network.getConnectedPeers().length + 1 : 0;
    document.getElementById('playerCount').textContent = count;

    const playerList = document.getElementById('playerList');
    if (playerList) {
        const allPlayers = [myPlayerId, ...network.getConnectedPeers()].sort();

        const colors = [
            PALETTE.green,
            PALETTE.red,
            PALETTE.blue,
            PALETTE.yellow,
            PALETTE.mauve,
            PALETTE.pink,
            PALETTE.teal,
            PALETTE.peach
        ];

        playerList.innerHTML = allPlayers.map((id, index) => {
            const name = getPlayerUsername(id);
            const tank = playerTanks.get(id);
            const color = colors[index % colors.length];
            const hexColor = `#${color.toString(16).padStart(6, '0')}`;

            const isEliminated = tank && tank.hp === 0;
            const textDecoration = isEliminated ? 'text-decoration: line-through;' : '';

            return `<div style="color: ${hexColor}; ${textDecoration}">${name}</div>`;
        }).join('');
    }
}

        function updateNetworkStats() {
            if (network) {
                const stats = network.getNetworkStats();
                document.getElementById('networkStats').textContent =
                    `Sent: ${stats.messagesSent} msgs, Received: ${stats.messagesReceived} msgs`;
            }
        }

        function addChatMessage(message) {
            const chatMessages = document.getElementById('chatMessages');
            const div = document.createElement('div');
            div.textContent = `${message}`;
            chatMessages.appendChild(div);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        function removePlayer(peerId) {
            if (playerTanks.has(peerId)) {
                const tank = playerTanks.get(peerId);
                world.removeChild(tank);
                if (tank.nameText) {
                    world.removeChild(tank.nameText); 
                }
                playerTanks.delete(peerId);
            }
        }

        app.view.addEventListener("mousedown", e => {
            if (e.button === 2) {
                dragging = true;
                document.body.style.cursor = 'grabbing';
                last.x = e.clientX;
                last.y = e.clientY;
            }
            if (e.button === 1) {
                e.preventDefault();
                if (!isMyTurn || gameState !== 'playing' || !canFire) return;
                fireBullet();
                canFire = false
            }
            if (e.button === 0) {
                if (gameState !== 'playing' || !myTank) return;
                maiming = true
                document.body.style.cursor = 'crosshair';

                const worldPos = screenToWorld(e.clientX, e.clientY);

                const angle = calculateAngleToPoint(myTank, worldPos.x, worldPos.y);

                myTank.barrelAngleDeg = Math.round(angle);

                broadcastTankState();
            }
        });

        app.view.addEventListener("contextmenu", e => {
            e.preventDefault(); 
        });

        app.view.addEventListener("mouseup", () => {
            document.body.style.cursor = '';
            dragging = false;
            maiming = false
        });

        app.view.addEventListener("mousemove", e => {
            if (dragging) {
                world.x += e.clientX - last.x;
                world.y += e.clientY - last.y;
                last.x = e.clientX;
                last.y = e.clientY;
            }
            if (maiming) {

                const worldPos = screenToWorld(e.clientX, e.clientY);

                const angle = calculateAngleToPoint(myTank, worldPos.x, worldPos.y);

                myTank.barrelAngleDeg = Math.round(angle);

                broadcastTankState();
            }
        });

        app.view.addEventListener("wheel", e => {
            if (!maiming) {
            e.preventDefault();
            let f = e.deltaY < 0 ? 1.1 : 0.9;
            scale = Math.max(0.2, Math.min(4, scale * f));
            world.scale.set(scale);

            for (const [id, tank] of playerTanks) {
                if (tank.nameText) {
                    tank.nameText.scale.set(1 / scale);
                }
            }
            } else {
                        const delta = e.deltaY < 0 ? 5 : -5;
        myTank.power = Math.max(0, Math.min(100, myTank.power + delta));
            }
        });

        window.addEventListener('keydown', (e) => {
            keys[e.code] = true;

            if (document.activeElement.id === 'chatInput') return;

            if (e.code === 'Space') {
                e.preventDefault();
                if (!isMyTurn || gameState !== 'playing' || !canFire) return;
                fireBullet();
                canFire = false
            }

            if (e.code === 'ArrowUp') {
                e.preventDefault();
                myTank.power = Math.min(100, myTank.power + 1);
            }

            if (e.code === 'ArrowDown') {
                e.preventDefault();
                myTank.power = Math.max(0, myTank.power - 1);
            }
            if (keys['ArrowLeft']) {
                myTank.barrelAngleDeg--;
                broadcastTankState();
            }
            if (keys['ArrowRight']) {
                myTank.barrelAngleDeg++;
                broadcastTankState();
            }
        });

        window.addEventListener('keyup', (e) => {
            keys[e.code] = false;
        });

function fireBullet() {
    if (!myTank || !isMyTurn || !canFire) return;

    canFire = false;

    for (const g of allBulletGraphics) world.removeChild(g);
    allBulletGraphics = []

    for (const bullet of bullets) {
        if (bullet.graphics) {
            world.removeChild(bullet.graphics);
            bullet.graphics = null;
        }
    }

    const angle = PIXI.DEG_TO_RAD * myTank.barrelAngleDeg;
    const speed = myTank.power * 0.5;

    const bulletX = myTank.x + Math.cos(angle) * 12;
    const bulletY = myTank.y + Math.sin(angle) * 12;

    bullets.push({
        x: bulletX,
        y: bulletY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        trail: [],
        graphics: null,
        shooter: myTank
    });

    network.broadcastGameData({
        type: 'bullet-fired',
        playerId: myPlayerId,
        x: bulletX,
        y: bulletY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed
    });
}

        function broadcastTankState() {
            if (!myTank || !network) return;

            network.broadcastGameData({
                type: 'tank-move',
                x: myTank.x,
                y: myTank.y,
                angle: myTank.angle,
                power: myTank.power,
                barrelAngleDeg: myTank.barrelAngleDeg
            });
        }

        document.getElementById('connectBtn').onclick = async() => {
            const roomId = document.getElementById('roomId').value;
            myUsername = document.getElementById('username').value || 'Player1';

            try {
                await network.joinGameRoom(roomId);
                isHost = false;
                myPlayerId = network.localPlayerId;
                addChatMessage(`Joined room: ${roomId}`);

                document.getElementById('generateBtn').style.display = 'none';
                document.getElementById('connectBtn').style.display = 'none';
                document.getElementById('username').style.display = 'none';
                document.getElementById('gameUI').style.display = 'inline-block';
                document.getElementById('copyLinkBtn').style.display = 'inline-block';
                document.getElementById('disconnect').style.display = 'inline-block';
                document.getElementById('chat').style.display = 'flex';

            } catch (error) {
                try {
                    await network.createGameRoom(roomId);
                    isHost = true;
                    myPlayerId = network.localPlayerId;
                    addChatMessage(`Created room: ${roomId}`);

                    document.getElementById('copyLinkBtn').style.display = 'inline-block';
                    document.getElementById('generateBtn').style.display = 'inline-block';
                    document.getElementById('connectBtn').style.display = 'none';
                    document.getElementById('username').style.display = 'none';
                    document.getElementById('gameUI').style.display = 'inline-block';
                    document.getElementById('disconnect').style.display = 'inline-block';
                    document.getElementById('chat').style.display = 'flex';
                } catch (createError) {
                    addChatMessage(`Failed to connect: ${createError.message}`);
                }
            }
        };

document.getElementById('disconnect').onclick = () => {
    if (network) {
        network.disconnect();
        addChatMessage('Not connected');

        clearAllGameGraphics();

        document.getElementById('copyLinkBtn').style.display = 'none';
        document.getElementById('connectBtn').style.display = 'inline-block';
        document.getElementById('generateBtn').style.display = 'none';
        document.getElementById('username').style.display = 'inline-block';
        document.getElementById('gameUI').style.display = 'none';
        document.getElementById('disconnect').style.display = 'none';
        document.getElementById('chat').style.display = 'none';
        document.title = 'the tankening'

        isHost = false;
        gameState = 'waiting';
        myTank = null;
        myPlayerId = null;
        currentTurn = 0;
        isMyTurn = false;
        canFire = true;

        playerTanks.clear();
        playerUsernames.clear();
        bullets = [];
        allBulletGraphics = [];

        world.x = 0;
        world.y = 0;
        world.scale.set(1);
        scale = 1;
    }
};

function clearAllGameGraphics() {

    for (const [id, tank] of playerTanks) {
        world.removeChild(tank);
        if (tank.nameText) {
            world.removeChild(tank.nameText);
        }
    }

    for (const g of allBulletGraphics) {
        world.removeChild(g);
    }

    for (const bullet of bullets) {
        if (bullet.graphics) {
            world.removeChild(bullet.graphics);
        }
    }

    bulletTrail.clear();

    tctx.clearRect(0, 0, TERR_WIDTH, TERR_HEIGHT);
    ttex.update();

    heights = [];
    terrain = [];
    collapseRegs = [];
}

        document.getElementById('generateBtn').onclick = () => {
            if (isHost) {
                newSeed = Math.floor(Math.random() * 10000);
                generate(newSeed);
                resetTanks();

                network.broadcastGameData({
                    type: 'terrain-generated',
                    seed: newSeed
                });
            }
        };

        document.getElementById('chatInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); 
                const message = e.target.value.trim();
                if (message && network?.broadcastGameData) {
                    network.broadcastGameData({
                        type: 'chat',
                        playerId: myPlayerId,
                        message: message
                    });
                    addChatMessage(`${myUsername}: ${message}`);
                    e.target.value = '';
                }
            }
        });

app.ticker.add(() => {
    if (!myTank || gameState !== 'playing') return;

    globalBulletTrail.clear();

    if (isMyTurn && document.activeElement.id != 'chatInput' && bullets.length < 1) {
        let moved = false;
        if (keys['KeyA']) {
            const newX = Math.max(0, myTank.x - 1);
            if (Math.abs(getY(newX) - getY(myTank.x)) <= MAX_SLOPE) {
                myTank.x = newX;
                moved = true;
            }
        }
        if (keys['KeyD']) {
            const newX = Math.min(TERR_WIDTH - 1, myTank.x + 1);
            if (Math.abs(getY(newX) - getY(myTank.x)) <= MAX_SLOPE) {
                myTank.x = newX;
                moved = true;
            }
        }
        if (moved) {
            broadcastTankState();
        }
    }

    for (const [id, tank] of playerTanks) {
        updateTankDisplay(tank);
    }

    if (myTank) {
        document.getElementById('angleVal').textContent = myTank.barrelAngleDeg + 90;
        document.getElementById('powerVal').textContent = myTank.power;
    }

    bulletTrail.clear();

for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.vy += GRAVITY;

    const steps = Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vy)));
    let bulletHit = false;

    for (let s = 0; s < steps && !bulletHit; s++) {
        b.x += b.vx / steps;
        b.y += b.vy / steps;
        b.trail.push({
            x: b.x,
            y: b.y
        });
        if (b.trail.length > 5000) b.trail.shift();

        if (b.x < 0 || b.x >= TERR_WIDTH || b.y >= TERR_HEIGHT) {
            bullets.splice(i, 1);

            if (b.shooter === myTank) {
                endMyTurn();
            }
            bulletHit = true;
            continue;
        }

        const ix = Math.floor(b.x);
        const iy = Math.floor(b.y);

if (b.shooter === myTank) {

    for (const [id, tank] of playerTanks) {
        if (tank.hp > 0 && bulletHitsTank(b, tank)) {

            const damage = 15; 

            tank.hp = Math.max(0, tank.hp - damage);
            tank.updateHpBar();

            showExplosionEffect(tank.x, tank.y, 5, 0xffff00);
            showDamageText(tank.x, tank.y, damage);

            if (tank.hp === 0 && !tank.eliminated) {
                world.removeChild(tank);
                addChatMessage(`${getPlayerUsername(id)} is eliminated!`);
                tank.eliminated = true;
                updatePlayerCount();

                const alivePlayers = Array.from(playerTanks.values()).filter(t => t.hp > 0);
                if (alivePlayers.length <= 1 && isHost) {
                    setTimeout(() => {
                        gameState = 'ended';
                        let endMessage = '';
                        if (alivePlayers.length === 1) {
                            const winner = Array.from(playerTanks.entries()).find(([id, tank]) => tank.hp > 0);
                            const winnerName = getPlayerUsername(winner[0]);
                            endMessage = `${winnerName} wins!`;
                        } else {
                            endMessage = 'Draw!';
                        }
                        syncGameState(endMessage);
                    }, 1000);
                }
            }

            bullets.splice(i, 1);

            if (network) {
                network.broadcastGameData({
                    type: 'direct-hit',
                    tankId: id,
                    damage: damage,
                    x: tank.x,
                    y: tank.y
                });
            }

            endMyTurn();
            bulletHit = true;
            break;
        }
    }

    if (!bulletHit && terrain[iy] && terrain[iy][ix]) {

        blast(ix, iy, 25);

        showExplosionEffect(ix, iy, 25, PALETTE.peach);

        let anyPlayerEliminated = false;
        for (const [id, tank] of playerTanks) {
            const dist = Math.hypot(tank.x - ix, tank.y - iy);
            if (dist <= 25 && tank.hp > 0) {
                tank.hp = Math.max(0, tank.hp - 10);
                tank.updateHpBar();
                showDamageText(tank.x, tank.y, 10);

                if (tank.hp === 0 && !tank.eliminated) {
                    world.removeChild(tank);
                    addChatMessage(`${getPlayerUsername(id)} is eliminated!`);
                    tank.eliminated = true;
                    anyPlayerEliminated = true;
                    updatePlayerCount();
                }
            }
        }

        if (anyPlayerEliminated && isHost) {
            const alivePlayers = Array.from(playerTanks.values()).filter(t => t.hp > 0);
            if (alivePlayers.length <= 1) {
                setTimeout(() => {
                    gameState = 'ended';
                    let endMessage = '';
                    if (alivePlayers.length === 1) {
                        const winner = Array.from(playerTanks.entries()).find(([id, tank]) => tank.hp > 0);
                        const winnerName = getPlayerUsername(winner[0]);
                        endMessage = `${winnerName} wins!`;
                    } else {
                        endMessage = 'Draw!';
                    }
                    syncGameState(endMessage);
                }, 1000);
            }
        }

        bullets.splice(i, 1);

        if (network) {
            network.broadcastGameData({
                type: 'explosion',
                x: ix,
                y: iy,
                radius: 25,
                damage: 10
            });
        }

        endMyTurn();
        bulletHit = true;
    }
}
    }

    if (!bulletHit && bullets[i]) {

        bulletTrail.beginFill(PALETTE.yellow);
        bulletTrail.drawCircle(bullets[i].x, bullets[i].y, 2);
        bulletTrail.endFill();

        globalBulletTrail.beginFill(PALETTE.yellow);
        globalBulletTrail.drawCircle(bullets[i].x, bullets[i].y, 2);
        globalBulletTrail.endFill();

        if (b.shooter === myTank) {
            if (!b.graphics) {
                b.graphics = new PIXI.Graphics();
                world.addChild(b.graphics);
                allBulletGraphics.push(b.graphics);
            }

            b.graphics.clear();
            b.graphics.lineStyle(5, PALETTE.yellow, 0.1);

            if (b.trail.length > 1) {
                b.graphics.moveTo(b.trail[0].x, b.trail[0].y);
                for (let j = 1; j < b.trail.length; j++) {
                    b.graphics.lineTo(b.trail[j].x, b.trail[j].y);
                }
            }
        }

        if (b.trail.length > 1) {
            const trailPoints = b.trail;
            for (let j = 1; j < trailPoints.length; j++) {
                const segmentAge = j / (trailPoints.length - 1);
                const alpha = Math.pow(segmentAge, 10);

                globalBulletTrail.lineStyle(
                    4, 
                    PALETTE.yellow, 
                    alpha
                );
                globalBulletTrail.moveTo(trailPoints[j - 1].x, trailPoints[j - 1].y);
                globalBulletTrail.lineTo(trailPoints[j].x, trailPoints[j].y);
            }
        }
    }
}

    stepCollapse();

    updateNetworkStats();
});

        initializeNetwork();

        function fitWorld() {
            if (scale === 1 && world.x === 0 && world.y === 0) {
                const sw = app.renderer.width / TERR_WIDTH;
                const sh = app.renderer.height / TERR_HEIGHT;
                const autoScale = Math.min(sw, sh);
                world.scale.set(autoScale);
                world.x = (app.renderer.width - TERR_WIDTH * autoScale) / 2;
                world.y = (app.renderer.height - TERR_HEIGHT * autoScale) / 2;
                scale = autoScale;

                for (const [id, tank] of playerTanks) {
                    if (tank.nameText) {
                        tank.nameText.scale.set(1 / scale);
                    }
                }
            }
        }

        function screenToWorld(screenX, screenY) {
            return {
                x: (screenX - world.x) / world.scale.x,
                y: (screenY - world.y) / world.scale.y
            };
        }

        function calculateAngleToPoint(tank, worldX, worldY) {
            const dx = worldX - tank.x;
            const dy = worldY - tank.y;
            return Math.atan2(dy, dx) * PIXI.RAD_TO_DEG;
        }

function showExplosionEffect(x, y, radius, color) {
    const explosion = new PIXI.Graphics()
        .beginFill(color, 0.7)
        .drawCircle(x, y, radius)
        .endFill();
    world.addChild(explosion);

    gsap.to(explosion, {
        alpha: 0,
        duration: 0.5,
        onComplete: () => world.removeChild(explosion)
    });
}

function showDamageText(x, y, damage) {
    const damageText = new PIXI.Text(`-${damage}`, {
        fontSize: 14,
        fill: PALETTE.red,
        fontWeight: 'bold'
    });
    damageText.x = x;
    damageText.y = y - 25;
    world.addChild(damageText);

    gsap.to(damageText, {
        y: y - 45,
        alpha: 0,
        duration: 1,
        onComplete: () => world.removeChild(damageText)
    });
}

let turnEnding = false;

function syncPeerList() {
    if (isHost) {
        const peerData = {};
        peerData[myPlayerId] = myUsername;
        
        for (const [peerId, username] of playerUsernames) {
            peerData[peerId] = username;
        }

        network.broadcastGameData({
            type: 'peer-list-sync',
            peers: peerData
        });
    }
}

function endMyTurn() {
    if (turnEnding) return; 
    turnEnding = true;

    canFire = false;

    if (isHost) {

        setTimeout(() => {
            const nextPlayer = advanceTurn();
            turnEnding = false;
        }, 1000);
    } else {

        setTimeout(() => {
            network.broadcastGameData({
                type: 'turn-end-request',
                playerId: myPlayerId
            });
            turnEnding = false;
        }, 1000);
    }
}

function resetTanksFromState(tanksData) {

    for (const [id, tank] of playerTanks) {
        world.removeChild(tank);
        if (tank.nameText) {
            world.removeChild(tank.nameText);
        }
    }
    playerTanks.clear();

    bullets = [];
    for (const g of allBulletGraphics) {
        world.removeChild(g);
    }
    allBulletGraphics = [];
    bulletTrail.clear();
    globalBulletTrail.clear();

    const colors = [
        PALETTE.green,
        PALETTE.red,
        PALETTE.blue,
        PALETTE.yellow,
        PALETTE.mauve,
        PALETTE.pink,
        PALETTE.teal,
        PALETTE.peach
    ];

    const sortedPlayerIds = Object.keys(tanksData).sort();

    sortedPlayerIds.forEach((playerId, index) => {
        const tankData = tanksData[playerId];
        const tank = createTank(tankData.x, colors[index % colors.length], playerId);
        tank.hp = tankData.hp;
        tank.angle = tankData.angle;
        tank.power = tankData.power;
        tank.barrelAngleDeg = tankData.barrelAngleDeg;
        tank.updateHpBar();
        tank.eliminated = false; 

        playerTanks.set(playerId, tank);

        if (playerId === myPlayerId) {
            myTank = tank;
        }
    });
    updatePlayerCount();
}

setInterval(() => {
    if (isHost && network && network.getConnectedPeers().length > 0) {
        syncPeerList();
    }
}, 1000);

function debugPeerInfo() {
    console.log('=== PEER DEBUG INFO ===');
    console.log('My Player ID:', myPlayerId);
    console.log('My Username:', myUsername);
    console.log('Is Host:', isHost);
    console.log('Connected Peers:', network.getConnectedPeers());
    console.log('Known Usernames:', Object.fromEntries(playerUsernames));
    console.log('Player Tanks:', Array.from(playerTanks.keys()));
    console.log('=======================');
}

        fitWorld();
        window.addEventListener('resize', fitWorld);