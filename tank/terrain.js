// terrain.js - Improved terrain generation with smoother transitions

import { TERR_WIDTH, TERR_HEIGHT, GRADIENT_STEPS, MAX_SLOPE } from './config.js';

export class TerrainManager {
    constructor(noiseLib, palette, pixiTexture, pixiContext) {
        this.noise = noiseLib;
        this.PALETTE = palette;
        this.texture = pixiTexture;
        this.ctx = pixiContext;

        this.terrain = [];
        this.heights = [];
        this.collapseRegs = [];
        this.terrainGradientCache = Array.from({ length: TERR_WIDTH }, () =>
        new Array(TERR_HEIGHT).fill(null)
        );
        this.sharedGradientPalette = [];

        this.buildGradientPalette();
    }

    buildGradientPalette() {
        const surfaceColor = this.PALETTE.surface1;
        const baseColor = this.PALETTE.base;

        this.sharedGradientPalette = [];
        for (let i = 0; i < GRADIENT_STEPS; i++) {
            const t = i / (GRADIENT_STEPS - 1);
            this.sharedGradientPalette.push([...this.blendColors(surfaceColor, baseColor, t), 255]);
        }
    }

    blendColors(color1, color2, t) {
        const r1 = (color1 >> 16) & 0xFF, g1 = (color1 >> 8) & 0xFF, b1 = color1 & 0xFF;
        const r2 = (color2 >> 16) & 0xFF, g2 = (color2 >> 8) & 0xFF, b2 = color2 & 0xFF;

        return [
            Math.round(r1 + (r2 - r1) * t),
            Math.round(g1 + (g2 - g1) * t),
            Math.round(b1 + (b2 - b1) * t),
        ];
    }

    createPRNG(seed) {
        let state = seed | 0;
        return function() {
            state ^= state << 13;
            state ^= state >>> 17;
            state ^= state << 5;
            return ((state >>> 0) / 4294967296);
        };
    }

    // Smooth interpolation function (smoothstep)
    smoothstep(edge0, edge1, x) {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
    }

    // Apply smoothing filter to reduce jaggedness
    smoothHeights(heights, passes = 2) {
        const smoothed = [...heights];

        for (let pass = 0; pass < passes; pass++) {
            const temp = [...smoothed];
            for (let i = 1; i < smoothed.length - 1; i++) {
                // Weighted average with neighbors
                temp[i] = smoothed[i] * 0.5 +
                smoothed[i - 1] * 0.25 +
                smoothed[i + 1] * 0.25;
            }
            smoothed.splice(0, smoothed.length, ...temp);
        }

        return smoothed;
    }

