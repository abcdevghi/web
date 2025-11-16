// game.js - Main game orchestration, input handling, UI, game loop

import { TERR_WIDTH, TERR_HEIGHT, TANK_W, TANK_H, ZOOM_EASE, MAX_SCALE, MIN_SCALE, ZOOM_INTENSITY, EDGE_MARGIN, SKY_MARGIN, MARGIN, SETTLEMENT_TIME, RESPONSIVE_INTERVAL, getPlayerColor, getAllPlayerColors } from './config.js';
import { NetworkManager, createMessageHandlers } from './network.js';
import { TerrainManager } from './terrain.js';
import { TankManager, BulletManager, EffectsManager, TankFavicon } from './tank.js';
import { PALETTE } from './palette.js';
import noise from './noise.js';

export class Game {
    constructor(PALETTE, noise) {
        this.PALETTE = PALETTE;
        this.noise = noise;

        // Game state
        this.gameState = 'waiting';
        this.gameStarted = false;
        this.currentTurn = 0;
        this.volleyCount = 0;
        this.isMyTurn = false;
        this.canFire = false;
        this.tanksSettling = false;
        this.settlementTimer = 0;
        this.newSeed = 1;

        // Player state
        this.myPlayerId = null;
        this.myUsername = 'Player1';
        this.myTank = null;
        this.playerUsernames = new Map();

        // Input state
        this.keys = {};
        this.mouse = { x: 0, y: 0 };
        this.dragging = false;
        this.maiming = false;
        this.last = { x: 0, y: 0 };
        this.velocity = { x: 0, y: 0 };
        this.dragFrameTime = 0;

        // Camera state
        this.scale = 1;
        this.targetScale = 1;
        this.autoScale = 1;
        this.zoomAnchor = null;

        // Network throttling
        this.lastSentTankState = {};
        this.scheduledUpdate = false;
        this.lastUpdateTime = 0;

        // Initialize PIXI
        this.initializePixi();

        // Initialize managers
        this.network = new NetworkManager();
        this.terrainManager = new TerrainManager(this.noise, this.PALETTE, this.ttex, this.tctx);
        this.tankManager = new TankManager(this.world, this.PALETTE, this.terrainManager, this);
        this.bulletManager = new BulletManager(this.world, this.PALETTE, this.terrainManager, this);
        this.effectsManager = new EffectsManager(this.world, this.PALETTE, this);
        this.tankFavicon = new TankFavicon(this.PALETTE, getPlayerColor);

        // Setup network message handlers
        this.setupNetworkHandlers();

        // Setup input handlers
        this.setupInputHandlers();

        // Initialize game loop
        this.initializeGameLoop();
    }

    initializePixi() {
        this.app = new PIXI.Application({
            resizeTo: window,
            backgroundColor: this.PALETTE.base,
            autoDensity: true
        });
        document.body.appendChild(this.app.view);

        this.world = new PIXI.Container();
        this.app.stage.addChild(this.world);

        // Terrain canvas
        const tc = document.createElement('canvas');
        tc.width = TERR_WIDTH;
        tc.height = TERR_HEIGHT;
        this.tctx = tc.getContext('2d');
        this.ttex = PIXI.Texture.from(tc);
        this.ttex.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
        this.tspr = new PIXI.Sprite(this.ttex);

        // Graphics layers
        this.bulletTrail = new PIXI.Graphics();
        this.globalBulletTrail = new PIXI.Graphics();
        this.persistentTrail = new PIXI.Graphics();

        this.world.addChild(this.persistentTrail);
        this.world.addChild(this.bulletTrail);
        this.world.addChild(this.globalBulletTrail);
        this.world.addChild(this.tspr);

        // Offscreen indicators
        this.offscreenIndicators = new PIXI.Container();
        this.app.stage.addChild(this.offscreenIndicators);

        // Handle window resize
        window.addEventListener('resize', () => {
            this.app.renderer.resize(window.innerWidth, window.innerHeight);
            this.fitWorld();
        });
    }

    setupNetworkHandlers() {
        const handlers = createMessageHandlers(this);
        for (const [type, handler] of Object.entries(handlers)) {
            this.network.on(type, handler);
        }
    }

    initializeGameLoop() {
        this.app.ticker.add(() => {
            if (this.gameState !== 'playing') return;

            // Update interpolation for other players
            if (this.tankManager.playerInterpolation) {
                this.tankManager.updatePlayerInterpolation();
            }

            // Clear bullet trails
            if (this.globalBulletTrail) this.globalBulletTrail.clear();
            if (this.bulletTrail) this.bulletTrail.clear();

            // Handle player input
            this.handlePlayerInput();

            // Update bullets
            this.bulletManager.updateBullets(this.persistentTrail, this.bulletTrail, this.globalBulletTrail);

            // Check tank settlement
            this.checkTankSettlement();

            // Update offscreen indicators
            this.updateOffscreenIndicators();

            // Handle zoom
            this.handleZoom();

            // Handle camera movement
            this.handleCameraMovement();
        });

        this.app.ticker.start();
    }

