const TERR_WIDTH = 1600;      
const TERR_HEIGHT = 1200;     
const TANK_W = 16;            
const TANK_H = 8;             
const GRAVITY = 0.5;          
const MAX_SLOPE = 3;          
const CELEBRATION_TIME = 10000; 
const TRAIL_MAX_LENGTH = 2000;  
const TRAIL_FADE_SEGMENTS = 10; 
const SETTLEMENT_TIME = 1500;   
const KNOCKBACK_FORCE = 12;     
const EXPLOSION_RADIUS = 40;    
const ZOOM_EASE = 0.2;          
const MAX_SCALE = 5;            
const MIN_SCALE = 1;            
const ZOOM_INTENSITY = 0.001;   
const EDGE_MARGIN = 20;         
const UI_FONT = 'SpaceGrotesk'; 

let lastIdleUpdate = 0;
let totalShakeOffset = { x: 0, y: 0 };
let autoScale = 1;
let gameEndTimer = null;
let gameEndCountdown = null;
let terrainGradientCache = Array.from({ length: TERR_WIDTH }, () => new Array(TERR_HEIGHT).fill(null));
let targetScale = 1;
let cachedSurfaceYs = null;
let cachedSmoothedYs = null;
let lastTerrainHash = null;
let volleyCount = 0;
let lastConfirmedTankState = null;
let pendingInputs = [];
let inputSequence = 0;
let socket = null;
let myUsername = 'Player1';
let myPlayerId = null;
let newSeed = 1;
let gameStarted = false;
let gameState = 'waiting';
let currentTurn = 0;
let playerTanks = new Map();
let myTank = null;
let isMyTurn = false;
let playerUsernames = new Map();
let canFire = true;
let zoomAnchor = null;
let velocity = { x: 0, y: 0 };
let dragFrameTime = 0;
let dragging = false;
let last = { x: 0, y: 0 };
let scale = 1;
let maiming = false;

function addLateJoinerTank(playerId) {
    if (playerTanks.has(playerId)) {
        console.log('Tank already exists for late joiner:', playerId);
        return;
    }
    
    console.log('Adding late joiner tank for:', playerId);
    
    const allPlayers = Array.from(playerUsernames.keys()).sort();
    const colors = [
        PALETTE.green, PALETTE.red, PALETTE.blue, PALETTE.yellow,
        PALETTE.mauve, PALETTE.pink, PALETTE.teal, PALETTE.peach
    ];

    // Find safe spawn position
    let x = findOptimalSpawnPosition();
    
    // Calculate average HP of existing tanks
    let totalHp = 0, count = 0;
    for (const t of playerTanks.values()) {
        if (t.hp > 0) { totalHp += t.hp; count++; }
    }
    const avgHp = count > 0 ? Math.round(totalHp / count) : 50;
    
    // Create tank with appropriate color
    const playerIndex = allPlayers.indexOf(playerId);
    const color = colors[playerIndex % colors.length];
    const tank = createTank(x, color, playerId);
    tank.hp = avgHp;
    tank.updateHpBar();
    
    playerTanks.set(playerId, tank);
    
    // Set up interpolation if not my tank
    if (playerId !== myPlayerId) {
        initializePlayerInterpolation(playerId, tank);
    } else {
        myTank = tank;
    }
    
    updateTankDisplay(tank);
    updatePlayerCount();

    // CLIENT DECIDES POSITION, then broadcasts to server
    sendToServer({ 
        type: 'tank-spawn', 
        playerId, 
        x: tank.x, 
        y: tank.y, 
        hp: tank.hp,
        color: color
    });
}

function findOptimalSpawnPosition() {
    const margin = 100;
    const minDistance = TANK_W * 3; // Minimum distance from other tanks
    const attempts = 50;
    
    for (let i = 0; i < attempts; i++) {
        const x = margin + Math.random() * (TERR_WIDTH - 2 * margin);
        const surfaceY = getTerrainHeight(x);
        
        // Check if position is valid (not too close to other tanks)
        let validPosition = true;
        for (const [id, tank] of playerTanks) {
            if (Math.abs(tank.x - x) < minDistance) {
                validPosition = false;
                break;
            }
        }
        
        // Also check if terrain is suitable (not too steep)
        if (validPosition) {
            const leftY = getTerrainHeight(Math.max(0, x - 20));
            const rightY = getTerrainHeight(Math.min(TERR_WIDTH - 1, x + 20));
            const slope = Math.abs(leftY - rightY) / 40;
            
            if (slope <= MAX_SLOPE) {
                return x;
            }
        }
    }
    
    // Fallback to simple random position if no optimal position found
    return margin + Math.random() * (TERR_WIDTH - 2 * margin);
}

function handleLateJoinSync(data) {
    console.log('=== LATE JOIN SYNC START ===');
    console.log('Data received:', {
        hasTerrainData: !!data.terrain,
        hasSeed: !!data.seed,
        seedValue: data.seed,
        hasPlayers: !!data.players,
        hasTanks: !!data.tanks,
        currentTurn: data.currentTurn,
        currentPlayerId: data.currentPlayerId,
        explosionsCount: data.allExplosions?.length || 0
    });
    
    if (!gameStarted || gameState !== 'playing') {
        resetGameState();
        gameState = 'playing';
        gameStarted = true;
        currentTurn = data.currentTurn || 0;
        volleyCount = data.gameMetadata?.volleyCount || 0;
        
        console.log('📍 Game state initialized for late joiner');
        console.log('Current turn:', currentTurn, 'Volley count:', volleyCount);

        // CRITICAL FIX: Prioritize server terrain data over seed generation
        if (data.terrain && Array.isArray(data.terrain)) {
            console.log('🗺️ Loading terrain from server data');
            console.log('Terrain dimensions:', data.terrain.length, 'x', data.terrain[0]?.length);
            
            // Load terrain directly from server
            terrain = data.terrain.map(row => new Uint8Array(row));
            heights = [];
            
            // Regenerate heights array from terrain
            for (let x = 0; x < TERR_WIDTH; x++) {
                for (let y = 0; y < TERR_HEIGHT; y++) {
                    if (terrain[y] && terrain[y][x]) {
                        heights[x] = y;
                        break;
                    }
                }
                if (heights[x] === undefined) {
                    heights[x] = TERR_HEIGHT - 1;
                }
            }
            
            console.log('✅ Terrain loaded from server data');
            
        } else if (data.seed && typeof generate === 'function') {
            console.log('🌱 Generating fresh terrain from seed:', data.seed);
            newSeed = data.seed;
            generate(data.seed);
            
            // Apply explosion history AFTER generating fresh terrain
            if (Array.isArray(data.allExplosions)) {
                console.log('💥 Applying', data.allExplosions.length, 'explosions to terrain');
                for (const blast of data.allExplosions) {
                    blastTerrainOnly(blast.x, blast.y, blast.radius);
                }
            }
        } else {
            console.error('❌ CRITICAL: No terrain data or seed provided for late joiner!');
            return;
        }

        // Clean up existing tanks
        for (const [id, tank] of playerTanks) {
            if (world && world.removeChild) {
                world.removeChild(tank);
                if (tank.nameText?.parent) world.removeChild(tank.nameText);
                if (tank.lockText?.parent) world.removeChild(tank.lockText);
                if (tank.hpBar?.parent) world.removeChild(tank.hpBar);
            }
        }
        playerTanks.clear();
        playerUsernames.clear();
        playerInterpolation.clear();

        // Set up player usernames
        if (data.players) {
            console.log('👥 Setting up players:', Object.keys(data.players));
            for (const [pid, uname] of Object.entries(data.players)) {
                playerUsernames.set(pid, uname);
            }
        }

        // Create tanks with server positions
        if (data.tanks) {
            const colors = [PALETTE.green, PALETTE.red, PALETTE.blue, PALETTE.yellow, PALETTE.mauve, PALETTE.pink, PALETTE.teal, PALETTE.peach];
            const allPlayers = Array.from(playerUsernames.keys()).sort();
            
            console.log('🚗 Creating tanks for players:', allPlayers);
            
            for (const [pid, t] of Object.entries(data.tanks)) {
                const playerIndex = allPlayers.indexOf(pid);
                const color = colors[playerIndex % colors.length];
                
                const tank = createTank(t.x, color, pid);
                tank.y = t.y;
                tank.angle = t.angle || 0;
                tank.hp = t.health || t.hp || 50;
                tank.barrelAngleDeg = t.barrelAngleDeg || -45;
                tank.power = t.power || 30;
                tank.eliminated = tank.hp <= 0;
                
                playerTanks.set(pid, tank);
                
                if (pid !== myPlayerId) {
                    initializePlayerInterpolation(pid, tank);
                } else {
                    myTank = tank;
                    console.log('🎯 My tank assigned:', myPlayerId);
                }
                
                updateTankDisplay(tank);
                console.log('✅ Tank created for', getPlayerUsername(pid), 'HP:', tank.hp);
            }
        }

        // CRITICAL: Ensure terrain is properly rendered and physics applied
        if (typeof calculateTerrainGradients === 'function') {
            calculateTerrainGradients();
        }
        
        if (typeof instantCollapse === 'function') {
            console.log('⚡ Applying instant terrain collapse');
            instantCollapse();
        }
        
        if (typeof drawTerrain === 'function') {
            console.log('🎨 Drawing terrain');
            drawTerrain();
        }
    }

    // FIXED: Robust turn state synchronization for late joiners
    if (typeof data.currentTurn === 'number') {
        currentTurn = data.currentTurn;
        console.log('🔄 Turn synchronized to:', currentTurn);
    }
    
    // FIXED: Set turn state based on server data with comprehensive validation
    if (data.currentPlayerId) {
        const wasMyTurn = isMyTurn;
        isMyTurn = data.currentPlayerId === myPlayerId;
        canFire = isMyTurn && bullets.length === 0 && !tanksSettling;
        
        console.log('🎮 Turn state synchronized:');
        console.log('  Server current player:', data.currentPlayerId);
        console.log('  My player ID:', myPlayerId);
        console.log('  Was my turn:', wasMyTurn);
        console.log('  Is my turn now:', isMyTurn);
        console.log('  Can fire:', canFire);
        console.log('  Bullets in flight:', bullets.length);
        console.log('  Tanks settling:', tanksSettling);

        // FIXED: Clear all lock indicators and set correct turn indicator
        for (const [id, tank] of playerTanks) {
            if (tank.lockText) {
                tank.lockText.visible = false;
                tank.lockText.text = '[LOCKED IN]';
                tank.lockText.style.fill = PALETTE.blue;
            }
        }

        // Show turn triangle for current player
        const currentTank = playerTanks.get(data.currentPlayerId);
        if (currentTank && currentTank.lockText) {
            updateTurnTriangle(currentTank, data.currentPlayerId);
            console.log('▲ Turn triangle set for:', getPlayerUsername(data.currentPlayerId));
        }
    }

    updateTurnIndicator();
    updatePlayerCount();
    fitWorld();
    
    console.log('=== LATE JOIN SYNC COMPLETE ===');
}

function blastTerrain(x, y, radius) {
    const r2 = radius * radius;
    for (let ty = Math.max(0, y - radius); ty < Math.min(TERR_HEIGHT, y + radius); ty++) {
        for (let tx = Math.max(0, x - radius); tx < Math.min(TERR_WIDTH, x + radius); tx++) {
            if ((tx - x) * (tx - x) + (ty - y) * (ty - y) <= r2) {
                if (terrain[ty] && terrain[ty][tx]) terrain[ty][tx] = 0;
            }
        }
    }
}

function blastTerrainOnly(cx, cy, r) {
    const r2 = r * r;
    for (let y = Math.max(0, cy - r); y < Math.min(TERR_HEIGHT, cy + r); y++) {
        for (let x = Math.max(0, cx - r); x < Math.min(TERR_WIDTH, cx + r); x++) {
            if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) {
                if (terrain[y] && terrain[y][x]) terrain[y][x] = 0;
            }
        }
    }
    
    // Ensure bedrock
    for (let x = 0; x < TERR_WIDTH; x++) {
        terrain[TERR_HEIGHT - 1][x] = 1;
    }
}

function resetTanks(forceReset = false) {
    const allPlayers = Array.from(playerUsernames.keys()).sort();
    console.log('Reset tanks called, players:', allPlayers, 'force:', forceReset);

    if (forceReset || gameState === 'waiting' || allPlayers.length <= 2 || playerTanks.size === 0) {
        console.log('Performing full tank reset');

        for (const [id, tank] of playerTanks) {
            if (world && world.removeChild) {
                world.removeChild(tank);
                if (tank.nameText && tank.nameText.parent) world.removeChild(tank.nameText);
                if (tank.lockText && tank.lockText.parent) world.removeChild(tank.lockText);
                if (tank.hpBar && tank.hpBar.parent) world.removeChild(tank.hpBar);
            }
        }
        playerTanks.clear();
        playerInterpolation.clear();
        visualPredictions.clear();

        const colors = [PALETTE.green, PALETTE.red, PALETTE.blue, PALETTE.yellow, PALETTE.mauve, PALETTE.pink, PALETTE.teal, PALETTE.peach];
        const positions = generateTankPositions(allPlayers.length);

        allPlayers.forEach((playerId, index) => {
            if (index < colors.length && index < positions.length) {
                const tank = createTank(positions[index], colors[index], playerId);
                playerTanks.set(playerId, tank);

                if (playerId !== myPlayerId) {
                    initializePlayerInterpolation(playerId, tank);
                }

                if (playerId === myPlayerId) {
                    myTank = tank;
                }
                updateTankDisplay(tank);
            }
        });

        volleyCount = 0;
        gameStarted = true;
        currentTurn = 0;
        gameState = 'playing';
    } else {

        console.log('Performing partial tank reset (adding missing tanks)');
        addMissingTanks();
    }

    updateTurnIndicator();
    updatePlayerCount();

    if (persistentTrail) persistentTrail.clear();
    if (bulletTrail) bulletTrail.clear();
    if (globalBulletTrail) globalBulletTrail.clear();
}

