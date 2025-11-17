// tank.js - Tank management, bullets, visual effects, interpolation, favicon

import { TANK_W, TANK_H, TERR_WIDTH, TERR_HEIGHT, GRAVITY, HORIZONTAL_DRAG, TRAIL_MAX_LENGTH, SETTLEMENT_TIME, getPlayerColor } from './config.js';

export class TankManager {
    constructor(world, PALETTE, terrainManager, game) {
        this.world = world;
        this.PALETTE = PALETTE;
        this.terrainManager = terrainManager;
        this.game = game;
        this.playerTanks = new Map();
        this.playerInterpolation = new Map();
    }

    createTank(x, color, playerId) {
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
        .beginFill(this.PALETTE.crust)
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
        this.world.addChild(g.hpBar);
        g.updateHpBar = () => {
            g.hpBar.clear();
            const pct = Math.max(0, g.hp / 50);
            let barColor = this.PALETTE.green;
            if (pct < 0.3) barColor = this.PALETTE.red;
            else if (pct < 0.6) barColor = this.PALETTE.yellow;
            const barWidth = TANK_W * 3;
            const barHeight = 4;
            g.hpBar.beginFill(this.PALETTE.surface0)
            .drawRect(-barWidth / 2, -barHeight / 2, barWidth, barHeight)
            .endFill();
            g.hpBar.beginFill(barColor)
            .drawRect(-barWidth / 2, -barHeight / 2, barWidth * pct, barHeight)
            .endFill();
        };
        g.updateHpBar();
        const barrel = new PIXI.Graphics()
        .beginFill(this.PALETTE.text)
        .drawRect(0, 1, 16, 2)
        .drawCircle(0, 2, 1)
        .endFill();
        barrel.pivot.set(0, 2);
        barrel.baseLength = 16;
        barrel.recoilAmount = 0;
        barrel.isRecoiling = false;

        // Capture the barrel color in a closure variable
        const barrelColor = this.PALETTE.text;
        barrel.triggerRecoil = function() {
            if (this.isRecoiling) return;
            this.isRecoiling = true;
            this.recoilAmount = 6;
            this.clear();
            this.beginFill(barrelColor);
            this.drawRect(-this.recoilAmount, 1, this.baseLength - this.recoilAmount, 2);
            this.drawCircle(-this.recoilAmount, 2, 1);
            this.endFill();
            gsap.to(this, {
                recoilAmount: 0,
                duration: 0.8,
                ease: "none",
                onUpdate: () => {
                    this.clear();
                    this.beginFill(barrelColor);
                    this.drawRect(-this.recoilAmount, 1, this.baseLength - this.recoilAmount, 2);
                    this.drawCircle(-this.recoilAmount, 2, 1);
                    this.endFill();
                },
                onComplete: () => {
                    this.isRecoiling = false;
                }
            });
        }.bind(barrel);
        g.barrel = barrel;
        g.addChild(barrel);
        const nameText = new PIXI.Text(this.game.getPlayerUsername(playerId), {
            fontFamily: 'SpaceGrotesk',
            fontSize: 12,
            fill: playerId === this.game.myPlayerId ? this.PALETTE.yellow : this.PALETTE.text
        });
        nameText.anchor.set(0.5, 1);
        g.nameText = nameText;
        this.world.addChild(nameText);
        const lockText = new PIXI.Text('[LOCKED IN]', {
            fontFamily: 'SpaceGrotesk',
            fontSize: 12,
            fill: this.PALETTE.blue
        });
        lockText.anchor.set(0.5, 1);
        lockText.visible = false;
        g.lockText = lockText;
        this.world.addChild(lockText);
        g.angle = -Math.PI / 4;
        g.power = 30;
        g.barrelAngleDeg = -45;
        g.x = x;
        const surfaceY = this.terrainManager.getTerrainHeight(x);
        g.y = surfaceY - TANK_H;
        this.world.addChild(g);
        return g;
    }