    handlePlayerInput() {
        if (!this.myTank || this.bulletManager.bullets.length > 0 || this.gameState !== 'playing') {
            return;
        }

        // Chat input handler
        const chatInput = document.getElementById('chatInput');
        if (document.activeElement && document.activeElement.id === 'chatInput') {
            // Check if Enter was pressed
            if (this.keys['Enter'] && chatInput.value.trim()) {
                const message = chatInput.value.trim();
                this.network.send({
                    type: 'chat',
                    message: message
                });
                chatInput.value = '';
                chatInput.blur(); // Optional: unfocus after sending
            }
            return;
        }

        let moved = false;
        if (this.isMyTurn) {
            if (this.keys['KeyA']) {
                const newX = Math.max(TANK_W/2, this.myTank.x - 0.5);
                if (this.terrainManager.canMoveTo(this.myTank.x, newX)) {
                    this.myTank.x = newX;
                    this.tankManager.updateTankDisplay(this.myTank, this.scale);
                    moved = true;
                }
            }
            if (this.keys['KeyD']) {
                const newX = Math.min(TERR_WIDTH - TANK_W/2, this.myTank.x + 0.5);
                if (this.terrainManager.canMoveTo(this.myTank.x, newX)) {
                    this.myTank.x = newX;
                    this.tankManager.updateTankDisplay(this.myTank, this.scale);
                    moved = true;
                }
            }
            if (moved) {
                this.sendTankUpdate();
            }
        }
        const angleEl = document.getElementById('angleVal');
        const powerEl = document.getElementById('powerVal');
        if (angleEl) angleEl.textContent = Math.round(this.myTank.barrelAngleDeg + 90);
        if (powerEl) powerEl.textContent = Math.round(this.myTank.power);
    }

    checkTankSettlement() {
        let anyTankFlying = false;

        if (this.myTank && this.myTank.hp > 0) {
            this.tankManager.updateTankPhysics(this.myTank);
            this.tankManager.updateTankDisplay(this.myTank, this.scale);

            if (this.myTank.flying) {
                anyTankFlying = true;

                this.network.send({
                    type: 'tank-move',
                    playerId: this.myPlayerId,
                    x: this.myTank.x,
                    y: this.myTank.y,
                    angle: this.myTank.angle,
                    power: this.myTank.power,
                    barrelAngleDeg: this.myTank.barrelAngleDeg,
                    flying: true
                });
            }
        }

        if (this.tanksSettling) {
            this.settlementTimer += 16;

            if (!anyTankFlying) {
                if (this.settlementTimer >= SETTLEMENT_TIME) {
                    console.log('Settlement complete - server will handle turn advancement');
                    this.tanksSettling = false;
                    this.settlementTimer = 0;
                }
            }
        }
    }

    handleZoom() {
        const diff = Math.abs(this.targetScale - this.scale);
        if (diff > 0.0001) {
            this.scale += (this.targetScale - this.scale) * (ZOOM_EASE || 0.2);

            if (Math.abs(this.scale - this.autoScale) < 0.001) {
                this.scale = this.autoScale;
                this.targetScale = this.autoScale;
            }

            this.world.scale.set(this.scale);

            if (this.zoomAnchor) {
                const newWorldX = this.zoomAnchor.screenX - this.zoomAnchor.worldX * this.scale;
                const newWorldY = this.zoomAnchor.screenY - this.zoomAnchor.worldY * this.scale;

                this.world.x = newWorldX;
                this.world.y = newWorldY;
                this.enforceWorldBounds();
            }

            for (const [id, tank] of this.tankManager.playerTanks) {
                if (tank.nameText) tank.nameText.scale.set(1 / this.scale);
                if (tank.lockText) tank.lockText.scale.set(1 / this.scale);
                if (tank.hpBar) tank.hpBar.scale.set(1 / this.scale);
                this.tankManager.updateTankDisplay(tank, this.scale);
            }
        } else {
            this.zoomAnchor = null;
        }
    }

    handleCameraMovement() {
        if (!this.dragging) {
            const inertiaScaleFactor = this.scale;
            const baseFriction = 0.85;
            const friction = Math.pow(baseFriction, inertiaScaleFactor);

            this.world.x += this.velocity.x * 16;
            this.world.y += this.velocity.y * 16;

            this.velocity.x *= friction;
            this.velocity.y *= friction;

            if (Math.abs(this.velocity.x) < 0.01) this.velocity.x = 0;
            if (Math.abs(this.velocity.y) < 0.01) this.velocity.y = 0;

            this.enforceWorldBounds();
        }
    }

    enforceWorldBounds() {
        const bounds = this.world.getLocalBounds();

        const worldW = bounds.width * this.scale;
        const worldH = bounds.height * this.scale;

        const viewW = this.app.view.clientWidth;
        const viewH = this.app.view.clientHeight;

        const minX = Math.min(viewW - worldW, 0) - MARGIN;
        const maxX = MARGIN;

        const minY = Math.min(viewH - worldH, 0) - MARGIN;
        const maxY = SKY_MARGIN;

        this.world.x = this.clamp(this.world.x, minX, maxX);
        this.world.y = this.clamp(this.world.y, minY, maxY);
    }

    clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }

    fitWorld() {
        const autoScale = this.app.renderer.width / TERR_WIDTH;

        if (this.scale === 1 && this.world.x === 0 && this.world.y === 0 || this.scale < autoScale) {
            this.scale = autoScale;
            this.targetScale = autoScale;
            this.world.scale.set(autoScale);
            this.world.x = (this.app.renderer.width - TERR_WIDTH * autoScale) / 2;
            this.world.y = this.app.renderer.height - TERR_HEIGHT * autoScale;
        }

        for (const [id, tank] of this.tankManager.playerTanks) {
            if (tank.nameText) tank.nameText.scale.set(1 / this.scale);
            this.tankManager.updateTankDisplay(tank, this.scale);
        }
    }

    fireBullet() {
        console.log('=== FIRE BULLET ATTEMPT ===');
        console.log('myTank exists:', !!this.myTank);
        console.log('isMyTurn:', this.isMyTurn);
        console.log('canFire:', this.canFire);
        console.log('bullets.length:', this.bulletManager.bullets.length);
        console.log('gameState:', this.gameState);
        console.log('tanksSettling:', this.tanksSettling);

        if (!this.myTank) {
            console.log('❌ FIRE BLOCKED: No tank');
            return;
        }

        if (!this.isMyTurn) {
            console.log('❌ FIRE BLOCKED: Not my turn');
            return;
        }

        if (this.bulletManager.bullets.length > 0) {
            console.log('❌ FIRE BLOCKED: Bullets in flight:', this.bulletManager.bullets.length);
            return;
        }

        if (this.gameState !== 'playing') {
            console.log('❌ FIRE BLOCKED: Game state is:', this.gameState);
            return;
        }

        if (this.tanksSettling) {
            console.log('❌ FIRE BLOCKED: Tanks are settling');
            return;
        }

        console.log('✅ FIRING BULLET - All conditions met');

        const angle = PIXI.DEG_TO_RAD * this.myTank.barrelAngleDeg;
        const speed = this.myTank.power * 0.5;

        const barrelLength = 16;
        const startX = this.myTank.x + Math.cos(angle) * barrelLength;
        const startY = this.myTank.y + Math.sin(angle) * barrelLength;

        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed;

        this.canFire = false;
        this.isMyTurn = false;
        this.tanksSettling = true;
        this.settlementTimer = 0;

        console.log('🚀 Bullet fired - turn state reset');
        console.log('New state: canFire =', this.canFire, 'isMyTurn =', this.isMyTurn);

        if (this.myTank.lockText) {
            this.myTank.lockText.visible = true;
            this.myTank.lockText.text = '[LOCKED IN]';
            this.myTank.lockText.style.fill = this.PALETTE.blue;
            this.tankManager.updateTankDisplay(this.myTank, this.scale);
        }

        this.network.send({
            type: 'bullet-fired',
            playerId: this.myPlayerId,
            x: startX,
            y: startY,
            vx: vx,
            vy: vy,
            angle: angle,
            speed: speed
        });

        this.sendTankUpdate();
        this.persistentTrail.clear();
    }

    sendTankUpdate() {
        if (!this.myTank || !this.network.isConnected() || !this.isMyTurn) return;

        const currentState = {
            x: Math.round(this.myTank.x * 100) / 100,
            y: Math.round(this.myTank.y * 100) / 100,
            power: Math.round(this.myTank.power),
            barrelAngleDeg: Math.round(this.myTank.barrelAngleDeg),
            angle: Math.round(this.myTank.angle * 1000) / 1000,
            playerId: this.myPlayerId
        };

        const threshold = 0.1;
        const lastState = this.lastSentTankState;

        if (lastState.x !== undefined &&
            Math.abs(currentState.x - lastState.x) < threshold &&
            Math.abs(currentState.y - lastState.y) < threshold &&
            currentState.power === lastState.power &&
            currentState.barrelAngleDeg === lastState.barrelAngleDeg) {
            return;
            }

            console.log('Sending tank update:', currentState);

        this.network.send({
            type: 'tank-move',
            ...currentState
        });

        this.lastSentTankState = currentState;
    }

    queueUpdate() {
        if (!this.isMyTurn || !this.myTank || this.scheduledUpdate) return;

        const now = performance.now();

        if (now - this.lastUpdateTime >= RESPONSIVE_INTERVAL) {
            this.sendTankUpdate();
            this.lastUpdateTime = now;
        } else {
            this.scheduledUpdate = true;
            const timeToWait = RESPONSIVE_INTERVAL - (now - this.lastUpdateTime);
            setTimeout(() => {
                if (this.isMyTurn && this.myTank) {
                    this.sendTankUpdate();
                }
                this.lastUpdateTime = performance.now();
                this.scheduledUpdate = false;
            }, timeToWait);
        }
    }

    handleTurnChange(data) {
        console.log('=== TURN CHANGE START ===');
        console.log('Previous turn:', this.currentTurn, '-> New turn:', data.currentTurn);
        console.log('Current player ID from server:', data.currentPlayerId);
        console.log('Previous isMyTurn:', this.isMyTurn);
        console.log('Previous canFire:', this.canFire);

        this.currentTurn = data.currentTurn;
        if (typeof data.volleyCount === 'number') {
            this.volleyCount = data.volleyCount;
            console.log('📊 Volley count updated to:', this.volleyCount);
        }

        const newCurrentPlayer = data.currentPlayerId;
        const wasMyTurn = this.isMyTurn;

        this.isMyTurn = newCurrentPlayer === this.myPlayerId;
        this.canFire = this.isMyTurn && this.bulletManager.bullets.length === 0 && !this.tanksSettling;

        console.log('🎯 Turn change processing:');
        console.log('  New current player:', newCurrentPlayer);
        console.log('  Is my turn now:', this.isMyTurn);
        console.log('  Can fire now:', this.canFire);
        console.log('  Bullets count:', this.bulletManager.bullets.length);
        console.log('  Tanks settling:', this.tanksSettling);

        // Clear ALL lock indicators and triangles first
        for (const [id, tank] of this.tankManager.playerTanks) {
            if (tank.lockText) {
                tank.lockText.visible = false;
                tank.lockText.text = '[LOCKED IN]';
                tank.lockText.style.fill = this.PALETTE.blue;
            }
        }

        // Show turn triangle for new current player only
        const currentTank = this.tankManager.playerTanks.get(newCurrentPlayer);
        if (currentTank && currentTank.lockText) {
            this.updateTurnTriangle(currentTank, newCurrentPlayer);
            console.log('▼ Turn triangle assigned to:', this.getPlayerUsername(newCurrentPlayer));
        }

        this.tanksSettling = false;
        this.settlementTimer = 0;
        console.log('⏹️ Settlement state reset');

        this.updateTurnIndicator();

        const playerName = this.getPlayerUsername(newCurrentPlayer);
        if (this.isMyTurn) {
            this.addChatMessage(`🎯 Your turn!`);
            console.log('🎮 MY TURN - player can now shoot');
        } else {
            this.addChatMessage(`⏳ ${playerName}'s turn`);
            console.log('⏳ OTHER PLAYER TURN - waiting for:', playerName);
        }

        console.log('=== TURN CHANGE COMPLETE ===');
    }

    updateTurnTriangle(tank, playerId) {
        if (!tank.lockText) return;

        const allPlayers = Array.from(this.playerUsernames.keys()).sort();
        const playerIndex = allPlayers.indexOf(playerId);
        const playerColor = getPlayerColor(playerIndex, this.PALETTE);

        tank.lockText.text = '▼';
        tank.lockText.style.fill = playerColor;
        tank.lockText.style.fontSize = 16;
        tank.lockText.visible = true;

        console.log(`Updated turn triangle for ${this.getPlayerUsername(playerId)} with color index ${playerIndex}`);
    }

    updateTurnIndicator() {
        const allPlayers = Array.from(this.playerUsernames.keys()).sort();
        if (allPlayers.length === 0) {
            this.tankFavicon.updateFavicon(null, 'waiting', this.playerUsernames);
            return;
        }

        let currentPlayer = null;
        if (this.gameState === 'playing') {
            if (this.isMyTurn) {
                currentPlayer = this.myPlayerId;
            } else {
                const alivePlayers = allPlayers.filter(id => {
                    const tank = this.tankManager.playerTanks.get(id);
                    return tank && tank.hp > 0 && !tank.eliminated;
                });

                if (alivePlayers.length > 0) {
                    currentPlayer = alivePlayers[this.currentTurn % alivePlayers.length];
                }
            }
        }

        console.log('Update turn indicator:', {
            currentPlayer,
            myPlayerId: this.myPlayerId,
            isMyTurn: this.isMyTurn,
            canFire: this.canFire,
            gameState: this.gameState,
            currentTurn: this.currentTurn,
            allPlayersCount: allPlayers.length
        });

        if (currentPlayer) {
            const tank = this.tankManager.playerTanks.get(currentPlayer);
            if (tank && tank.hp > 0) {
                const playerName = this.getPlayerUsername(currentPlayer);
                const turnText = currentPlayer === this.myPlayerId ? 'Your Turn!' : `${playerName}'s Turn`;
                document.title = turnText;

                this.tankFavicon.animateTurn(currentPlayer);
                this.updatePlayerCount();
            }
        }
    }

    updatePlayerCount() {
        console.log('Updating player count, current players:', this.playerUsernames);
        const count = this.playerUsernames.size;
        const playerList = document.getElementById('playerList');

        const volleyCountEl = document.getElementById('volleyCount');
        if (volleyCountEl) {
            const displayVolley = this.gameStarted ? this.volleyCount + 1 : 1;
            volleyCountEl.textContent = displayVolley;
            console.log('Displaying volley:', displayVolley, 'Internal count:', this.volleyCount);
        }

        if (playerList && count > 0) {
            const allPlayers = Array.from(this.playerUsernames.keys()).sort();
            const colors = getAllPlayerColors(this.PALETTE);

            let currentPlayer = null;
            if (this.gameState === 'playing' && allPlayers.length > 0) {
                if (this.isMyTurn) {
                    currentPlayer = this.myPlayerId;
                } else {
                    for (const [id, tank] of this.tankManager.playerTanks) {
                        if (tank.lockText && tank.lockText.visible && tank.lockText.text === '▼') {
                            currentPlayer = id;
                            break;
                        }
                    }

                    if (!currentPlayer) {
                        const alivePlayers = allPlayers.filter(id => {
                            const tank = this.tankManager.playerTanks.get(id);
                            return tank && tank.hp > 0 && !tank.eliminated;
                        });
                        if (alivePlayers.length > 0) {
                            currentPlayer = alivePlayers[this.currentTurn % alivePlayers.length];
                        }
                    }
                }
            }

            playerList.innerHTML = allPlayers.map((id, index) => {
                const name = this.getPlayerUsername(id);
                const tank = this.tankManager.playerTanks.get(id);
                const color = colors[index % colors.length];
                const hexColor = `#${color.toString(16).padStart(6, '0')}`;
                const isEliminated = tank && (tank.hp === 0 || tank.eliminated);
                const hp = tank ? tank.hp : 50;
                const isCurrentTurn = id === currentPlayer && !isEliminated && this.gameState === 'playing';
                const isYou = id === this.myPlayerId;

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

    updateOffscreenIndicators() {
        this.offscreenIndicators.removeChildren();

        const screenBounds = {
            left: -this.world.x / this.world.scale.x,
            right: (this.app.screen.width - this.world.x) / this.world.scale.x,
            top: -this.world.y / this.world.scale.y,
            bottom: (this.app.screen.height - this.world.y) / this.world.scale.y
        };

        for (const [id, tank] of this.tankManager.playerTanks) {
            if (tank.hp <= 0) continue;

            const isOffscreen = tank.x < screenBounds.left ||
            tank.x > screenBounds.right ||
            tank.y < screenBounds.top ||
            tank.y > screenBounds.bottom;

            if (isOffscreen) {
                this.createOffscreenIndicator(tank, 'tank', id);
            }
        }

        for (const bullet of this.bulletManager.bullets) {
            const isOffscreen = bullet.x < screenBounds.left ||
            bullet.x > screenBounds.right ||
            bullet.y < screenBounds.top ||
            bullet.y > screenBounds.bottom;

            if (isOffscreen) {
                this.createOffscreenIndicator(bullet, 'bullet');
            }
        }
    }

    createOffscreenIndicator(object, type, playerId = null) {
        const indicator = new PIXI.Graphics();

        const screenCenter = {
            x: this.app.screen.width / 2,
            y: this.app.screen.height / 2
        };

        const worldPos = {
            x: object.x * this.world.scale.x + this.world.x,
            y: object.y * this.world.scale.y + this.world.y
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
            right: this.app.screen.width - margin,
            top: margin,
            bottom: this.app.screen.height - margin
        };

        let indicatorX, indicatorY;

        const centerX = this.app.screen.width / 2;
        const centerY = this.app.screen.height / 2;

        const maxDistX = Math.abs(normalizedDx) > 0 ?
        (normalizedDx > 0 ? screenBounds.right - centerX : centerX - screenBounds.left) / Math.abs(normalizedDx) : Infinity;
        const maxDistY = Math.abs(normalizedDy) > 0 ?
        (normalizedDy > 0 ? screenBounds.bottom - centerY : centerY - screenBounds.top) / Math.abs(normalizedDy) : Infinity;

        const maxDist = Math.min(maxDistX, maxDistY);

        indicatorX = centerX + normalizedDx * maxDist;
        indicatorY = centerY + normalizedDy * maxDist;

        if (type === 'tank') {
            const allPlayers = Array.from(this.playerUsernames.keys()).sort();
            const playerIndex = allPlayers.indexOf(playerId);
            const color = getPlayerColor(playerIndex, this.PALETTE);

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
                const nameText = new PIXI.Text(this.getPlayerUsername(playerId), {
                    fontFamily: 'SpaceGrotesk',
                    fontSize: 10,
                    fill: color
                });
                nameText.anchor.set(0.5, 0.5);
                nameText.x = indicatorX;
                nameText.y = indicatorY - 15;
                this.offscreenIndicators.addChild(nameText);
            }

        } else if (type === 'bullet') {
            indicator.beginFill(this.PALETTE.yellow, 0.9);
            indicator.drawCircle(indicatorX, indicatorY, 4);
            indicator.endFill();
        }

        this.offscreenIndicators.addChild(indicator);
    }

    // Helper functions
    getPlayerUsername(playerId) {
        if (this.playerUsernames.has(playerId)) {
            return this.playerUsernames.get(playerId);
        }
        return playerId.slice(0, 8);
    }

    addChatMessage(message) {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;
        const div = document.createElement('div');
        div.textContent = `${message}`;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    showGameUI() {
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

    checkGameEnd() {
        const alivePlayers = Array.from(this.tankManager.playerTanks.values()).filter(t => t.hp > 0 && !t.eliminated);

        if (alivePlayers.length <= 1 && this.gameState === 'playing') {
            console.log('Game should end - server will handle this');
        }
    }

    resetGameState() {
        console.log('Resetting game state');

        this.gameState = 'waiting';
        this.gameStarted = false;
        this.currentTurn = 0;
        this.volleyCount = 0;
        this.isMyTurn = false;
        this.canFire = false;
        this.myTank = null;
        this.tankManager.playerTanks.clear();
        this.playerUsernames.clear();
        this.bulletManager.bullets = [];

        this.tankFavicon.updateFavicon(null, 'waiting', this.playerUsernames);

        this.bulletTrail.clear();
        this.globalBulletTrail.clear();
        this.persistentTrail.clear();

        this.tankManager.playerInterpolation.clear();

        this.terrainManager.terrain = [];
        this.terrainManager.heights = [];
        this.terrainManager.collapseRegs = [];

        if (this.tctx) {
            this.tctx.clearRect(0, 0, TERR_WIDTH, TERR_HEIGHT);
            this.ttex.update();
        }

        document.title = 'the tankening';
        const turnIndicator = document.getElementById('turnIndicator');
        if (turnIndicator) turnIndicator.textContent = 'Waiting...';
        const angleVal = document.getElementById('angleVal');
        if (angleVal) angleVal.textContent = '...';
        const powerVal = document.getElementById('powerVal');
        if (powerVal) powerVal.textContent = '...';

        console.log('Game state reset - volley count:', this.volleyCount);
    }

    handlePlayerDisconnect(playerId) {
        console.log('Player disconnected:', playerId);

        if (this.tankManager.playerTanks.has(playerId)) {
            const tank = this.tankManager.playerTanks.get(playerId);
            if (this.world && this.world.removeChild) {
                this.world.removeChild(tank);
                if (tank.nameText && tank.nameText.parent) this.world.removeChild(tank.nameText);
                if (tank.lockText && tank.lockText.parent) this.world.removeChild(tank.lockText);
                if (tank.hpBar && tank.hpBar.parent) this.world.removeChild(tank.hpBar);
            }
            this.tankManager.playerTanks.delete(playerId);
        }

        this.playerUsernames.delete(playerId);
        this.tankManager.playerInterpolation.delete(playerId);

        if (playerId === this.myPlayerId) {
            this.resetGameState();
            setTimeout(() => {
                if (this.myUsername) {
                    console.log('Attempting to reconnect...');
                    this.network.initialize();
                    setTimeout(() => {
                        this.network.send({
                            type: 'join-room',
                            username: this.myUsername.split('#')[0]
                        });
                    }, 1000);
                }
            }, 3000);
        } else {
            this.updatePlayerCount();
            this.updateTurnIndicator();
            this.checkGameEnd();
        }
    }

    addLateJoinerTank(playerId) {
        if (this.tankManager.playerTanks.has(playerId)) {
            console.log('Tank already exists for late joiner:', playerId);
            return;
        }

        console.log('Adding late joiner tank for:', playerId);

        const allPlayers = Array.from(this.playerUsernames.keys()).sort();
        const colors = getAllPlayerColors(this.PALETTE);

        let x = this.findOptimalSpawnPosition();

        let totalHp = 0, count = 0;
        for (const t of this.tankManager.playerTanks.values()) {
            if (t.hp > 0) { totalHp += t.hp; count++; }
        }
        const avgHp = count > 0 ? Math.round(totalHp / count) : 50;

        const playerIndex = allPlayers.indexOf(playerId);
        const color = colors[playerIndex % colors.length];
        const tank = this.tankManager.createTank(x, color, playerId);
        tank.hp = avgHp;
        tank.updateHpBar();

        this.tankManager.playerTanks.set(playerId, tank);

        if (playerId !== this.myPlayerId) {
            this.tankManager.initializePlayerInterpolation(playerId, tank);
        } else {
            this.myTank = tank;
        }

        this.tankManager.updateTankDisplay(tank, this.scale);
        this.updatePlayerCount();

        this.network.send({
            type: 'tank-spawn',
            playerId,
            x: tank.x,
            y: tank.y,
            hp: tank.hp,
            color: color
        });
    }

    findOptimalSpawnPosition() {
        const margin = 100;
        const minDistance = TANK_W * 3;
        const attempts = 50;

        for (let i = 0; i < attempts; i++) {
            const x = margin + Math.random() * (TERR_WIDTH - 2 * margin);
            const surfaceY = this.terrainManager.getTerrainHeight(x);

            let validPosition = true;
            for (const [id, tank] of this.tankManager.playerTanks) {
                if (Math.abs(tank.x - x) < minDistance) {
                    validPosition = false;
                    break;
                }
            }

            if (validPosition) {
                const leftY = this.terrainManager.getTerrainHeight(Math.max(0, x - 20));
                const rightY = this.terrainManager.getTerrainHeight(Math.min(TERR_WIDTH - 1, x + 20));
                const slope = Math.abs(leftY - rightY) / 40;

                if (slope <= 3) {
                    return x;
                }
            }
        }

        return margin + Math.random() * (TERR_WIDTH - 2 * margin);
    }

    addMissingTanks() {
        const allPlayers = Array.from(this.playerUsernames.keys()).sort();
        const colors = getAllPlayerColors(this.PALETTE);

        for (const playerId of allPlayers) {
            if (!this.tankManager.playerTanks.has(playerId)) {
                console.log('Adding tank for late joiner:', playerId);

                let spawnX = this.findOptimalSpawnPosition();

                const playerIndex = allPlayers.indexOf(playerId);
                const color = colors[playerIndex % colors.length];

                let avgHp = 50;
                let totalHp = 0, count = 0;
                for (const [id, tank] of this.tankManager.playerTanks) {
                    if (tank.hp > 0) {
                        totalHp += tank.hp;
                        count++;
                    }
                }
                if (count > 0) avgHp = Math.round(totalHp / count);

                const tank = this.tankManager.createTank(spawnX, color, playerId);
                tank.hp = avgHp;
                tank.updateHpBar();

                this.tankManager.playerTanks.set(playerId, tank);
                this.tankManager.updateTankDisplay(tank, this.scale);

                if (playerId !== this.myPlayerId) {
                    this.tankManager.initializePlayerInterpolation(playerId, tank);
                }

                if (playerId === this.myPlayerId) {
                    this.myTank = tank;
                }
            }
        }
        this.updatePlayerCount();
    }

    handleLateJoinSync(data) {
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

        if (!this.gameStarted || this.gameState !== 'playing') {
            this.resetGameState();
            this.gameState = 'playing';
            this.gameStarted = true;
            this.currentTurn = data.currentTurn || 0;
            this.volleyCount = data.gameMetadata?.volleyCount || 0;

            console.log('📍 Game state initialized for late joiner');
            console.log('Current turn:', this.currentTurn, 'Volley count:', this.volleyCount);

            if (data.terrain && Array.isArray(data.terrain)) {
                console.log('🗺️ Loading terrain from server data');
                this.terrainManager.loadTerrain(data.terrain);
                console.log('✅ Terrain loaded from server data');

            } else if (data.seed && typeof this.terrainManager.generate === 'function') {
                console.log('🌱 Generating fresh terrain from seed:', data.seed);
                this.newSeed = data.seed;
                this.terrainManager.generate(data.seed);

                if (Array.isArray(data.allExplosions)) {
                    console.log('💥 Applying', data.allExplosions.length, 'explosions to terrain');
                    for (const blast of data.allExplosions) {
                        this.terrainManager.blastTerrainOnly(blast.x, blast.y, blast.radius);
                    }
                }
            } else {
                console.error('❌ CRITICAL: No terrain data or seed provided for late joiner!');
                return;
            }

            for (const [id, tank] of this.tankManager.playerTanks) {
                if (this.world && this.world.removeChild) {
                    this.world.removeChild(tank);
                    if (tank.nameText?.parent) this.world.removeChild(tank.nameText);
                    if (tank.lockText?.parent) this.world.removeChild(tank.lockText);
                    if (tank.hpBar?.parent) this.world.removeChild(tank.hpBar);
                }
            }
            this.tankManager.playerTanks.clear();
            this.playerUsernames.clear();
            this.tankManager.playerInterpolation.clear();

            if (data.players) {
                console.log('👥 Setting up players:', Object.keys(data.players));
                for (const [pid, uname] of Object.entries(data.players)) {
                    this.playerUsernames.set(pid, uname);
                }
            }

            if (data.tanks) {
                const colors = getAllPlayerColors(this.PALETTE);
                const allPlayers = Array.from(this.playerUsernames.keys()).sort();

                console.log('🚗 Creating tanks for players:', allPlayers);

                for (const [pid, t] of Object.entries(data.tanks)) {
                    const playerIndex = allPlayers.indexOf(pid);
                    const color = colors[playerIndex % colors.length];

                    const tank = this.tankManager.createTank(t.x, color, pid);
                    tank.y = t.y;
                    tank.angle = t.angle || 0;
                    tank.hp = t.health || t.hp || 50;
                    tank.barrelAngleDeg = t.barrelAngleDeg || -45;
                    tank.power = t.power || 30;
                    tank.eliminated = tank.hp <= 0;

                    this.tankManager.playerTanks.set(pid, tank);

                    if (pid !== this.myPlayerId) {
                        this.tankManager.initializePlayerInterpolation(pid, tank);
                    } else {
                        this.myTank = tank;
                        console.log('🎯 My tank assigned:', this.myPlayerId);
                    }

                    this.tankManager.updateTankDisplay(tank, this.scale);
                    console.log('✅ Tank created for', this.getPlayerUsername(pid), 'HP:', tank.hp);
                }
            }

            if (typeof this.terrainManager.calculateTerrainGradients === 'function') {
                this.terrainManager.calculateTerrainGradients();
            }

            if (typeof this.terrainManager.instantCollapse === 'function') {
                console.log('⚡ Applying instant terrain collapse');
                this.terrainManager.instantCollapse();
            }

            if (typeof this.terrainManager.drawTerrain === 'function') {
                console.log('🎨 Drawing terrain');
                this.terrainManager.drawTerrain();
            }
        }

        if (typeof data.currentTurn === 'number') {
            this.currentTurn = data.currentTurn;
            console.log('🔄 Turn synchronized to:', this.currentTurn);
        }

        if (data.currentPlayerId) {
            const wasMyTurn = this.isMyTurn;
            this.isMyTurn = data.currentPlayerId === this.myPlayerId;
            this.canFire = this.isMyTurn && this.bulletManager.bullets.length === 0 && !this.tanksSettling;

            console.log('🎮 Turn state synchronized:');
            console.log('  Server current player:', data.currentPlayerId);
            console.log('  My player ID:', this.myPlayerId);
            console.log('  Was my turn:', wasMyTurn);
            console.log('  Is my turn now:', this.isMyTurn);
            console.log('  Can fire:', this.canFire);

            for (const [id, tank] of this.tankManager.playerTanks) {
                if (tank.lockText) {
                    tank.lockText.visible = false;
                    tank.lockText.text = '[LOCKED IN]';
                    tank.lockText.style.fill = this.PALETTE.blue;
                }
            }

            const currentTank = this.tankManager.playerTanks.get(data.currentPlayerId);
            if (currentTank && currentTank.lockText) {
                this.updateTurnTriangle(currentTank, data.currentPlayerId);
                console.log('▲ Turn triangle set for:', this.getPlayerUsername(data.currentPlayerId));
            }
        }

        this.updateTurnIndicator();
        this.updatePlayerCount();
        this.fitWorld();

        console.log('=== LATE JOIN SYNC COMPLETE ===');
    }

    screenToWorld(screenX, screenY) {
        return {
            x: (screenX - this.world.x) / this.world.scale.x,
            y: (screenY - this.world.y) / this.world.scale.y
        };
    }

    calculateAngleToPoint(tank, worldX, worldY) {
        const dx = worldX - tank.x;
        const dy = worldY - tank.y;
        return Math.atan2(dy, dx) * PIXI.RAD_TO_DEG;
    }

    setupInputHandlers() {
        // Mouse handlers
        this.app.view.addEventListener("mousedown", e => {
            if (e.button === 2) {
                // Right click - camera drag
                this.dragging = true;
                document.body.style.cursor = 'grabbing';
                this.last.x = e.clientX;
                this.last.y = e.clientY;
                this.velocity.x = 0;
                this.velocity.y = 0;
                this.dragFrameTime = performance.now();
            }
            if (e.button === 1) {
                // Middle click - fire bullet
                e.preventDefault();
                console.log('🖱️ Middle click detected - attempting to fire');
                this.fireBullet();
            }
            if (e.button === 0) {
                // Left click - aim
                if (this.gameState !== 'playing' || !this.myTank || !this.isMyTurn || this.bulletManager.bullets.length > 0) {
                    console.log('🖱️ Left click ignored - invalid state for aiming');
                    return;
                }
                this.maiming = true;
                document.body.style.cursor = 'crosshair';
                const worldPos = this.screenToWorld(e.clientX, e.clientY);
                const angle = this.calculateAngleToPoint(this.myTank, worldPos.x, worldPos.y);
                this.myTank.barrelAngleDeg = Math.round(angle);
                this.queueUpdate();
                this.tankManager.updateTankDisplay(this.myTank, this.scale);
            }
        });

        this.app.view.addEventListener("contextmenu", e => e.preventDefault());

        this.app.view.addEventListener("mouseup", () => {
            document.body.style.cursor = '';
            this.dragging = false;
            this.maiming = false;
        });

        this.app.view.addEventListener("mousemove", e => {
            if (this.dragging) {
                const now = performance.now();
                const dt = now - this.dragFrameTime;
                this.dragFrameTime = now;

                const dx = e.clientX - this.last.x;
                const dy = e.clientY - this.last.y;

                this.world.x += dx;
                this.world.y += dy;

                this.velocity.x = dx / dt;
                this.velocity.y = dy / dt;

                this.last.x = e.clientX;
                this.last.y = e.clientY;

                this.enforceWorldBounds();
            }

            if (this.maiming && this.myTank) {
                const worldPos = this.screenToWorld(e.clientX, e.clientY);
                const angle = this.calculateAngleToPoint(this.myTank, worldPos.x, worldPos.y);

                this.myTank.barrelAngleDeg = Math.round(angle);
                this.tankManager.updateTankDisplay(this.myTank, this.scale);

                const angleEl = document.getElementById('angleVal');
                if (angleEl) angleEl.textContent = Math.round(this.myTank.barrelAngleDeg + 90);

                if (this.isMyTurn) {
                    this.queueUpdate();
                }
            }
        });

        this.app.view.addEventListener("wheel", e => {
            if (!this.maiming) {
                e.preventDefault();
                const zoom = 1 - e.deltaY * ZOOM_INTENSITY;
                let newTarget = this.scale * zoom;
                newTarget = Math.min(MAX_SCALE, newTarget);

                const rect = this.app.view.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                this.zoomAnchor = {
                    worldX: (mouseX - this.world.x) / this.scale,
                                       worldY: (mouseY - this.world.y) / this.scale,
                                       screenX: mouseX,
                                       screenY: mouseY,
                };

                this.targetScale = newTarget;
            } else if (this.myTank && this.isMyTurn && this.bulletManager.bullets.length === 0) {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 5 : -5;
                this.myTank.power = Math.max(0, Math.min(100, this.myTank.power + delta));
                this.tankManager.updateTankDisplay(this.myTank, this.scale);
                const powerEl = document.getElementById('powerVal');
                if (powerEl) powerEl.textContent = Math.round(this.myTank.power);
                this.queueUpdate();
            }
        });

        // Keyboard handlers
        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            if (document.activeElement && document.activeElement.id === 'chatInput') return;

            if (e.code === 'Space') {
                e.preventDefault();
                console.log('⌨️ Spacebar pressed - attempting to fire');
                this.fireBullet();
            }

            if (!this.myTank || this.gameState !== 'playing') {
                return;
            }

            let shouldUpdate = false;
            let shouldSendToServer = false;

            if (e.code === 'ArrowUp') {
                e.preventDefault();
                this.myTank.power = Math.min(100, this.myTank.power + 1);
                shouldUpdate = true;
                shouldSendToServer = this.isMyTurn;
            }
            if (e.code === 'ArrowDown') {
                e.preventDefault();
                this.myTank.power = Math.max(0, this.myTank.power - 1);
                shouldUpdate = true;
                shouldSendToServer = this.isMyTurn;
            }
            if (e.code === 'ArrowLeft') {
                e.preventDefault();
                this.myTank.barrelAngleDeg -= 1;
                shouldUpdate = true;
                shouldSendToServer = this.isMyTurn;
            }
            if (e.code === 'ArrowRight') {
                e.preventDefault();
                this.myTank.barrelAngleDeg += 1;
                shouldUpdate = true;
                shouldSendToServer = this.isMyTurn;
            }

            if (shouldUpdate) {
                this.tankManager.updateTankDisplay(this.myTank, this.scale);

                const angleEl = document.getElementById('angleVal');
                const powerEl = document.getElementById('powerVal');
                if (angleEl) angleEl.textContent = Math.round(this.myTank.barrelAngleDeg + 90);
                if (powerEl) powerEl.textContent = Math.round(this.myTank.power);

                if (shouldSendToServer) {
                    this.queueUpdate();
                }
            }
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });
    }
}

// Initialize game when DOM is ready
let game;

document.addEventListener('DOMContentLoaded', () => {
    // Connect button handler
    document.getElementById('connectBtn').onclick = () => {
        console.log('Connect button clicked');
        const username = document.getElementById('username').value || 'Player1';
        console.log('Connecting with username:', username);

        game = new Game(PALETTE, noise);
        game.myUsername = username;
        game.network.initialize();

        game.network.send({
            type: 'join-room',
            username: username
        });
    };
});