function generateTankPositions(playerCount) {
    const margin = 150;
    const positions = [];

    if (playerCount === 1) {
        positions.push(TERR_WIDTH / 2);
    } else if (playerCount === 2) {
        positions.push(margin, TERR_WIDTH - margin);
    } else {

        const usableWidth = TERR_WIDTH - (2 * margin);
        const spacing = usableWidth / Math.max(1, playerCount - 1);

        for (let i = 0; i < playerCount; i++) {
            positions.push(margin + (i * spacing));
        }
    }

    return positions;
}

let tanksSettling = false;
let settlementTimer = 0;
const explosion_radius = 40;
const zoomEase = ZOOM_EASE
const TERRAIN_HEIGHT = TERR_HEIGHT;
const TERRAIN_WIDTH = TERR_WIDTH;

function initializeGameLoop() {

    app.ticker.add(() => {
        if (gameState !== 'playing') return;

        if (typeof updatePlayerInterpolation === 'function') {
            updatePlayerInterpolation();
        }

        if (typeof cleanupOldPredictions === 'function') {
            cleanupOldPredictions();
        }

        if (globalBulletTrail) globalBulletTrail.clear();
        if (bulletTrail) bulletTrail.clear();

        handlePlayerInput();
        updateBulletsEnhanced();

        if (typeof checkTankSettlement === 'function') {
            checkTankSettlement();
        }

        if (typeof updateOffscreenIndicators === 'function') {
            updateOffscreenIndicators();
        }

        handleZoom();

        handleCameraMovement();
    });

    app.ticker.start();
}

function handlePlayerDisconnect(playerId) {
    console.log('Player disconnected:', playerId);
    
    // Remove from all tracking structures
    if (playerTanks.has(playerId)) {
        const tank = playerTanks.get(playerId);
        // Clean up display objects
        if (world && world.removeChild) {
            world.removeChild(tank);
            if (tank.nameText && tank.nameText.parent) world.removeChild(tank.nameText);
            if (tank.lockText && tank.lockText.parent) world.removeChild(tank.lockText);
            if (tank.hpBar && tank.hpBar.parent) world.removeChild(tank.hpBar);
        }
        playerTanks.delete(playerId);
    }
    
    // Remove from username tracking
    playerUsernames.delete(playerId);
    
    // Clear interpolation data
    playerInterpolation.delete(playerId);
    
    // If it was my own disconnect, handle reconnection
    if (playerId === myPlayerId) {
        resetGameState();
        // Auto-reconnect after a delay
        setTimeout(() => {
            if (myUsername) {
                console.log('Attempting to reconnect...');
                initializeNetwork();
                setTimeout(() => {
                    sendToServer({ 
                        type: 'join-room',
                        username: myUsername.split('#')[0] // Remove the old ID suffix
                    });
                }, 1000);
            }
        }, 3000);
    } else {
        // Update UI for other player disconnections
        updatePlayerCount();
        updateTurnIndicator();
        
        // Check if game should end due to insufficient players
        checkGameEnd();
    }
}

function handlePlayerInput() {

    if (!myTank || bullets.length > 0 || gameState !== 'playing') {
        return;
    }

    if (document.activeElement && document.activeElement.id === 'chatInput') {
        return;
    }

    let moved = false;

    if (isMyTurn) { 
        if (keys['KeyA']) {
            const newX = Math.max(TANK_W/2, myTank.x - 0.5);
            if (canMoveTo(myTank.x, newX)) {
                myTank.x = newX;
                updateTankDisplay(myTank);
                moved = true;
            }
        }
        if (keys['KeyD']) {
            const newX = Math.min(TERR_WIDTH - TANK_W/2, myTank.x + 0.5);
            if (canMoveTo(myTank.x, newX)) {
                myTank.x = newX;
                updateTankDisplay(myTank);
                moved = true;
            }
        }

        if (moved) {

            sendTankUpdate();
        }
    }

    const angleEl = document.getElementById('angleVal');
    const powerEl = document.getElementById('powerVal');
    if (angleEl) angleEl.textContent = Math.round(myTank.barrelAngleDeg + 90);
    if (powerEl) powerEl.textContent = Math.round(myTank.power);
}

function handleZoom() {
    const diff = Math.abs(targetScale - scale);
    if (diff > 0.0001) {
        scale += (targetScale - scale) * (zoomEase || 0.2);

        if (Math.abs(scale - autoScale) < 0.001) {
            scale = autoScale;
            targetScale = autoScale;
        }

        world.scale.set(scale);

        if (zoomAnchor) {
            const newWorldX = zoomAnchor.screenX - zoomAnchor.worldX * scale;
            const newWorldY = zoomAnchor.screenY - zoomAnchor.worldY * scale;

            world.x = newWorldX;
            world.y = newWorldY;
            enforceWorldBounds();
        }

        for (const [id, tank] of playerTanks) {
            if (tank.nameText) tank.nameText.scale.set(1 / scale);
            if (tank.lockText) tank.lockText.scale.set(1 / scale);
            if (tank.hpBar) tank.hpBar.scale.set(1 / scale);
            updateTankDisplay(tank);
        }
    } else {
        zoomAnchor = null;
    }
}

function handleCameraMovement() {
    if (!dragging) {
        const inertiaScaleFactor = scale;
        const baseFriction = 0.85;
        const friction = Math.pow(baseFriction, inertiaScaleFactor);

        world.x += velocity.x * 16;
        world.y += velocity.y * 16;

        velocity.x *= friction;
        velocity.y *= friction;

        if (Math.abs(velocity.x) < 0.01) velocity.x = 0;
        if (Math.abs(velocity.y) < 0.01) velocity.y = 0;

        enforceWorldBounds();
    }
}

function initializeGame() {

    if (!world) {
        console.error('World container not initialized');
        return;
    }

    if (typeof buildGradientPalette === 'function') {
        buildGradientPalette();
    }

    initializeGameLoop();

    showGameUI();

    console.log('Game initialized successfully');
}