    generate(seed) {
        console.log('🌍 Generating terrain with seed:', seed);

        const terrainTypes = ["plain", "mountain", "single_mountain", "valley", "cliff"];
        const firstDigit = +String(seed)[0] % terrainTypes.length;
        const type = terrainTypes[firstDigit];

        console.log('🏔️ Terrain type selected:', type);

        const rng = this.createPRNG(seed);
        this.noise.seed(seed);

        const W = TERR_WIDTH;
        const H = TERR_HEIGHT;
        const base = H * 0.75;

        // Improved amplitude ranges for better variety
        const amps = {
            plain: 0.25,
            mountain: 1.2,
            single_mountain: 0.35,
            valley: 1.0,
            cliff: 0.2
        };

        // Use RNG for all random values to ensure determinism
        const ampVariation = rng();
        const peakVariation = rng();
        const dipVariation = rng();
        const cliffVariation = rng();

        const amp = amps[type] * (0.85 + ampVariation * 0.3);
        const peakH = 70 + peakVariation * 100;
        const dipD = 70 + dipVariation * 100;
        const cliffO = 50 + cliffVariation * 80;

        // Enhanced octave settings for more natural noise
        const octs = [
            { f: 0.0015, a: 130 },  // Large features
            { f: 0.006, a: 45 },    // Medium features
            { f: 0.025, a: 12 },    // Small details
            { f: 0.08, a: 3 }       // Fine texture
        ];

        this.heights = [];

        // Better randomized feature positions using seeded RNG
        const s0Variation = rng();
        const w0Variation = rng();
        let s0 = 0.25 + s0Variation * 0.25;
        let w0 = 0.25 + w0Variation * 0.35;
        let s1 = s0 + w0;

        // Pre-generate random values for mountain peaks
        const peak1Rand = rng();
        const peak2Rand = rng();

        for (let x = 0; x <= W; x++) {
            let t = x / W;

            // Multi-octave noise for natural variation
            let e = octs.reduce((sum, o) => sum + this.noise.simplex2(x * o.f, 0) * o.a, 0);

            let y = base - e * amp;

            // Terrain type modifications with smoother transitions
            switch (type) {
                case "single_mountain":
                    if (t > s0 && t < s1) {
                        // Use smoothstep for natural mountain curve
                        const mountainT = (t - s0) / (s1 - s0);
                        const curve = Math.sin(mountainT * Math.PI);
                        const smoothCurve = this.smoothstep(0, 1, curve);
                        y -= smoothCurve * peakH * 1.4;
                    }
                    break;

                case "valley":
                    if (t > 0.25 && t < 0.75) {
                        const valleyT = (t - 0.25) / 0.5;
                        const curve = Math.sin(valleyT * Math.PI);
                        const smoothCurve = this.smoothstep(0, 1, curve);
                        y += smoothCurve * dipD;
                    }
                    break;

                case "cliff":
                    // Smoother cliff transition
                    if (t < 0.5) {
                        const cliffTransition = this.smoothstep(0.4, 0.5, t);
                        y -= cliffO * (1 - cliffTransition);
                    }
                    // Add natural variation
                    y += this.noise.simplex2(x * 0.02, 100) * 8;
                    break;

                case "mountain":
                    // Add multiple peaks for mountain terrain (using pre-generated randoms)
                    const peak1 = Math.sin(t * Math.PI * 1.5) * 40 * (peak1Rand * 0.5 + 0.5);
                    const peak2 = Math.sin(t * Math.PI * 2.3 + 1) * 30 * (peak2Rand * 0.5 + 0.5);
                    y -= peak1 + peak2;
                    break;
            }

            // Ensure terrain stays within bounds with smooth clamping
            y = Math.max(10, Math.min(H - 10, y));
            this.heights.push(y);
        }

        // Apply smoothing to reduce jaggedness
        this.heights = this.smoothHeights(this.heights, 2);

        // Additional edge smoothing to prevent harsh boundaries
        const edgeSmooth = 15;
        for (let i = 0; i < edgeSmooth; i++) {
            const leftT = i / edgeSmooth;
            const rightT = i / edgeSmooth;

            this.heights[i] = this.heights[i] * this.smoothstep(0, 1, leftT) +
            (H * 0.75) * (1 - this.smoothstep(0, 1, leftT));

            const rightIdx = this.heights.length - 1 - i;
            this.heights[rightIdx] = this.heights[rightIdx] * this.smoothstep(0, 1, rightT) +
            (H * 0.75) * (1 - this.smoothstep(0, 1, rightT));
        }

        // Build terrain from heights
        this.terrain = Array.from({ length: H }, () => new Uint8Array(W));

        for (let i = 0; i < this.heights.length; i++) {
            const px = i;
            const hy = Math.floor(this.heights[i]);
            for (let yy = hy; yy < H - 1; yy++) {
                this.terrain[yy][px] = 1;
            }
            this.terrain[H - 1][px] = 1;
        }

        this.collapseRegs = [];

        console.log('✅ Terrain generation complete');

        this.calculateTerrainGradients();
        this.drawTerrain();
    }

    calculateTerrainGradients() {
        const smoothRadius = 5;

        const surfaceYs = new Array(TERR_WIDTH).fill(null);
        for (let x = 0; x < TERR_WIDTH; x++) {
            for (let y = 0; y < TERR_HEIGHT; y++) {
                if (this.terrain[y][x]) {
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
                    this.terrainGradientCache[x][y] = null;
                } else {
                    const t = Math.min(1, (y - surfaceY) / fadeLength);
                    const idx = Math.floor(t * (GRADIENT_STEPS - 1));
                    this.terrainGradientCache[x][y] = idx;
                }
            }
        }
    }

