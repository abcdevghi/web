// config.js - All game constants and configuration

export const TERR_WIDTH = 1000;
export const TERR_HEIGHT = 800;
export const TANK_W = 14;
export const TANK_H = 6;
export const GRAVITY = 0.5;
export const MAX_SLOPE = 3;
export const CELEBRATION_TIME = 10000;
export const TRAIL_MAX_LENGTH = 2000;
export const TRAIL_FADE_SEGMENTS = 10;
export const SETTLEMENT_TIME = 1500;
export const KNOCKBACK_FORCE = 12;
export const EXPLOSION_RADIUS = 40;
export const ZOOM_EASE = 0.2;
export const MAX_SCALE = 5;
export const MIN_SCALE = 1;
export const ZOOM_INTENSITY = 0.001;
export const EDGE_MARGIN = 20;
export const UI_FONT = 'SpaceGrotesk';
export const GRADIENT_STEPS = 32;
export const HORIZONTAL_DRAG = 0.999;
export const MAX_LAUNCH_SPEED = 15;
export const SKY_MARGIN = 1000;
export const MARGIN = 1;
export const UPDATE_INTERVAL = 100;
export const RESPONSIVE_INTERVAL = 50;
export const PREDICTION_TIMEOUT = 5000;

// WebSocket URL - Point to your remote server
export const WS_URL = 'wss://dono-01.danbot.host:9550/';

// Player colors (used with PALETTE)
export const PLAYER_COLORS = ['green', 'red', 'blue', 'yellow', 'mauve', 'pink', 'teal', 'peach'];

// Helper to get player color
export function getPlayerColor(playerIndex, PALETTE) {
    const colorNames = PLAYER_COLORS;
    const colorName = colorNames[playerIndex % colorNames.length];
    return PALETTE[colorName];
}

// Helper to get all player colors as hex values
export function getAllPlayerColors(PALETTE) {
    return PLAYER_COLORS.map(name => PALETTE[name]);
}