const app = new PIXI.Application({
    resizeTo: window,
    backgroundColor: PALETTE.base,
    autoDensity: true
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
const persistentTrail = new PIXI.Graphics();
world.addChild(persistentTrail);
world.addChild(bulletTrail);        
world.addChild(globalBulletTrail);  
world.addChild(tspr);               

function fireBullet() {
    console.log('=== FIRE BULLET ATTEMPT ===');
    console.log('myTank exists:', !!myTank);
    console.log('isMyTurn:', isMyTurn);
    console.log('canFire:', canFire);
    console.log('bullets.length:', bullets.length);
    console.log('gameState:', gameState);
    console.log('tanksSettling:', tanksSettling);
    
    if (!myTank) {
        console.log('❌ FIRE BLOCKED: No tank');
        return;
    }
    
    if (!isMyTurn) {
        console.log('❌ FIRE BLOCKED: Not my turn');
        return;
    }
    
    if (!canFire) {
        console.log('❌ FIRE BLOCKED: canFire is false');
        return;
    }
    
    if (bullets.length > 0) {
        console.log('❌ FIRE BLOCKED: Bullets in flight:', bullets.length);
        return;
    }
    
    if (gameState !== 'playing') {
        console.log('❌ FIRE BLOCKED: Game state is:', gameState);
        return;
    }
    
    if (tanksSettling) {
        console.log('❌ FIRE BLOCKED: Tanks are settling');
        return;
    }

    console.log('✅ FIRING BULLET - All conditions met');
    
    const angle = PIXI.DEG_TO_RAD * myTank.barrelAngleDeg;
    const speed = myTank.power * 0.5;

    const barrelLength = 16;
    const startX = myTank.x + Math.cos(angle) * barrelLength;
    const startY = myTank.y + Math.sin(angle) * barrelLength;

    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;

    // FIXED: Reset turn state immediately and consistently
    canFire = false;
    isMyTurn = false;
    tanksSettling = true;
    settlementTimer = 0;

    console.log('🚀 Bullet fired - turn state reset');
    console.log('New state: canFire =', canFire, 'isMyTurn =', isMyTurn);

    if (myTank.lockText) {
        myTank.lockText.visible = true;
        myTank.lockText.text = '[LOCKED IN]';
        myTank.lockText.style.fill = PALETTE.blue;
        updateTankDisplay(myTank);
    }

    sendToServer({
        type: 'bullet-fired',
        playerId: myPlayerId,
        x: startX,
        y: startY,
        vx: vx,
        vy: vy,
        angle: angle,
        speed: speed
    });
    
    sendTankUpdate();
    persistentTrail.clear();
}

let offscreenIndicators = new PIXI.Container();
app.stage.addChild(offscreenIndicators);

function updateOffscreenIndicators() {

    offscreenIndicators.removeChildren();

    const screenBounds = {
        left: -world.x / world.scale.x,
        right: (app.screen.width - world.x) / world.scale.x,
        top: -world.y / world.scale.y,
        bottom: (app.screen.height - world.y) / world.scale.y
    };

    for (const [id, tank] of playerTanks) {
        if (tank.hp <= 0) continue;

        const isOffscreen = tank.x < screenBounds.left || 
                           tank.x > screenBounds.right || 
                           tank.y < screenBounds.top || 
                           tank.y > screenBounds.bottom;

        if (isOffscreen) {
            createOffscreenIndicator(tank, 'tank', id);
        }
    }

    for (const bullet of bullets) {
        const isOffscreen = bullet.x < screenBounds.left || 
                           bullet.x > screenBounds.right || 
                           bullet.y < screenBounds.top || 
                           bullet.y > screenBounds.bottom;

        if (isOffscreen) {
            createOffscreenIndicator(bullet, 'bullet');
        }
    }
}

function createOffscreenIndicator(object, type, playerId = null) {
    const indicator = new PIXI.Graphics();

    const screenCenter = {
        x: app.screen.width / 2,
        y: app.screen.height / 2
    };

    const worldPos = {
        x: object.x * world.scale.x + world.x,
        y: object.y * world.scale.y + world.y
    };

    const dx = worldPos.x - screenCenter.x;
    const dy = worldPos.y - screenCenter.y;
    const distance = Math.hypot(dx, dy);

    if (distance === 0) return;

    const normalizedDx = dx / distance;
    const normalizedDy = dy / distance;

    const margin = 20;
    const screenBounds = {
        left: margin,
        right: app.screen.width - margin,
        top: margin,
        bottom: app.screen.height - margin
    };

    let indicatorX, indicatorY;

    const centerX = app.screen.width / 2;
    const centerY = app.screen.height / 2;

    const maxDistX = Math.abs(normalizedDx) > 0 ? 
        (normalizedDx > 0 ? screenBounds.right - centerX : centerX - screenBounds.left) / Math.abs(normalizedDx) : Infinity;
    const maxDistY = Math.abs(normalizedDy) > 0 ? 
        (normalizedDy > 0 ? screenBounds.bottom - centerY : centerY - screenBounds.top) / Math.abs(normalizedDy) : Infinity;

    const maxDist = Math.min(maxDistX, maxDistY);

    indicatorX = centerX + normalizedDx * maxDist;
    indicatorY = centerY + normalizedDy * maxDist;

    if (type === 'tank') {
        // FIXED: Use consistent color calculation logic
        const allPlayers = Array.from(playerUsernames.keys()).sort();
        const playerIndex = allPlayers.indexOf(playerId);
        const colors = [PALETTE.green, PALETTE.red, PALETTE.blue, PALETTE.yellow, PALETTE.mauve, PALETTE.pink, PALETTE.teal, PALETTE.peach];
        const color = colors[playerIndex % colors.length] || PALETTE.text;

        const size = 8;
        const angle = Math.atan2(dy, dx);

        indicator.beginFill(color, 0.8);
        indicator.moveTo(
            indicatorX + Math.cos(angle) * size,
            indicatorY + Math.sin(angle) * size
        );
        indicator.lineTo(
            indicatorX + Math.cos(angle + 2.5) * size,
            indicatorY + Math.sin(angle + 2.5) * size
        );
        indicator.lineTo(
            indicatorX + Math.cos(angle - 2.5) * size,
            indicatorY + Math.sin(angle - 2.5) * size
        );
        indicator.endFill();

        if (playerId) {
            const nameText = new PIXI.Text(getPlayerUsername(playerId), {
                fontFamily: 'SpaceGrotesk',
                fontSize: 10,
                fill: color
            });
            nameText.anchor.set(0.5, 0.5);
            nameText.x = indicatorX;
            nameText.y = indicatorY - 15;
            offscreenIndicators.addChild(nameText);
        }

    } else if (type === 'bullet') {
        indicator.beginFill(PALETTE.yellow, 0.9);
        indicator.drawCircle(indicatorX, indicatorY, 4);
        indicator.endFill();
    }

    offscreenIndicators.addChild(indicator);
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

        function addChatMessage(message) {
            const chatMessages = document.getElementById('chatMessages');
            if (!chatMessages) return;
            const div = document.createElement('div');
            div.textContent = `${message}`;
            chatMessages.appendChild(div);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

let visualPredictions = new Map(); 
let playerInterpolation = new Map(); 
let predictionId = 0;

function createInterpolationData(tank) {
    return {
        fromX: tank.x,
        fromY: tank.y,
        fromAngle: tank.angle,
        fromBarrelAngle: tank.barrelAngleDeg,
        fromPower: tank.power,
        toX: tank.x,
        toY: tank.y,
        toAngle: tank.angle,
        toBarrelAngle: tank.barrelAngleDeg,
        toPower: tank.power,
        startTime: performance.now(),
        duration: 100, 
        lastUpdateTime: performance.now()
    };
}

function createVisualBlastPrediction(x, y, radius, predId) {
    const prediction = {
        id: predId,
        x: x,
        y: y,
        radius: radius,
        terrainBackup: null, 
        confirmed: false,
        timestamp: performance.now()
    };

    prediction.terrainBackup = backupTerrainArea(x, y, radius);

    visualBlast(x, y, radius, predId);

    visualPredictions.set(predId, prediction);
    return predId;
}

function backupTerrainArea(cx, cy, radius) {
    const backup = new Map();
    const r2 = radius * radius;

    for (let y = Math.max(0, cy - radius); y < Math.min(TERR_HEIGHT, cy + radius); y++) {
        for (let x = Math.max(0, cx - radius); x < Math.min(TERR_WIDTH, cx + radius); x++) {
            if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) {
                backup.set(`${x},${y}`, terrain[y] ? terrain[y][x] : 0);
            }
        }
    }
    return backup;
}

function visualBlast(cx, cy, r, predId) {
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

    instantCollapse();

    for (const [id, tank] of playerTanks) {
        updateTankDisplay(tank);
    }
    drawTerrain();
}

function confirmVisualPrediction(predId) {
    const prediction = visualPredictions.get(predId);
    if (prediction && !prediction.confirmed) {
        prediction.confirmed = true;

        console.log('Visual prediction confirmed:', predId);
    }
}

function rollbackVisualPrediction(predId) {
    const prediction = visualPredictions.get(predId);
    if (prediction && !prediction.confirmed) {

        for (const [coord, value] of prediction.terrainBackup) {
            const [x, y] = coord.split(',').map(Number);
            if (terrain[y]) {
                terrain[y][x] = value;
            }
        }

        drawTerrain();
        instantCollapse();

        for (const [id, tank] of playerTanks) {
            updateTankDisplay(tank);
        }

        console.log('Visual prediction rolled back:', predId);
    }
    visualPredictions.delete(predId);
}

function cleanupOldPredictions() {
    const now = performance.now();
    const PREDICTION_TIMEOUT = 5000; 

    for (const [id, prediction] of visualPredictions) {
        if (now - prediction.timestamp > PREDICTION_TIMEOUT) {
            if (!prediction.confirmed) {
                rollbackVisualPrediction(id);
            } else {
                visualPredictions.delete(id);
            }
        }
    }
}

function initializePlayerInterpolation(playerId, tank) {
    playerInterpolation.set(playerId, createInterpolationData(tank));
}

function updateInterpolationTarget(playerId, newState) {
    const tank = playerTanks.get(playerId);
    if (!tank) return;

    let interpData = playerInterpolation.get(playerId);
    if (!interpData) {
        interpData = createInterpolationData(tank);
        playerInterpolation.set(playerId, interpData);
    }

    const now = performance.now();

    interpData.fromX = tank.x;
    interpData.fromY = tank.y;
    interpData.fromAngle = tank.angle;
    interpData.fromBarrelAngle = tank.barrelAngleDeg;
    interpData.fromPower = tank.power;

    interpData.toX = newState.x;
    interpData.toY = newState.y;
    interpData.toAngle = newState.angle || tank.angle;
    interpData.toBarrelAngle = newState.barrelAngleDeg;
    interpData.toPower = newState.power;

    interpData.startTime = now;
    interpData.lastUpdateTime = now;

    const distance = Math.hypot(newState.x - tank.x, newState.y - tank.y);
    interpData.duration = Math.min(200, Math.max(50, distance * 2)); 
}

function updatePlayerInterpolation() {
    const now = performance.now();

    for (const [playerId, interpData] of playerInterpolation) {

        if (playerId === myPlayerId) continue;

        const tank = playerTanks.get(playerId);
        if (!tank) continue;

        const elapsed = now - interpData.startTime;
        const progress = Math.min(1, elapsed / interpData.duration);

        const eased = easeOutQuart(progress);

        const newX = lerp(interpData.fromX, interpData.toX, eased);
        const newY = lerp(interpData.fromY, interpData.toY, eased);

        if (Math.abs(newX - tank.x) < 100 && Math.abs(newY - tank.y) < 100) {
            tank.x = newX;
            tank.y = newY;
            tank.angle = lerpAngle(interpData.fromAngle, interpData.toAngle, eased);
            tank.barrelAngleDeg = lerp(interpData.fromBarrelAngle, interpData.toBarrelAngle, eased);
            tank.power = lerp(interpData.fromPower, interpData.toPower, eased);

            updateTankDisplay(tank);
        }

        if (progress >= 1) {
            interpData.startTime = now;
            interpData.fromX = interpData.toX;
            interpData.fromY = interpData.toY;
            interpData.fromAngle = interpData.toAngle;
            interpData.fromBarrelAngle = interpData.toBarrelAngle;
            interpData.fromPower = interpData.toPower;
        }
    }
}

function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
}

function lerpAngle(from, to, t) {
    const diff = to - from;
    const wrappedDiff = ((diff + Math.PI) % (2 * Math.PI)) - Math.PI;
    return from + wrappedDiff * t;
}

function showGameUI() {
    if (document.getElementById('connectionPanel')) {
        document.getElementById('connectionPanel').style.display = 'none';
    }
    if (document.getElementById('gameControls')) {
        document.getElementById('gameControls').style.display = 'block';
    }
    if (document.getElementById('gameUI')) {
        document.getElementById('gameUI').style.display = 'block';
    }
    if (document.getElementById('chat')) {
        document.getElementById('chat').style.display = 'flex';
    }
    if (document.getElementById('volleyDisplay')) {
        document.getElementById('volleyDisplay').style.display = 'block';
    }
}

        let messageQueue = [];
        let socketReady = false;

function initializeNetwork() {
    console.log('Initializing network connection...');
    socketReady = false;
    messageQueue = [];

    if (socket) {
        try { 
            socket.onopen = null;
            socket.onclose = null;
            socket.onerror = null;
            socket.onmessage = null;
            socket.close(); 
        } catch (e) {
            console.log('Error closing existing socket:', e);
        }
    }

    socket = new WebSocket('wss://dono-01.danbot.host:9550/');

    socket.onopen = () => {
        console.log('WebSocket connection opened');
        socketReady = true;
        
        // Send queued messages
        while (messageQueue.length > 0) {
            const msg = messageQueue.shift();
            sendToServer(msg);
        }
    };

    socket.onclose = (event) => {
        console.log('WebSocket connection closed:', event.code, event.reason);
        socketReady = false;
        
        // Only auto-reconnect if it wasn't a clean close
        if (event.code !== 1000) {
            setTimeout(() => {
                console.log('Attempting to reconnect...');
                if (myUsername && !socket || socket.readyState === WebSocket.CLOSED) {
                    initializeNetwork();
                    setTimeout(() => {
                        sendToServer({ 
                            type: 'join-room',
                            username: myUsername.split('#')[0]
                        });
                    }, 1000);
                }
            }, 3000);
        }
    };

    socket.onerror = (err) => {
        console.error('WebSocket error:', err);
        socketReady = false;
        addChatMessage('Network error - attempting to reconnect...');
    };

    socket.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleServerMessage(msg);
        } catch (e) {
            console.error('Error parsing message:', e, event.data);
        }
    };
}



        function sendToServer(data) {
            console.log('Attempting to send:', data);
            if (!socket) {
                console.warn('No socket connection exists');
                return;
            }

            if (socketReady && socket.readyState === WebSocket.OPEN) {
                console.log('Sending message:', data);
                socket.send(JSON.stringify(data));
            } else {
                console.log('Queueing message:', data);
                messageQueue.push(data);
            }
        }

function handleServerMessage(data) {
    console.log('Handling server message:', data.type, data);

    switch (data.type) {
        case 'late-join-sync':
            handleLateJoinSync(data);
            break;

        case 'room-joined':
            myPlayerId = data.playerId;
            myUsername = `${data.username}#${myPlayerId.split('_')[1]}`;
            playerUsernames.set(myPlayerId, myUsername);
            addChatMessage(`Joined game as: ${myUsername}`);
            showGameUI();
            
            // Request late join sync if game is in progress
            if (data.gameInProgress) {
                sendToServer({ type: 'request-late-join-sync' });
            }
            break;
            
         case 'player-joined':
            console.log('New player joined:', data.playerId, data.username);
            playerUsernames.set(data.playerId, data.username);
            updatePlayerCount();
            
            if (gameState === 'playing') {
                // Add tank for new player
                addLateJoinerTank(data.playerId);
            }
            break;
            
        case 'player-disconnected':
            console.log('Player disconnected:', data.playerId);
            handlePlayerDisconnect(data.playerId);
            break;
            
       case 'player-list':
            console.log('Updating player list:', data.players);
            
            // Clear existing player list
            const oldPlayers = new Set(playerUsernames.keys());
            playerUsernames.clear();
            
            // Add all current players
            for (const [playerId, username] of Object.entries(data.players)) {
                playerUsernames.set(playerId, username);
            }
            
            // Remove tanks for disconnected players
            for (const oldPlayerId of oldPlayers) {
                if (!playerUsernames.has(oldPlayerId)) {
                    handlePlayerDisconnect(oldPlayerId);
                }
            }
            
            updatePlayerCount();

            if (gameState !== 'playing') {
                resetTanks();
            } else {
                addMissingTanks();
            }
            break;

            

        case 'player-list':
            console.log('Updating player list:', data.players);
            for (const [playerId, username] of Object.entries(data.players)) {
                playerUsernames.set(playerId, username);
            }
            updatePlayerCount();

            if (gameState !== 'playing') {
                resetTanks();
            } else {
                addMissingTanks();
            }
            break;

        case 'tank-move':
            handleTankMoveMessage(data);
            break;

        case 'turn-change':
            handleTurnChange(data);
            break;

        case 'bullet-fired':
            console.log('Bullet fired by:', data.playerId);

            const shooterTank = playerTanks.get(data.playerId);

            if (shooterTank && shooterTank.barrel && shooterTank.barrel.triggerRecoil) {
                shooterTank.barrel.triggerRecoil();
                showMuzzleFlash(shooterTank);
            }

            const bullet = {
                x: data.x,
                y: data.y,
                vx: data.vx,
                vy: data.vy,
                trail: [],
                graphics: new PIXI.Graphics(),
                shooter: shooterTank,
            };

            if (shooterTank && shooterTank.lockText) {
                shooterTank.lockText.visible = true;
            }

            bullets.push(bullet);
            sendTankUpdate();
            world.addChild(bullet.graphics);

            console.log('Bullet created, total bullets:', bullets.length);
            break;

        case 'direct-hit':
            console.log('Direct hit received:', data);
            if (playerTanks.has(data.targetId)) {
                const tank = playerTanks.get(data.targetId);
                tank.hp = Math.max(0, data.newHp || tank.hp - (data.damage || 20));
                tank.updateHpBar();

                showDamageText(tank.x, tank.y - 10, data.damage || 20);
                applyScreenShake(12, 0.8, 2, 10);

                if (tank.hp === 0 && !tank.eliminated) {
                    tank.eliminated = true;
                    addChatMessage(`❌ ${getPlayerUsername(data.targetId)} was eliminated!`);

                    gsap.to(tank, {
                        alpha: 0.3,
                        rotation: tank.rotation + Math.PI / 4,
                        duration: 1,
                        ease: "power2.out"
                    });

                    if (tank.nameText) {
                        gsap.to(tank.nameText, {
                            alpha: 0.3,
                            duration: 1
                        });
                    }

                    updatePlayerCount();
                    checkGameEnd();
                }
            }
            break;

        case 'explosion':
            console.log('Explosion received:', data);

            // Apply damage to tanks based on server data
            if (data.tankDamage) {
                for (const [tankId, damage] of Object.entries(data.tankDamage)) {
                    const tank = playerTanks.get(tankId);
                    if (tank) {
                        tank.hp = Math.max(0, tank.hp - damage);
                        tank.updateHpBar();
                        if (damage > 0) {
                            showDamageText(tank.x, tank.y - 10, damage);
                        }
                    }
                }
            }

            blast(data.x, data.y, data.radius);
            applyScreenShake(15, 0.8, 3);
            checkGameEnd();
            break;

        case 'terrain-sync':
            if (data.terrain) {
                terrain = data.terrain.map(row => new Uint8Array(row));
                drawTerrain();
                
                // Update all tank positions after terrain change
                for (const [id, tank] of playerTanks) {
                    updateTankDisplay(tank);
                }
            }
            break;

        case 'chat':
            addChatMessage(`${data.username}: ${data.message}`);
            break;

        case 'game-state-sync':
            gameState = data.gameState;
            if (data.endMessage) {
                addChatMessage(data.endMessage);
            }
            if (data.gameState === 'ended') {
                // Server will handle restart automatically
                tankFavicon.updateFavicon(null, 'ended');
            }
            break;

        case 'game-state':
            console.log('Game state update:', data.gameState);
            if (data.gameState === 'playing') {
                newSeed = data.seed;
                generate(data.seed);
                gameState = 'playing';
                gameStarted = true;
                
                // Reset turn state properly for new game
                currentTurn = 0;
                volleyCount = 0;
                
                resetTanks(true);
                addChatMessage('🚀 Game started!');

                // Set initial turn state
                setTimeout(() => {
                    const allPlayers = Array.from(playerUsernames.keys());
                    if (allPlayers.length > 0) {
                        const firstPlayer = data.currentPlayerId || allPlayers[0];
                        isMyTurn = firstPlayer === myPlayerId;
                        canFire = isMyTurn && bullets.length === 0;
                        
                        console.log('Initial turn state set:', {
                            firstPlayer,
                            myPlayerId,
                            isMyTurn,
                            canFire
                        });
                        
                        updateTurnIndicator();
                        tankFavicon.updateFavicon(firstPlayer, 'playing');
                    }
                }, 100);
            }
            break;

        case 'server-shutdown':
            addChatMessage('🔴 Server is shutting down...');
            resetGameState();
            break;
    }
}

        function getPlayerUsername(playerId) {
            if (playerUsernames.has(playerId)) {
                return playerUsernames.get(playerId);
            }

            return playerId.slice(0, 8);
        }