    drawTerrain() {
        const img = this.ctx.createImageData(TERR_WIDTH, TERR_HEIGHT);

        const fallbackInt = this.PALETTE.surface1;
        const fallback = [
            (fallbackInt >> 16) & 0xFF,
            (fallbackInt >> 8) & 0xFF,
            fallbackInt & 0xFF
        ];

        for (let y = 0; y < TERR_HEIGHT; y++) {
            for (let x = 0; x < TERR_WIDTH; x++) {
                if (this.terrain[y][x]) {
                    const idx = this.terrainGradientCache[x][y];
                    const i = (y * TERR_WIDTH + x) * 4;

                    if (idx !== null && this.sharedGradientPalette[idx]) {
                        const color = this.sharedGradientPalette[idx];
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
            (this.PALETTE.pink >> 16) & 0xFF,
            (this.PALETTE.pink >> 8) & 0xFF,
            this.PALETTE.pink & 0xFF
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
                const surfaceY = this.getTerrainHeight(x);
                minY = Math.min(minY, surfaceY - 150);
            }

            const wallTopY = Math.floor(minY);

            for (let x = band.start; x < band.end; x++) {
                const surfaceY = this.getTerrainHeight(x);
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

        this.ctx.putImageData(img, 0, 0);
        this.texture.update();
    }

    getTerrainHeight(x) {
        x = Math.max(0, Math.min(TERR_WIDTH - 1, Math.floor(x)));

        for (let y = 0; y < TERR_HEIGHT; y++) {
            if (this.terrain[y] && this.terrain[y][x]) {
                return y;
            }
        }
        return TERR_HEIGHT - 1;
    }

    blast(cx, cy, r, myTank) {
        const r2 = r * r;

        for (let y = Math.max(0, cy - r); y < Math.min(TERR_HEIGHT, cy + r); y++) {
            for (let x = Math.max(0, cx - r); x < Math.min(TERR_WIDTH, cx + r); x++) {
                const dx = x - cx;
                const dy = y - cy;
                const dist2 = dx * dx + dy * dy;

                if (dist2 <= r2) {
                    this.terrain[y][x] = 0;
                }
            }
        }

        for (let x = 0; x < TERR_WIDTH; x++) {
            this.terrain[TERR_HEIGHT - 1][x] = 1;
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

                    console.log(`myTank LAUNCHED at speed ${launchSpeed.toFixed(1)}`);
                }
            }
        }

        this.instantCollapse();
        this.drawTerrain();

        return { launched: tank && tank.flying };
    }

    blastTerrainOnly(cx, cy, r) {
        const r2 = r * r;
        for (let y = Math.max(0, cy - r); y < Math.min(TERR_HEIGHT, cy + r); y++) {
            for (let x = Math.max(0, cx - r); x < Math.min(TERR_WIDTH, cx + r); x++) {
                if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) {
                    if (this.terrain[y] && this.terrain[y][x]) this.terrain[y][x] = 0;
                }
            }
        }

        for (let x = 0; x < TERR_WIDTH; x++) {
            this.terrain[TERR_HEIGHT - 1][x] = 1;
        }
    }

    instantCollapse() {
        let totalChanged = false;

        for (let x = 0; x < TERR_WIDTH; x++) {
            let writeIndex = TERR_HEIGHT - 1;

            for (let y = TERR_HEIGHT - 1; y >= 0; y--) {
                if (this.terrain[y][x] === 1) {
                    if (y !== writeIndex) {
                        this.terrain[writeIndex][x] = 1;
                        this.terrain[y][x] = 0;
                        totalChanged = true;
                    }
                    writeIndex--;
                }
            }

            this.terrain[TERR_HEIGHT - 1][x] = 1;
        }

        if (totalChanged) {
            this.drawTerrain();
        }

        return totalChanged;
    }

    canMoveTo(fromX, toX) {
        const distance = Math.abs(toX - fromX);
        if (distance === 0) return true;

        const steps = Math.max(1, Math.floor(distance));
        const stepSize = (toX - fromX) / steps;

        for (let i = 1; i <= steps; i++) {
            const checkX = fromX + (stepSize * i);
            const prevX = fromX + (stepSize * (i - 1));

            const currentY = this.getTerrainHeight(checkX);
            const prevY = this.getTerrainHeight(prevX);

            const heightDiff = Math.abs(currentY - prevY);
            const segmentDistance = Math.abs(checkX - prevX);
            const slope = segmentDistance > 0 ? heightDiff / segmentDistance : 0;

            if (slope > MAX_SLOPE) {
                return false;
            }
        }

        return true;
    }

    loadTerrain(terrainData) {
        this.terrain = terrainData.map(row => new Uint8Array(row));
        this.heights = [];

        for (let x = 0; x < TERR_WIDTH; x++) {
            for (let y = 0; y < TERR_HEIGHT; y++) {
                if (this.terrain[y] && this.terrain[y][x]) {
                    this.heights[x] = y;
                    break;
                }
            }
            if (this.heights[x] === undefined) {
                this.heights[x] = TERR_HEIGHT - 1;
            }
        }

        this.calculateTerrainGradients();
        this.drawTerrain();
    }

    handleExplosion(data) {
        if (data.tankDamage) {
            // Tank damage handled by tank manager
        }

        this.blast(data.x, data.y, Math.ceil(data.radius * 0.5), null);
    }
}