    updateTankDisplay(tank, scale = 1) {
        if (!tank) return;

        const surfaceY = this.terrainManager.getTerrainHeight(tank.x);
        const targetY = surfaceY - TANK_H;

        if (Math.abs(tank.y - targetY) > 2) {
            tank.y = targetY;
        } else if (Math.abs(tank.y - targetY) > 0.1) {
            tank.y += (targetY - tank.y) * 0.5;
        } else {
            tank.y = targetY;
        }

        const sampleDistance = 8;
        const yL = this.terrainManager.getTerrainHeight(Math.max(0, tank.x - sampleDistance));
        const yR = this.terrainManager.getTerrainHeight(Math.min(TERR_WIDTH - 1, tank.x + sampleDistance));
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

    updateTankPhysics(tank) {
        if (tank.flying) {
            tank.vy += GRAVITY;
            tank.x += tank.vx;
            tank.y += tank.vy;

            tank.x = Math.max(TANK_W/2, Math.min(TERR_WIDTH - TANK_W/2, tank.x));

            const groundY = this.terrainManager.getTerrainHeight(Math.floor(tank.x)) - TANK_H;
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
            const groundY = this.terrainManager.getTerrainHeight(Math.floor(tank.x)) - TANK_H;
            if (Math.abs(tank.y - groundY) > 1) {
                tank.y = groundY;
            }
            tank.settling = false;
            tank.grounded = true;
        }

        tank.settling = tank.flying;
    }

    handleTankMove(data) {
        const tank = this.playerTanks.get(data.playerId);
        if (!tank) {
            console.warn('Received tank-move for unknown player:', data.playerId);
            return;
        }

        if (data.playerId === this.game.myPlayerId) {
            const positionThreshold = 3.0;
            const isMoving = this.game.keys['KeyA'] || this.game.keys['KeyD'] || this.game.maiming;

            if (!isMoving && typeof data.x === 'number' && Math.abs(data.x - tank.x) > positionThreshold) {
                console.log('Applying server position correction:', data.x, 'vs', tank.x);
                tank.x = data.x;
                this.updateTankDisplay(tank);
            }

            if (typeof data.y === 'number') tank.y = data.y;
            if (typeof data.flying === 'boolean') tank.flying = data.flying;

            return;
        }

        if (typeof data.x === 'number') tank.x = data.x;
        if (typeof data.y === 'number') tank.y = data.y;
        if (typeof data.angle === 'number') tank.angle = data.angle;
        if (typeof data.barrelAngleDeg === 'number') tank.barrelAngleDeg = data.barrelAngleDeg;
        if (typeof data.power === 'number') tank.power = data.power;
        if (typeof data.flying === 'boolean') tank.flying = data.flying;

        this.updateInterpolationTarget(data.playerId, {
            x: data.x,
            y: data.y,
            angle: data.angle || tank.angle,
            power: data.power || tank.power,
            barrelAngleDeg: data.barrelAngleDeg || tank.barrelAngleDeg,
            flying: data.flying || false
        });

        this.updateTankDisplay(tank);
    }

    handleDirectHit(data) {
        if (this.playerTanks.has(data.targetId)) {
            const tank = this.playerTanks.get(data.targetId);
            tank.hp = Math.max(0, data.newHp || tank.hp - (data.damage || 20));
            tank.updateHpBar();

            // Display damage with proper decimal formatting
            const damageDisplay = data.damage % 1 === 0 ? data.damage : data.damage.toFixed(2);
            this.game.effectsManager.showDamageText(tank.x, tank.y - 10, damageDisplay);
            this.game.effectsManager.applyScreenShake(12, 0.8, 2, 10);

            if (tank.hp === 0 && !tank.eliminated) {
                tank.eliminated = true;
                this.game.addChatMessage(`❌ ${this.game.getPlayerUsername(data.targetId)} was eliminated!`);

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

                this.game.updatePlayerCount();
                this.game.checkGameEnd();
            }
        }
    }

    resetTanks(forceReset = false) {
        const allPlayers = Array.from(this.game.playerUsernames.keys()).sort();
        console.log('Reset tanks called, players:', allPlayers, 'force:', forceReset);

        if (forceReset || this.game.gameState === 'waiting' || allPlayers.length <= 2 || this.playerTanks.size === 0) {
            console.log('Performing full tank reset');

            for (const [id, tank] of this.playerTanks) {
                if (this.world && this.world.removeChild) {
                    this.world.removeChild(tank);
                    if (tank.nameText && tank.nameText.parent) this.world.removeChild(tank.nameText);
                    if (tank.lockText && tank.lockText.parent) this.world.removeChild(tank.lockText);
                    if (tank.hpBar && tank.hpBar.parent) this.world.removeChild(tank.hpBar);
                }
            }
            this.playerTanks.clear();
            this.playerInterpolation.clear();

            const colors = [
                this.PALETTE.green, this.PALETTE.red, this.PALETTE.blue, this.PALETTE.yellow,
                this.PALETTE.mauve, this.PALETTE.pink, this.PALETTE.teal, this.PALETTE.peach
            ];
            const positions = this.generateTankPositions(allPlayers.length);

            allPlayers.forEach((playerId, index) => {
                if (index < colors.length && index < positions.length) {
                    const tank = this.createTank(positions[index], colors[index], playerId);
                    this.playerTanks.set(playerId, tank);

                    if (playerId !== this.game.myPlayerId) {
                        this.initializePlayerInterpolation(playerId, tank);
                    }

                    if (playerId === this.game.myPlayerId) {
                        this.game.myTank = tank;
                    }
                    this.updateTankDisplay(tank);
                }
            });

            this.game.volleyCount = 0;
            this.game.gameStarted = true;
            this.game.currentTurn = 0;
            this.game.gameState = 'playing';
        } else {
            console.log('Performing partial tank reset (adding missing tanks)');
            this.game.addMissingTanks();
        }

        this.game.updateTurnIndicator();
        this.game.updatePlayerCount();

        if (this.game.persistentTrail) this.game.persistentTrail.clear();
        if (this.game.bulletTrail) this.game.bulletTrail.clear();
        if (this.game.globalBulletTrail) this.game.globalBulletTrail.clear();
    }

    generateTankPositions(playerCount) {
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

    // Interpolation system
    createInterpolationData(tank) {
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

    initializePlayerInterpolation(playerId, tank) {
        this.playerInterpolation.set(playerId, this.createInterpolationData(tank));
    }

    updateInterpolationTarget(playerId, newState) {
        const tank = this.playerTanks.get(playerId);
        if (!tank) return;

        let interpData = this.playerInterpolation.get(playerId);
        if (!interpData) {
            interpData = this.createInterpolationData(tank);
            this.playerInterpolation.set(playerId, interpData);
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

    updatePlayerInterpolation() {
        const now = performance.now();

        for (const [playerId, interpData] of this.playerInterpolation) {
            if (playerId === this.game.myPlayerId) continue;

            const tank = this.playerTanks.get(playerId);
            if (!tank) continue;

            const elapsed = now - interpData.startTime;
            const progress = Math.min(1, elapsed / interpData.duration);

            const eased = this.easeOutQuart(progress);

            const newX = this.lerp(interpData.fromX, interpData.toX, eased);
            const newY = this.lerp(interpData.fromY, interpData.toY, eased);

            if (Math.abs(newX - tank.x) < 100 && Math.abs(newY - tank.y) < 100) {
                tank.x = newX;
                tank.y = newY;
                tank.angle = this.lerpAngle(interpData.fromAngle, interpData.toAngle, eased);
                tank.barrelAngleDeg = this.lerp(interpData.fromBarrelAngle, interpData.toBarrelAngle, eased);
                tank.power = this.lerp(interpData.fromPower, interpData.toPower, eased);

                this.updateTankDisplay(tank);
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

    easeOutQuart(t) {
        return 1 - Math.pow(1 - t, 4);
    }

    lerp(start, end, t) {
        return start + (end - start) * t;
    }

    lerpAngle(from, to, t) {
        const diff = to - from;
        const wrappedDiff = ((diff + Math.PI) % (2 * Math.PI)) - Math.PI;
        return from + wrappedDiff * t;
    }
}

// Bullet Manager
export class BulletManager {
    constructor(world, PALETTE, terrainManager, game) {
        this.world = world;
        this.PALETTE = PALETTE;
        this.terrainManager = terrainManager;
        this.game = game;
        this.bullets = [];
    }

    createBulletFromServer(data) {
        const shooterTank = this.game.tankManager.playerTanks.get(data.playerId);

        if (shooterTank && shooterTank.barrel && shooterTank.barrel.triggerRecoil) {
            shooterTank.barrel.triggerRecoil();
            this.game.effectsManager.showMuzzleFlash(shooterTank);
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

        this.bullets.push(bullet);
        this.world.addChild(bullet.graphics);

        console.log('Bullet created, total bullets:', this.bullets.length);
    }

    updateBullets(persistentTrail, bulletTrail, globalBulletTrail) {
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];

            b.vy += GRAVITY;
            b.vx *= HORIZONTAL_DRAG;

            const steps = Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vy)));
            let bulletHit = false;
            const isMyBullet = b.shooter === this.game.myTank;

            for (let s = 0; s < steps && !bulletHit; s++) {
                b.x += b.vx / steps;
                b.y += b.vy / steps;

                this.updateBulletTrail(b);

                if (isMyBullet) {
                    persistentTrail.beginFill(this.PALETTE.blue, 0.05);
                    persistentTrail.drawCircle(b.x, b.y, 1.2);
                    persistentTrail.endFill();
                }

                const ix = Math.floor(b.x);
                const iy = Math.floor(b.y);

                const terrainHeight = this.terrainManager.getTerrainHeight(b.x);
                const bounceThreshold = terrainHeight - 150;

                const hittingLeftEdge = b.x <= 0 && b.y >= bounceThreshold;
                const hittingRightEdge = b.x >= TERR_WIDTH - 1 && b.y >= bounceThreshold;

                if (hittingLeftEdge || hittingRightEdge) {
                    b.vx *= -1;
                    b.x = Math.max(1, Math.min(TERR_WIDTH - 2, b.x));
                    continue;
                }

                const outOfBounds = b.x < 0 || b.x >= TERR_WIDTH;
                const terrainHit = !outOfBounds && this.terrainManager.terrain[iy] && this.terrainManager.terrain[iy][ix];

                if (outOfBounds || terrainHit) {
                    if (terrainHit) {
                        this.game.effectsManager.showExplosionEffect(ix, iy, 70, this.PALETTE.peach);

                        if (isMyBullet) {
                            this.game.network.send({ type: 'explosion', x: ix, y: iy, radius: 40 });
                        }
                    }

                    if (b.graphics) this.world.removeChild(b.graphics);
                    this.bullets.splice(i, 1);
                    bulletHit = true;
                    continue;
                }

                // Check tank hits
                for (const [id, tank] of this.game.tankManager.playerTanks) {
                    if (tank.hp > 0 && this.bulletHitsTank(b, tank)) {
                        this.game.effectsManager.showExplosionEffect(b.x, b.y, 20, this.PALETTE.yellow);
                        this.game.effectsManager.applyScreenShake(15, 0.12, 3);

                        if (isMyBullet) {
                            this.game.network.send({
                                type: 'direct-hit',
                                targetId: id,
                                damage: 20,
                                x: b.x,
                                y: b.y
                            });
                        }

                        if (b.graphics) this.world.removeChild(b.graphics);
                        this.bullets.splice(i, 1);
                        bulletHit = true;
                        break;
                    }
                }
            }
        }

        this.renderOptimizedTrails(globalBulletTrail);
    }

    updateBulletTrail(bullet) {
        bullet.trail.push({ x: bullet.x, y: bullet.y });

        const speed = Math.sqrt(bullet.vx * bullet.vx + bullet.vy * bullet.vy);
        const maxLength = Math.min(TRAIL_MAX_LENGTH, Math.floor(speed * 8));

        if (bullet.trail.length > maxLength) {
            const removeCount = bullet.trail.length - maxLength;
            bullet.trail.splice(0, removeCount);
        }
    }

    renderOptimizedTrails(globalBulletTrail) {
        globalBulletTrail.clear();
        for (let i = 0; i < this.bullets.length; i++) {
            const bullet = this.bullets[i];
            if (bullet.trail.length < 2) continue;

            // Calculate bullet speed
            const speed = Math.sqrt(bullet.vx * bullet.vx + bullet.vy * bullet.vy);

            // Map speed to glow radius (5 to 10)
            // Typical max speed at launch is around 15-20, min speed before hitting ground is around 1-3
            const maxSpeed = 20; // Adjust based on your game's max bullet speed
            const minSpeed = 1;
            const speedRatio = Math.min(1, Math.max(0, (speed - minSpeed) / (maxSpeed - minSpeed)));
            const glowRadius = 5 + (speedRatio * 5); // 5 when slow, 10 when fast
                        // Core bullet
            globalBulletTrail.beginFill(this.PALETTE.yellow, 1);
            globalBulletTrail.drawCircle(bullet.x, bullet.y, 3);
            globalBulletTrail.endFill();

            // Velocity-based glow
            globalBulletTrail.beginFill(this.PALETTE.yellow, 0.3);
            globalBulletTrail.drawCircle(bullet.x, bullet.y, glowRadius);
            globalBulletTrail.endFill();
            const trail = bullet.trail;
            const maxSegments = 50;
            const sampleRate = Math.max(1, Math.floor(trail.length / maxSegments));
            for (let j = sampleRate; j < trail.length; j += sampleRate) {
                const progress = j / (trail.length - 1);
                const ageFactor = Math.pow(progress, 1.8);
                const alpha = ageFactor * 0.7;
                const width = 1.5 + ageFactor * 2.5;
                const isMyBullet = bullet.shooter === this.game.myTank;
                const trailColor = this.PALETTE.yellow;
                globalBulletTrail.lineStyle(width, trailColor, alpha);
                globalBulletTrail.moveTo(trail[j - sampleRate].x, trail[j - sampleRate].y);
                globalBulletTrail.lineTo(trail[j].x, trail[j].y);
            }
        }
    }

    bulletHitsTank(bullet, tank) {
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
}

// Effects Manager
export class EffectsManager {
    constructor(world, PALETTE, game) {
        this.world = world;
        this.PALETTE = PALETTE;
        this.game = game;
    }

    showExplosionEffect(x, y, radius, color) {
        const explosion = new PIXI.Graphics()
        .beginFill(color, 1)
        .drawCircle(0, 0, radius * 0.8)
        .endFill();

        explosion.x = x;
        explosion.y = y;
        explosion.scale.set(0.5);
        this.world.addChild(explosion);

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
            onComplete: () => this.world.removeChild(explosion)
        });

        this.createShockwave(x, y, radius * 2);
        this.applyScreenShake(2, 0.5, 6, 1.5);
    }

    createShockwave(x, y, maxRadius) {
        const shockwave = new PIXI.Graphics();
        shockwave.x = x;
        shockwave.y = y;
        this.world.addChild(shockwave);

        let currentRadius = 8;
        const animate = () => {
            shockwave.clear();

            if (currentRadius < maxRadius) {
                const alpha = Math.max(0, 1 - (currentRadius / maxRadius));
                const width = Math.max(1, 4 * alpha);

                shockwave.lineStyle(width, this.PALETTE.yellow, alpha * 0.6);
                shockwave.drawCircle(0, 0, currentRadius);

                currentRadius += 4;
                requestAnimationFrame(animate);
            } else {
                this.world.removeChild(shockwave);
            }
        };

        animate();
    }

    showDamageText(x, y, damage) {
        // Handle both number and string (already formatted) damage values
        const damageStr = typeof damage === 'string' ? damage :
        (damage % 1 === 0 ? damage.toString() : damage.toFixed(2));

        const damageText = new PIXI.Text(`-${damageStr}`, {
            fontFamily: 'SpaceGrotesk',
            fontSize: 24,
            fill: this.PALETTE.red,
            fontWeight: 'bold'
        });
        damageText.x = x;
        damageText.y = y - 25;
        damageText.anchor.set(0.5, 0.5);
        this.world.addChild(damageText);

        gsap.to(damageText, {
            y: y - 100,
            alpha: 0,
            duration: 3,
            ease: "power2.out",
            onComplete: () => this.world.removeChild(damageText)
        });
    }

    applyScreenShake(intensity = 30, duration = 0.5, jolts = 5, rotationIntensity = 5) {
        const originalX = this.world.x;
        const originalY = this.world.y;
        const originalRotation = this.world.rotation || 0;

        let jolt = 0;

        const doJolt = () => {
            const progress = jolt / jolts;
            const falloff = Math.pow(1 - progress, 2);

            const currentIntensity = intensity * falloff;
            const currentRotation = rotationIntensity * falloff;

            const offsetX = (Math.random() - 0.5) * currentIntensity * 2;
            const offsetY = (Math.random() - 0.5) * currentIntensity * 2;
            const offsetRotation = (Math.random() - 0.5) * currentRotation * (Math.PI / 180);

            gsap.to(this.world, {
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
                            gsap.to(this.world, {
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

    showMuzzleFlash(tank) {
        const angle = PIXI.DEG_TO_RAD * tank.barrelAngleDeg;
        const barrelLength = 16;

        const muzzleX = tank.x + Math.cos(angle) * barrelLength;
        const muzzleY = tank.y + Math.sin(angle) * barrelLength;

        const flash = new PIXI.Graphics();
        flash.beginFill(this.PALETTE.yellow, 0.8);
        flash.drawCircle(0, 0, 12);
        flash.endFill();
        flash.beginFill(this.PALETTE.peach, 0.6);
        flash.drawCircle(0, 0, 8);
        flash.endFill();
        flash.beginFill(0xFFFFFF, 0.9);
        flash.drawCircle(0, 0, 4);
        flash.endFill();

        flash.x = muzzleX;
        flash.y = muzzleY;
        flash.scale.set(0.5);
        this.world.addChild(flash);

        gsap.to(flash.scale, {
            x: 1.5,
            y: 1.5,
            duration: 0.06,
            ease: "power2.out"
        });

        gsap.to(flash, {
            alpha: 0,
            duration: 0.15,
            ease: "power2.out",
            onComplete: () => this.world.removeChild(flash)
        });
    }
}

// Favicon System
export class TankFavicon {
    constructor(PALETTE, getPlayerColor, game) {
        this.PALETTE = PALETTE;
        this.getPlayerColor = getPlayerColor;
        this.game = game; // Store game reference
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

    colorToHex(color) {
        // Handle both number (pixi color) and {r, g, b} object
        if (typeof color === 'number') {
            return '#' + (color & 0xFFFFFF).toString(16).padStart(6, '0');
        }
        if (color && typeof color === 'object' && 'r' in color) {
            const r = color.r.toString(16).padStart(2, '0');
            const g = color.g.toString(16).padStart(2, '0');
            const b = color.b.toString(16).padStart(2, '0');
            return `#${r}${g}${b}`;
        }
        return color; // Already a hex string
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

        const tankColor = this.colorToHex(color) || '#a6e3a1';
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

    getCacheKey(playerId, isMyTurn, gameState) {
        return `${playerId}-${isMyTurn}-${gameState}`;
    }

    updateFavicon(currentPlayerId, gameState = 'playing', playerUsernames = null) {
        if (!this.currentFaviconLink) this.ensureFaviconLink();

        if (gameState === 'waiting' || gameState === 'ended') {
            const key = `waiting-${gameState}`;
            if (key === this.lastKey) return;
            this.lastKey = key;

            if (this.cache.has(key)) {
                this.currentFaviconLink.href = this.cache.get(key);
                return;
            }

            this.drawTank(null, false, gameState);
            const dataUrl = this.canvas.toDataURL('image/png');
            this.cache.set(key, dataUrl);
            this.currentFaviconLink.href = dataUrl;
            return;
        }

        let color = null;
        let isMyTurn = false;

        if (currentPlayerId) {
            const usernames = playerUsernames || this.game?.playerUsernames;
            if (usernames) {
                const allPlayers = Array.from(usernames.keys()).sort();
                const playerIndex = allPlayers.indexOf(currentPlayerId);
                color = this.getPlayerColor(playerIndex, this.PALETTE);
                isMyTurn = currentPlayerId === this.game?.myPlayerId;
            }
        }

        const key = this.getCacheKey(currentPlayerId, isMyTurn, gameState);
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
        // Don't animate if it's not initialized yet
        if (!this.game?.playerUsernames) return;

        const originalUpdate = () => this.updateFavicon(currentPlayerId, 'playing');

        this.ctx.clearRect(0, 0, 32, 32);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.beginPath();
        this.ctx.arc(16, 16, 10, 0, Math.PI * 2);
        this.ctx.fill();

        this.currentFaviconLink.href = this.canvas.toDataURL('image/png');
        setTimeout(originalUpdate, 150);
    }
}