function checkGameEndAfterExplosion() {
    const alivePlayers = Array.from(playerTanks.values()).filter(t => t.hp > 0 && !t.eliminated);

    if (alivePlayers.length <= 1 && gameState === 'playing') {
        gameState = 'ended';
                if (alivePlayers.length === 1) {
                    const winnerName = getPlayerUsername(alivePlayers[0].playerId);
                    startGameEndCountdown(`🎉 ${winnerName} wins!`);
                } else {
                    startGameEndCountdown('🤝 Game Over - Draw!');
                }
    }
}

// 5. IMPROVED TANK MOVE HANDLING WITH ROLLBACK PREVENTION
function handleTankMoveMessage(data) {
    const tank = playerTanks.get(data.playerId);
    if (!tank) {
        console.warn('Received tank-move for unknown player:', data.playerId);
        return;
    }

    // For my own tank, ignore server updates while I'm actively moving
    if (data.playerId === myPlayerId) {
        // Only apply server corrections if position differs significantly AND I'm not currently moving
        const positionThreshold = 3.0;
        const isMoving = keys['KeyA'] || keys['KeyD'] || maiming;
        
        if (!isMoving && typeof data.x === 'number' && Math.abs(data.x - tank.x) > positionThreshold) {
            console.log('Applying server position correction:', data.x, 'vs', tank.x);
            tank.x = data.x;
            updateTankDisplay(tank);
        }
        
        // Always apply non-position updates
        if (typeof data.y === 'number') tank.y = data.y;
        if (typeof data.flying === 'boolean') tank.flying = data.flying;
        
        return; // Don't process other updates for my tank
    }

    // For other players, apply all updates with interpolation
    if (typeof data.x === 'number') tank.x = data.x;
    if (typeof data.y === 'number') tank.y = data.y;
    if (typeof data.angle === 'number') tank.angle = data.angle;
    if (typeof data.barrelAngleDeg === 'number') tank.barrelAngleDeg = data.barrelAngleDeg;
    if (typeof data.power === 'number') tank.power = data.power;
    if (typeof data.flying === 'boolean') tank.flying = data.flying;

    updateInterpolationTarget(data.playerId, {
        x: data.x,
        y: data.y,
        angle: data.angle || tank.angle,
        power: data.power || tank.power,
        barrelAngleDeg: data.barrelAngleDeg || tank.barrelAngleDeg,
        flying: data.flying || false
    });

    updateTankDisplay(tank);
}

// 6. IMPROVED TURN CHANGE HANDLING
function handleTurnChange(data) {
    console.log('=== TURN CHANGE START ===');
    console.log('Previous turn:', currentTurn, '-> New turn:', data.currentTurn);
    console.log('Current player ID from server:', data.currentPlayerId);
    console.log('Previous isMyTurn:', isMyTurn);
    console.log('Previous canFire:', canFire);

    currentTurn = data.currentTurn;
    if (typeof data.volleyCount === 'number') {
        volleyCount = data.volleyCount;
        console.log('📊 Volley count updated to:', volleyCount);
    }

    const newCurrentPlayer = data.currentPlayerId;
    const wasMyTurn = isMyTurn;
    
    // FIXED: Complete turn state reset with proper validation
    isMyTurn = newCurrentPlayer === myPlayerId;
    canFire = isMyTurn && bullets.length === 0 && !tanksSettling;
    
    console.log('🎯 Turn change processing:');
    console.log('  New current player:', newCurrentPlayer);
    console.log('  Is my turn now:', isMyTurn);
    console.log('  Can fire now:', canFire);
    console.log('  Bullets count:', bullets.length);
    console.log('  Tanks settling:', tanksSettling);

    // FIXED: Clear ALL lock indicators and triangles first
    for (const [id, tank] of playerTanks) {
        if (tank.lockText) {
            tank.lockText.visible = false;
            tank.lockText.text = '[LOCKED IN]';
            tank.lockText.style.fill = PALETTE.blue;
        }
    }

    // FIXED: Show turn triangle for new current player only
    const currentTank = playerTanks.get(newCurrentPlayer);
    if (currentTank && currentTank.lockText) {
        updateTurnTriangle(currentTank, newCurrentPlayer);
        console.log('▼ Turn triangle assigned to:', getPlayerUsername(newCurrentPlayer));
    }

    // Reset settlement state properly
    tanksSettling = false;
    settlementTimer = 0;
    console.log('⏹️ Settlement state reset');

    updateTurnIndicator();

    const playerName = getPlayerUsername(newCurrentPlayer);
    if (isMyTurn) {
        addChatMessage(`🎯 Your turn!`);
        console.log('🎮 MY TURN - player can now shoot');
    } else {
        addChatMessage(`⏳ ${playerName}'s turn`);
        console.log('⏳ OTHER PLAYER TURN - waiting for:', playerName);
    }
    
    console.log('=== TURN CHANGE COMPLETE ===');
}

function updateTurnTriangle(tank, playerId) {
    if (!tank.lockText) return;

    // Get player color
    const allPlayers = Array.from(playerUsernames.keys()).sort();
    const playerIndex = allPlayers.indexOf(playerId);
    const colors = [PALETTE.green, PALETTE.red, PALETTE.blue, PALETTE.yellow, PALETTE.mauve, PALETTE.pink, PALETTE.teal, PALETTE.peach];
    const playerColor = colors[playerIndex % colors.length] || PALETTE.text;

    // Update lock text to show turn triangle
    tank.lockText.text = '▼';
    tank.lockText.style.fill = playerColor;
    tank.lockText.style.fontSize = 16;
    tank.lockText.visible = true;
    
    console.log(`Updated turn triangle for ${getPlayerUsername(playerId)} with color index ${playerIndex}`);
}

function createTank(x, color, playerId) {
    const g = new PIXI.Container();
    g.hp = 50;
    g.playerId = playerId;
    g.eliminated = false;

    const TANK_BODY_WIDTH = TANK_W; 
    const TANK_CORNER_RADIUS = 4;

g.flying = false;      
g.settling = false;    
g.grounded = true;     
g.vx = 0;             
g.vy = 0;             

    const body = new PIXI.Graphics()
        .beginFill(color)
        .drawRoundedRect(-TANK_BODY_WIDTH / 2, 0, TANK_BODY_WIDTH, TANK_H, TANK_CORNER_RADIUS)
        .endFill();
    g.addChild(body);

const TRACK_WIDTH = TANK_BODY_WIDTH + 4;
const TRACK_HEIGHT = 4;
const TRACK_RADIUS = 3;

const track = new PIXI.Graphics()
    .lineStyle(1, color)
    .beginFill(PALETTE.crust)
    .drawRoundedRect(
        -TRACK_WIDTH / 2,
        TANK_H - TRACK_HEIGHT, 
        TRACK_WIDTH,
        TRACK_HEIGHT,
        TRACK_RADIUS
    )
    .endFill();
g.addChild(track);

    g.hpBar = new PIXI.Graphics();
    world.addChild(g.hpBar);

    g.updateHpBar = function () {
        g.hpBar.clear();
        const pct = Math.max(0, g.hp / 50);
        let barColor = PALETTE.green;
        if (pct < 0.3) barColor = PALETTE.red;
        else if (pct < 0.6) barColor = PALETTE.yellow;

        const barWidth = TANK_W * 3;
        const barHeight = 4;

        g.hpBar.beginFill(PALETTE.surface0)
            .drawRect(-barWidth / 2, -barHeight / 2, barWidth, barHeight)
            .endFill();

        g.hpBar.beginFill(barColor)
            .drawRect(-barWidth / 2, -barHeight / 2, barWidth * pct, barHeight)
            .endFill();
    };
    g.updateHpBar();

const barrel = new PIXI.Graphics()
    .beginFill(PALETTE.text)
    .drawRect(0, 1, 16, 2)      
    .drawCircle(0, 2, 1)        
    .endFill();
barrel.pivot.set(0, 2);

barrel.baseLength = 16;
barrel.recoilAmount = 0; 
barrel.isRecoiling = false;

barrel.triggerRecoil = function() {
    if (this.isRecoiling) return; 

    this.isRecoiling = true;

    this.recoilAmount = 6; 
    this.clear();
    this.beginFill(PALETTE.text);
    this.drawRect(-this.recoilAmount, 1, this.baseLength - this.recoilAmount, 2);
    this.drawCircle(-this.recoilAmount, 2, 1);
    this.endFill();

    gsap.to(this, {
        recoilAmount: 0,
        duration: 0.8,
        ease: "none", 
        onUpdate: () => {
            this.clear();
            this.beginFill(PALETTE.text);
            this.drawRect(-this.recoilAmount, 1, this.baseLength - this.recoilAmount, 2);
            this.drawCircle(-this.recoilAmount, 2, 1);
            this.endFill();
        },
        onComplete: () => {
            this.isRecoiling = false;
        }
    });
};

g.barrel = barrel;
g.addChild(barrel);

    const nameText = new PIXI.Text(getPlayerUsername(playerId), {
        fontFamily: 'SpaceGrotesk',
        fontSize: 12,
        fill: playerId === myPlayerId ? PALETTE.yellow : PALETTE.text
    });
    nameText.anchor.set(0.5, 1);
    g.nameText = nameText;
    world.addChild(nameText);

    const lockText = new PIXI.Text('[LOCKED IN]', {
        fontFamily: 'SpaceGrotesk',
        fontSize: 12,
        fill: PALETTE.blue
    });
    lockText.anchor.set(0.5, 1);
    lockText.visible = false;
    g.lockText = lockText;
    world.addChild(lockText);

    g.angle = -Math.PI / 4;
    g.power = 30;
    g.barrelAngleDeg = -45;
    g.x = x;

    const surfaceY = getTerrainHeight(x);
    g.y = surfaceY - TANK_H;

    world.addChild(g);
    return g;
}

function getTerrainHeight(x) {
    x = Math.max(0, Math.min(TERR_WIDTH - 1, Math.floor(x)));

    for (let y = 0; y < TERR_HEIGHT; y++) {
        if (terrain[y] && terrain[y][x]) {
            return y;
        }
    }
    return TERR_HEIGHT - 1;
}

function createOptimizedBullet(x, y, vx, vy, shooter) {
    return {
        x, y, vx, vy,
        trail: [],
        trailSegments: [], 
        shooter,
        lastTrailUpdate: 0
    };
}

function updateBulletTrail(bullet) {

    bullet.trail.push({ x: bullet.x, y: bullet.y });

    const speed = Math.sqrt(bullet.vx * bullet.vx + bullet.vy * bullet.vy);
    const maxLength = Math.min(TRAIL_MAX_LENGTH, Math.floor(speed * 8));

    if (bullet.trail.length > maxLength) {

        const removeCount = bullet.trail.length - maxLength;
        bullet.trail.splice(0, removeCount);
    }
}

function renderOptimizedTrails() {
    globalBulletTrail.clear();
    bulletTrail.clear();

    for (let i = 0; i < bullets.length; i++) {
        const bullet = bullets[i];
        if (bullet.trail.length < 2) continue;

        globalBulletTrail.beginFill(PALETTE.yellow, 0.9);
        globalBulletTrail.drawCircle(bullet.x, bullet.y, 3);
        globalBulletTrail.endFill();

        globalBulletTrail.beginFill(PALETTE.yellow, 0.3);
        globalBulletTrail.drawCircle(bullet.x, bullet.y, 5);
        globalBulletTrail.endFill();

        const trail = bullet.trail;
        const maxSegments = 25; 
        const sampleRate = Math.max(1, Math.floor(trail.length / maxSegments));

        for (let j = sampleRate; j < trail.length; j += sampleRate) {
            const progress = j / (trail.length - 1);

            const ageFactor = Math.pow(progress, 1.8);
            const alpha = ageFactor * 0.7;
            const width = 1.5 + ageFactor * 2.5;

            const isMyBullet = bullet.shooter === myTank;
            const trailColor = isMyBullet ? PALETTE.blue : PALETTE.yellow;

            globalBulletTrail.lineStyle(width, trailColor, alpha);
            globalBulletTrail.moveTo(trail[j - sampleRate].x, trail[j - sampleRate].y);
            globalBulletTrail.lineTo(trail[j].x, trail[j].y);
        }
    }
}

let anyTankFlying = false;

function updateTankPhysics(tank) {

    if (tank.flying) {

        tank.vy += GRAVITY;

        tank.x += tank.vx;
        tank.y += tank.vy;

        tank.x = Math.max(TANK_W/2, Math.min(TERR_WIDTH - TANK_W/2, tank.x));

        const groundY = getTerrainHeight(Math.floor(tank.x)) - TANK_H;
        if (tank.y >= groundY) {

            tank.y = groundY;
            tank.vx = 0;
            tank.vy = 0;
            tank.flying = false;
            tank.grounded = true;
            tank.settling = false;
            console.log(`Tank ${tank.playerId?.slice(0,6)} landed and stuck`);
        }
    } else {

        const groundY = getTerrainHeight(Math.floor(tank.x)) - TANK_H;
        if (Math.abs(tank.y - groundY) > 1) {
            tank.y = groundY;
        }
        tank.settling = false;
        tank.grounded = true;
    }

    tank.settling = tank.flying;
}

function checkTankSettlement() {
    let anyTankFlying = false;

    if (myTank && myTank.hp > 0) {
        updateTankPhysics(myTank);
        updateTankDisplay(myTank);

        if (myTank.flying) {
            anyTankFlying = true;

            sendToServer({ 
                type: 'tank-move', 
                playerId: myPlayerId, 
                x: myTank.x, 
                y: myTank.y, 
                angle: myTank.angle, 
                power: myTank.power, 
                barrelAngleDeg: myTank.barrelAngleDeg,
                flying: true 
            });
        }
    }

    if (tanksSettling) {
        settlementTimer += 16; 

        if (!anyTankFlying) {
            if (settlementTimer >= SETTLEMENT_TIME) {
                console.log('Settlement complete - server will handle turn advancement');
                tanksSettling = false;
                settlementTimer = 0;
                // Remove manual turn advancement - server handles this
            }
        }
    }
}

function instantCollapse() {
    let totalChanged = false;

    for (let x = 0; x < TERR_WIDTH; x++) {
        let writeIndex = TERR_HEIGHT - 1;

        for (let y = TERR_HEIGHT - 1; y >= 0; y--) {
            if (terrain[y][x] === 1) {
                if (y !== writeIndex) {
                    terrain[writeIndex][x] = 1;
                    terrain[y][x] = 0;
                    totalChanged = true;
                }
                writeIndex--;
            }
        }

        terrain[TERR_HEIGHT - 1][x] = 1;
    }

    if (totalChanged) {
        drawTerrain();

        for (const [id, tank] of playerTanks) {
            updateTankDisplay(tank);
        }
    }

    return totalChanged;
}

function resetTanks() {
    console.log('Resetting tanks, players:', Array.from(playerUsernames.keys()));

    for (const [id, tank] of playerTanks) {
        world.removeChild(tank);
        if (tank.nameText && tank.nameText.parent) {
            world.removeChild(tank.nameText);
        }
        if (tank.lockText && tank.lockText.parent) {
            world.removeChild(tank.lockText);
        }
        if (tank.hpBar && tank.hpBar.parent) {
            world.removeChild(tank.hpBar);
        }
    }
    playerTanks.clear();
    playerInterpolation.clear();
    visualPredictions.clear();

    bullets = bullets.filter(b => {
        if (b.graphics && b.graphics.parent) {
            world.removeChild(b.graphics);
        }
        return false;
    });

    for (const g of allBulletGraphics) {
        world.removeChild(g);
    }
    allBulletGraphics = [];
    bulletTrail.clear();
    globalBulletTrail.clear();

    const allPlayers = Array.from(playerUsernames.keys()).sort();
    const colors = [
        PALETTE.green, PALETTE.red, PALETTE.blue, PALETTE.yellow,
        PALETTE.mauve, PALETTE.pink, PALETTE.teal, PALETTE.peach
    ];

    const generatePositions = (numPlayers) => {
        const positions = [];
        const margin = 150;

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

            if (playerId !== myPlayerId) {
                initializePlayerInterpolation(playerId, tank);
            }

            if (playerId === myPlayerId) {
                myTank = tank;
            }
            updateTankDisplay(tank);
        }
    });

    volleyCount = 0;
    gameStarted = true;
    currentTurn = 0;
    gameState = 'playing';
    updateTurnIndicator();
    updatePlayerCount();
    persistentTrail.clear();

    console.log('Game started - Volley count reset to:', volleyCount);
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
    if (!tank) return;

    const surfaceY = getTerrainHeight(tank.x);
    const targetY = surfaceY - TANK_H;

    if (Math.abs(tank.y - targetY) > 2) {
        tank.y = targetY;
    } else if (Math.abs(tank.y - targetY) > 0.1) {
        tank.y += (targetY - tank.y) * 0.5;
    } else {
        tank.y = targetY;
    }

    const sampleDistance = 8;
    const yL = getTerrainHeight(Math.max(0, tank.x - sampleDistance));
    const yR = getTerrainHeight(Math.min(TERR_WIDTH - 1, tank.x + sampleDistance));
    const targetRotation = Math.atan2(yR - yL, sampleDistance * 2);

    if (Math.abs(tank.rotation - targetRotation) > 0.01) {
        tank.rotation += (targetRotation - tank.rotation) * 0.3;
    } else {
        tank.rotation = targetRotation;
    }

    tank.barrel.rotation = PIXI.DEG_TO_RAD * tank.barrelAngleDeg - tank.rotation;

    tank.hpBar.x = tank.x;
    tank.hpBar.y = tank.y + 24; 
    tank.hpBar.scale.set(1 / scale);

    if (tank.nameText) {
        tank.nameText.x = tank.x;
        tank.nameText.y = tank.y - 16;
        tank.nameText.scale.set(1 / scale);
    }

    if (tank.lockText) {
        tank.lockText.x = tank.nameText ? tank.nameText.x : tank.x;
        tank.lockText.y = tank.nameText ? tank.nameText.y - (16 / scale) : tank.y - 32;
        tank.lockText.scale.set(1 / scale);
    }
}

function blendColors(color1, color2, t) {
    const r1 = (color1 >> 16) & 0xFF, g1 = (color1 >> 8) & 0xFF, b1 = color1 & 0xFF;
    const r2 = (color2 >> 16) & 0xFF, g2 = (color2 >> 8) & 0xFF, b2 = color2 & 0xFF;

    return [
        Math.round(r1 + (r2 - r1) * t),
        Math.round(g1 + (g2 - g1) * t),
        Math.round(b1 + (b2 - b1) * t),
    ];
}

function bulletHitsTank(bullet, tank) {
    if (tank.eliminated || tank.hp <= 0) return false;

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
    const allPlayers = Array.from(playerUsernames.keys()).sort();
    if (allPlayers.length === 0) {
        tankFavicon.updateFavicon(null, 'waiting');
        return;
    }

    let currentPlayer = null;
    if (gameState === 'playing') {
        // FIXED: Use the actual current player from turn state, not calculated
        if (isMyTurn) {
            currentPlayer = myPlayerId;
        } else {
            // Find current player from alive players based on current turn
            const alivePlayers = allPlayers.filter(id => {
                const tank = playerTanks.get(id);
                return tank && tank.hp > 0 && !tank.eliminated;
            });
            
            if (alivePlayers.length > 0) {
                currentPlayer = alivePlayers[currentTurn % alivePlayers.length];
            }
        }
    }

    console.log('Update turn indicator:', {
        currentPlayer,
        myPlayerId,
        isMyTurn,
        canFire,
        gameState,
        currentTurn,
        allPlayersCount: allPlayers.length
    });

    if (currentPlayer) {
        const tank = playerTanks.get(currentPlayer);
        if (tank && tank.hp > 0) {
            const playerName = getPlayerUsername(currentPlayer);
            const turnText = currentPlayer === myPlayerId ? 'Your Turn!' : `${playerName}'s Turn`;
            document.title = turnText;

            tankFavicon.animateTurn(currentPlayer);
            updatePlayerCount();
        }
    }
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
    console.log('🌍 Generating terrain with seed:', seed);
    
    const terrainTypes = ["plain", "mountain", "single_mountain", "valley", "cliff"];
    const firstDigit = +String(seed)[0] % terrainTypes.length;
    const type = terrainTypes[firstDigit];
    
    console.log('🏔️ Terrain type selected:', type);

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

    // Initialize terrain array properly
    terrain = Array.from({ length: H }, () => new Uint8Array(W));

    for (let i = 0; i < heights.length; i++) {
        const px = i;
        const hy = Math.floor(heights[i]);
        for (let yy = hy; yy < H - 1; yy++) {
            terrain[yy][px] = 1;
        }
        terrain[H - 1][px] = 1; // Bedrock
    }

    collapseRegs = [];
    
    console.log('✅ Terrain generation complete');
    console.log('Terrain dimensions:', terrain.length, 'x', terrain[0].length);
    
    calculateTerrainGradients();
    drawTerrain();
}

function calculateTerrainGradients() {
    const smoothRadius = 5;

    const surfaceYs = new Array(TERR_WIDTH).fill(null);
    for (let x = 0; x < TERR_WIDTH; x++) {
        for (let y = 0; y < TERR_HEIGHT; y++) {
            if (terrain[y][x]) {
                surfaceYs[x] = y;
                break;
            }
        }
    }

    const smoothedYs = new Array(TERR_WIDTH);
    for (let x = 0; x < TERR_WIDTH; x++) {
        let sum = 0, count = 0;
        for (let dx = -smoothRadius; dx <= smoothRadius; dx++) {
            const nx = x + dx;
            if (nx >= 0 && nx < TERR_WIDTH && surfaceYs[nx] !== null) {
                sum += surfaceYs[nx];
                count++;
            }
        }
        smoothedYs[x] = count > 0 ? sum / count : null;
    }

    for (let x = 0; x < TERR_WIDTH; x++) {
        const surfaceY = smoothedYs[x];
const fadeLength = TERR_HEIGHT - (surfaceY ?? TERR_HEIGHT);

for (let y = 0; y < TERR_HEIGHT; y++) {
    if (surfaceY === null || y < surfaceY || fadeLength === 0) {
        terrainGradientCache[x][y] = null;
    } else {
        const t = Math.min(1, (y - surfaceY) / fadeLength);
        const idx = Math.floor(t * (GRADIENT_STEPS - 1));
        terrainGradientCache[x][y] = idx;
    }
}
    }
}

function drawTerrain() {
    const img = tctx.createImageData(TERR_WIDTH, TERR_HEIGHT);

    const fallbackInt = PALETTE.surface1;
    const fallback = [
        (fallbackInt >> 16) & 0xFF,
        (fallbackInt >> 8) & 0xFF,
        fallbackInt & 0xFF
    ];

    for (let y = 0; y < TERR_HEIGHT; y++) {
        for (let x = 0; x < TERR_WIDTH; x++) {
            if (terrain[y][x]) {
                const idx = terrainGradientCache[x][y];
                const i = (y * TERR_WIDTH + x) * 4;

                if (idx !== null && sharedGradientPalette[idx]) {
                    const color = sharedGradientPalette[idx];
                    img.data[i] = color[0];
                    img.data[i + 1] = color[1];
                    img.data[i + 2] = color[2];
                    img.data[i + 3] = color[3];
                } else {
                    img.data[i] = fallback[0];
                    img.data[i + 1] = fallback[1];
                    img.data[i + 2] = fallback[2];
                    img.data[i + 3] = 255;
                }
            }
        }
    }

const pink = [
    (PALETTE.pink >> 16) & 0xFF,
    (PALETTE.pink >> 8) & 0xFF,
    PALETTE.pink & 0xFF
];

const edgeBands = [
    { start: 0, end: 5, direction: 'right' },  
    { start: TERR_WIDTH - 5, end: TERR_WIDTH, direction: 'left' }  
];

const maxAlpha = 180;
const fadeHeight = 40;

for (const band of edgeBands) {
    let minY = Infinity;

    for (let x = band.start; x < band.end; x++) {
        const surfaceY = getTerrainHeight(x);
        minY = Math.min(minY, surfaceY - 150);
    }

    const wallTopY = Math.floor(minY);

    for (let x = band.start; x < band.end; x++) {
        const surfaceY = getTerrainHeight(x);
        const wallBottomY = Math.floor(surfaceY);

        const distFromEdge = band.direction === 'right'
            ? x - band.start
            : band.end - 1 - x;

        let xFade = 1;
        if (distFromEdge === 1) xFade = 0.75;
        else if (distFromEdge === 2) xFade = 0.5;
        else if (distFromEdge === 3) xFade = 0.3;
        else if (distFromEdge >= 4) xFade = 0.15;

        for (let y = wallTopY; y < wallBottomY; y++) {
            if (y < 0 || y >= TERR_HEIGHT) continue;

            const dy = y - wallTopY;
            const yFade = dy < fadeHeight ? (dy / fadeHeight) : 1;

            const alpha = Math.floor(maxAlpha * xFade * yFade);
            const i = (y * TERR_WIDTH + x) * 4;

            img.data[i] = pink[0];
            img.data[i + 1] = pink[1];
            img.data[i + 2] = pink[2];
            img.data[i + 3] = alpha;
        }
    }
}

    tctx.putImageData(img, 0, 0);
    ttex.update();
}

const GRADIENT_STEPS = 32;
let sharedGradientPalette = [];

function buildGradientPalette() {
    const surfaceColor = PALETTE.surface1;
    const baseColor = PALETTE.base;

    sharedGradientPalette = [];
    for (let i = 0; i < GRADIENT_STEPS; i++) {
        const t = i / (GRADIENT_STEPS - 1);
        sharedGradientPalette.push([...blendColors(surfaceColor, baseColor, t), 255]);
    }
}

function blast(cx, cy, r) {
    const r2 = r * r;

    for (let y = Math.max(0, cy - r); y < Math.min(TERR_HEIGHT, cy + r); y++) {
        for (let x = Math.max(0, cx - r); x < Math.min(TERR_WIDTH, cx + r); x++) {
            const dx = x - cx;
            const dy = y - cy;
            const dist2 = dx * dx + dy * dy;

            if (dist2 <= r2) {
                terrain[y][x] = 0;
            }
        }
    }

    for (let x = 0; x < TERR_WIDTH; x++) {
        terrain[TERR_HEIGHT - 1][x] = 1;
    }

    const MAX_LAUNCH_SPEED = 15;
    const tank = myTank;

    if (tank && tank.hp > 0) {
        const dx = tank.x - cx;
        const dy = tank.y - cy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const maxKnockbackRadius = r * 2.0;

        if (distance <= maxKnockbackRadius && distance > 0) {
            const knockbackFactor = Math.max(0, 1 - (distance / maxKnockbackRadius));
            const launchSpeed = MAX_LAUNCH_SPEED * knockbackFactor;

            if (launchSpeed > 1) {
                const angle = Math.atan2(dy, dx);

                tank.vx = Math.cos(angle) * launchSpeed;
                tank.vy = Math.sin(angle) * launchSpeed - 2;

                tank.flying = true;
                tank.grounded = false;
                tank.settling = true;
                tanksSettling = true;

                console.log(`myTank LAUNCHED at speed ${launchSpeed.toFixed(1)}`);
            }
        }
    }

    instantCollapse();
    drawTerrain();

    if (!myTank.flying) {
        const groundY = getTerrainHeight(Math.floor(myTank.x)) - TANK_H;
        myTank.y = groundY;
        updateTankDisplay(myTank);
    }
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

function updatePlayerCount() {
    console.log('Updating player count, current players:', playerUsernames);
    const count = playerUsernames.size;
    const playerList = document.getElementById('playerList');

    const volleyCountEl = document.getElementById('volleyCount');
    if (volleyCountEl) {
        const displayVolley = gameStarted ? volleyCount + 1 : 1;
        volleyCountEl.textContent = displayVolley;
        console.log('Displaying volley:', displayVolley, 'Internal count:', volleyCount);
    }

    if (playerList && count > 0) {
        const allPlayers = Array.from(playerUsernames.keys()).sort();
        const colors = [0xa6e3a1, 0xf38ba8, 0x89b4fa, 0xf9e2af, 0xcba6f7, 0xf5c2e7, 0x94e2d5, 0xfab387];

        // FIXED: Determine current player more reliably
        let currentPlayer = null;
        if (gameState === 'playing' && allPlayers.length > 0) {
            if (isMyTurn) {
                currentPlayer = myPlayerId;
            } else {
                // Use the tank that has the turn triangle visible
                for (const [id, tank] of playerTanks) {
                    if (tank.lockText && tank.lockText.visible && tank.lockText.text === '▼') {
                        currentPlayer = id;
                        break;
                    }
                }
                
                // Fallback to calculation if no triangle found
                if (!currentPlayer) {
                    const alivePlayers = allPlayers.filter(id => {
                        const tank = playerTanks.get(id);
                        return tank && tank.hp > 0 && !tank.eliminated;
                    });
                    if (alivePlayers.length > 0) {
                        currentPlayer = alivePlayers[currentTurn % alivePlayers.length];
                    }
                }
            }
        }

        playerList.innerHTML = allPlayers.map((id, index) => {
            const name = getPlayerUsername(id);
            const tank = playerTanks.get(id);
            const color = colors[index % colors.length];
            const hexColor = `#${color.toString(16).padStart(6, '0')}`;
            const isEliminated = tank && (tank.hp === 0 || tank.eliminated);
            const hp = tank ? tank.hp : 50;
            const isCurrentTurn = id === currentPlayer && !isEliminated && gameState === 'playing';
            const isYou = id === myPlayerId;

            let styling = `color: ${hexColor};`;
            let cssClass = 'player-item';

            if (isEliminated) {
                styling += ' text-decoration: line-through; opacity: 0.5;';
            }

            if (isCurrentTurn) {
                cssClass += ' current-turn';
                styling += ' font-weight: bold; background-color: rgba(255, 255, 255, 0.1); padding: 2px 4px; border-radius: 3px;';
            }

            const youPrefix = isYou ? '⚇ ' : '';
            const heart = isEliminated ? '✖ ' : `🛡 ${hp}/50`;
            const lockStatus = (tank && tank.lockText && tank.lockText.visible && tank.lockText.text === '[LOCKED IN]') ? ' ꗃ' : '';
            const turnIndicator = isCurrentTurn ? ' ▶' : '';
            const displayName = `${youPrefix}${name} ${heart}${lockStatus}${turnIndicator}`;

            return `<div class="${cssClass}" style="${styling}">${displayName}</div>`;
        }).join('');
    }
}

function resetGameState() {
    console.log('Resetting game state');

    gameState = 'waiting';
    gameStarted = false; 
    currentTurn = 0;
    volleyCount = 0; 
    isMyTurn = false;
    canFire = false;
    myTank = null;
    playerTanks.clear();
    playerUsernames.clear();
    bullets = [];

    tankFavicon.updateFavicon(null, 'waiting');

    for (const g of allBulletGraphics) {
        if (g.parent) {
            g.parent.removeChild(g);
        }
    }
    allBulletGraphics = [];
    bulletTrail.clear();
    globalBulletTrail.clear();
    persistentTrail.clear();

    visualPredictions.clear();
    playerInterpolation.clear();

    terrain = [];
    heights = [];
    collapseRegs = [];

    if (tctx) {
        tctx.clearRect(0, 0, TERR_WIDTH, TERR_HEIGHT);
        ttex.update();
    }

    document.title = 'the tankening';
    const turnIndicator = document.getElementById('turnIndicator');
    if (turnIndicator) turnIndicator.textContent = 'Waiting...';
    const angleVal = document.getElementById('angleVal');
    if (angleVal) angleVal.textContent = '...';
    const powerVal = document.getElementById('powerVal');
    if (powerVal) powerVal.textContent = '...';

    console.log('Game state reset - volley count:', volleyCount);
}

function startGameEndCountdown(endMessage) {
    // Just show the message, server handles restart
    addChatMessage(endMessage);
    
    tankFavicon.ctx.clearRect(0, 0, 32, 32);
    tankFavicon.ctx.fillStyle = '#1e1e2e';
    tankFavicon.ctx.fillRect(0, 0, 32, 32);
    tankFavicon.ctx.fillStyle = '#f9e2af';
    tankFavicon.ctx.font = 'bold 16px Arial';
    tankFavicon.ctx.textAlign = 'center';
    tankFavicon.ctx.textBaseline = 'middle';
    tankFavicon.ctx.fillText('🎉', 16, 16);
    tankFavicon.currentFaviconLink.href = tankFavicon.canvas.toDataURL('image/png');
}

document.getElementById('connectBtn').onclick = () => {
    console.log('Connect button clicked');
    myUsername = document.getElementById('username').value || 'Player1';
    console.log('Connecting with username:', myUsername);
    initializeNetwork();
    initializeGame();

    sendToServer({ 
        type: 'join-room',
        username: myUsername
    });
};

app.view.addEventListener("mousedown", e => {
    if (e.button === 2) {
        // Right click - camera drag (unchanged)
        dragging = true;
        document.body.style.cursor = 'grabbing';
        last.x = e.clientX;
        last.y = e.clientY;
        velocity.x = 0;
        velocity.y = 0;
        dragFrameTime = performance.now();
    }
    if (e.button === 1) { 
        // Middle click - fire bullet
        e.preventDefault();
        console.log('🖱️ Middle click detected - attempting to fire');
        
        if (!isMyTurn) {
            console.log('❌ Middle click blocked: Not your turn');
            return;
        }
        if (gameState !== 'playing') {
            console.log('❌ Middle click blocked: Game state is', gameState);
            return;
        }
        if (!canFire) {
            console.log('❌ Middle click blocked: canFire is false');
            return;
        }
        if (bullets.length > 0) {
            console.log('❌ Middle click blocked: Bullets in flight:', bullets.length);
            return;
        }
        if (tanksSettling) {
            console.log('❌ Middle click blocked: Tanks are settling');
            return;
        }
        
        fireBullet();
    }
    if (e.button === 0) { 
        // Left click - aim (unchanged but with validation)
        if (gameState !== 'playing' || !myTank || !isMyTurn || bullets.length > 0) {
            console.log('🖱️ Left click ignored - invalid state for aiming');
            return;
        }
        maiming = true;
        document.body.style.cursor = 'crosshair';
        const worldPos = screenToWorld(e.clientX, e.clientY);
        const angle = calculateAngleToPoint(myTank, worldPos.x, worldPos.y);
        myTank.barrelAngleDeg = Math.round(angle);
        queueUpdate();
        updateTankDisplay(myTank);
    }
});

app.view.addEventListener("contextmenu", e => e.preventDefault());

app.view.addEventListener("mouseup", () => {
    document.body.style.cursor = '';
    dragging = false;
    maiming = false;
});

const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
const MARGIN = 1; 
const SKY_MARGIN = 1000;

app.view.addEventListener("mousemove", e => {
    if (dragging) {
        const now = performance.now();
        const dt = now - dragFrameTime;
        dragFrameTime = now;

        const dx = e.clientX - last.x;
        const dy = e.clientY - last.y;

        world.x += dx;
        world.y += dy;

        velocity.x = dx / dt;
        velocity.y = dy / dt;

        last.x = e.clientX;
        last.y = e.clientY;

        enforceWorldBounds();
    }

    if (maiming && myTank) {
        const worldPos = screenToWorld(e.clientX, e.clientY);
        const angle = calculateAngleToPoint(myTank, worldPos.x, worldPos.y);

        myTank.barrelAngleDeg = Math.round(angle);
        updateTankDisplay(myTank);

        const angleEl = document.getElementById('angleVal');
        if (angleEl) angleEl.textContent = Math.round(myTank.barrelAngleDeg + 90);

        if (isMyTurn) {
            queueUpdate();
        }
    }
});

function checkGameEnd() {
    const alivePlayers = Array.from(playerTanks.values()).filter(t => t.hp > 0 && !t.eliminated);
    
    // Just update UI, don't handle game end logic - server does that
    if (alivePlayers.length <= 1 && gameState === 'playing') {
        console.log('Game should end - server will handle this');
    }
}

app.view.addEventListener("wheel", e => {
    if (!maiming) {

        e.preventDefault();
        const zoom = 1 - e.deltaY * ZOOM_INTENSITY;
        let newTarget = scale * zoom;
        newTarget = Math.min(MAX_SCALE, newTarget);

        const rect = app.view.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        zoomAnchor = {
            worldX: (mouseX - world.x) / scale,
            worldY: (mouseY - world.y) / scale,
            screenX: mouseX,
            screenY: mouseY,
        };

        targetScale = newTarget;
    } else if (myTank && isMyTurn && bullets.length === 0) {

        e.preventDefault();
        const delta = e.deltaY < 0 ? 5 : -5;
        myTank.power = Math.max(0, Math.min(100, myTank.power + delta));
        updateTankDisplay(myTank);
        const powerEl = document.getElementById('powerVal');
        if (powerEl) powerEl.textContent = Math.round(myTank.power);
        queueUpdate();
    }
});

window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (document.activeElement && document.activeElement.id === 'chatInput') return;

    if (e.code === 'Space') {
        e.preventDefault();
        console.log('⌨️ Spacebar pressed - attempting to fire');

        if (!isMyTurn) {
            console.log('❌ Spacebar blocked: Not your turn (isMyTurn:', isMyTurn, ')');
            return;
        }
        if (gameState !== 'playing') {
            console.log('❌ Spacebar blocked: Game state is', gameState);
            return;
        }
        if (!canFire) {
            console.log('❌ Spacebar blocked: canFire is', canFire);
            return;
        }
        if (bullets.length > 0) {
            console.log('❌ Spacebar blocked: Bullets in flight:', bullets.length);
            return;
        }
        if (!myTank) {
            console.log('❌ Spacebar blocked: No tank assigned');
            return;
        }
        if (tanksSettling) {
            console.log('❌ Spacebar blocked: Tanks are settling');
            return;
        }
        
        fireBullet();
    }

    // Tank control validation (unchanged but with better logging)
    if (!myTank || gameState !== 'playing') {
        return;
    }

    let shouldUpdate = false;
    let shouldSendToServer = false;

    if (e.code === 'ArrowUp') {
        e.preventDefault();
        myTank.power = Math.min(100, myTank.power + 1);
        shouldUpdate = true;
        shouldSendToServer = isMyTurn; 
        console.log('⬆️ Power increased to:', myTank.power);
    }
    if (e.code === 'ArrowDown') {
        e.preventDefault();
        myTank.power = Math.max(0, myTank.power - 1);
        shouldUpdate = true;
        shouldSendToServer = isMyTurn;
        console.log('⬇️ Power decreased to:', myTank.power);
    }
    if (e.code === 'ArrowLeft') {
        e.preventDefault();
        myTank.barrelAngleDeg -= 1;
        shouldUpdate = true;
        shouldSendToServer = isMyTurn;
        console.log('⬅️ Angle adjusted to:', myTank.barrelAngleDeg);
    }
    if (e.code === 'ArrowRight') {
        e.preventDefault();
        myTank.barrelAngleDeg += 1;
        shouldUpdate = true;
        shouldSendToServer = isMyTurn;
        console.log('➡️ Angle adjusted to:', myTank.barrelAngleDeg);
    }

    if (shouldUpdate) {
        updateTankDisplay(myTank);

        const angleEl = document.getElementById('angleVal');
        const powerEl = document.getElementById('powerVal');
        if (angleEl) angleEl.textContent = Math.round(myTank.barrelAngleDeg + 90);
        if (powerEl) powerEl.textContent = Math.round(myTank.power);

        if (shouldSendToServer) {
            queueUpdate();
        }
    }
});

window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

function enforceWorldBounds() {
    const bounds = world.getLocalBounds();

    const worldW = bounds.width * scale;
    const worldH = bounds.height * scale;

    const viewW = app.view.clientWidth;
    const viewH = app.view.clientHeight;

    const minX = Math.min(viewW - worldW, 0) - MARGIN;
    const maxX = MARGIN;

    const minY = Math.min(viewH - worldH, 0) - MARGIN;
    const maxY = SKY_MARGIN;

    world.x = clamp(world.x, minX, maxX);
    world.y = clamp(world.y, minY, maxY);
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

function findSafeSpawnPosition() {
    const margin = 100;
    const attempts = 20;

    for (let i = 0; i < attempts; i++) {
        const x = margin + Math.random() * (TERR_WIDTH - 2 * margin);
        let tooClose = false;

        for (const [id, tank] of playerTanks) {
            if (Math.abs(tank.x - x) < TANK_W * 3) {
                tooClose = true;
                break;
            }
        }

        if (!tooClose) {
            return x;
        }
    }

    return margin + Math.random() * (TERR_WIDTH - 2 * margin);
}

function calculateAverageHP() {
    let totalHp = 0;
    let count = 0;

    for (const [id, tank] of playerTanks) {
        if (tank.hp > 0) {
            totalHp += tank.hp;
            count++;
        }
    }

    return count > 0 ? Math.round(totalHp / count) : 50;
}

function addMissingTanks() {
    const allPlayers = Array.from(playerUsernames.keys()).sort();
    const colors = [
        PALETTE.green, PALETTE.red, PALETTE.blue, PALETTE.yellow,
        PALETTE.mauve, PALETTE.pink, PALETTE.teal, PALETTE.peach
    ];

    for (const playerId of allPlayers) {
        if (!playerTanks.has(playerId)) {
            console.log('Adding tank for late joiner:', playerId);

            let spawnX = findSafeSpawnPosition();

            const playerIndex = allPlayers.indexOf(playerId);
            const color = colors[playerIndex % colors.length];

            const avgHp = calculateAverageHP();
            const tank = createTank(spawnX, color, playerId);
            tank.hp = avgHp;
            tank.updateHpBar();

            playerTanks.set(playerId, tank);
            updateTankDisplay(tank);

            if (playerId !== myPlayerId) {
                initializePlayerInterpolation(playerId, tank);
            }

            if (playerId === myPlayerId) {
                myTank = tank;
            }
        }
    }
    updatePlayerCount();
}

function showExplosionEffect(x, y, radius, color) {

    const explosion = new PIXI.Graphics()
        .beginFill(color, 1)
        .drawCircle(0, 0, radius * 0.8)
        .endFill();

    explosion.x = x;
    explosion.y = y;
    explosion.scale.set(0.5);
    world.addChild(explosion);

    gsap.to(explosion.scale, {
        x: 1.5,
        y: 1.5,
        duration: 1,
        ease: "power2.out"
    });

    gsap.to(explosion, {
        alpha: 0,
        duration: 0.8,
        ease: "power2.out",
        onComplete: () => world.removeChild(explosion)
    });
        createShockwave(x, y, radius * 2);
    applyScreenShake(2, 0.5, 6, 1.5);
}

function createDustEffect(x, y, intensity = 1) {

    for (let i = 0; i < 3; i++) {
        const particle = new PIXI.Graphics();
        particle.beginFill(PALETTE.surface1, 0.4);
        particle.drawCircle(0, 0, 1);
        particle.endFill();

        particle.x = x + (Math.random() - 0.5) * 8;
        particle.y = y;
        world.addChild(particle);

        gsap.to(particle, {
            y: particle.y - 5,
            alpha: 0,
            duration: 0.5,
            onComplete: () => world.removeChild(particle)
        });
    }
}

function createShockwave(x, y, maxRadius) {
    const shockwave = new PIXI.Graphics();
    shockwave.x = x;
    shockwave.y = y;
    world.addChild(shockwave);

    let currentRadius = 8;
    const animate = () => {
        shockwave.clear();

        if (currentRadius < maxRadius) {
            const alpha = Math.max(0, 1 - (currentRadius / maxRadius));
            const width = Math.max(1, 4 * alpha);

            shockwave.lineStyle(width, PALETTE.yellow, alpha * 0.6);
            shockwave.drawCircle(0, 0, currentRadius);

            currentRadius += 4;
            requestAnimationFrame(animate);
        } else {
            world.removeChild(shockwave);
        }
    };

    animate();
}

function updateBulletsEnhanced() {
    const HORIZONTAL_DRAG = 0.999; 

    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];

        b.vy += GRAVITY;
        b.vx *= HORIZONTAL_DRAG;

        const steps = Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vy)));
        let bulletHit = false;
        const isMyBullet = b.shooter === myTank;

        for (let s = 0; s < steps && !bulletHit; s++) {
            b.x += b.vx / steps;
            b.y += b.vy / steps;

            updateBulletTrail(b);

            if (isMyBullet) {
                persistentTrail.beginFill(PALETTE.blue, 0.4);
                persistentTrail.drawCircle(b.x, b.y, 1.2);
                persistentTrail.endFill();
            }

            const ix = Math.floor(b.x);
            const iy = Math.floor(b.y);

            const terrainHeight = getTerrainHeight(b.x);
            const bounceThreshold = terrainHeight - 150;

            const hittingLeftEdge = b.x <= 0 && b.y >= bounceThreshold;
            const hittingRightEdge = b.x >= TERR_WIDTH - 1 && b.y >= bounceThreshold;

            if (hittingLeftEdge || hittingRightEdge) {
                b.vx *= -1;
                b.x = Math.max(1, Math.min(TERR_WIDTH - 2, b.x));
                continue;
            }

            const outOfBounds = b.x < 0 || b.x >= TERR_WIDTH;
            const terrainHit = !outOfBounds && terrain[iy] && terrain[iy][ix];

            if (outOfBounds || terrainHit) {
                if (terrainHit) {
                    showExplosionEffect(ix, iy, 40, PALETTE.peach);

                    // Only send explosion if it's my bullet
                    if (isMyBullet) {
                        sendToServer({ type: 'explosion', x: ix, y: iy, radius: 40 });
                    }
                }

                // Remove bullet handling from client - server handles turn advancement
                if (b.graphics) world.removeChild(b.graphics);
                bullets.splice(i, 1);
                bulletHit = true;
                continue;
            }

            // Check tank hits
            for (const [id, tank] of playerTanks) {
                if (tank.hp > 0 && bulletHitsTank(b, tank)) {
                    showExplosionEffect(b.x, b.y, 12, PALETTE.yellow);
                    applyScreenShake(15, 0.12, 3);

                    // Only send direct hit if it's my bullet
                    if (isMyBullet) {
                        sendToServer({
                            type: 'direct-hit',
                            targetId: id,
                            damage: 20,
                            x: b.x,
                            y: b.y
                        });
                    }

                    if (b.graphics) world.removeChild(b.graphics);
                    bullets.splice(i, 1);
                    bulletHit = true;
                    break;
                }
            }
        }
    }

    renderOptimizedTrails();
}

function applyLocalInput(input) {
    if (!myTank || !isMyTurn) return false;

    let changed = false;
    switch(input.type) {
        case 'move':
            const newX = Math.max(0, Math.min(TERR_WIDTH - 1, myTank.x + input.dx));
            if (Math.abs(getTerrainHeight(newX) - getTerrainHeight(myTank.x)) <= MAX_SLOPE) {
                myTank.x = newX;
                changed = true;
            }
            break;
        case 'aim':
            myTank.barrelAngleDeg = input.angle;
            changed = true;
            break;
        case 'power':
            myTank.power = Math.max(0, Math.min(100, myTank.power + input.delta));
            changed = true;
            break;
    }

    if (changed) {
        updateTankDisplay(myTank);

        queueUpdate();
    }
    return changed;
}

const UPDATE_INTERVAL = 100; 
let updateQueue = [];
let lastUpdateTime = 0;
let scheduledUpdate = false;

function queueUpdate() {
    if (!isMyTurn || !myTank || scheduledUpdate) return;

    const now = performance.now();
    const RESPONSIVE_INTERVAL = 50; 

    if (now - lastUpdateTime >= RESPONSIVE_INTERVAL) {
        sendTankUpdate();
        lastUpdateTime = now;
    } else {
        scheduledUpdate = true;
        const timeToWait = RESPONSIVE_INTERVAL - (now - lastUpdateTime);
        setTimeout(() => {
            if (isMyTurn && myTank) { // Double check conditions
                sendTankUpdate();
            }
            lastUpdateTime = performance.now();
            scheduledUpdate = false;
        }, timeToWait);
    }
}

let lastSentTankState = {};

function sendTankUpdate() {
    if (!myTank || !socketReady || !socket || !isMyTurn) return;

    const currentState = {
        x: Math.round(myTank.x * 100) / 100, 
        y: Math.round(myTank.y * 100) / 100,
        power: Math.round(myTank.power),
        barrelAngleDeg: Math.round(myTank.barrelAngleDeg),
        angle: Math.round(myTank.angle * 1000) / 1000, 
        playerId: myPlayerId
    };

    // Only send if state has changed significantly
    const threshold = 0.1;
    const lastState = lastSentTankState;
    
    if (lastState.x !== undefined && 
        Math.abs(currentState.x - lastState.x) < threshold &&
        Math.abs(currentState.y - lastState.y) < threshold &&
        currentState.power === lastState.power &&
        currentState.barrelAngleDeg === lastState.barrelAngleDeg) {
        return; // No significant change
    }

    console.log('Sending tank update:', currentState);

    sendToServer({
        type: 'tank-move',
        ...currentState
    });

    lastSentTankState = { ...currentState };
}

function sendTankUpdate() {
    if (!myTank || !socketReady || !socket || !isMyTurn) return;

    const currentState = {
        x: Math.round(myTank.x * 100) / 100, 
        y: Math.round(myTank.y * 100) / 100,
        power: Math.round(myTank.power),
        barrelAngleDeg: Math.round(myTank.barrelAngleDeg),
        angle: Math.round(myTank.angle * 1000) / 1000, 
        playerId: myPlayerId
    };

    console.log('Sending tank update:', currentState);

    sendToServer({
        type: 'tank-move',
        ...currentState
    });

    lastSentTankState = currentState;
}

function showDamageText(x, y, damage) {
    const damageText = new PIXI.Text(`-${damage}`, {
        fontFamily: 'SpaceGrotesk',
        fontSize: 24,
        fill: PALETTE.red,
        fontWeight: 'bold'
    });
    damageText.x = x;
    damageText.y = y - 25;
    damageText.anchor.set(0.5, 0.5);
    world.addChild(damageText);

    gsap.to(damageText, {
        y: y - 100,
        alpha: 0,
        duration: 3,
        ease: "power2.out",
        onComplete: () => world.removeChild(damageText)
    });
}

function lerp(start, end, factor) {
    return start + (end - start) * factor;
}

function applyScreenShake(intensity = 30, duration = 0.5, jolts = 5, rotationIntensity = 5) {
    const originalX = world.x;
    const originalY = world.y;
    const originalRotation = world.rotation || 0;

    let jolt = 0;

    const doJolt = () => {
        const progress = jolt / jolts;
        const falloff = Math.pow(1 - progress, 2); 

        const currentIntensity = intensity * falloff;
        const currentRotation = rotationIntensity * falloff;

        const offsetX = (Math.random() - 0.5) * currentIntensity * 2;
        const offsetY = (Math.random() - 0.5) * currentIntensity * 2;
        const offsetRotation = (Math.random() - 0.5) * currentRotation * (Math.PI / 180);

        gsap.to(world, {
            x: originalX + offsetX,
            y: originalY + offsetY,
            rotation: originalRotation + offsetRotation,
            duration: duration / (jolts * 2),
            ease: "power2.out",
            onComplete: () => {
                jolt++;
                if (jolt < jolts) {
                    doJolt();
                } else {

                    gsap.to(world, {
                        x: originalX,
                        y: originalY,
                        rotation: originalRotation,
                        duration: 0.2,
                        ease: "sine.inOut"
                    });
                }
            }
        });
    };

    doJolt();
}

function canMoveTo(fromX, toX) {
    const distance = Math.abs(toX - fromX);
    if (distance === 0) return true;

    const steps = Math.max(1, Math.floor(distance));
    const stepSize = (toX - fromX) / steps;

    for (let i = 1; i <= steps; i++) {
        const checkX = fromX + (stepSize * i);
        const prevX = fromX + (stepSize * (i - 1));

        const currentY = getTerrainHeight(checkX);
        const prevY = getTerrainHeight(prevX);

        const heightDiff = Math.abs(currentY - prevY);
        const segmentDistance = Math.abs(checkX - prevX);
        const slope = segmentDistance > 0 ? heightDiff / segmentDistance : 0;

        if (slope > MAX_SLOPE) {
            return false;
        }
    }

    return true;
}

function validateAndApplyMovement(tank, newX) {
    const oldX = tank.x;

    if (!canMoveTo(oldX, newX)) {
        return false;
    }

    tank.x = newX;
    updateTankDisplay(tank);

    sendToServer({
        type: 'tank-move',
        playerId: tank.playerId,
        x: newX,
        y: tank.y,
        angle: tank.angle,
        power: tank.power,
        barrelAngleDeg: tank.barrelAngleDeg,
        validateMovement: true
    });

    return true;
}

function fitWorld() {
    const autoScale = app.renderer.width / TERR_WIDTH;

    if (scale === 1 && world.x === 0 && world.y === 0 || scale < autoScale) {
        scale = autoScale;
        targetScale = autoScale
        world.scale.set(autoScale);
        world.x = (app.renderer.width - TERR_WIDTH * autoScale) / 2;
        world.y = app.renderer.height - TERR_HEIGHT * autoScale;
    }

    for (const [id, tank] of playerTanks) {
        if (tank.nameText) tank.nameText.scale.set(1 / scale);
        updateTankDisplay(tank);
    }
}

fitWorld();

window.addEventListener("resize", () => {
    app.renderer.resize(window.innerWidth, window.innerHeight);
    fitWorld();
});

function showMuzzleFlash(tank) {
    const angle = PIXI.DEG_TO_RAD * tank.barrelAngleDeg;
    const barrelLength = 16;

    const muzzleX = tank.x + Math.cos(angle) * barrelLength;
    const muzzleY = tank.y + Math.sin(angle) * barrelLength;

    const flash = new PIXI.Graphics();
    flash.beginFill(PALETTE.yellow, 0.8);
    flash.drawCircle(0, 0, 6);
    flash.endFill();
    flash.beginFill(PALETTE.peach, 0.6);
    flash.drawCircle(0, 0, 4);
    flash.endFill();
    flash.beginFill(0xFFFFFF, 0.9);
    flash.drawCircle(0, 0, 2);
    flash.endFill();

    flash.x = muzzleX;
    flash.y = muzzleY;
    flash.scale.set(0.5);
    world.addChild(flash);

    gsap.to(flash.scale, {
        x: 1.5,
        y: 1.5,
        duration: 0.06,
        ease: "power2.out"
    });

    gsap.to(flash, {
        alpha: 0,
        duration: 0.12,
        ease: "power2.out",
        onComplete: () => world.removeChild(flash)
    });
}

class TankFavicon {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 32;
        this.canvas.height = 32;
        this.ctx = this.canvas.getContext('2d');
        this.currentFaviconLink = null;

        this.cache = new Map();
        this.lastKey = null;
        this.pendingUpdate = null;

        this.ensureFaviconLink();
        this.updateFavicon(null, 'waiting');
    }

    ensureFaviconLink() {
        const existingLink = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
        if (existingLink) existingLink.remove();

        this.currentFaviconLink = document.createElement('link');
        this.currentFaviconLink.rel = 'icon';
        this.currentFaviconLink.type = 'image/png';
        document.head.appendChild(this.currentFaviconLink);
    }

    pixiColorToHex(color) {
        return '#' + (color & 0xFFFFFF).toString(16).padStart(6, '0');
    }

    getCacheKey(color, isMyTurn, gameState) {
        return `${color}-${isMyTurn}-${gameState}`;
    }

    drawTank(color, isMyTurn = false, gameState = 'playing') {
        const ctx = this.ctx;
        const size = 32;
        ctx.clearRect(0, 0, size, size);

        if (gameState === 'waiting') {
            ctx.fillStyle = '#cdd6f4';
            ctx.font = 'bold 20px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(':)', size / 2, size / 2);
            return;
        }

        const tankColor = typeof color === 'number' ? this.pixiColorToHex(color) : (color || '#a6e3a1');
        const crustColor = '#11111b'; 

        if (isMyTurn) {
            ctx.fillStyle = '#f9e2af';
            ctx.beginPath();
            ctx.arc(6, 6, 4, 0, Math.PI * 2);
            ctx.fill();
        }

        const tankWidth = 24;
        const tankHeight = 12;
        const tankX = (size - tankWidth) / 2;
        const tankY = size - tankHeight - 2;

        const TRACK_HEIGHT = 6;
        const TRACK_WIDTH = tankWidth + 6;
        const TRACK_RADIUS = 2;

        const trackX = tankX - 3;
        const trackY = tankY + tankHeight - TRACK_HEIGHT;

        ctx.fillStyle = tankColor;
        ctx.beginPath();
        ctx.roundRect(tankX, tankY, tankWidth, tankHeight, 4);
        ctx.fill();

        ctx.fillStyle = crustColor;
        ctx.strokeStyle = tankColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(trackX, trackY, TRACK_WIDTH, TRACK_HEIGHT, TRACK_RADIUS);
        ctx.fill();
        ctx.stroke();

        const barrelLength = 14;
        const barrelX = size / 2;
        const barrelY = tankY;
        const barrelEndX = barrelX + barrelLength * Math.cos(-Math.PI / 4);
        const barrelEndY = barrelY + barrelLength * Math.sin(-Math.PI / 4);

        ctx.strokeStyle = '#cdd6f4';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(barrelX, barrelY);
        ctx.lineTo(barrelEndX, barrelEndY);
        ctx.stroke();
    }

    updateFavicon(currentPlayerId, gameState = 'playing') {
        if (!this.currentFaviconLink) this.ensureFaviconLink();

        if (gameState === 'waiting') {
            const key = this.getCacheKey('waiting', false, 'waiting');
            if (key === this.lastKey) return;
            this.lastKey = key;

            if (this.cache.has(key)) {
                this.currentFaviconLink.href = this.cache.get(key);
                return;
            }

            this.drawTank(null, false, 'waiting');
            const dataUrl = this.canvas.toDataURL('image/png');
            this.cache.set(key, dataUrl);
            this.currentFaviconLink.href = dataUrl;
            return;
        }

        let color = null;
        let isMyTurn = false;

        if (currentPlayerId) {
            const allPlayers = Array.from(playerUsernames.keys()).sort();
            const playerIndex = allPlayers.indexOf(currentPlayerId);
            const colors = [0xa6e3a1, 0xf38ba8, 0x89b4fa, 0xf9e2af, 0xcba6f7, 0xf5c2e7, 0x94e2d5, 0xfab387];
            color = colors[playerIndex % colors.length] || 0xa6e3a1;
            isMyTurn = currentPlayerId === myPlayerId;
        }

        const key = this.getCacheKey(color, isMyTurn, gameState);
        if (key === this.lastKey) return;
        this.lastKey = key;

        if (this.cache.has(key)) {
            this.currentFaviconLink.href = this.cache.get(key);
            return;
        }

        this.drawTank(color, isMyTurn, gameState);
        const dataUrl = this.canvas.toDataURL('image/png');
        this.cache.set(key, dataUrl);
        this.currentFaviconLink.href = dataUrl;
    }

    scheduleUpdate(currentPlayerId, gameState = 'playing') {
        if (this.pendingUpdate) cancelAnimationFrame(this.pendingUpdate);
        this.pendingUpdate = requestAnimationFrame(() => {
            this.updateFavicon(currentPlayerId, gameState);
            this.pendingUpdate = null;
        });
    }

    animateTurn(currentPlayerId) {
        const originalUpdate = () => this.updateFavicon(currentPlayerId);

        this.ctx.clearRect(0, 0, 32, 32);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.beginPath();
        this.ctx.arc(16, 16, 10, 0, Math.PI * 2);
        this.ctx.fill();

        this.currentFaviconLink.href = this.canvas.toDataURL('image/png');
        setTimeout(originalUpdate, 150);
    }
}

const tankFavicon = new TankFavicon();

fitWorld();
window.addEventListener('resize', fitWorld);

function logTurnState() {
    console.log('=== TURN STATE DEBUG ===');
    console.log('currentTurn:', currentTurn);
    console.log('isMyTurn:', isMyTurn);
    console.log('canFire:', canFire);
    console.log('myPlayerId:', myPlayerId);
    console.log('gameState:', gameState);
    console.log('bullets.length:', bullets.length);
    console.log('tanksSettling:', tanksSettling);

    const allPlayers = Array.from(playerUsernames.keys()).sort();
    const currentPlayer = allPlayers[currentTurn % allPlayers.length];
    console.log('All players:', allPlayers);
    console.log('Calculated current player:', currentPlayer);
    console.log('=== END TURN STATE DEBUG ===');
}

function forceSyncTurnState() {
    const allPlayers = Array.from(playerUsernames.keys()).sort();
    if (allPlayers.length === 0) return;

    const currentPlayer = allPlayers[currentTurn % allPlayers.length];
    const shouldBeMyTurn = currentPlayer === myPlayerId;

    console.log('FORCE SYNC - Before:', { isMyTurn, canFire, currentTurn, currentPlayer });

    isMyTurn = shouldBeMyTurn;
    canFire = shouldBeMyTurn;

    console.log('FORCE SYNC - After:', { isMyTurn, canFire });

    updateTurnIndicator();
}

// 7. FIXED: Add debugging function for turn state inspection
function debugTurnState() {
    console.log('🔍 === TURN STATE DEBUG ===');
    console.log('gameState:', gameState);
    console.log('gameStarted:', gameStarted);
    console.log('currentTurn:', currentTurn);
    console.log('volleyCount:', volleyCount);
    console.log('isMyTurn:', isMyTurn);
    console.log('canFire:', canFire);
    console.log('myPlayerId:', myPlayerId);
    console.log('myTank exists:', !!myTank);
    console.log('bullets.length:', bullets.length);
    console.log('tanksSettling:', tanksSettling);
    console.log('settlementTimer:', settlementTimer);
    
    const allPlayers = Array.from(playerUsernames.keys()).sort();
    console.log('All players:', allPlayers);
    
    if (allPlayers.length > 0) {
        const alivePlayers = allPlayers.filter(id => {
            const tank = playerTanks.get(id);
            return tank && tank.hp > 0 && !tank.eliminated;
        });
        console.log('Alive players:', alivePlayers);
        
        if (alivePlayers.length > 0) {
            const expectedCurrentPlayer = alivePlayers[currentTurn % alivePlayers.length];
            console.log('Expected current player:', expectedCurrentPlayer);
            console.log('Expected current player name:', getPlayerUsername(expectedCurrentPlayer));
        }
    }
    
    console.log('Tank states:');
    for (const [id, tank] of playerTanks) {
        console.log(`  ${getPlayerUsername(id)}: HP=${tank.hp}, eliminated=${tank.eliminated}, lockVisible=${tank.lockText?.visible}`);
    }
    
    console.log('🔍 === END TURN STATE DEBUG ===');
}

// Make debug function globally available
window.debugTurnState = debugTurnState;
window.forceSyncTurnState = forceSyncTurnState;
window.handlePlayerDisconnect = handlePlayerDisconnect;
window.handleLateJoinSync = handleLateJoinSync;
window.addLateJoinerTank = addLateJoinerTank;
window.findOptimalSpawnPosition = findOptimalSpawnPosition;
window.handleServerMessage = handleServerMessage;
window.handleTankMoveMessage = handleTankMoveMessage;
window.handleTurnChange = handleTurnChange;
window.queueUpdate = queueUpdate;
window.sendTankUpdate = sendTankUpdate;
window.updatePlayerCount = updatePlayerCount;
window.initializeNetwork = initializeNetwork;
